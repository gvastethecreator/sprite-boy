import {
  GRID_PROCESSING_OPERATIONS,
  GRID_PROCESSING_WARNING_CODES,
  type GridProcessingOperation,
  type GridProcessingRectV1,
  type GridProcessingResultV1,
  type GridProcessingWarningCode,
} from "./gridProcessingProtocol";

export const GRID_PROCESSING_GOLDEN_VERSION = 1 as const;
export const GRID_PROCESSING_RGBA_NORMALIZATION = "rgba8-srgb-row-major-v1" as const;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_GOLDEN_FIXTURES = 64;

export interface GridProcessingGoldenOutputV1 {
  readonly index: number;
  readonly row: number;
  readonly column: number;
  readonly cellBounds: GridProcessingRectV1;
  readonly contentBounds: GridProcessingRectV1 | null;
  readonly dimensions: { readonly width: number; readonly height: number };
  readonly cropReductionRatio: number;
  readonly operations: readonly GridProcessingOperation[];
  readonly warnings: readonly GridProcessingWarningCode[];
  readonly rgbaSha256: string;
}

export interface GridProcessingGoldenFixtureV1 {
  readonly id: string;
  readonly source: {
    readonly width: number;
    readonly height: number;
    readonly rgbaSha256: string;
  };
  readonly layout: {
    readonly origin: "manual" | "detected" | "fallback";
    readonly rows: number;
    readonly cols: number;
  };
  readonly outputs: readonly GridProcessingGoldenOutputV1[];
  readonly summary: {
    readonly outputCount: number;
    readonly outputPixelCount: number;
    readonly cropReductionRatio: number;
    readonly warnings: readonly GridProcessingWarningCode[];
  };
}

export interface GridProcessingGoldenManifestV1 {
  readonly version: typeof GRID_PROCESSING_GOLDEN_VERSION;
  readonly algorithmBaseline: "grid-splitter-port-v1";
  readonly rgbaNormalization: typeof GRID_PROCESSING_RGBA_NORMALIZATION;
  readonly fixtures: readonly GridProcessingGoldenFixtureV1[];
}

type DataRecord = Record<string, unknown>;

function fail(label: string): never {
  throw new TypeError(`${label} is not a valid grid processing golden V1 value.`);
}

function readRecord(value: unknown, label: string): DataRecord {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) fail(label);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(label);
    const output = Object.create(null) as DataRecord;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") fail(label);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail(label);
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    return fail(label);
  }
}

function exactKeys(record: DataRecord, keys: readonly string[], label: string): void {
  const actual = Object.keys(record);
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) fail(label);
}

function readArray(value: unknown, maxLength: number, label: string): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(label);
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (!length || !("value" in length) || !Number.isSafeInteger(length.value) ||
        length.value < 0 || length.value > maxLength || Reflect.ownKeys(value).length !== length.value + 1) {
      fail(label);
    }
    const output: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail(label);
      output.push(descriptor.value);
    }
    return output;
  } catch {
    return fail(label);
  }
}

function integer(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max || Object.is(value, -0)) {
    fail(label);
  }
  return value as number;
}

function ratio(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1 || Object.is(value, -0)) {
    fail(label);
  }
  return value;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) fail(label);
  return value;
}

function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 80) fail(label);
  return value;
}

function rect(value: unknown, label: string): GridProcessingRectV1 {
  const record = readRecord(value, label);
  exactKeys(record, ["x", "y", "width", "height"], label);
  return {
    x: integer(record.x, 0, 16_384, `${label}.x`),
    y: integer(record.y, 0, 16_384, `${label}.y`),
    width: integer(record.width, 1, 16_384, `${label}.width`),
    height: integer(record.height, 1, 16_384, `${label}.height`),
  };
}

function enumArray<TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  maxLength: number,
  label: string,
): readonly TValue[] {
  const entries = readArray(value, maxLength, label);
  const result: TValue[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || !allowed.includes(entry as TValue) || result.includes(entry as TValue)) fail(label);
    result.push(entry as TValue);
  }
  return result;
}

function fits(inner: GridProcessingRectV1, outer: GridProcessingRectV1): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}

function readOutput(
  value: unknown,
  index: number,
  rows: number,
  cols: number,
  sourceBounds: GridProcessingRectV1,
): GridProcessingGoldenOutputV1 {
  const label = `manifest.fixtures.outputs[${index}]`;
  const record = readRecord(value, label);
  exactKeys(record, [
    "index", "row", "column", "cellBounds", "contentBounds", "dimensions",
    "cropReductionRatio", "operations", "warnings", "rgbaSha256",
  ], label);
  const outputIndex = integer(record.index, 0, rows * cols - 1, `${label}.index`);
  const row = integer(record.row, 0, rows - 1, `${label}.row`);
  const column = integer(record.column, 0, cols - 1, `${label}.column`);
  if (outputIndex !== index || row !== Math.floor(index / cols) || column !== index % cols) fail(label);
  const cellBounds = rect(record.cellBounds, `${label}.cellBounds`);
  if (!fits(cellBounds, sourceBounds)) fail(`${label}.cellBounds`);
  const contentBounds = record.contentBounds === null ? null : rect(record.contentBounds, `${label}.contentBounds`);
  if (contentBounds !== null && !fits(contentBounds, cellBounds)) fail(`${label}.contentBounds`);
  const dimensions = readRecord(record.dimensions, `${label}.dimensions`);
  exactKeys(dimensions, ["width", "height"], `${label}.dimensions`);
  const cropReductionRatio = ratio(record.cropReductionRatio, `${label}.cropReductionRatio`);
  const expectedReduction = contentBounds === null
    ? 1
    : 1 - (contentBounds.width * contentBounds.height) / (cellBounds.width * cellBounds.height);
  if (Math.abs(cropReductionRatio - expectedReduction) > 1e-12) fail(`${label}.cropReductionRatio`);
  return {
    index: outputIndex,
    row,
    column,
    cellBounds,
    contentBounds,
    dimensions: {
      width: integer(dimensions.width, 1, 16_384, `${label}.dimensions.width`),
      height: integer(dimensions.height, 1, 16_384, `${label}.dimensions.height`),
    },
    cropReductionRatio,
    operations: enumArray(record.operations, GRID_PROCESSING_OPERATIONS, GRID_PROCESSING_OPERATIONS.length, `${label}.operations`),
    warnings: enumArray(record.warnings, GRID_PROCESSING_WARNING_CODES, GRID_PROCESSING_WARNING_CODES.length, `${label}.warnings`),
    rgbaSha256: hash(record.rgbaSha256, `${label}.rgbaSha256`),
  };
}

function readFixture(value: unknown, fixtureIndex: number): GridProcessingGoldenFixtureV1 {
  const label = `manifest.fixtures[${fixtureIndex}]`;
  const record = readRecord(value, label);
  exactKeys(record, ["id", "source", "layout", "outputs", "summary"], label);
  const source = readRecord(record.source, `${label}.source`);
  exactKeys(source, ["width", "height", "rgbaSha256"], `${label}.source`);
  const width = integer(source.width, 1, 16_384, `${label}.source.width`);
  const height = integer(source.height, 1, 16_384, `${label}.source.height`);
  if (width * height > 67_108_864) fail(`${label}.source`);
  const layout = readRecord(record.layout, `${label}.layout`);
  exactKeys(layout, ["origin", "rows", "cols"], `${label}.layout`);
  const origin = layout.origin;
  if (origin !== "manual" && origin !== "detected" && origin !== "fallback") fail(`${label}.layout.origin`);
  const rows = integer(layout.rows, 1, height, `${label}.layout.rows`);
  const cols = integer(layout.cols, 1, width, `${label}.layout.cols`);
  const outputValues = readArray(record.outputs, 4_096, `${label}.outputs`);
  if (outputValues.length !== rows * cols) fail(`${label}.outputs`);
  const sourceBounds = { x: 0, y: 0, width, height };
  const outputs = outputValues.map((output, index) => readOutput(output, index, rows, cols, sourceBounds));
  const summary = readRecord(record.summary, `${label}.summary`);
  exactKeys(summary, ["outputCount", "outputPixelCount", "cropReductionRatio", "warnings"], `${label}.summary`);
  const outputCount = integer(summary.outputCount, 1, 4_096, `${label}.summary.outputCount`);
  const outputPixelCount = integer(summary.outputPixelCount, 1, 67_108_864, `${label}.summary.outputPixelCount`);
  if (outputCount !== outputs.length || outputPixelCount !== outputs.reduce((sum, output) =>
    sum + output.dimensions.width * output.dimensions.height, 0)) fail(`${label}.summary`);
  const summaryReduction = ratio(summary.cropReductionRatio, `${label}.summary.cropReductionRatio`);
  const cellPixels = outputs.reduce((sum, output) =>
    sum + output.cellBounds.width * output.cellBounds.height, 0);
  const retainedPixels = outputs.reduce((sum, output) => sum + (output.contentBounds === null
    ? 0
    : output.contentBounds.width * output.contentBounds.height), 0);
  if (Math.abs(summaryReduction - (1 - retainedPixels / cellPixels)) > 1e-12) fail(`${label}.summary.cropReductionRatio`);
  const fixture: GridProcessingGoldenFixtureV1 = {
    id: id(record.id, `${label}.id`),
    source: { width, height, rgbaSha256: hash(source.rgbaSha256, `${label}.source.rgbaSha256`) },
    layout: { origin, rows, cols },
    outputs,
    summary: {
      outputCount,
      outputPixelCount,
      cropReductionRatio: summaryReduction,
      warnings: enumArray(summary.warnings, GRID_PROCESSING_WARNING_CODES, GRID_PROCESSING_WARNING_CODES.length, `${label}.summary.warnings`),
    },
  };
  for (const output of fixture.outputs) {
    let previousOperation = -1;
    for (const operation of output.operations) {
      const operationIndex = GRID_PROCESSING_OPERATIONS.indexOf(operation);
      if (operationIndex <= previousOperation) fail(`${label}.outputs[${output.index}].operations`);
      previousOperation = operationIndex;
    }
  }
  return fixture;
}

/** Fail-closed validation for a committed algorithm baseline. Accessors and unknown keys are rejected. */
export function assertGridProcessingGoldenManifestV1(value: unknown): asserts value is GridProcessingGoldenManifestV1 {
  const manifest = readRecord(value, "manifest");
  exactKeys(manifest, ["version", "algorithmBaseline", "rgbaNormalization", "fixtures"], "manifest");
  if (manifest.version !== GRID_PROCESSING_GOLDEN_VERSION ||
      manifest.algorithmBaseline !== "grid-splitter-port-v1" ||
      manifest.rgbaNormalization !== GRID_PROCESSING_RGBA_NORMALIZATION) fail("manifest");
  const fixtureValues = readArray(manifest.fixtures, MAX_GOLDEN_FIXTURES, "manifest.fixtures");
  if (fixtureValues.length === 0) fail("manifest.fixtures");
  const fixtureIds = new Set<string>();
  for (let index = 0; index < fixtureValues.length; index += 1) {
    const fixture = readFixture(fixtureValues[index], index);
    if (fixtureIds.has(fixture.id)) fail(`manifest.fixtures[${index}].id`);
    fixtureIds.add(fixture.id);
  }
}

function rgbaBytes(pixels: ArrayBuffer, width: number, height: number): Uint8Array<ArrayBuffer> {
  integer(width, 1, 16_384, "surface.width");
  integer(height, 1, 16_384, "surface.height");
  let byteLength: number;
  try {
    byteLength = pixels.byteLength;
  } catch {
    return fail("surface.pixels");
  }
  if (Object.getPrototypeOf(pixels) !== ArrayBuffer.prototype || byteLength !== width * height * 4) fail("surface.pixels");
  return new Uint8Array<ArrayBuffer>(pixels.slice(0));
}

/** SHA-256 over packed, row-major RGBA8 bytes; alpha and transparent RGB are intentionally retained. */
export async function sha256NormalizedRgba(
  pixels: ArrayBuffer,
  width: number,
  height: number,
): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", rgbaBytes(pixels, width, height));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Captures only stable, algorithm-owned fields; request IDs, timing and progress are excluded. */
export async function captureGridProcessingGoldenFixture(
  fixtureId: string,
  source: { readonly width: number; readonly height: number; readonly rgbaSha256: string },
  result: GridProcessingResultV1,
): Promise<GridProcessingGoldenFixtureV1> {
  id(fixtureId, "fixture.id");
  hash(source.rgbaSha256, "fixture.source.rgbaSha256");
  const outputs = await Promise.all(result.outputs.map(async (output) => ({
    index: output.index,
    row: output.row,
    column: output.column,
    cellBounds: { ...output.cellBounds },
    contentBounds: output.contentBounds === null ? null : { ...output.contentBounds },
    dimensions: { width: output.surface.width, height: output.surface.height },
    cropReductionRatio: output.cropReductionRatio,
    operations: [...output.operations],
    warnings: [...output.warnings],
    rgbaSha256: await sha256NormalizedRgba(output.surface.pixels, output.surface.width, output.surface.height),
  })));
  return {
    id: fixtureId,
    source: { ...source },
    layout: { ...result.layout },
    outputs,
    summary: {
      outputCount: result.summary.outputCount,
      outputPixelCount: result.summary.outputPixelCount,
      cropReductionRatio: result.summary.cropReductionRatio,
      warnings: [...result.summary.warnings],
    },
  };
}

function firstDifference(actual: unknown, expected: unknown, path = "manifest"): string | null {
  if (Object.is(actual, expected)) return null;
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return `${path}.length`;
    for (let index = 0; index < actual.length; index += 1) {
      const difference = firstDifference(actual[index], expected[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (actual && expected && typeof actual === "object" && typeof expected === "object") {
    const actualRecord = actual as Record<string, unknown>;
    const expectedRecord = expected as Record<string, unknown>;
    const keys = Object.keys(expectedRecord);
    if (Object.keys(actualRecord).length !== keys.length) return path;
    for (const key of keys) {
      const difference = firstDifference(actualRecord[key], expectedRecord[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return path;
}

export function assertGridProcessingGoldenMatches(
  actual: unknown,
  expected: unknown,
): asserts actual is GridProcessingGoldenManifestV1 {
  assertGridProcessingGoldenManifestV1(actual);
  assertGridProcessingGoldenManifestV1(expected);
  const difference = firstDifference(actual, expected);
  if (difference !== null) throw new Error(`Grid processing golden drift at ${difference}.`);
}
