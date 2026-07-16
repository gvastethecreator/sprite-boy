import { isEntityId, type EntityId, type GridSplitRecipeV1 } from "../project";

export const GRID_PROCESSING_PROTOCOL_VERSION = 1 as const;

export const GRID_PROCESSING_STAGES = Object.freeze([
  "decode",
  "detect",
  "chroma",
  "crop",
  "resize",
  "quantize",
  "finalize",
] as const);

export type GridProcessingStage = (typeof GRID_PROCESSING_STAGES)[number];

/** Pixel-affecting stages in their only valid execution order. */
export const GRID_PROCESSING_OPERATIONS = Object.freeze([
  "chroma",
  "crop",
  "resize",
  "quantize",
] as const);

export type GridProcessingOperation = (typeof GRID_PROCESSING_OPERATIONS)[number];

export const GRID_PROCESSING_WARNING_CODES = Object.freeze([
  "grid-detection-fallback",
  "empty-output",
  "pixel-size-clamped",
  "palette-reduced",
] as const);

export type GridProcessingWarningCode = (typeof GRID_PROCESSING_WARNING_CODES)[number];

export const GRID_PROCESSING_ERROR_CODES = Object.freeze([
  "invalid-input",
  "decode",
  "detect",
  "memory",
  "worker-crash",
  "timeout",
] as const);

export type GridProcessingErrorCode = (typeof GRID_PROCESSING_ERROR_CODES)[number];

export const GRID_PROCESSING_LIMITS = Object.freeze({
  maxIdentifierLength: 256,
  maxDimension: 16_384,
  maxSourcePixels: 67_108_864,
  maxResultCount: 4_096,
  maxResultPixels: 67_108_864,
  maxProgressTotal: 67_108_864,
  maxPixelSize: 4_096,
  maxPaletteColors: 256,
  maxWarnings: 16,
} as const);

export interface GridProcessingSurfaceV1 {
  readonly width: number;
  readonly height: number;
  readonly format: "rgba8";
  readonly colorSpace: "srgb";
  /** Packed row-major RGBA bytes. Transfer this buffer; never create a runtime URL. */
  readonly pixels: ArrayBuffer;
}

export interface GridProcessingProcessRequestV1 {
  readonly version: typeof GRID_PROCESSING_PROTOCOL_VERSION;
  readonly type: "process";
  readonly requestId: EntityId;
  readonly source: GridProcessingSurfaceV1;
  readonly recipe: GridSplitRecipeV1;
}

export interface GridProcessingCancelRequestV1 {
  readonly version: typeof GRID_PROCESSING_PROTOCOL_VERSION;
  readonly type: "cancel";
  /** Identity of the process request to cancel. */
  readonly requestId: EntityId;
}

export type GridProcessingRequestV1 =
  | GridProcessingProcessRequestV1
  | GridProcessingCancelRequestV1;

export interface GridProcessingRectV1 {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GridProcessingOutputV1 {
  /** Row-major identity. Equal to row * result.layout.cols + column. */
  readonly index: number;
  readonly row: number;
  readonly column: number;
  /** Absolute source-space cell rectangle. */
  readonly cellBounds: GridProcessingRectV1;
  /** Absolute source-space retained content, or null for an empty cell. */
  readonly contentBounds: GridProcessingRectV1 | null;
  readonly surface: GridProcessingSurfaceV1;
  /** Fraction removed by crop, canonicalized to the inclusive range 0..1. */
  readonly cropReductionRatio: number;
  readonly operations: readonly GridProcessingOperation[];
  readonly warnings: readonly GridProcessingWarningCode[];
}

export interface GridProcessingResultV1 {
  readonly source: {
    readonly width: number;
    readonly height: number;
  };
  readonly layout: {
    readonly origin: "manual" | "detected" | "fallback";
    readonly rows: number;
    readonly cols: number;
  };
  readonly outputs: readonly GridProcessingOutputV1[];
  readonly summary: {
    readonly outputCount: number;
    readonly outputPixelCount: number;
    /** Cell-area-weighted aggregate of output cropReductionRatio values. */
    readonly cropReductionRatio: number;
    readonly warnings: readonly GridProcessingWarningCode[];
  };
}

export interface GridProcessingProgressResponseV1 {
  readonly version: typeof GRID_PROCESSING_PROTOCOL_VERSION;
  readonly type: "progress";
  readonly requestId: EntityId;
  readonly stage: GridProcessingStage;
  readonly completed: number;
  readonly total: number;
}

export interface GridProcessingResultResponseV1 {
  readonly version: typeof GRID_PROCESSING_PROTOCOL_VERSION;
  readonly type: "result";
  readonly requestId: EntityId;
  readonly result: GridProcessingResultV1;
}

export interface GridProcessingErrorV1 {
  readonly code: GridProcessingErrorCode;
  /** Null means the failure occurred outside an algorithm stage. */
  readonly stage: GridProcessingStage | null;
}

export interface GridProcessingErrorResponseV1 {
  readonly version: typeof GRID_PROCESSING_PROTOCOL_VERSION;
  readonly type: "error";
  readonly requestId: EntityId;
  /** Closed codes only: no worker-controlled message, stack or path crosses the boundary. */
  readonly error: GridProcessingErrorV1;
}

export interface GridProcessingCancelledResponseV1 {
  readonly version: typeof GRID_PROCESSING_PROTOCOL_VERSION;
  readonly type: "cancelled";
  readonly requestId: EntityId;
}

export type GridProcessingResponseV1 =
  | GridProcessingProgressResponseV1
  | GridProcessingResultResponseV1
  | GridProcessingErrorResponseV1
  | GridProcessingCancelledResponseV1;

export interface GridProcessingResponseExpectationV1 {
  readonly requestId: EntityId;
  readonly source: {
    readonly width: number;
    readonly height: number;
  };
  readonly layout: GridSplitRecipeV1["layout"];
}

type DataRecord = Record<string, unknown>;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const RATIO_EPSILON = 1e-12;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const ARRAY_BUFFER_RESIZABLE_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "resizable",
)?.get;
const ARRAY_BUFFER_MAX_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "maxByteLength",
)?.get;

function protocolTypeError(label: string): TypeError {
  return new TypeError(`${label} is not a valid grid processing V1 value.`);
}

function readDataRecord(value: unknown, label: string): DataRecord {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw protocolTypeError(label);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw protocolTypeError(label);
    const output = Object.create(null) as DataRecord;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw protocolTypeError(label);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw protocolTypeError(label);
      }
      Object.defineProperty(output, key, { enumerable: true, value: descriptor.value });
    }
    return output;
  } catch {
    throw protocolTypeError(label);
  }
}

function requireExactKeys(
  record: DataRecord,
  required: readonly string[],
  optional: readonly string[] = [],
  label = "Object",
): void {
  const keys = Object.keys(record);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(record, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    throw protocolTypeError(label);
  }
}

function requireIdentifier(value: unknown, label: string): asserts value is EntityId {
  if (!isEntityId(value) || value.length > GRID_PROCESSING_LIMITS.maxIdentifierLength) {
    throw protocolTypeError(label);
  }
}

function requireCanonicalNumber(value: unknown, min: number, max: number, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Object.is(value, -0) ||
    value < min ||
    value > max
  ) {
    throw protocolTypeError(label);
  }
  return value;
}

function requireInteger(value: unknown, min: number, max: number, label: string): number {
  const number = requireCanonicalNumber(value, min, max, label);
  if (!Number.isSafeInteger(number)) throw protocolTypeError(label);
  return number;
}

function requireBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") throw protocolTypeError(label);
}

function readDenseArray(value: unknown, maxLength: number, label: string): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      throw protocolTypeError(label);
    }
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !length || !("value" in length) || !Number.isSafeInteger(length.value) ||
      length.value < 0 || length.value > maxLength || Reflect.ownKeys(value).length !== length.value + 1
    ) {
      throw protocolTypeError(label);
    }
    const output: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw protocolTypeError(label);
      }
      output.push(descriptor.value);
    }
    return output;
  } catch {
    throw protocolTypeError(label);
  }
}

function arrayBufferByteLength(value: unknown, label: string): number {
  try {
    if (
      !ARRAY_BUFFER_BYTE_LENGTH_GETTER ||
      typeof value !== "object" ||
      value === null ||
      Reflect.ownKeys(value).length !== 0
    ) {
      throw protocolTypeError(label);
    }
    const byteLength = Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, value, []) as number;
    if (
      ARRAY_BUFFER_RESIZABLE_GETTER &&
      Reflect.apply(ARRAY_BUFFER_RESIZABLE_GETTER, value, []) !== false
    ) {
      throw protocolTypeError(label);
    }
    if (
      ARRAY_BUFFER_MAX_BYTE_LENGTH_GETTER &&
      Reflect.apply(ARRAY_BUFFER_MAX_BYTE_LENGTH_GETTER, value, []) !== byteLength
    ) {
      throw protocolTypeError(label);
    }
    return byteLength;
  } catch {
    throw protocolTypeError(label);
  }
}

function assertSurface(value: unknown, maxPixels: number, label: string): asserts value is GridProcessingSurfaceV1 {
  const surface = readDataRecord(value, label);
  requireExactKeys(surface, ["width", "height", "format", "colorSpace", "pixels"], [], label);
  const width = requireInteger(surface.width, 1, GRID_PROCESSING_LIMITS.maxDimension, `${label}.width`);
  const height = requireInteger(surface.height, 1, GRID_PROCESSING_LIMITS.maxDimension, `${label}.height`);
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > maxPixels) throw protocolTypeError(label);
  if (surface.format !== "rgba8" || surface.colorSpace !== "srgb") throw protocolTypeError(label);
  if (arrayBufferByteLength(surface.pixels, `${label}.pixels`) !== pixelCount * 4) {
    throw protocolTypeError(`${label}.pixels`);
  }
}

function assertRecipe(
  value: unknown,
  source: GridProcessingSurfaceV1,
): asserts value is GridSplitRecipeV1 {
  const recipe = readDataRecord(value, "request.recipe");
  requireExactKeys(
    recipe,
    ["kind", "version", "sourceAssetId", "layout", "crop", "chroma", "pixel"],
    [],
    "request.recipe",
  );
  if (recipe.kind !== "grid-split" || recipe.version !== 1) throw protocolTypeError("request.recipe");
  requireIdentifier(recipe.sourceAssetId, "request.recipe.sourceAssetId");

  const layout = readDataRecord(recipe.layout, "request.recipe.layout");
  if (layout.mode === "auto") {
    requireExactKeys(layout, ["mode"], [], "request.recipe.layout");
  } else if (layout.mode === "manual") {
    requireExactKeys(layout, ["mode", "rows", "cols"], [], "request.recipe.layout");
    const rows = requireInteger(layout.rows, 1, GRID_PROCESSING_LIMITS.maxResultCount, "request.recipe.layout.rows");
    const cols = requireInteger(layout.cols, 1, GRID_PROCESSING_LIMITS.maxResultCount, "request.recipe.layout.cols");
    if (
      rows * cols > GRID_PROCESSING_LIMITS.maxResultCount ||
      rows > source.height ||
      cols > source.width
    ) {
      throw protocolTypeError("request.recipe.layout");
    }
  } else {
    throw protocolTypeError("request.recipe.layout");
  }

  const crop = readDataRecord(recipe.crop, "request.recipe.crop");
  requireExactKeys(crop, ["threshold", "padding"], [], "request.recipe.crop");
  requireCanonicalNumber(crop.threshold, 0, 100, "request.recipe.crop.threshold");
  requireInteger(crop.padding, 0, GRID_PROCESSING_LIMITS.maxDimension, "request.recipe.crop.padding");

  const chroma = readDataRecord(recipe.chroma, "request.recipe.chroma");
  requireExactKeys(
    chroma,
    ["enabled", "color", "tolerance", "smoothness", "spill"],
    [],
    "request.recipe.chroma",
  );
  requireBoolean(chroma.enabled, "request.recipe.chroma.enabled");
  if (typeof chroma.color !== "string" || !HEX_COLOR.test(chroma.color)) {
    throw protocolTypeError("request.recipe.chroma.color");
  }
  for (const key of ["tolerance", "smoothness", "spill"] as const) {
    requireCanonicalNumber(chroma[key], 0, 100, `request.recipe.chroma.${key}`);
  }

  const pixel = readDataRecord(recipe.pixel, "request.recipe.pixel");
  requireExactKeys(
    pixel,
    ["enabled", "size", "quantize", "colors"],
    ["palette"],
    "request.recipe.pixel",
  );
  requireBoolean(pixel.enabled, "request.recipe.pixel.enabled");
  requireInteger(pixel.size, 1, GRID_PROCESSING_LIMITS.maxPixelSize, "request.recipe.pixel.size");
  requireBoolean(pixel.quantize, "request.recipe.pixel.quantize");
  requireInteger(pixel.colors, 2, GRID_PROCESSING_LIMITS.maxPaletteColors, "request.recipe.pixel.colors");
  if (Object.prototype.hasOwnProperty.call(pixel, "palette")) {
    const palette = readDenseArray(
      pixel.palette,
      GRID_PROCESSING_LIMITS.maxPaletteColors,
      "request.recipe.pixel.palette",
    );
    if (palette.length === 0 || palette.some((color) => typeof color !== "string" || !HEX_COLOR.test(color))) {
      throw protocolTypeError("request.recipe.pixel.palette");
    }
  }
}

/** Fail-closed assertion for messages entering the processing worker. */
export function assertGridProcessingRequest(value: unknown): asserts value is GridProcessingRequestV1 {
  const request = readDataRecord(value, "Grid processing request");
  if (request.version !== GRID_PROCESSING_PROTOCOL_VERSION) throw protocolTypeError("request.version");
  if (request.type === "process") {
    requireExactKeys(request, ["version", "type", "requestId", "source", "recipe"], [], "Grid processing request");
    requireIdentifier(request.requestId, "request.requestId");
    assertSurface(request.source, GRID_PROCESSING_LIMITS.maxSourcePixels, "request.source");
    assertRecipe(request.recipe, request.source);
    return;
  }
  if (request.type === "cancel") {
    requireExactKeys(request, ["version", "type", "requestId"], [], "Grid processing request");
    requireIdentifier(request.requestId, "request.requestId");
    return;
  }
  throw protocolTypeError("request.type");
}

function requireEnum<TValue extends string>(
  value: unknown,
  values: readonly TValue[],
  label: string,
): asserts value is TValue {
  if (typeof value !== "string" || !values.includes(value as TValue)) throw protocolTypeError(label);
}

function readEnumArray<TValue extends string>(
  value: unknown,
  values: readonly TValue[],
  maxLength: number,
  label: string,
): readonly TValue[] {
  const entries = readDenseArray(value, maxLength, label);
  const seen = new Set<TValue>();
  const output: TValue[] = [];
  for (const entry of entries) {
    requireEnum(entry, values, label);
    if (seen.has(entry)) throw protocolTypeError(label);
    seen.add(entry);
    output.push(entry);
  }
  return output;
}

function readRect(value: unknown, label: string): GridProcessingRectV1 {
  const rect = readDataRecord(value, label);
  requireExactKeys(rect, ["x", "y", "width", "height"], [], label);
  return {
    x: requireInteger(rect.x, 0, GRID_PROCESSING_LIMITS.maxDimension, `${label}.x`),
    y: requireInteger(rect.y, 0, GRID_PROCESSING_LIMITS.maxDimension, `${label}.y`),
    width: requireInteger(rect.width, 1, GRID_PROCESSING_LIMITS.maxDimension, `${label}.width`),
    height: requireInteger(rect.height, 1, GRID_PROCESSING_LIMITS.maxDimension, `${label}.height`),
  };
}

interface ValidatedResponseExpectation {
  readonly requestId: EntityId;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly layout:
    | { readonly mode: "auto" }
    | { readonly mode: "manual"; readonly rows: number; readonly cols: number };
}

function readResponseExpectation(value: unknown): ValidatedResponseExpectation {
  const expectation = readDataRecord(value, "Response expectation");
  requireExactKeys(expectation, ["requestId", "source", "layout"], [], "Response expectation");
  requireIdentifier(expectation.requestId, "expectation.requestId");

  const source = readDataRecord(expectation.source, "expectation.source");
  requireExactKeys(source, ["width", "height"], [], "expectation.source");
  const sourceWidth = requireInteger(
    source.width,
    1,
    GRID_PROCESSING_LIMITS.maxDimension,
    "expectation.source.width",
  );
  const sourceHeight = requireInteger(
    source.height,
    1,
    GRID_PROCESSING_LIMITS.maxDimension,
    "expectation.source.height",
  );
  if (sourceWidth * sourceHeight > GRID_PROCESSING_LIMITS.maxSourcePixels) {
    throw protocolTypeError("expectation.source");
  }

  const layout = readDataRecord(expectation.layout, "expectation.layout");
  if (layout.mode === "auto") {
    requireExactKeys(layout, ["mode"], [], "expectation.layout");
    return {
      requestId: expectation.requestId,
      sourceWidth,
      sourceHeight,
      layout: { mode: "auto" },
    };
  }
  if (layout.mode !== "manual") throw protocolTypeError("expectation.layout");
  requireExactKeys(layout, ["mode", "rows", "cols"], [], "expectation.layout");
  const rows = requireInteger(layout.rows, 1, sourceHeight, "expectation.layout.rows");
  const cols = requireInteger(layout.cols, 1, sourceWidth, "expectation.layout.cols");
  if (rows * cols > GRID_PROCESSING_LIMITS.maxResultCount) {
    throw protocolTypeError("expectation.layout");
  }
  return {
    requestId: expectation.requestId,
    sourceWidth,
    sourceHeight,
    layout: { mode: "manual", rows, cols },
  };
}

function rectFitsInside(inner: GridProcessingRectV1, outer: GridProcessingRectV1): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function assertResult(
  value: unknown,
  expectation: ValidatedResponseExpectation,
): asserts value is GridProcessingResultV1 {
  const result = readDataRecord(value, "response.result");
  requireExactKeys(result, ["source", "layout", "outputs", "summary"], [], "response.result");

  const source = readDataRecord(result.source, "response.result.source");
  requireExactKeys(source, ["width", "height"], [], "response.result.source");
  const sourceWidth = requireInteger(
    source.width,
    1,
    GRID_PROCESSING_LIMITS.maxDimension,
    "response.result.source.width",
  );
  const sourceHeight = requireInteger(
    source.height,
    1,
    GRID_PROCESSING_LIMITS.maxDimension,
    "response.result.source.height",
  );
  if (sourceWidth * sourceHeight > GRID_PROCESSING_LIMITS.maxSourcePixels) {
    throw protocolTypeError("response.result.source");
  }
  if (
    sourceWidth !== expectation.sourceWidth ||
    sourceHeight !== expectation.sourceHeight
  ) {
    throw protocolTypeError("response.result.source");
  }
  const sourceBounds: GridProcessingRectV1 = {
    x: 0,
    y: 0,
    width: sourceWidth,
    height: sourceHeight,
  };

  const layout = readDataRecord(result.layout, "response.result.layout");
  requireExactKeys(layout, ["origin", "rows", "cols"], [], "response.result.layout");
  requireEnum(layout.origin, ["manual", "detected", "fallback"] as const, "response.result.layout.origin");
  const rows = requireInteger(layout.rows, 1, GRID_PROCESSING_LIMITS.maxResultCount, "response.result.layout.rows");
  const cols = requireInteger(layout.cols, 1, GRID_PROCESSING_LIMITS.maxResultCount, "response.result.layout.cols");
  const expectedOutputCount = rows * cols;
  if (expectedOutputCount > GRID_PROCESSING_LIMITS.maxResultCount) {
    throw protocolTypeError("response.result.layout");
  }
  if (rows > sourceHeight || cols > sourceWidth) {
    throw protocolTypeError("response.result.layout");
  }
  if (expectation.layout.mode === "manual") {
    if (
      layout.origin !== "manual" ||
      rows !== expectation.layout.rows ||
      cols !== expectation.layout.cols
    ) {
      throw protocolTypeError("response.result.layout");
    }
  } else if (layout.origin !== "detected" && layout.origin !== "fallback") {
    throw protocolTypeError("response.result.layout");
  }

  const outputs = readDenseArray(
    result.outputs,
    GRID_PROCESSING_LIMITS.maxResultCount,
    "response.result.outputs",
  );
  if (outputs.length !== expectedOutputCount) throw protocolTypeError("response.result.outputs");
  const buffers = new Set<ArrayBuffer>();
  let outputPixelCount = 0;
  let cellPixelCount = 0;
  let retainedPixelCount = 0;
  const columnBands: Array<{ readonly start: number; readonly size: number } | undefined> =
    Array.from({ length: cols });
  const rowBands: Array<{ readonly start: number; readonly size: number } | undefined> =
    Array.from({ length: rows });
  for (let index = 0; index < outputs.length; index += 1) {
    const label = `response.result.outputs[${index}]`;
    const output = readDataRecord(outputs[index], label);
    requireExactKeys(
      output,
      [
        "index",
        "row",
        "column",
        "cellBounds",
        "contentBounds",
        "surface",
        "cropReductionRatio",
        "operations",
        "warnings",
      ],
      [],
      label,
    );
    const expectedRow = Math.floor(index / cols);
    const expectedColumn = index % cols;
    if (
      requireInteger(output.index, 0, GRID_PROCESSING_LIMITS.maxResultCount - 1, `${label}.index`) !== index ||
      requireInteger(output.row, 0, rows - 1, `${label}.row`) !== expectedRow ||
      requireInteger(output.column, 0, cols - 1, `${label}.column`) !== expectedColumn
    ) {
      throw protocolTypeError(label);
    }
    const cellBounds = readRect(output.cellBounds, `${label}.cellBounds`);
    if (!rectFitsInside(cellBounds, sourceBounds)) throw protocolTypeError(`${label}.cellBounds`);
    const columnBand = columnBands[expectedColumn];
    if (columnBand === undefined) {
      columnBands[expectedColumn] = { start: cellBounds.x, size: cellBounds.width };
    } else if (columnBand.start !== cellBounds.x || columnBand.size !== cellBounds.width) {
      throw protocolTypeError(`${label}.cellBounds`);
    }
    const rowBand = rowBands[expectedRow];
    if (rowBand === undefined) {
      rowBands[expectedRow] = { start: cellBounds.y, size: cellBounds.height };
    } else if (rowBand.start !== cellBounds.y || rowBand.size !== cellBounds.height) {
      throw protocolTypeError(`${label}.cellBounds`);
    }
    const contentBounds = output.contentBounds === null
      ? null
      : readRect(output.contentBounds, `${label}.contentBounds`);
    if (contentBounds !== null) {
      if (!rectFitsInside(contentBounds, cellBounds)) throw protocolTypeError(`${label}.contentBounds`);
    }
    const cellPixels = cellBounds.width * cellBounds.height;
    const retainedPixels = contentBounds === null ? 0 : contentBounds.width * contentBounds.height;
    cellPixelCount += cellPixels;
    retainedPixelCount += retainedPixels;
    assertSurface(output.surface, GRID_PROCESSING_LIMITS.maxResultPixels, `${label}.surface`);
    const surface = output.surface as GridProcessingSurfaceV1;
    if (buffers.has(surface.pixels)) throw protocolTypeError("response.result.outputs");
    buffers.add(surface.pixels);
    outputPixelCount += surface.width * surface.height;
    if (!Number.isSafeInteger(outputPixelCount) || outputPixelCount > GRID_PROCESSING_LIMITS.maxResultPixels) {
      throw protocolTypeError("response.result.outputs");
    }
    const cropReductionRatio = requireCanonicalNumber(
      output.cropReductionRatio,
      0,
      1,
      `${label}.cropReductionRatio`,
    );
    const expectedCropReductionRatio = 1 - retainedPixels / cellPixels;
    if (Math.abs(cropReductionRatio - expectedCropReductionRatio) > RATIO_EPSILON) {
      throw protocolTypeError(`${label}.cropReductionRatio`);
    }
    const operations = readEnumArray(
      output.operations,
      GRID_PROCESSING_OPERATIONS,
      GRID_PROCESSING_OPERATIONS.length,
      `${label}.operations`,
    );
    let previousOperation = -1;
    for (const operation of operations) {
      const operationIndex = GRID_PROCESSING_OPERATIONS.indexOf(operation);
      if (operationIndex <= previousOperation) throw protocolTypeError(`${label}.operations`);
      previousOperation = operationIndex;
    }
    readEnumArray(
      output.warnings,
      GRID_PROCESSING_WARNING_CODES,
      GRID_PROCESSING_LIMITS.maxWarnings,
      `${label}.warnings`,
    );
  }

  const allowGaps = expectation.layout.mode === "auto";
  const assertBands = (
    bands: readonly ({ readonly start: number; readonly size: number } | undefined)[],
    extent: number,
    label: string,
  ): void => {
    let previousEnd = 0;
    for (const band of bands) {
      if (band === undefined || band.start < previousEnd || (!allowGaps && band.start !== previousEnd)) {
        throw protocolTypeError(label);
      }
      previousEnd = band.start + band.size;
    }
    if (!allowGaps && previousEnd !== extent) throw protocolTypeError(label);
  };
  assertBands(columnBands, sourceWidth, "response.result.outputs.columns");
  assertBands(rowBands, sourceHeight, "response.result.outputs.rows");

  const summary = readDataRecord(result.summary, "response.result.summary");
  requireExactKeys(
    summary,
    ["outputCount", "outputPixelCount", "cropReductionRatio", "warnings"],
    [],
    "response.result.summary",
  );
  if (
    requireInteger(
      summary.outputCount,
      1,
      GRID_PROCESSING_LIMITS.maxResultCount,
      "response.result.summary.outputCount",
    ) !== outputs.length ||
    requireInteger(
      summary.outputPixelCount,
      1,
      GRID_PROCESSING_LIMITS.maxResultPixels,
      "response.result.summary.outputPixelCount",
    ) !== outputPixelCount
  ) {
    throw protocolTypeError("response.result.summary");
  }
  const aggregateCropReductionRatio = requireCanonicalNumber(
    summary.cropReductionRatio,
    0,
    1,
    "response.result.summary.cropReductionRatio",
  );
  const expectedAggregateCropReductionRatio = 1 - retainedPixelCount / cellPixelCount;
  if (Math.abs(aggregateCropReductionRatio - expectedAggregateCropReductionRatio) > RATIO_EPSILON) {
    throw protocolTypeError("response.result.summary.cropReductionRatio");
  }
  readEnumArray(
    summary.warnings,
    GRID_PROCESSING_WARNING_CODES,
    GRID_PROCESSING_LIMITS.maxWarnings,
    "response.result.summary.warnings",
  );
}

/** Fail-closed assertion for worker messages, including request routing identity. */
export function assertGridProcessingResponse(
  value: unknown,
  expected: GridProcessingResponseExpectationV1,
): asserts value is GridProcessingResponseV1 {
  const expectation = readResponseExpectation(expected);
  const response = readDataRecord(value, "Grid processing response");
  if (response.version !== GRID_PROCESSING_PROTOCOL_VERSION) throw protocolTypeError("response.version");
  requireIdentifier(response.requestId, "response.requestId");
  if (response.requestId !== expectation.requestId) throw protocolTypeError("response.requestId");
  switch (response.type) {
    case "progress": {
      requireExactKeys(
        response,
        ["version", "type", "requestId", "stage", "completed", "total"],
        [],
        "Grid processing response",
      );
      requireEnum(response.stage, GRID_PROCESSING_STAGES, "response.stage");
      const total = requireInteger(
        response.total,
        1,
        GRID_PROCESSING_LIMITS.maxProgressTotal,
        "response.total",
      );
      requireInteger(response.completed, 0, total, "response.completed");
      return;
    }
    case "result":
      requireExactKeys(
        response,
        ["version", "type", "requestId", "result"],
        [],
        "Grid processing response",
      );
      assertResult(response.result, expectation);
      return;
    case "error": {
      requireExactKeys(
        response,
        ["version", "type", "requestId", "error"],
        [],
        "Grid processing response",
      );
      const error = readDataRecord(response.error, "response.error");
      requireExactKeys(error, ["code", "stage"], [], "response.error");
      requireEnum(error.code, GRID_PROCESSING_ERROR_CODES, "response.error.code");
      if (error.stage !== null) requireEnum(error.stage, GRID_PROCESSING_STAGES, "response.error.stage");
      return;
    }
    case "cancelled":
      requireExactKeys(
        response,
        ["version", "type", "requestId"],
        [],
        "Grid processing response",
      );
      return;
    default:
      throw protocolTypeError("response.type");
  }
}

export function isGridProcessingErrorRetryable(code: GridProcessingErrorCode): boolean {
  requireEnum(code, GRID_PROCESSING_ERROR_CODES, "error.code");
  return code === "memory" || code === "worker-crash" || code === "timeout";
}

function assertUnreachable(value: never, label = "request.type"): never {
  void value;
  throw protocolTypeError(label);
}

/** Exact transfer list for a validated request. */
export function gridProcessingRequestTransferables(
  value: unknown,
): readonly ArrayBuffer[] {
  assertGridProcessingRequest(value);
  switch (value.type) {
    case "process": return Object.freeze([value.source.pixels]);
    case "cancel": return Object.freeze([]);
    default: return assertUnreachable(value);
  }
}

/** Exact transfer list for a validated response; terminal metadata carries no URLs. */
export function gridProcessingResponseTransferables(
  value: unknown,
  expected: GridProcessingResponseExpectationV1,
): readonly ArrayBuffer[] {
  assertGridProcessingResponse(value, expected);
  switch (value.type) {
    case "result": return Object.freeze(value.result.outputs.map(({ surface }) => surface.pixels));
    case "progress":
    case "error":
    case "cancelled": return Object.freeze([]);
    default: return assertUnreachable(value, "response.type");
  }
}
