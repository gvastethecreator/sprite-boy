import { deflateSync, inflateSync } from "node:zlib";
import {
  MAX_SCENE_EXPORT_EDGE,
  SceneCompositorError,
  createSceneProjection,
  renderBrowserSceneExport,
  renderSceneExport,
  type SceneCompositorFrame,
  type SceneCompositorTarget,
  type SceneDrawOperation,
  type SceneExportSurface,
  type SceneExportSurfaceFactory,
  type SceneProjection,
  type SceneRasterEncodeOptions,
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

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const textEncoder = new TextEncoder();

type GoldenRoot = keyof typeof sceneCompositorPixelGoldens;
type MutableSceneProjection = {
  -readonly [Key in keyof SceneProjection]: SceneProjection[Key];
};

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
  return createSceneProjection({ project, revision: 15 }, EMPTY_WORKSPACE);
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

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function uint32(value: number): Uint8Array {
  return Uint8Array.from([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  ) >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = textEncoder.encode(type);
  const content = concatBytes([typeBytes, data]);
  return concatBytes([uint32(data.byteLength), content, uint32(crc32(content))]);
}

function encodeRgbaPng(width: number, height: number, pixels: Uint8ClampedArray): Uint8Array {
  const header = new Uint8Array(13);
  header.set(uint32(width), 0);
  header.set(uint32(height), 4);
  header.set([8, 6, 0, 0, 0], 8);
  const scanlines = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (1 + width * 4);
    scanlines[rowOffset] = 0;
    scanlines.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), rowOffset + 1);
  }
  return concatBytes([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", Uint8Array.from(deflateSync(scanlines))),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

async function decodeRgbaPng(blob: Blob): Promise<DecodedPng> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  expect(bytes.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  const compressed: Uint8Array[] = [];
  while (offset < bytes.byteLength) {
    const length = readUint32(bytes, offset);
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = readUint32(bytes, offset + 8 + length);
    expect(crc32(concatBytes([typeBytes, data]))).toBe(expectedCrc);
    const type = new TextDecoder().decode(typeBytes);
    if (type === "IHDR") {
      width = readUint32(data, 0);
      height = readUint32(data, 4);
      expect(Array.from(data.subarray(8))).toEqual([8, 6, 0, 0, 0]);
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const scanlines = Uint8Array.from(inflateSync(concatBytes(compressed)));
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (1 + width * 4);
    expect(scanlines[rowOffset]).toBe(0);
    pixels.set(scanlines.subarray(rowOffset + 1, rowOffset + 1 + width * 4), y * width * 4);
  }
  return { width, height, pixels };
}

function pixelRows(pixels: Uint8Array, width: number, height: number): readonly string[] {
  const rows: string[] = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const symbol = PIXEL_SYMBOLS.get(pixels.slice(offset, offset + 4).join(","));
      if (!symbol) throw new Error(`Unknown export pixel at ${x},${y}.`);
      row += symbol;
    }
    rows.push(row);
  }
  return rows;
}

class SoftwareExportSurface implements
  SceneExportSurface<RasterFixture>,
  SceneCompositorTarget<RasterFixture> {
  readonly target: SceneCompositorTarget<RasterFixture> = this;
  readonly pixels: Uint8ClampedArray;
  disposeCount = 0;
  abortCount = 0;
  failEncode = false;
  failDispose = false;
  outputType: string | undefined;
  private active = false;

  constructor(readonly width: number, readonly height: number) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  beginFrame(frame: SceneCompositorFrame): void {
    if (this.active) throw new Error("frame already active");
    if (frame.width !== this.width || frame.height !== this.height) {
      throw new Error("export frame dimensions changed");
    }
    this.active = true;
    this.pixels.fill(0);
    if (frame.background !== null) {
      const color = parseHexColor(frame.background);
      for (let offset = 0; offset < this.pixels.length; offset += 4) {
        this.pixels.set(color, offset);
      }
    }
  }

  drawImage(image: RasterFixture, operation: SceneDrawOperation): void {
    if (!this.active) throw new Error("no frame");
    const { matrix, sourceRect } = operation;
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (Math.abs(determinant) < Number.EPSILON) return;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
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
        const targetOffset = (y * this.width + x) * 4;
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
    if (!this.active) throw new Error("no frame");
    this.active = false;
  }

  abortFrame(): void {
    this.abortCount += 1;
    this.active = false;
    this.pixels.fill(0);
  }

  encode(options: SceneRasterEncodeOptions): Blob {
    if (this.failEncode) throw new Error("encode failed");
    if (options.mimeType === "image/png") {
      return new Blob([Uint8Array.from(encodeRgbaPng(this.width, this.height, this.pixels))], {
        type: this.outputType ?? options.mimeType,
      });
    }
    return new Blob(["test-webp"], { type: this.outputType ?? options.mimeType });
  }

  dispose(): void {
    this.disposeCount += 1;
    if (this.failDispose) throw new Error("dispose failed");
  }
}

class SoftwareExportFactory implements SceneExportSurfaceFactory<RasterFixture> {
  created = 0;
  surface: SoftwareExportSurface | null = null;
  configure?: (surface: SoftwareExportSurface) => void;

  create(frame: { readonly width: number; readonly height: number }): SoftwareExportSurface {
    this.created += 1;
    const surface = new SoftwareExportSurface(frame.width, frame.height);
    this.configure?.(surface);
    this.surface = surface;
    return surface;
  }
}

function renderWithSoftware(
  projection: SceneProjection,
  factory = new SoftwareExportFactory(),
  options: Partial<{
    mimeType: "image/png" | "image/webp";
    sampling: "nearest" | "smooth";
    quality: number;
  }> = {},
) {
  return renderSceneExport({
    projection,
    resolver: { resolve: () => sceneCompositorRasterFixture },
    surfaceFactory: factory,
    ...(options.mimeType === undefined ? {} : { mimeType: options.mimeType }),
    ...(options.sampling === undefined ? {} : { sampling: options.sampling }),
    ...(options.quality === undefined ? {} : { quality: options.quality }),
  });
}

describe("shared-compositor scene export", () => {
  it.each(["asset", "region", "composition", "variant", "cel"] as const)(
    "encodes a decodable full-resolution PNG matching the %s golden",
    async (root) => {
      const result = await renderWithSoftware(projectionFor(root));
      expect(result).not.toBeNull();
      const decoded = await decodeRgbaPng(result!.blob);

      expect(decoded).toMatchObject({ width: result!.width, height: result!.height });
      expect(pixelRows(decoded.pixels, decoded.width, decoded.height))
        .toEqual(sceneCompositorPixelGoldens[root]);
      expect(result).toMatchObject({
        projectId: "scene-compositor-project",
        revision: 15,
        mimeType: "image/png",
        fileExtension: "png",
        sampling: "nearest",
        byteSize: result!.blob.size,
      });
      expect(Object.isFrozen(result)).toBe(true);
    },
  );

  it("passes explicit WebP quality and reports exact artifact metadata", async () => {
    const factory = new SoftwareExportFactory();
    const result = await renderWithSoftware(projectionFor("composition"), factory, {
      mimeType: "image/webp",
      sampling: "smooth",
      quality: 0.8,
    });

    expect(result).toMatchObject({
      width: 3,
      height: 2,
      background: "#000000",
      mimeType: "image/webp",
      fileExtension: "webp",
      sampling: "smooth",
      drawCount: 2,
      byteSize: 9,
    });
    expect(factory.surface?.disposeCount).toBe(1);
  });

  it("renders the same validated snapshot when surface creation mutates the source projection", async () => {
    const projection = structuredClone(projectionFor("asset")) as MutableSceneProjection;
    const factory = new SoftwareExportFactory();
    factory.configure = () => {
      projection.canvas = {
        width: MAX_SCENE_EXPORT_EDGE + 1,
        height: MAX_SCENE_EXPORT_EDGE + 1,
        background: projection.root!.background,
      };
      projection.root = {
        ...projection.root!,
        width: MAX_SCENE_EXPORT_EDGE + 1,
        height: MAX_SCENE_EXPORT_EDGE + 1,
      };
    };

    const result = await renderWithSoftware(projection, factory);
    const decoded = await decodeRgbaPng(result!.blob);

    expect(result).toMatchObject({ width: 4, height: 2, background: null, revision: 15 });
    expect(pixelRows(decoded.pixels, decoded.width, decoded.height))
      .toEqual(sceneCompositorPixelGoldens.asset);
    expect(factory.surface?.disposeCount).toBe(1);
  });

  it("returns null without touching resolver or surfaces for an empty scene", async () => {
    const projection = createSceneProjection(
      { project: createEmptyStudioProject(), revision: 0 },
      EMPTY_WORKSPACE,
    );
    const factory = new SoftwareExportFactory();
    let resolves = 0;
    const result = await renderSceneExport({
      projection,
      resolver: { resolve() { resolves += 1; return sceneCompositorRasterFixture; } },
      surfaceFactory: factory,
    });

    expect(result).toBeNull();
    expect(resolves).toBe(0);
    expect(factory.created).toBe(0);
  });

  it("rejects oversized and invalid format requests before allocating", async () => {
    const projection = projectionFor("asset");
    const oversized = {
      ...projection,
      canvas: { width: MAX_SCENE_EXPORT_EDGE + 1, height: 2, background: null },
      root: { ...projection.root!, width: MAX_SCENE_EXPORT_EDGE + 1, height: 2 },
    } as SceneProjection;
    const factory = new SoftwareExportFactory();
    await expect(renderWithSoftware(oversized, factory))
      .rejects.toMatchObject({ code: "SCENE_EXPORT_DIMENSIONS_EXCEEDED" });
    await expect(renderSceneExport({
      projection,
      resolver: { resolve: () => sceneCompositorRasterFixture },
      surfaceFactory: factory,
      mimeType: "image/jpeg" as "image/png",
    })).rejects.toMatchObject({ code: "SCENE_EXPORT_INVALID_REQUEST" });
    await expect(renderSceneExport({
      projection,
      resolver: { resolve: () => sceneCompositorRasterFixture },
      surfaceFactory: factory,
      quality: Number.NaN,
    })).rejects.toMatchObject({ code: "SCENE_EXPORT_INVALID_REQUEST" });
    expect(factory.created).toBe(0);
  });

  it("types create/encode/MIME/cleanup failures and disposes created work", async () => {
    await expect(renderSceneExport({
      projection: projectionFor("asset"),
      resolver: { resolve: () => sceneCompositorRasterFixture },
      surfaceFactory: { create() { throw new Error("no surface"); } },
    })).rejects.toMatchObject({ code: "SCENE_EXPORT_SURFACE_FAILED" });

    const encode = new SoftwareExportFactory();
    encode.configure = (surface) => { surface.failEncode = true; };
    await expect(renderWithSoftware(projectionFor("asset"), encode))
      .rejects.toMatchObject({ code: "SCENE_EXPORT_ENCODE_FAILED" });
    expect(encode.surface?.disposeCount).toBe(1);

    const mime = new SoftwareExportFactory();
    mime.configure = (surface) => { surface.outputType = "image/webp"; };
    await expect(renderWithSoftware(projectionFor("asset"), mime))
      .rejects.toMatchObject({ code: "SCENE_EXPORT_ENCODE_FAILED" });
    expect(mime.surface?.disposeCount).toBe(1);

    const cleanup = new SoftwareExportFactory();
    cleanup.configure = (surface) => { surface.failDispose = true; };
    await expect(renderWithSoftware(projectionFor("asset"), cleanup))
      .rejects.toMatchObject({ code: "SCENE_EXPORT_CLEANUP_FAILED" });
  });

  it("preserves compositor failure when cleanup also fails", async () => {
    const factory = new SoftwareExportFactory();
    factory.configure = (surface) => { surface.failDispose = true; };
    await expect(renderSceneExport({
      projection: projectionFor("asset"),
      resolver: { resolve() { throw new Error("decode failed"); } },
      surfaceFactory: factory,
    })).rejects.toSatisfy((error: unknown) => (
      error instanceof SceneCompositorError && error.code === "SCENE_ASSET_RESOLVE_FAILED"
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

function recordingContext(
  canvas: HTMLCanvasElement,
  calls: Array<readonly unknown[]>,
): CanvasRenderingContext2D {
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
  return {
    canvas,
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
  } as unknown as CanvasRenderingContext2D;
}

describe("browser scene export surface", () => {
  it("falls back to HTMLCanvas and preserves full-resolution compositor matrices", async () => {
    const calls: Array<readonly unknown[]> = [];
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob(callback: BlobCallback, type?: string) {
        calls.push(["encode", type]);
        callback(new Blob(["encoded"], { type }));
      },
    } as unknown as HTMLCanvasElement;
    const context = recordingContext(canvas, calls);
    const abandonedOffscreen = { width: -1, height: -1 };
    class ContextlessOffscreenCanvas {
      private currentWidth = 0;
      private currentHeight = 0;
      get width(): number { return this.currentWidth; }
      set width(value: number) {
        this.currentWidth = value;
        abandonedOffscreen.width = value;
      }
      get height(): number { return this.currentHeight; }
      set height(value: number) {
        this.currentHeight = value;
        abandonedOffscreen.height = value;
      }
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext(): null { return null; }
    }
    const image = { fixture: true } as unknown as CanvasImageSource;
    const result = await renderBrowserSceneExport({
      projection: projectionFor("composition"),
      resolver: { resolve: () => image },
      scope: {
        OffscreenCanvas: ContextlessOffscreenCanvas as unknown as new (
          width: number,
          height: number,
        ) => OffscreenCanvas,
        document: {
          createElement: () => canvas,
        } as unknown as Pick<Document, "createElement">,
      },
    });

    expect(result).toMatchObject({ width: 3, height: 2, drawCount: 2 });
    expect(calls).toContainEqual(["fillRect", 0, 0, 3, 2]);
    expect(calls).toContainEqual(["setTransform", 1, 0, 0, 1, 0, 0]);
    expect(calls).toContainEqual(["setTransform", -1, 0, 0, 1, 3, 0]);
    expect(calls).toContainEqual(["encode", "image/png"]);
    expect(abandonedOffscreen).toEqual({ width: 0, height: 0 });
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });
});
