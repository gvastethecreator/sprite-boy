import {
  compositeScene,
  createCanvas2DSceneTarget,
  createSceneDrawPlan,
  createSceneProjection,
  SceneCompositorError,
  type SceneCompositorFrame,
  type SceneCompositorTarget,
  type SceneDrawOperation,
  type SceneProjection,
} from "../../core/render";
import { createEmptyStudioProject, validateStudioProject, type StudioProjectV1 } from "../../core/project";
import type { WorkspaceState } from "../../core/stores";
import {
  sceneCompositorPixelGoldens,
  sceneCompositorProjectFixture,
  sceneCompositorRasterFixture,
  type RasterFixture,
} from "./fixtures/sceneCompositorV1";

const EMPTY_WORKSPACE: WorkspaceState = {
  panelSizes: {},
  viewports: {},
  preferences: {},
};

const PIXEL_SYMBOLS = new Map([
  ["255,0,0,255", "R"],
  ["0,255,0,255", "G"],
  ["0,0,255,255", "B"],
  ["255,255,255,255", "W"],
  ["0,255,255,255", "C"],
  ["255,0,255,255", "M"],
  ["255,255,0,255", "Y"],
  ["0,0,0,255", "K"],
  ["0,0,0,0", "."],
]);

function parseHexColor(color: string): readonly [number, number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Unsupported test color ${color}.`);
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
    255,
  ];
}

class SoftwareRasterTarget implements SceneCompositorTarget<RasterFixture> {
  frame: SceneCompositorFrame | null = null;
  pixels = new Uint8ClampedArray();
  beginCount = 0;
  endCount = 0;
  abortCount = 0;
  failDraw = false;

  beginFrame(frame: SceneCompositorFrame): void {
    if (this.frame !== null) throw new Error("frame already active");
    this.frame = frame;
    this.beginCount += 1;
    this.pixels = new Uint8ClampedArray(frame.width * frame.height * 4);
    if (frame.background !== null) {
      const color = parseHexColor(frame.background);
      for (let offset = 0; offset < this.pixels.length; offset += 4) {
        this.pixels.set(color, offset);
      }
    }
  }

  drawImage(image: RasterFixture, operation: SceneDrawOperation): void {
    if (this.frame === null) throw new Error("no frame");
    if (this.failDraw) throw new Error("test draw failure");
    const { matrix, sourceRect } = operation;
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (Math.abs(determinant) < Number.EPSILON) return;
    for (let y = 0; y < this.frame.height; y += 1) {
      for (let x = 0; x < this.frame.width; x += 1) {
        const dx = x + 0.5 - matrix.e;
        const dy = y + 0.5 - matrix.f;
        const localX = (matrix.d * dx - matrix.c * dy) / determinant;
        const localY = (-matrix.b * dx + matrix.a * dy) / determinant;
        if (
          localX < 0 || localY < 0 ||
          localX >= sourceRect.width || localY >= sourceRect.height
        ) {
          continue;
        }
        const sourceX = sourceRect.x + Math.floor(localX);
        const sourceY = sourceRect.y + Math.floor(localY);
        if (sourceX < 0 || sourceY < 0 || sourceX >= image.width || sourceY >= image.height) {
          continue;
        }
        const sourceOffset = (sourceY * image.width + sourceX) * 4;
        const targetOffset = (y * this.frame.width + x) * 4;
        this.blendPixel(targetOffset, image.pixels, sourceOffset, operation.opacity);
      }
    }
  }

  private blendPixel(
    targetOffset: number,
    source: readonly number[],
    sourceOffset: number,
    opacity: number,
  ): void {
    const sourceAlpha = (source[sourceOffset + 3] / 255) * opacity;
    const targetAlpha = this.pixels[targetOffset + 3] / 255;
    const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
    if (outputAlpha === 0) return;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = (
        source[sourceOffset + channel] * sourceAlpha +
        this.pixels[targetOffset + channel] * targetAlpha * (1 - sourceAlpha)
      ) / outputAlpha;
      this.pixels[targetOffset + channel] = Math.round(value);
    }
    this.pixels[targetOffset + 3] = Math.round(outputAlpha * 255);
  }

  endFrame(): void {
    if (this.frame === null) throw new Error("no frame");
    this.endCount += 1;
    this.frame = null;
  }

  abortFrame(): void {
    this.abortCount += 1;
    this.frame = null;
    this.pixels = new Uint8ClampedArray();
  }

  pixelRows(width: number, height: number): readonly string[] {
    const rows: string[] = [];
    for (let y = 0; y < height; y += 1) {
      let row = "";
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const key = this.pixels.slice(offset, offset + 4).join(",");
        const symbol = PIXEL_SYMBOLS.get(key);
        if (!symbol) throw new Error(`Pixel ${key} has no golden symbol.`);
        row += symbol;
      }
      rows.push(row);
    }
    return rows;
  }
}

type GoldenRoot = keyof typeof sceneCompositorPixelGoldens;

function projectionFor(root: GoldenRoot): SceneProjection {
  const project: StudioProjectV1 = structuredClone(sceneCompositorProjectFixture);
  switch (root) {
    case "asset":
      project.workspace.activeWorkspace = "assets";
      break;
    case "region":
      project.workspace.activeWorkspace = "slice";
      break;
    case "composition":
      project.workspace.activeWorkspace = "compose";
      break;
    case "variant":
      project.workspace.activeWorkspace = "compose";
      delete project.workspace.selectedCompositionId;
      delete project.workspace.selectedLayerId;
      break;
    case "cel":
      project.workspace.activeWorkspace = "animate";
      break;
  }
  return createSceneProjection({ project, revision: 4 }, EMPTY_WORKSPACE);
}

function assertDeepFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) assertDeepFrozen(descriptor.value, seen);
  }
}

interface RecordingCanvasState {
  fillStyle: string;
  globalAlpha: number;
  globalCompositeOperation: string;
  filter: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
}

function createRecordingCanvasContext(): {
  readonly context: CanvasRenderingContext2D;
  readonly calls: Array<readonly unknown[]>;
} {
  const calls: Array<readonly unknown[]> = [];
  let state: RecordingCanvasState = {
    fillStyle: "#ff00ff",
    globalAlpha: 0.4,
    globalCompositeOperation: "xor",
    filter: "blur(2px)",
    shadowColor: "red",
    shadowBlur: 5,
    shadowOffsetX: 2,
    shadowOffsetY: 3,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "high",
  };
  const stack: RecordingCanvasState[] = [];
  const context = {
    canvas: { width: 3, height: 2 },
    get fillStyle() { return state.fillStyle; },
    set fillStyle(value: string) { state.fillStyle = value; calls.push(["fillStyle", value]); },
    get globalAlpha() { return state.globalAlpha; },
    set globalAlpha(value: number) { state.globalAlpha = value; calls.push(["globalAlpha", value]); },
    get globalCompositeOperation() { return state.globalCompositeOperation; },
    set globalCompositeOperation(value: string) {
      state.globalCompositeOperation = value;
      calls.push(["globalCompositeOperation", value]);
    },
    get filter() { return state.filter; },
    set filter(value: string) { state.filter = value; calls.push(["filter", value]); },
    get shadowColor() { return state.shadowColor; },
    set shadowColor(value: string) { state.shadowColor = value; calls.push(["shadowColor", value]); },
    get shadowBlur() { return state.shadowBlur; },
    set shadowBlur(value: number) { state.shadowBlur = value; calls.push(["shadowBlur", value]); },
    get shadowOffsetX() { return state.shadowOffsetX; },
    set shadowOffsetX(value: number) { state.shadowOffsetX = value; calls.push(["shadowOffsetX", value]); },
    get shadowOffsetY() { return state.shadowOffsetY; },
    set shadowOffsetY(value: number) { state.shadowOffsetY = value; calls.push(["shadowOffsetY", value]); },
    get imageSmoothingEnabled() { return state.imageSmoothingEnabled; },
    set imageSmoothingEnabled(value: boolean) {
      state.imageSmoothingEnabled = value;
      calls.push(["imageSmoothingEnabled", value]);
    },
    get imageSmoothingQuality() { return state.imageSmoothingQuality; },
    set imageSmoothingQuality(value: ImageSmoothingQuality) {
      state.imageSmoothingQuality = value;
      calls.push(["imageSmoothingQuality", value]);
    },
    save() { stack.push({ ...state }); calls.push(["save"]); },
    restore() {
      const previous = stack.pop();
      if (!previous) throw new Error("Canvas state stack underflow.");
      state = previous;
      calls.push(["restore"]);
    },
    setTransform: (...args: unknown[]) => calls.push(["setTransform", ...args]),
    clearRect: (...args: unknown[]) => calls.push(["clearRect", ...args]),
    fillRect: (...args: unknown[]) => calls.push(["fillRect", ...args]),
    drawImage: (...args: unknown[]) => calls.push(["drawImage", ...args]),
  } as unknown as CanvasRenderingContext2D;
  return { context, calls };
}

describe("canonical scene compositor", () => {
  it("uses a valid connected fixture", () => {
    expect(validateStudioProject(sceneCompositorProjectFixture)).toMatchObject({ valid: true });
  });

  it.each([
    ["asset", 1],
    ["region", 1],
    ["composition", 2],
    ["variant", 2],
    ["cel", 2],
  ] as const)("matches the %s pixel golden", async (root, expectedDraws) => {
    const target = new SoftwareRasterTarget();
    let resolves = 0;
    const result = await compositeScene({
      projection: projectionFor(root),
      resolver: {
        resolve(asset) {
          resolves += 1;
          expect(asset.assetId).toBe("asset-atlas");
          return sceneCompositorRasterFixture;
        },
      },
      target,
    });

    expect(result.drawCount).toBe(expectedDraws);
    expect(resolves).toBe(1);
    expect(target.pixelRows(result.canvas!.width, result.canvas!.height))
      .toEqual(sceneCompositorPixelGoldens[root]);
    expect(target.beginCount).toBe(1);
    expect(target.endCount).toBe(1);
    expect(target.abortCount).toBe(0);
  });

  it("compiles bottom-to-top center transforms and cel pivot transforms", () => {
    const composition = createSceneDrawPlan(projectionFor("composition"));
    expect(composition.operations.map((operation) => operation.origin.id)).toEqual([
      "layer-main-bottom",
      "layer-main-top",
    ]);
    expect(composition.operations[0].matrix).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    expect(composition.operations[1].matrix).toEqual({ a: -1, b: 0, c: 0, d: 1, e: 3, f: 0 });

    const cel = createSceneDrawPlan(projectionFor("cel"));
    expect(cel.operations[0].matrix).toEqual({ a: 1, b: 0, c: 0, d: -1, e: 0, f: 2 });
    expect(cel.operations[1].matrix).toEqual({ a: -1, b: 0, c: 0, d: -1, e: 3, f: 2 });
    expect(JSON.parse(JSON.stringify(cel))).toEqual(cel);
    assertDeepFrozen(cel);
  });

  it("multiplies cel and layer opacity without losing painter order", () => {
    const project = structuredClone(sceneCompositorProjectFixture);
    project.workspace.activeWorkspace = "animate";
    project.cels["cel-main"].transform = {
      ...project.cels["cel-main"].transform,
      opacity: 0.5,
    };
    project.layers["layer-variant-bottom"].transform.opacity = 0.5;

    const plan = createSceneDrawPlan(
      createSceneProjection({ project, revision: 8 }, EMPTY_WORKSPACE),
    );
    expect(plan.operations.map((operation) => operation.opacity)).toEqual([0.25, 0.5]);
  });

  it("skips invisible layers and hidden regions while keeping a valid frame", () => {
    const project = structuredClone(sceneCompositorProjectFixture);
    project.workspace.activeWorkspace = "compose";
    project.layers["layer-main-top"].visible = false;
    let plan = createSceneDrawPlan(createSceneProjection({ project, revision: 1 }, EMPTY_WORKSPACE));
    expect(plan.operations.map((operation) => operation.origin.id)).toEqual(["layer-main-bottom"]);

    project.workspace.activeWorkspace = "slice";
    project.regions["region-left"].hidden = true;
    plan = createSceneDrawPlan(createSceneProjection({ project, revision: 2 }, EMPTY_WORKSPACE));
    expect(plan.canvas).toEqual({ width: 2, height: 2, background: null });
    expect(plan.operations).toEqual([]);
  });

  it("applies layer opacity with source-over compositing", async () => {
    const project = structuredClone(sceneCompositorProjectFixture);
    project.workspace.activeWorkspace = "compose";
    project.layers["layer-main-top"].transform.opacity = 0.5;
    const target = new SoftwareRasterTarget();

    await compositeScene({
      projection: createSceneProjection({ project, revision: 2 }, EMPTY_WORKSPACE),
      resolver: { resolve: () => sceneCompositorRasterFixture },
      target,
    });

    expect(Array.from(target.pixels.slice(4, 8))).toEqual([128, 255, 128, 255]);
    expect(Array.from(target.pixels.slice(8, 12))).toEqual([0, 0, 128, 255]);
  });

  it("rotates a layer around its center in logical canvas pixels", async () => {
    const project = structuredClone(sceneCompositorProjectFixture);
    project.workspace.activeWorkspace = "compose";
    delete project.layers["layer-main-top"];
    project.compositions["composition-main"].layerIds = ["layer-main-bottom"];
    project.compositions["composition-main"].width = 2;
    project.layers["layer-main-bottom"].transform.rotation = 90;
    const target = new SoftwareRasterTarget();

    const result = await compositeScene({
      projection: createSceneProjection({ project, revision: 3 }, EMPTY_WORKSPACE),
      resolver: { resolve: () => sceneCompositorRasterFixture },
      target,
    });

    expect(createSceneDrawPlan(
      createSceneProjection({ project, revision: 3 }, EMPTY_WORKSPACE),
    ).operations[0].matrix).toEqual({ a: 0, b: 1, c: -1, d: 0, e: 2, f: 0 });
    expect(target.pixelRows(result.canvas!.width, result.canvas!.height)).toEqual(["CR", "MG"]);
  });

  it("keeps viewport and unrelated WorkspaceStore state out of the content plan", () => {
    const project = structuredClone(sceneCompositorProjectFixture);
    project.workspace.activeWorkspace = "compose";
    const first = createSceneProjection({ project, revision: 3 }, {
      panelSizes: { left: 200 },
      preferences: { grid: true },
      viewports: { compose: { scale: 1, offset: { x: 0, y: 0 } } },
    });
    const second = createSceneProjection({ project, revision: 3 }, {
      panelSizes: { left: 900 },
      preferences: { grid: false },
      viewports: { compose: { scale: 8, offset: { x: 90, y: -40 } } },
    });

    expect(first.viewport).not.toEqual(second.viewport);
    expect(createSceneDrawPlan(first)).toEqual(createSceneDrawPlan(second));
  });

  it("resolves every asset before beginning and reports stable resolver failures", async () => {
    const calls: string[] = [];
    const target: SceneCompositorTarget<object> = {
      beginFrame: () => { calls.push("begin"); },
      drawImage: () => { calls.push("draw"); },
      endFrame: () => { calls.push("end"); },
      abortFrame: () => { calls.push("abort"); },
    };

    await expect(compositeScene({
      projection: projectionFor("composition"),
      resolver: { resolve: () => undefined as never },
      target,
    })).rejects.toMatchObject({
      name: "SceneCompositorError",
      code: "SCENE_ASSET_RESOLVE_FAILED",
      assetId: "asset-atlas",
    });
    expect(calls).toEqual([]);
  });

  it("aborts a partial target frame and preserves the primary failure", async () => {
    const target = new SoftwareRasterTarget();
    target.failDraw = true;

    await expect(compositeScene({
      projection: projectionFor("composition"),
      resolver: { resolve: () => sceneCompositorRasterFixture },
      target,
    })).rejects.toMatchObject({
      name: "SceneCompositorError",
      code: "SCENE_TARGET_FAILED",
      assetId: "asset-atlas",
    });
    expect(target.beginCount).toBe(1);
    expect(target.endCount).toBe(0);
    expect(target.abortCount).toBe(1);
    expect(target.frame).toBeNull();
    expect(target.pixels).toHaveLength(0);
  });

  it("aborts when target finalization fails", async () => {
    const calls: string[] = [];
    let active = false;
    const target: SceneCompositorTarget<RasterFixture> = {
      beginFrame() { active = true; calls.push("begin"); },
      drawImage() { calls.push("draw"); },
      endFrame() { calls.push("end"); throw new Error("flush failed"); },
      abortFrame() { active = false; calls.push("abort"); },
    };

    await expect(compositeScene({
      projection: projectionFor("region"),
      resolver: { resolve: () => sceneCompositorRasterFixture },
      target,
    })).rejects.toMatchObject({
      name: "SceneCompositorError",
      code: "SCENE_TARGET_FAILED",
    });
    expect(calls).toEqual(["begin", "draw", "end", "abort"]);
    expect(active).toBe(false);
  });

  it("does not touch ports for an empty scene", async () => {
    const projection = createSceneProjection(
      { project: createEmptyStudioProject(), revision: 0 },
      EMPTY_WORKSPACE,
    );
    const calls: string[] = [];
    const result = await compositeScene({
      projection,
      resolver: { resolve: () => { calls.push("resolve"); return {}; } },
      target: {
        beginFrame: () => { calls.push("begin"); },
        drawImage: () => { calls.push("draw"); },
        endFrame: () => { calls.push("end"); },
        abortFrame: () => { calls.push("abort"); },
      },
    });

    expect(result).toEqual({ canvas: null, drawCount: 0 });
    expect(calls).toEqual([]);
    assertDeepFrozen(result);
  });

  it("rejects a projection whose root and canvas disagree", () => {
    const projection = projectionFor("asset");
    expect(() => createSceneDrawPlan({ ...projection, canvas: null })).toThrowError(
      expect.objectContaining<Partial<SceneCompositorError>>({
        code: "SCENE_INVALID_PROJECTION",
      }),
    );
  });
});

describe("Canvas2D scene target", () => {
  it("clears state, fills background and executes the affine crop with explicit sampling", async () => {
    const { context, calls } = createRecordingCanvasContext();
    const image = { fixture: true } as unknown as CanvasImageSource;
    const target = createCanvas2DSceneTarget(context);
    const plan = createSceneDrawPlan(projectionFor("composition"));

    await target.beginFrame({ ...plan.canvas!, sampling: "nearest" });
    await target.drawImage(image, plan.operations[1]);
    await target.endFrame();

    expect(calls).toContainEqual(["clearRect", 0, 0, 3, 2]);
    expect(calls).toContainEqual(["fillRect", 0, 0, 3, 2]);
    expect(calls).toContainEqual(["setTransform", -1, 0, 0, 1, 3, 0]);
    expect(calls).toContainEqual([
      "drawImage",
      image,
      2,
      0,
      2,
      2,
      0,
      0,
      2,
      2,
    ]);
    expect(calls).toContainEqual(["globalCompositeOperation", "source-over"]);
    expect(calls).toContainEqual(["filter", "none"]);
    expect(calls).toContainEqual(["imageSmoothingEnabled", false]);
    expect(calls).toContainEqual(["imageSmoothingQuality", "low"]);
    expect(calls).toContainEqual(["fillStyle", "#000000"]);
    expect(context.globalAlpha).toBe(0.4);
    expect(context.globalCompositeOperation).toBe("xor");
    expect(context.filter).toBe("blur(2px)");
    expect(context.shadowColor).toBe("red");
    expect(context.shadowBlur).toBe(5);
    expect(context.shadowOffsetX).toBe(2);
    expect(context.shadowOffsetY).toBe(3);
    expect(context.imageSmoothingEnabled).toBe(true);
    expect(context.imageSmoothingQuality).toBe("high");
    expect(context.fillStyle).toBe("#ff00ff");
  });
});
