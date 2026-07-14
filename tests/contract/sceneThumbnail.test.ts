import {
  MAX_SCENE_THUMBNAIL_EDGE,
  SceneCompositorError,
  SceneThumbnailError,
  createSceneProjection,
  createSceneThumbnailLayout,
  multiplySceneMatrices,
  renderBrowserSceneThumbnail,
  renderSceneThumbnail,
  sceneScale,
  type SceneCompositorFrame,
  type SceneCompositorTarget,
  type SceneDrawOperation,
  type SceneProjection,
  type SceneThumbnailEncodeOptions,
  type SceneThumbnailLayout,
  type SceneThumbnailSurface,
  type SceneThumbnailSurfaceFactory,
} from "../../core/render";
import { createEmptyStudioProject, type StudioProjectV1 } from "../../core/project";
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
  return createSceneProjection({ project, revision: 14 }, EMPTY_WORKSPACE);
}

function parseHexColor(color: string): readonly [number, number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Unsupported test color ${color}.`);
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
    255,
  ];
}

class SoftwareThumbnailSurface implements
  SceneThumbnailSurface<RasterFixture>,
  SceneCompositorTarget<RasterFixture> {
  readonly target: SceneCompositorTarget<RasterFixture> = this;
  pixels: Uint8ClampedArray;
  disposeCount = 0;
  abortCount = 0;
  failEncode = false;
  failDispose = false;
  outputType: string | undefined;
  outputBlob: Blob | undefined;
  private frame: SceneCompositorFrame | null = null;

  constructor(readonly layout: SceneThumbnailLayout) {
    this.pixels = new Uint8ClampedArray(layout.width * layout.height * 4);
  }

  beginFrame(frame: SceneCompositorFrame): void {
    if (this.frame !== null) throw new Error("frame already active");
    if (
      frame.width !== this.layout.sourceWidth ||
      frame.height !== this.layout.sourceHeight
    ) {
      throw new Error("source dimensions changed");
    }
    this.frame = frame;
    this.pixels.fill(0);
    if (frame.background !== null) {
      const color = parseHexColor(frame.background);
      for (let offset = 0; offset < this.pixels.length; offset += 4) {
        this.pixels.set(color, offset);
      }
    }
  }

  drawImage(image: RasterFixture, operation: SceneDrawOperation): void {
    if (this.frame === null) throw new Error("no frame");
    const matrix = multiplySceneMatrices(
      sceneScale(this.layout.scaleX, this.layout.scaleY),
      operation.matrix,
    );
    const { sourceRect } = operation;
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (Math.abs(determinant) < Number.EPSILON) return;
    for (let y = 0; y < this.layout.height; y += 1) {
      for (let x = 0; x < this.layout.width; x += 1) {
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
        if (
          sourceX < 0 || sourceY < 0 ||
          sourceX >= image.width || sourceY >= image.height
        ) {
          continue;
        }
        const sourceOffset = (sourceY * image.width + sourceX) * 4;
        const targetOffset = (y * this.layout.width + x) * 4;
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
    this.frame = null;
  }

  abortFrame(): void {
    this.abortCount += 1;
    this.frame = null;
    this.pixels.fill(0);
  }

  encode(options: SceneThumbnailEncodeOptions): Blob {
    if (this.failEncode) throw new Error("encode failed");
    if (this.outputBlob !== undefined) return this.outputBlob;
    return new Blob([Uint8Array.from(this.pixels)], {
      type: this.outputType ?? options.mimeType,
    });
  }

  dispose(): void {
    this.disposeCount += 1;
    if (this.failDispose) throw new Error("dispose failed");
  }
}

class SoftwareThumbnailFactory implements SceneThumbnailSurfaceFactory<RasterFixture> {
  created = 0;
  surface: SoftwareThumbnailSurface | null = null;
  configure?: (surface: SoftwareThumbnailSurface) => void;

  create(layout: SceneThumbnailLayout): SoftwareThumbnailSurface {
    this.created += 1;
    const surface = new SoftwareThumbnailSurface(layout);
    this.configure?.(surface);
    this.surface = surface;
    return surface;
  }
}

async function blobRows(blob: Blob, width: number, height: number): Promise<readonly string[]> {
  const pixels = new Uint8Array(await blob.arrayBuffer());
  const rows: string[] = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const symbol = PIXEL_SYMBOLS.get(pixels.slice(offset, offset + 4).join(","));
      if (!symbol) throw new Error(`Unknown thumbnail pixel at ${x},${y}.`);
      row += symbol;
    }
    rows.push(row);
  }
  return rows;
}

function renderWithSoftware(
  projection: SceneProjection,
  factory = new SoftwareThumbnailFactory(),
  options: Partial<{
    maxWidth: number;
    maxHeight: number;
    allowUpscale: boolean;
    mimeType: "image/png" | "image/webp";
  }> = {},
) {
  return renderSceneThumbnail({
    projection,
    resolver: { resolve: () => sceneCompositorRasterFixture },
    surfaceFactory: factory,
    maxWidth: options.maxWidth ?? 64,
    maxHeight: options.maxHeight ?? 64,
    ...(options.allowUpscale === undefined ? {} : { allowUpscale: options.allowUpscale }),
    ...(options.mimeType === undefined ? {} : { mimeType: options.mimeType }),
  });
}

describe("scene thumbnail layout", () => {
  it("fits within both bounds without crop, padding or implicit upscale", () => {
    expect(createSceneThumbnailLayout(
      { width: 400, height: 200, background: null },
      { maxWidth: 100, maxHeight: 100 },
    )).toEqual({
      sourceWidth: 400,
      sourceHeight: 200,
      width: 100,
      height: 50,
      scaleX: 0.25,
      scaleY: 0.25,
    });
    expect(createSceneThumbnailLayout(
      { width: 16, height: 8, background: null },
      { maxWidth: 100, maxHeight: 100 },
    )).toMatchObject({ width: 16, height: 8, scaleX: 1, scaleY: 1 });
    expect(createSceneThumbnailLayout(
      { width: 16, height: 8, background: null },
      { maxWidth: 100, maxHeight: 100, allowUpscale: true },
    )).toMatchObject({ width: 100, height: 50, scaleX: 6.25, scaleY: 6.25 });
  });

  it("rejects invalid and unbounded dimensions", () => {
    const canvas = { width: 16, height: 8, background: null } as const;
    expect(() => createSceneThumbnailLayout(canvas, { maxWidth: 0, maxHeight: 10 }))
      .toThrowError(SceneThumbnailError);
    expect(() => createSceneThumbnailLayout(canvas, {
      maxWidth: MAX_SCENE_THUMBNAIL_EDGE + 1,
      maxHeight: 10,
    })).toThrowError(expect.objectContaining({ code: "SCENE_THUMBNAIL_INVALID_REQUEST" }));
    expect(() => createSceneThumbnailLayout(
      { width: Number.POSITIVE_INFINITY, height: 8, background: null },
      { maxWidth: 10, maxHeight: 10 },
    )).toThrowError(SceneThumbnailError);
    expect(() => createSceneThumbnailLayout(canvas, undefined as never))
      .toThrowError(SceneThumbnailError);
  });
});

describe("shared-compositor thumbnail adapter", () => {
  it.each(["asset", "region", "composition", "variant", "cel"] as const)(
    "matches the canonical %s pixel golden",
    async (root) => {
      const result = await renderWithSoftware(projectionFor(root));
      expect(result).not.toBeNull();
      expect(await blobRows(result!.blob, result!.width, result!.height))
        .toEqual(sceneCompositorPixelGoldens[root]);
      expect(result).toMatchObject({
        projectId: "scene-compositor-project",
        revision: 14,
        sampling: "nearest",
        mimeType: "image/png",
      });
      expect(Object.isFrozen(result)).toBe(true);
    },
  );

  it("renders into a bounded surface instead of allocating the source dimensions", async () => {
    const factory = new SoftwareThumbnailFactory();
    const result = await renderWithSoftware(projectionFor("asset"), factory, {
      maxWidth: 2,
      maxHeight: 2,
    });

    expect(result).toMatchObject({
      sourceWidth: 4,
      sourceHeight: 2,
      width: 2,
      height: 1,
      scaleX: 0.5,
      scaleY: 0.5,
      drawCount: 1,
    });
    expect(factory.surface?.layout).toEqual({
      sourceWidth: 4,
      sourceHeight: 2,
      width: 2,
      height: 1,
      scaleX: 0.5,
      scaleY: 0.5,
    });
    expect(factory.surface?.disposeCount).toBe(1);
  });

  it("returns null without touching resolver or surface ports for an empty scene", async () => {
    const projection = createSceneProjection(
      { project: createEmptyStudioProject(), revision: 0 },
      EMPTY_WORKSPACE,
    );
    const factory = new SoftwareThumbnailFactory();
    let resolves = 0;
    const result = await renderSceneThumbnail({
      projection,
      resolver: { resolve() { resolves += 1; return sceneCompositorRasterFixture; } },
      surfaceFactory: factory,
      maxWidth: 64,
      maxHeight: 64,
    });

    expect(result).toBeNull();
    expect(resolves).toBe(0);
    expect(factory.created).toBe(0);
  });

  it("validates format controls before creating a surface", async () => {
    const factory = new SoftwareThumbnailFactory();
    await expect(renderSceneThumbnail({
      projection: projectionFor("asset"),
      resolver: { resolve: () => sceneCompositorRasterFixture },
      surfaceFactory: factory,
      maxWidth: 64,
      maxHeight: 64,
      quality: 2,
    })).rejects.toMatchObject({ code: "SCENE_THUMBNAIL_INVALID_REQUEST" });
    await expect(renderSceneThumbnail({
      projection: projectionFor("asset"),
      resolver: { resolve: () => sceneCompositorRasterFixture },
      surfaceFactory: factory,
      maxWidth: 64,
      maxHeight: 64,
      mimeType: "image/jpeg" as "image/png",
    })).rejects.toMatchObject({ code: "SCENE_THUMBNAIL_INVALID_REQUEST" });
    expect(factory.created).toBe(0);
  });

  it("wraps surface and encode failures and always disposes created work", async () => {
    await expect(renderSceneThumbnail({
      projection: projectionFor("asset"),
      resolver: { resolve: () => sceneCompositorRasterFixture },
      surfaceFactory: { create() { throw new Error("no surface"); } },
      maxWidth: 64,
      maxHeight: 64,
    })).rejects.toMatchObject({ code: "SCENE_THUMBNAIL_SURFACE_FAILED" });

    let incompleteDisposals = 0;
    await expect(renderSceneThumbnail({
      projection: projectionFor("asset"),
      resolver: { resolve: () => sceneCompositorRasterFixture },
      surfaceFactory: {
        create: () => ({
          target: {} as SceneCompositorTarget<RasterFixture>,
          encode: () => new Blob(),
          dispose: () => { incompleteDisposals += 1; },
        }),
      },
      maxWidth: 64,
      maxHeight: 64,
    })).rejects.toMatchObject({ code: "SCENE_THUMBNAIL_SURFACE_FAILED" });
    expect(incompleteDisposals).toBe(1);

    const factory = new SoftwareThumbnailFactory();
    factory.configure = (surface) => { surface.failEncode = true; };
    await expect(renderWithSoftware(projectionFor("asset"), factory))
      .rejects.toMatchObject({ code: "SCENE_THUMBNAIL_ENCODE_FAILED" });
    expect(factory.surface?.disposeCount).toBe(1);
  });

  it("rejects silent MIME fallback and reports cleanup failure after success", async () => {
    const mismatched = new SoftwareThumbnailFactory();
    mismatched.configure = (surface) => { surface.outputType = "image/png"; };
    await expect(renderWithSoftware(projectionFor("asset"), mismatched, {
      mimeType: "image/webp",
    })).rejects.toMatchObject({ code: "SCENE_THUMBNAIL_ENCODE_FAILED" });
    expect(mismatched.surface?.disposeCount).toBe(1);

    const cleanup = new SoftwareThumbnailFactory();
    cleanup.configure = (surface) => { surface.failDispose = true; };
    await expect(renderWithSoftware(projectionFor("asset"), cleanup))
      .rejects.toMatchObject({ code: "SCENE_THUMBNAIL_CLEANUP_FAILED" });
  });

  it("accepts an exact-MIME Blob produced in another browser realm", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    try {
      const ForeignBlob = (
        iframe.contentWindow as unknown as { readonly Blob?: typeof Blob } | null
      )?.Blob;
      if (!ForeignBlob) throw new Error("Expected iframe Blob support.");
      const foreignBlob = new ForeignBlob(["foreign pixels"], { type: "image/png" });
      expect(foreignBlob instanceof Blob).toBe(false);
      const factory = new SoftwareThumbnailFactory();
      factory.configure = (surface) => { surface.outputBlob = foreignBlob; };

      const result = await renderWithSoftware(projectionFor("asset"), factory);

      expect(result?.blob).toBe(foreignBlob);
      expect(result?.mimeType).toBe("image/png");
      expect(factory.surface?.disposeCount).toBe(1);
    } finally {
      iframe.remove();
    }
  });

  it("rejects a structural Blob impostor with a spoofed toStringTag", async () => {
    const impostor = {
      [Symbol.toStringTag]: "Blob",
      size: 1,
      type: "image/png",
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      slice: () => impostor,
    } as unknown as Blob;
    expect(Object.prototype.toString.call(impostor)).toBe("[object Blob]");
    const factory = new SoftwareThumbnailFactory();
    factory.configure = (surface) => { surface.outputBlob = impostor; };

    await expect(renderWithSoftware(projectionFor("asset"), factory))
      .rejects.toMatchObject({ code: "SCENE_THUMBNAIL_ENCODE_FAILED" });
    expect(factory.surface?.disposeCount).toBe(1);
  });

  it("preserves a compositor failure when cleanup also fails", async () => {
    const factory = new SoftwareThumbnailFactory();
    factory.configure = (surface) => { surface.failDispose = true; };
    await expect(renderSceneThumbnail({
      projection: projectionFor("asset"),
      resolver: { resolve() { throw new Error("decode failed"); } },
      surfaceFactory: factory,
      maxWidth: 64,
      maxHeight: 64,
    })).rejects.toSatisfy((error: unknown) => (
      error instanceof SceneCompositorError &&
      error.code === "SCENE_ASSET_RESOLVE_FAILED"
    ));
    expect(factory.surface?.disposeCount).toBe(1);
  });
});

interface RecordingState {
  fillStyle: string;
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
  filter: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
}

class FakeOffscreenCanvas {
  static instances: FakeOffscreenCanvas[] = [];
  readonly calls: Array<readonly unknown[]> = [];
  readonly initialWidth: number;
  readonly initialHeight: number;
  readonly context: OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.initialWidth = width;
    this.initialHeight = height;
    let state: RecordingState = {
      fillStyle: "#000000",
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      filter: "none",
      shadowColor: "rgba(0, 0, 0, 0)",
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
    };
    const stack: RecordingState[] = [];
    const calls = this.calls;
    this.context = {
      canvas: this,
      get fillStyle() { return state.fillStyle; },
      set fillStyle(value: string | CanvasGradient | CanvasPattern) {
        state.fillStyle = String(value); calls.push(["fillStyle", value]);
      },
      get globalAlpha() { return state.globalAlpha; },
      set globalAlpha(value: number) { state.globalAlpha = value; calls.push(["alpha", value]); },
      get globalCompositeOperation() { return state.globalCompositeOperation; },
      set globalCompositeOperation(value: GlobalCompositeOperation) {
        state.globalCompositeOperation = value; calls.push(["composite", value]);
      },
      get filter() { return state.filter; },
      set filter(value: string) { state.filter = value; calls.push(["filter", value]); },
      get shadowColor() { return state.shadowColor; },
      set shadowColor(value: string) { state.shadowColor = value; calls.push(["shadowColor", value]); },
      get shadowBlur() { return state.shadowBlur; },
      set shadowBlur(value: number) { state.shadowBlur = value; calls.push(["shadowBlur", value]); },
      get shadowOffsetX() { return state.shadowOffsetX; },
      set shadowOffsetX(value: number) { state.shadowOffsetX = value; calls.push(["shadowX", value]); },
      get shadowOffsetY() { return state.shadowOffsetY; },
      set shadowOffsetY(value: number) { state.shadowOffsetY = value; calls.push(["shadowY", value]); },
      get imageSmoothingEnabled() { return state.imageSmoothingEnabled; },
      set imageSmoothingEnabled(value: boolean) {
        state.imageSmoothingEnabled = value; calls.push(["smoothing", value]);
      },
      get imageSmoothingQuality() { return state.imageSmoothingQuality; },
      set imageSmoothingQuality(value: ImageSmoothingQuality) {
        state.imageSmoothingQuality = value; calls.push(["quality", value]);
      },
      save() { stack.push({ ...state }); calls.push(["save"]); },
      restore() {
        const previous = stack.pop();
        if (!previous) throw new Error("state stack underflow");
        state = previous;
        calls.push(["restore"]);
      },
      setTransform: (...args: unknown[]) => calls.push(["setTransform", ...args]),
      clearRect: (...args: unknown[]) => calls.push(["clearRect", ...args]),
      fillRect: (...args: unknown[]) => calls.push(["fillRect", ...args]),
      drawImage: (...args: unknown[]) => calls.push(["drawImage", ...args]),
    } as unknown as OffscreenCanvasRenderingContext2D;
    FakeOffscreenCanvas.instances.push(this);
  }

  getContext(contextId: "2d"): OffscreenCanvasRenderingContext2D | null {
    return contextId === "2d" ? this.context : null;
  }

  convertToBlob(options: ImageEncodeOptions): Promise<Blob> {
    this.calls.push(["encode", options.type, options.quality]);
    return Promise.resolve(new Blob(["encoded"], { type: options.type }));
  }
}

describe("browser scene thumbnail surface", () => {
  it("scales canonical operations directly into one bounded OffscreenCanvas", async () => {
    FakeOffscreenCanvas.instances = [];
    const image = { fixture: true } as unknown as CanvasImageSource;
    const result = await renderBrowserSceneThumbnail({
      projection: projectionFor("composition"),
      resolver: { resolve: () => image },
      maxWidth: 6,
      maxHeight: 4,
      allowUpscale: true,
      scope: {
        OffscreenCanvas: FakeOffscreenCanvas as unknown as new (
          width: number,
          height: number,
        ) => OffscreenCanvas,
      },
    });

    expect(result).toMatchObject({
      sourceWidth: 3,
      sourceHeight: 2,
      width: 6,
      height: 4,
      scaleX: 2,
      scaleY: 2,
      drawCount: 2,
    });
    const surface = FakeOffscreenCanvas.instances[0];
    expect(surface.initialWidth).toBe(6);
    expect(surface.initialHeight).toBe(4);
    expect(surface.calls).toContainEqual(["fillRect", 0, 0, 6, 4]);
    expect(surface.calls).toContainEqual(["setTransform", 2, 0, 0, 2, 0, 0]);
    expect(surface.calls).toContainEqual(["setTransform", -2, 0, 0, 2, 6, 0]);
    expect(surface.calls).toContainEqual(["smoothing", false]);
    expect(surface.calls).toContainEqual(["encode", "image/png", undefined]);
    expect(surface.width).toBe(0);
    expect(surface.height).toBe(0);
  });
});
