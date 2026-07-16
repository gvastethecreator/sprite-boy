import { GRID_PROCESSING_LIMITS } from "./gridProcessingLimits";

export type IrregularRegionConnectivity = 4 | 8;

/**
 * All policy is explicit at this seam so a recipe can reproduce the same regions.
 * A pixel belongs to content only when its alpha is strictly greater than alphaThreshold.
 */
export interface IrregularRegionDetectionOptions {
  readonly alphaThreshold: number;
  readonly connectivity: IrregularRegionConnectivity;
  readonly minPixelCount: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly maxRegions: number;
}

export interface IrregularRegionBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface IrregularDetectedRegion {
  /** Stable accepted-region index in source scan order. */
  readonly index: number;
  readonly pixelCount: number;
  readonly bounds: IrregularRegionBounds;
}

export type IrregularRegionCancellationCheck = () => boolean;

/** A stricter working-set cap than the general worker protocol keeps flood-fill memory bounded. */
export const IRREGULAR_REGION_DETECTION_LIMITS = Object.freeze({
  maxDimension: GRID_PROCESSING_LIMITS.maxDimension,
  maxSourcePixels: Math.min(GRID_PROCESSING_LIMITS.maxSourcePixels, 16_777_216),
  maxRegions: GRID_PROCESSING_LIMITS.maxResultCount,
} as const);

/** Exact legacy donor behavior, now captured as data instead of hidden worker constants. */
export const IRREGULAR_REGION_DONOR_DEFAULTS: IrregularRegionDetectionOptions = Object.freeze({
  alphaThreshold: 10,
  connectivity: 4,
  minPixelCount: 5,
  minWidth: 3,
  minHeight: 3,
  maxRegions: IRREGULAR_REGION_DETECTION_LIMITS.maxRegions,
});

export class IrregularRegionDetectionCancelledError extends Error {
  constructor() {
    super("Irregular region detection was cancelled.");
    this.name = "AbortError";
  }
}

export class IrregularRegionDetectionLimitError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "IrregularRegionDetectionLimitError";
  }
}

const OPTION_KEYS = Object.freeze([
  "alphaThreshold",
  "connectivity",
  "minPixelCount",
  "minWidth",
  "minHeight",
  "maxRegions",
] as const);
const DX_4 = Object.freeze([0, -1, 1, 0] as const);
const DY_4 = Object.freeze([-1, 0, 0, 1] as const);
const DX_8 = Object.freeze([-1, 0, 1, -1, 1, -1, 0, 1] as const);
const DY_8 = Object.freeze([-1, -1, -1, 0, 0, 1, 1, 1] as const);
const CANCELLATION_CHECK_MASK = 0xfff;

const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8ClampedArray.prototype) as object;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "length",
)?.get;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)?.get;
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  Symbol.toStringTag,
)?.get;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;

function invalid(label: string): TypeError {
  return new TypeError(`${label} is not valid irregular region detection input.`);
}

function requireInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < minimum ||
    value > maximum
  ) {
    throw invalid(label);
  }
  return value;
}

function ownDataValue(record: object, key: PropertyKey, label: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch {
    throw invalid(label);
  }
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw invalid(label);
  return descriptor.value;
}

function readOptions(value: unknown): IrregularRegionDetectionOptions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid("options");
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw invalid("options");
  }
  if (
    keys.length !== OPTION_KEYS.length ||
    keys.some((key) => typeof key !== "string" || !OPTION_KEYS.includes(key as typeof OPTION_KEYS[number]))
  ) {
    throw invalid("options");
  }
  const alphaThreshold = requireInteger(
    ownDataValue(value, "alphaThreshold", "options.alphaThreshold"),
    0,
    255,
    "options.alphaThreshold",
  );
  const connectivity = ownDataValue(value, "connectivity", "options.connectivity");
  if (connectivity !== 4 && connectivity !== 8) throw invalid("options.connectivity");
  return Object.freeze({
    alphaThreshold,
    connectivity,
    minPixelCount: requireInteger(
      ownDataValue(value, "minPixelCount", "options.minPixelCount"),
      1,
      IRREGULAR_REGION_DETECTION_LIMITS.maxSourcePixels,
      "options.minPixelCount",
    ),
    minWidth: requireInteger(
      ownDataValue(value, "minWidth", "options.minWidth"),
      1,
      IRREGULAR_REGION_DETECTION_LIMITS.maxDimension,
      "options.minWidth",
    ),
    minHeight: requireInteger(
      ownDataValue(value, "minHeight", "options.minHeight"),
      1,
      IRREGULAR_REGION_DETECTION_LIMITS.maxDimension,
      "options.minHeight",
    ),
    maxRegions: requireInteger(
      ownDataValue(value, "maxRegions", "options.maxRegions"),
      1,
      IRREGULAR_REGION_DETECTION_LIMITS.maxRegions,
      "options.maxRegions",
    ),
  });
}

function readPixelLength(value: unknown): number {
  try {
    if (
      !TYPED_ARRAY_LENGTH_GETTER ||
      !TYPED_ARRAY_BUFFER_GETTER ||
      !TYPED_ARRAY_TAG_GETTER ||
      !ARRAY_BUFFER_BYTE_LENGTH_GETTER ||
      typeof value !== "object" ||
      value === null ||
      Reflect.apply(TYPED_ARRAY_TAG_GETTER, value, []) !== "Uint8ClampedArray" ||
      Object.getOwnPropertyDescriptor(value, "length") !== undefined ||
      Object.getOwnPropertySymbols(value).length !== 0
    ) {
      throw invalid("pixels");
    }
    const buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBufferLike;
    Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, []);
    return Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as number;
  } catch {
    throw invalid("pixels");
  }
}

function readDimensions(width: unknown, height: unknown): { width: number; height: number; pixels: number } {
  const safeWidth = requireInteger(
    width,
    0,
    IRREGULAR_REGION_DETECTION_LIMITS.maxDimension,
    "width",
  );
  const safeHeight = requireInteger(
    height,
    0,
    IRREGULAR_REGION_DETECTION_LIMITS.maxDimension,
    "height",
  );
  if ((safeWidth === 0) !== (safeHeight === 0)) throw invalid("dimensions");
  const pixels = safeWidth * safeHeight;
  if (pixels > IRREGULAR_REGION_DETECTION_LIMITS.maxSourcePixels) {
    throw new IrregularRegionDetectionLimitError("Irregular region source exceeds the pixel limit.");
  }
  return { width: safeWidth, height: safeHeight, pixels };
}

function throwIfCancelled(check: IrregularRegionCancellationCheck | undefined): void {
  if (check === undefined) return;
  const cancelled = check();
  if (typeof cancelled !== "boolean") throw invalid("isCancelled");
  if (cancelled) throw new IrregularRegionDetectionCancelledError();
}

/**
 * Detect alpha-connected source regions without canvas, DOM, mutation or ambient state.
 * Components are discovered by a deterministic row-major scan and are never gap-merged,
 * matching the donor policy. The optional function is polled between rows and during large
 * floods so a worker can cooperatively stop synchronous work.
 */
export function detectIrregularRegions(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: IrregularRegionDetectionOptions,
  isCancelled?: IrregularRegionCancellationCheck,
): readonly IrregularDetectedRegion[] {
  const dimensions = readDimensions(width, height);
  if (readPixelLength(pixels) !== dimensions.pixels * 4) throw invalid("pixels");
  const policy = readOptions(options);
  if (isCancelled !== undefined && typeof isCancelled !== "function") throw invalid("isCancelled");
  throwIfCancelled(isCancelled);
  if (dimensions.pixels === 0) return Object.freeze([]);

  const visited = new Uint8Array(dimensions.pixels);
  let frontier: Uint32Array | null = null;
  const result: IrregularDetectedRegion[] = [];
  const dx = policy.connectivity === 4 ? DX_4 : DX_8;
  const dy = policy.connectivity === 4 ? DY_4 : DY_8;

  for (let sourceY = 0; sourceY < dimensions.height; sourceY += 1) {
    throwIfCancelled(isCancelled);
    for (let sourceX = 0; sourceX < dimensions.width; sourceX += 1) {
      const start = sourceY * dimensions.width + sourceX;
      if (visited[start] === 1 || pixels[start * 4 + 3]! <= policy.alphaThreshold) continue;
      if (!frontier) {
        try {
          frontier = new Uint32Array(dimensions.pixels);
        } catch {
          throw new IrregularRegionDetectionLimitError(
            "Irregular region detection could not allocate its bounded frontier.",
          );
        }
      }
      let head = 0;
      let tail = 1;
      frontier[0] = start;
      visited[start] = 1;
      let minX = sourceX;
      let maxX = sourceX;
      let minY = sourceY;
      let maxY = sourceY;
      let pixelCount = 0;

      while (head < tail) {
        if ((head & CANCELLATION_CHECK_MASK) === 0) throwIfCancelled(isCancelled);
        const current = frontier[head++]!;
        const currentX = current % dimensions.width;
        const currentY = Math.floor(current / dimensions.width);
        pixelCount += 1;
        if (currentX < minX) minX = currentX;
        if (currentX > maxX) maxX = currentX;
        if (currentY < minY) minY = currentY;
        if (currentY > maxY) maxY = currentY;

        for (let direction = 0; direction < dx.length; direction += 1) {
          const nextX = currentX + dx[direction]!;
          const nextY = currentY + dy[direction]!;
          if (
            nextX < 0 || nextX >= dimensions.width ||
            nextY < 0 || nextY >= dimensions.height
          ) continue;
          const next = nextY * dimensions.width + nextX;
          if (visited[next] === 1 || pixels[next * 4 + 3]! <= policy.alphaThreshold) continue;
          visited[next] = 1;
          frontier[tail++] = next;
        }
      }

      const regionWidth = maxX - minX + 1;
      const regionHeight = maxY - minY + 1;
      if (
        pixelCount < policy.minPixelCount ||
        regionWidth < policy.minWidth ||
        regionHeight < policy.minHeight
      ) continue;
      if (result.length >= policy.maxRegions) {
        throw new IrregularRegionDetectionLimitError(
          `Irregular region detection exceeds the ${policy.maxRegions} region limit.`,
        );
      }
      result.push(Object.freeze({
        index: result.length,
        pixelCount,
        bounds: Object.freeze({ x: minX, y: minY, width: regionWidth, height: regionHeight }),
      }));
    }
  }
  return Object.freeze(result);
}
