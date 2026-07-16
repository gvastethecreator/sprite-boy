import type { GridProcessingProcessRequestV1 } from "../../../core/processing/gridProcessingProtocol";
import type { GridSplitRecipeV1 } from "../../../core/project";

export interface GridProcessingGoldenInput {
  readonly id: string;
  readonly createPixels: () => Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly recipe: GridSplitRecipeV1;
}

function recipe(
  id: string,
  layout: GridSplitRecipeV1["layout"],
  overrides: Partial<Pick<GridSplitRecipeV1, "crop" | "chroma" | "pixel">> = {},
): GridSplitRecipeV1 {
  return {
    kind: "grid-split",
    version: 1,
    sourceAssetId: `asset-golden-${id}`,
    layout,
    crop: overrides.crop ?? { threshold: 0, padding: 0 },
    chroma: overrides.chroma ?? {
      enabled: false,
      color: "#00ff00",
      tolerance: 0,
      smoothness: 0,
      spill: 0,
    },
    pixel: overrides.pixel ?? { enabled: false, size: 16, quantize: false, colors: 16 },
  };
}

function packed(...pixels: readonly (readonly [number, number, number, number])[]): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels.flat());
}

function grid3x3Pixels(): Uint8ClampedArray {
  const width = 17;
  const pixels = new Uint8ClampedArray(width * width * 4);
  for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255;
  const starts = [1, 7, 13];
  for (let row = 0; row < starts.length; row += 1) {
    for (let column = 0; column < starts.length; column += 1) {
      for (let y = starts[row]!; y < starts[row]! + 3; y += 1) {
        for (let x = starts[column]!; x < starts[column]! + 3; x += 1) {
          const offset = (y * width + x) * 4;
          pixels[offset] = 32 + column * 80;
          pixels[offset + 1] = 48 + row * 72;
          pixels[offset + 2] = 240 - (row * 3 + column) * 20;
          pixels[offset + 3] = 255;
        }
      }
    }
  }
  return pixels;
}

function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function noisyPixels(width: number, height: number, seed: number): Uint8ClampedArray {
  const random = xorshift32(seed);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = random() & 0xff;
    pixels[offset + 1] = random() & 0xff;
    pixels[offset + 2] = random() & 0xff;
    pixels[offset + 3] = offset % 28 === 0 ? 96 : 128 + (random() & 0x7f);
  }
  return pixels;
}

function largeSafePixels(): Uint8ClampedArray {
  const width = 512;
  const height = 384;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const cell = ((x >>> 6) + (y >>> 6) * 8) & 0xff;
      pixels[offset] = (cell * 37 + x) & 0xff;
      pixels[offset + 1] = (cell * 19 + y) & 0xff;
      pixels[offset + 2] = (x ^ y ^ (cell * 11)) & 0xff;
      pixels[offset + 3] = (x + y) % 31 === 0 ? 127 : 255;
    }
  }
  return pixels;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const GRID_PROCESSING_GOLDEN_INPUTS: readonly GridProcessingGoldenInput[] = deepFreeze([
  {
    id: "single-pixel-1x1",
    width: 1,
    height: 1,
    createPixels: () => packed([17, 34, 51, 68]),
    recipe: recipe("single-pixel-1x1", { mode: "manual", rows: 1, cols: 1 }),
  },
  {
    id: "single-row-1xn",
    width: 7,
    height: 1,
    createPixels: () => packed(
      [255, 0, 0, 255], [0, 255, 0, 224], [0, 0, 255, 192], [255, 255, 0, 160],
      [255, 0, 255, 128], [0, 255, 255, 96], [12, 34, 56, 0],
    ),
    recipe: recipe("single-row-1xn", { mode: "manual", rows: 1, cols: 7 }),
  },
  {
    id: "single-column-nx1",
    width: 1,
    height: 7,
    createPixels: () => packed(
      [1, 2, 3, 255], [11, 22, 33, 224], [44, 55, 66, 192], [77, 88, 99, 160],
      [111, 122, 133, 128], [144, 155, 166, 64], [177, 188, 199, 0],
    ),
    recipe: recipe("single-column-nx1", { mode: "manual", rows: 7, cols: 1 }),
  },
  {
    id: "detected-grid-3x3",
    width: 17,
    height: 17,
    createPixels: grid3x3Pixels,
    recipe: recipe("detected-grid-3x3", { mode: "auto" }, {
      crop: { threshold: 1, padding: 0 },
    }),
  },
  {
    id: "fully-transparent-grid",
    width: 4,
    height: 4,
    createPixels: () => new Uint8ClampedArray(4 * 4 * 4),
    recipe: recipe("fully-transparent-grid", { mode: "manual", rows: 2, cols: 2 }, {
      crop: { threshold: 1, padding: 0 },
    }),
  },
  {
    id: "seeded-noisy-pipeline",
    width: 17,
    height: 13,
    createPixels: () => noisyPixels(17, 13, 0x47312d35),
    recipe: recipe("seeded-noisy-pipeline", { mode: "manual", rows: 2, cols: 3 }, {
      crop: { threshold: 12, padding: 1 },
      chroma: { enabled: true, color: "#00ff00", tolerance: 17, smoothness: 23, spill: 31 },
      pixel: { enabled: true, size: 6, quantize: true, colors: 5 },
    }),
  },
  {
    id: "non-divisible-3x3",
    width: 10,
    height: 7,
    createPixels: () => noisyPixels(10, 7, 0x4e444956),
    recipe: recipe("non-divisible-3x3", { mode: "manual", rows: 3, cols: 3 }),
  },
  {
    id: "large-safe-4x4",
    width: 512,
    height: 384,
    createPixels: largeSafePixels,
    recipe: recipe("large-safe-4x4", { mode: "manual", rows: 4, cols: 4 }),
  },
] satisfies readonly GridProcessingGoldenInput[]);

export function createGoldenProcessRequest(
  input: GridProcessingGoldenInput,
  pixels: Uint8ClampedArray = input.createPixels(),
): GridProcessingProcessRequestV1 {
  return {
    version: 1,
    type: "process",
    requestId: `golden-${input.id}`,
    source: {
      width: input.width,
      height: input.height,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: pixels.buffer as ArrayBuffer,
    },
    recipe: input.recipe,
  };
}
