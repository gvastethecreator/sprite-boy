import type { GridSplitRecipeV1 } from "../project";
import { GRID_PROCESSING_LIMITS } from "./gridProcessingLimits";
import type { GridProcessingRectV1 } from "./gridProcessingProtocol";

export type GridCropCancellationCheck = () => boolean;

export interface GridCropStageResult {
  /** Bounds relative to the supplied cell. */
  readonly localBounds: GridProcessingRectV1;
  /** Bounds in source coordinates. */
  readonly contentBounds: GridProcessingRectV1;
  /** Newly owned packed RGBA pixels for localBounds. */
  readonly pixels: Uint8ClampedArray;
}

export class GridCropCancelledError extends Error {
  constructor() {
    super("Grid crop was cancelled.");
    this.name = "AbortError";
  }
}

const RECT_KEYS = Object.freeze(["x", "y", "width", "height"] as const);
const CROP_KEYS = Object.freeze(["threshold", "padding"] as const);
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
  return new TypeError(`${label} is not valid grid crop input.`);
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

function requireNumber(value: unknown, minimum: number, maximum: number, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Object.is(value, -0) ||
    value < minimum ||
    value > maximum
  ) {
    throw invalid(label);
  }
  return value;
}

function readExactDataRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid(label);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw invalid(label);
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
    ) {
      throw invalid(label);
    }
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) throw invalid(`${label}.${key}`);
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    throw invalid(label);
  }
}

function readDimensions(width: unknown, height: unknown): { width: number; height: number } {
  const safeWidth = requireInteger(width, 1, GRID_PROCESSING_LIMITS.maxDimension, "width");
  const safeHeight = requireInteger(height, 1, GRID_PROCESSING_LIMITS.maxDimension, "height");
  if (safeWidth * safeHeight > GRID_PROCESSING_LIMITS.maxSourcePixels) {
    throw invalid("dimensions");
  }
  return { width: safeWidth, height: safeHeight };
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
    const byteLength = Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, []) as number;
    const length = Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as number;
    if (byteLength === 0 || !Number.isSafeInteger(length) || length < 1) throw invalid("pixels");
    return length;
  } catch {
    throw invalid("pixels");
  }
}

function readCellBounds(
  value: unknown,
  sourceWidth: number,
  sourceHeight: number,
): GridProcessingRectV1 {
  const record = readExactDataRecord(value, RECT_KEYS, "cellBounds");
  const x = requireInteger(record.x, 0, sourceWidth - 1, "cellBounds.x");
  const y = requireInteger(record.y, 0, sourceHeight - 1, "cellBounds.y");
  const width = requireInteger(record.width, 1, sourceWidth, "cellBounds.width");
  const height = requireInteger(record.height, 1, sourceHeight, "cellBounds.height");
  if (x + width > sourceWidth || y + height > sourceHeight) throw invalid("cellBounds");
  return Object.freeze({ x, y, width, height });
}

function readCrop(value: unknown): Readonly<GridSplitRecipeV1["crop"]> {
  const record = readExactDataRecord(value, CROP_KEYS, "crop");
  return Object.freeze({
    threshold: requireNumber(record.threshold, 0, 100, "crop.threshold"),
    padding: requireInteger(
      record.padding,
      0,
      GRID_PROCESSING_LIMITS.maxDimension,
      "crop.padding",
    ),
  });
}

function throwIfCancelled(check: GridCropCancellationCheck | undefined): void {
  if (check === undefined) return;
  let cancelled: unknown;
  try {
    cancelled = Reflect.apply(check, undefined, []);
  } catch {
    throw invalid("isCancelled");
  }
  if (typeof cancelled !== "boolean") throw invalid("isCancelled");
  if (cancelled) throw new GridCropCancelledError();
}

function freezeRect(x: number, y: number, width: number, height: number): GridProcessingRectV1 {
  return Object.freeze({ x, y, width, height });
}

/**
 * Deterministically trims one source-space cell using the serializable recipe crop seam.
 * A pixel is content only when alpha is strictly greater than floor(threshold% * 255).
 * Padding expands the retained rectangle but is always clamped to the original cell.
 */
export function trimGridCell(
  pixels: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  cellBounds: GridProcessingRectV1,
  crop: GridSplitRecipeV1["crop"],
  isCancelled?: GridCropCancellationCheck,
): GridCropStageResult | null {
  const dimensions = readDimensions(sourceWidth, sourceHeight);
  if (readPixelLength(pixels) !== dimensions.width * dimensions.height * 4) throw invalid("pixels");
  const cell = readCellBounds(cellBounds, dimensions.width, dimensions.height);
  const policy = readCrop(crop);
  if (isCancelled !== undefined && typeof isCancelled !== "function") throw invalid("isCancelled");
  throwIfCancelled(isCancelled);

  const alphaCutoff = Math.floor((policy.threshold * 255) / 100);
  let left = cell.width;
  let top = cell.height;
  let right = -1;
  let bottom = -1;
  let visited = 0;

  for (let localY = 0; localY < cell.height; localY += 1) {
    throwIfCancelled(isCancelled);
    const sourceY = cell.y + localY;
    for (let localX = 0; localX < cell.width; localX += 1) {
      if ((visited & CANCELLATION_CHECK_MASK) === 0) throwIfCancelled(isCancelled);
      visited += 1;
      const sourceX = cell.x + localX;
      const alpha = pixels[(sourceY * dimensions.width + sourceX) * 4 + 3]!;
      if (alpha <= alphaCutoff) continue;
      if (localX < left) left = localX;
      if (localX > right) right = localX;
      if (localY < top) top = localY;
      if (localY > bottom) bottom = localY;
    }
  }

  if (right < left || bottom < top) return null;

  left = Math.max(0, left - policy.padding);
  top = Math.max(0, top - policy.padding);
  right = Math.min(cell.width - 1, right + policy.padding);
  bottom = Math.min(cell.height - 1, bottom + policy.padding);
  const retainedWidth = right - left + 1;
  const retainedHeight = bottom - top + 1;
  const output = new Uint8ClampedArray(retainedWidth * retainedHeight * 4);
  const rowBytes = retainedWidth * 4;

  for (let row = 0; row < retainedHeight; row += 1) {
    throwIfCancelled(isCancelled);
    const sourceStart = ((cell.y + top + row) * dimensions.width + cell.x + left) * 4;
    const outputStart = row * rowBytes;
    for (let byte = 0; byte < rowBytes; byte += 1) {
      if ((byte & CANCELLATION_CHECK_MASK) === 0) throwIfCancelled(isCancelled);
      output[outputStart + byte] = pixels[sourceStart + byte]!;
    }
  }

  const localBounds = freezeRect(left, top, retainedWidth, retainedHeight);
  return Object.freeze({
    localBounds,
    contentBounds: freezeRect(
      cell.x + localBounds.x,
      cell.y + localBounds.y,
      localBounds.width,
      localBounds.height,
    ),
    pixels: output,
  });
}
