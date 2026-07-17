import type { EntityId, GridSplitRecipeV1 } from "../../../core/project";
import {
  GRID_PROCESSING_OPERATIONS,
  GRID_PROCESSING_STAGES,
} from "../../../core/processing/gridProcessingProtocol";
import type { GridProcessingClientProgress } from "../processing/gridProcessingClient";
import type {
  GridProcessingOutputV1,
  GridProcessingProcessRequestV1,
  GridProcessingResultV1,
  GridProcessingRectV1,
  GridProcessingStage,
  GridProcessingWarningCode,
} from "../../../core/processing/gridProcessingProtocol";

export const STAGED_GRID_RESULT_STATUSES = Object.freeze([
  "idle",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
] as const);

export type StagedGridResultStatus = (typeof STAGED_GRID_RESULT_STATUSES)[number];

export type StagedGridResultErrorCode =
  | "invalid-result"
  | "invalid-state"
  | "cancelled"
  | "invalid-input"
  | "decode"
  | "detect"
  | "memory"
  | "worker-crash"
  | "timeout";

const STAGED_GRID_ERROR_CODES = Object.freeze([
  "invalid-result",
  "invalid-state",
  "cancelled",
  "invalid-input",
  "decode",
  "detect",
  "memory",
  "worker-crash",
  "timeout",
] as const satisfies readonly StagedGridResultErrorCode[]);

export interface StagedGridResultError {
  readonly code: StagedGridResultErrorCode;
  readonly message: string;
  readonly stage: GridProcessingStage | null;
  readonly retryable: boolean;
}

export interface StagedGridResultSource {
  readonly assetId: EntityId;
  readonly width: number;
  readonly height: number;
}

export interface StagedGridResultProgress {
  readonly ratio: number;
  readonly stage: GridProcessingStage;
  readonly completed: number;
  readonly total: number;
}

export interface StagedGridResultSurface {
  readonly width: number;
  readonly height: number;
  readonly format: "rgba8";
  readonly colorSpace: "srgb";
  /** Owned by the staged snapshot; callers must not transfer this buffer. */
  readonly pixels: ArrayBuffer;
}

export interface StagedGridResultOutput {
  readonly index: number;
  readonly row: number;
  readonly column: number;
  readonly cellBounds: GridProcessingRectV1;
  readonly contentBounds: GridProcessingRectV1 | null;
  readonly surface: StagedGridResultSurface;
  readonly cropReductionRatio: number;
  readonly operations: readonly ("chroma" | "crop" | "resize" | "quantize")[];
  readonly warnings: readonly GridProcessingWarningCode[];
}

export interface StagedGridResultSummary {
  readonly outputCount: number;
  readonly outputPixelCount: number;
  readonly cropReductionRatio: number;
  readonly warnings: readonly GridProcessingWarningCode[];
  readonly emptyOutputCount: number;
}

export interface StagedGridResultsSnapshot {
  readonly status: StagedGridResultStatus;
  readonly requestId: EntityId | null;
  readonly source: StagedGridResultSource | null;
  readonly recipe: Readonly<GridSplitRecipeV1> | null;
  readonly progress: StagedGridResultProgress | null;
  readonly outputs: readonly StagedGridResultOutput[];
  readonly summary: StagedGridResultSummary | null;
  readonly selectedIndex: number | null;
  readonly error: StagedGridResultError | null;
}

const EMPTY_OUTPUTS: readonly StagedGridResultOutput[] = Object.freeze([]);
const EMPTY_PROGRESS: StagedGridResultProgress | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(message: string): TypeError {
  return new TypeError(`Invalid staged Grid results: ${message}`);
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw invalid(`${label} must be a positive safe integer.`);
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid(`${label} must be a non-negative safe integer.`);
}

function assertRatio(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw invalid(`${label} must be finite and within 0..1.`);
  }
}

function freezeRect(value: GridProcessingRectV1, label: string): GridProcessingRectV1 {
  if (!isRecord(value)) throw invalid(`${label} must be a rectangle.`);
  assertNonNegativeInteger(value.x, `${label}.x`);
  assertNonNegativeInteger(value.y, `${label}.y`);
  assertPositiveInteger(value.width, `${label}.width`);
  assertPositiveInteger(value.height, `${label}.height`);
  return Object.freeze({ x: value.x, y: value.y, width: value.width, height: value.height });
}

function cloneRecipe(recipe: GridSplitRecipeV1): Readonly<GridSplitRecipeV1> {
  if (!isRecord(recipe) || recipe.kind !== "grid-split" || recipe.version !== 1) {
    throw invalid("recipe shape is unsupported.");
  }
  if (typeof recipe.sourceAssetId !== "string" || recipe.sourceAssetId.length === 0) {
    throw invalid("recipe.sourceAssetId is required.");
  }
  const layout = recipe.layout;
  if (!isRecord(layout) || (layout.mode !== "auto" && layout.mode !== "manual")) {
    throw invalid("recipe.layout is invalid.");
  }
  const frozenLayout = layout.mode === "auto"
    ? Object.freeze({ mode: "auto" as const })
    : (() => {
        assertPositiveInteger(layout.rows, "recipe.layout.rows");
        assertPositiveInteger(layout.cols, "recipe.layout.cols");
        return Object.freeze({ mode: "manual" as const, rows: layout.rows, cols: layout.cols });
      })();
  if (!isRecord(recipe.crop) || typeof recipe.crop.threshold !== "number" ||
    !Number.isFinite(recipe.crop.threshold) || recipe.crop.threshold < 0 || recipe.crop.threshold > 100) {
    throw invalid("recipe.crop is invalid.");
  }
  assertNonNegativeInteger(recipe.crop.padding, "recipe.crop.padding");
  if (!isRecord(recipe.chroma) || typeof recipe.chroma.enabled !== "boolean" ||
    typeof recipe.chroma.color !== "string" || typeof recipe.chroma.tolerance !== "number" ||
    typeof recipe.chroma.smoothness !== "number" || typeof recipe.chroma.spill !== "number") {
    throw invalid("recipe.chroma is invalid.");
  }
  if (!isRecord(recipe.pixel) || typeof recipe.pixel.enabled !== "boolean" ||
    typeof recipe.pixel.size !== "number" || typeof recipe.pixel.quantize !== "boolean" ||
    typeof recipe.pixel.colors !== "number") {
    throw invalid("recipe.pixel is invalid.");
  }
  assertPositiveInteger(recipe.pixel.size, "recipe.pixel.size");
  assertPositiveInteger(recipe.pixel.colors, "recipe.pixel.colors");
  if (recipe.pixel.palette !== undefined &&
    (!Array.isArray(recipe.pixel.palette) || recipe.pixel.palette.some((color) => typeof color !== "string"))) {
    throw invalid("recipe.pixel.palette is invalid.");
  }
  return Object.freeze({
    kind: "grid-split" as const,
    version: 1 as const,
    sourceAssetId: recipe.sourceAssetId,
    layout: frozenLayout,
    crop: Object.freeze({ threshold: recipe.crop.threshold, padding: recipe.crop.padding }),
    chroma: Object.freeze({
      enabled: recipe.chroma.enabled,
      color: recipe.chroma.color,
      tolerance: recipe.chroma.tolerance,
      smoothness: recipe.chroma.smoothness,
      spill: recipe.chroma.spill,
    }),
    pixel: Object.freeze({
      enabled: recipe.pixel.enabled,
      size: recipe.pixel.size,
      quantize: recipe.pixel.quantize,
      colors: recipe.pixel.colors,
      ...(recipe.pixel.palette === undefined ? {} : { palette: Object.freeze([...recipe.pixel.palette]) as unknown as string[] }),
    }),
  }) as unknown as Readonly<GridSplitRecipeV1>;
}

function clonePixels(pixels: ArrayBuffer, width: number, height: number, label: string): ArrayBuffer {
  if (!(pixels instanceof ArrayBuffer)) throw invalid(`${label}.pixels must be an ArrayBuffer.`);
  const expected = width * height * 4;
  if (!Number.isSafeInteger(expected) || pixels.byteLength !== expected) {
    throw invalid(`${label}.pixels byte length does not match its dimensions.`);
  }
  return new Uint8Array(pixels).slice().buffer;
}

function cloneOutput(output: GridProcessingOutputV1, index: number): StagedGridResultOutput {
  if (!isRecord(output)) throw invalid(`outputs[${index}] must be an object.`);
  assertNonNegativeInteger(output.index, `outputs[${index}].index`);
  assertNonNegativeInteger(output.row, `outputs[${index}].row`);
  assertNonNegativeInteger(output.column, `outputs[${index}].column`);
  if (!isRecord(output.surface)) throw invalid(`outputs[${index}].surface is required.`);
  assertPositiveInteger(output.surface.width, `outputs[${index}].surface.width`);
  assertPositiveInteger(output.surface.height, `outputs[${index}].surface.height`);
  if (output.surface.format !== "rgba8" || output.surface.colorSpace !== "srgb") {
    throw invalid(`outputs[${index}].surface format is unsupported.`);
  }
  const cellBounds = freezeRect(output.cellBounds, `outputs[${index}].cellBounds`);
  const contentBounds = output.contentBounds === null
    ? null
    : freezeRect(output.contentBounds, `outputs[${index}].contentBounds`);
  assertRatio(output.cropReductionRatio, `outputs[${index}].cropReductionRatio`);
  if (!Array.isArray(output.operations) || output.operations.some((operation) =>
    operation !== "chroma" && operation !== "crop" && operation !== "resize" && operation !== "quantize")) {
    throw invalid(`outputs[${index}].operations is invalid.`);
  }
  if (!Array.isArray(output.warnings) || output.warnings.some((warning) =>
    warning !== "grid-detection-fallback" && warning !== "empty-output" &&
    warning !== "pixel-size-clamped" && warning !== "palette-reduced")) {
    throw invalid(`outputs[${index}].warnings is invalid.`);
  }
  return Object.freeze({
    index: output.index,
    row: output.row,
    column: output.column,
    cellBounds,
    contentBounds,
    surface: Object.freeze({
      width: output.surface.width,
      height: output.surface.height,
      format: "rgba8" as const,
      colorSpace: "srgb" as const,
      pixels: clonePixels(output.surface.pixels, output.surface.width, output.surface.height, `outputs[${index}].surface`),
    }),
    cropReductionRatio: output.cropReductionRatio,
    operations: Object.freeze([...output.operations]),
    warnings: Object.freeze([...output.warnings]),
  });
}

function cloneProgress(progress: GridProcessingClientProgress): StagedGridResultProgress {
  const completed = isRecord(progress) ? progress.completed : undefined;
  const total = isRecord(progress) ? progress.total : undefined;
  if (!isRecord(progress) || typeof progress.ratio !== "number" || !Number.isFinite(progress.ratio) ||
    progress.ratio < 0 || progress.ratio > 1 || typeof progress.stage !== "string" ||
    !(GRID_PROCESSING_STAGES as readonly string[]).includes(progress.stage) ||
    !Number.isSafeInteger(completed) || (completed as number) < 0 ||
    !Number.isSafeInteger(total) || (total as number) < 1 || (completed as number) > (total as number)) {
    throw invalid("progress is invalid.");
  }
  return Object.freeze({
    ratio: progress.ratio,
    stage: progress.stage as GridProcessingStage,
    completed: completed as number,
    total: total as number,
  });
}

function uniqueWarnings(outputs: readonly StagedGridResultOutput[]): readonly GridProcessingWarningCode[] {
  const warnings: GridProcessingWarningCode[] = [];
  const seen = new Set<GridProcessingWarningCode>();
  for (const output of outputs) {
    for (const warning of output.warnings) {
      if (seen.has(warning)) continue;
      seen.add(warning);
      warnings.push(warning);
    }
  }
  return Object.freeze(warnings);
}

function cloneSummary(result: GridProcessingResultV1, outputs: readonly StagedGridResultOutput[]): StagedGridResultSummary {
  if (!isRecord(result.summary)) throw invalid("summary is required.");
  assertNonNegativeInteger(result.summary.outputCount, "summary.outputCount");
  assertNonNegativeInteger(result.summary.outputPixelCount, "summary.outputPixelCount");
  assertRatio(result.summary.cropReductionRatio, "summary.cropReductionRatio");
  if (!Array.isArray(result.summary.warnings) || result.summary.warnings.some((warning) =>
    warning !== "grid-detection-fallback" && warning !== "empty-output" &&
    warning !== "pixel-size-clamped" && warning !== "palette-reduced")) {
    throw invalid("summary.warnings is invalid.");
  }
  const outputPixelCount = outputs.reduce((sum, output) => sum + output.surface.width * output.surface.height, 0);
  if (result.summary.outputCount !== outputs.length || result.summary.outputPixelCount !== outputPixelCount) {
    throw invalid("summary counts do not match cloned outputs.");
  }
  const warnings = uniqueWarnings(outputs);
  const declaredWarnings = [...new Set(result.summary.warnings)];
  if (JSON.stringify(declaredWarnings) !== JSON.stringify(warnings)) {
    throw invalid("summary warnings do not match output warnings.");
  }
  return Object.freeze({
    outputCount: outputs.length,
    outputPixelCount,
    cropReductionRatio: result.summary.cropReductionRatio,
    warnings,
    emptyOutputCount: outputs.filter((output) => output.contentBounds === null).length,
  });
}

function cloneResult(result: GridProcessingResultV1): {
  readonly outputs: readonly StagedGridResultOutput[];
  readonly summary: StagedGridResultSummary;
} {
  if (!isRecord(result) || !isRecord(result.source) || !isRecord(result.layout) || !Array.isArray(result.outputs)) {
    throw invalid("Worker result shape is invalid.");
  }
  assertPositiveInteger(result.source.width, "result.source.width");
  assertPositiveInteger(result.source.height, "result.source.height");
  if (result.layout.origin !== "manual" && result.layout.origin !== "detected" && result.layout.origin !== "fallback") {
    throw invalid("result.layout.origin is invalid.");
  }
  assertPositiveInteger(result.layout.rows, "result.layout.rows");
  assertPositiveInteger(result.layout.cols, "result.layout.cols");
  const outputs = Object.freeze(result.outputs.map((output, index) => cloneOutput(output, index)));
  const indexes = outputs.map((output) => output.index);
  if (new Set(indexes).size !== indexes.length || indexes.some((value, index) => value !== index)) {
    throw invalid("result outputs must be row-major and contiguous.");
  }
  return Object.freeze({ outputs, summary: cloneSummary(result, outputs) });
}

function assertResultMatchesRequest(state: StagedGridResultsSnapshot, result: GridProcessingResultV1): void {
  const source = state.source;
  const recipe = state.recipe;
  if (!source || !recipe) throw invalid("processing state is missing source or recipe metadata.");
  if (result.source.width !== source.width || result.source.height !== source.height) {
    throw invalid("result source dimensions do not match the request.");
  }
  if (recipe.layout.mode === "manual") {
    if (result.layout.origin !== "manual" || result.layout.rows !== recipe.layout.rows || result.layout.cols !== recipe.layout.cols) {
      throw invalid("manual result layout does not match the recipe.");
    }
  } else if (result.layout.origin === "manual") {
    throw invalid("auto recipe cannot return a manual result layout.");
  }
  const expectedOutputCount = result.layout.rows * result.layout.cols;
  if (!Number.isSafeInteger(expectedOutputCount) || result.outputs.length !== expectedOutputCount) {
    throw invalid("result output count does not match its layout.");
  }
  for (const output of result.outputs) {
    const expectedRow = Math.floor(output.index / result.layout.cols);
    const expectedColumn = output.index % result.layout.cols;
    if (output.row !== expectedRow || output.column !== expectedColumn) {
      throw invalid(`output ${output.index} row/column is not row-major.`);
    }
    const cell = output.cellBounds;
    if (cell.x + cell.width > source.width || cell.y + cell.height > source.height) {
      throw invalid(`output ${output.index} cell bounds exceed the source.`);
    }
    if (output.contentBounds) {
      const content = output.contentBounds;
      if (content.x < cell.x || content.y < cell.y ||
        content.x + content.width > cell.x + cell.width ||
        content.y + content.height > cell.y + cell.height) {
        throw invalid(`output ${output.index} content bounds exceed its cell.`);
      }
    }
    let previousOperationIndex = -1;
    for (const operation of output.operations) {
      const operationIndex = GRID_PROCESSING_OPERATIONS.indexOf(operation);
      if (operationIndex <= previousOperationIndex) throw invalid(`output ${output.index} operations are out of order.`);
      previousOperationIndex = operationIndex;
    }
  }
}

function cloneSourceMetadata(source: StagedGridResultSource): StagedGridResultSource {
  if (!isRecord(source) || typeof source.assetId !== "string" || source.assetId.length === 0) {
    throw invalid("source.assetId is required.");
  }
  assertPositiveInteger(source.width, "source.width");
  assertPositiveInteger(source.height, "source.height");
  return Object.freeze({ assetId: source.assetId, width: source.width, height: source.height });
}

function clearSnapshot(status: StagedGridResultStatus = "idle"): StagedGridResultsSnapshot {
  return Object.freeze({
    status,
    requestId: null,
    source: null,
    recipe: null,
    progress: EMPTY_PROGRESS,
    outputs: EMPTY_OUTPUTS,
    summary: null,
    selectedIndex: null,
    error: null,
  });
}

export function createIdleStagedGridResults(): StagedGridResultsSnapshot {
  return clearSnapshot();
}

export function beginStagedGridProcessing(
  previous: StagedGridResultsSnapshot,
  request: Pick<GridProcessingProcessRequestV1, "requestId" | "recipe" | "source">,
): StagedGridResultsSnapshot {
  if (!previous || typeof previous !== "object") throw invalid("previous snapshot is required.");
  if (typeof request.requestId !== "string" || request.requestId.length === 0) throw invalid("requestId is required.");
  const recipe = cloneRecipe(request.recipe);
  assertPositiveInteger(request.source.width, "request.source.width");
  assertPositiveInteger(request.source.height, "request.source.height");
  return Object.freeze({
    status: "processing" as const,
    requestId: request.requestId,
    source: Object.freeze({ assetId: recipe.sourceAssetId, width: request.source.width, height: request.source.height }),
    recipe,
    progress: null,
    outputs: EMPTY_OUTPUTS,
    summary: null,
    selectedIndex: null,
    error: null,
  });
}

/** Start the visible preparation state before main-thread rasterization begins. */
export function beginStagedGridPreparation(
  previous: StagedGridResultsSnapshot,
  request: { readonly requestId: EntityId; readonly source: StagedGridResultSource; readonly recipe: GridSplitRecipeV1 },
): StagedGridResultsSnapshot {
  if (!previous || typeof previous !== "object") throw invalid("previous snapshot is required.");
  if (typeof request.requestId !== "string" || request.requestId.length === 0) throw invalid("requestId is required.");
  return Object.freeze({
    status: "processing" as const,
    requestId: request.requestId,
    source: cloneSourceMetadata(request.source),
    recipe: cloneRecipe(request.recipe),
    progress: null,
    outputs: EMPTY_OUTPUTS,
    summary: null,
    selectedIndex: null,
    error: null,
  });
}

export function updateStagedGridProgress(
  state: StagedGridResultsSnapshot,
  progress: GridProcessingClientProgress,
): StagedGridResultsSnapshot {
  if (state.status !== "processing") return state;
  const next = cloneProgress(progress);
  const previous = state.progress;
  if (previous) {
    const previousStage = GRID_PROCESSING_STAGES.indexOf(previous.stage);
    const nextStage = GRID_PROCESSING_STAGES.indexOf(next.stage);
    if (nextStage < previousStage || next.ratio < previous.ratio ||
      (nextStage === previousStage && next.completed < previous.completed)) {
      throw invalid("progress must be monotonic.");
    }
  }
  return Object.freeze({ ...state, progress: next });
}

export function completeStagedGridProcessing(
  state: StagedGridResultsSnapshot,
  result: GridProcessingResultV1,
): StagedGridResultsSnapshot {
  if (state.status !== "processing") throw invalid("only processing state can complete.");
  assertResultMatchesRequest(state, result);
  const cloned = cloneResult(result);
  return Object.freeze({
    ...state,
    status: "succeeded" as const,
    outputs: cloned.outputs,
    summary: cloned.summary,
    selectedIndex: cloned.outputs.length > 0 ? 0 : null,
    error: null,
  });
}

export function failStagedGridProcessing(
  state: StagedGridResultsSnapshot,
  error: Pick<StagedGridResultError, "code" | "message" | "stage" | "retryable">,
): StagedGridResultsSnapshot {
  if (!isRecord(error) || typeof error.code !== "string" ||
    !(STAGED_GRID_ERROR_CODES as readonly string[]).includes(error.code) || typeof error.message !== "string" ||
    (error.stage !== null && !(GRID_PROCESSING_STAGES as readonly string[]).includes(error.stage)) ||
    typeof error.retryable !== "boolean") {
    throw invalid("error is invalid.");
  }
  const status = error.code === "cancelled" ? "cancelled" : "failed";
  return Object.freeze({
    ...clearSnapshot(status),
    requestId: state.requestId,
    source: state.source,
    recipe: state.recipe,
    error: Object.freeze({
      code: error.code,
      message: error.message,
      stage: error.stage,
      retryable: error.retryable,
    }),
  });
}

export function selectStagedGridOutput(
  state: StagedGridResultsSnapshot,
  index: number | null,
): StagedGridResultsSnapshot {
  if (index !== null && (!Number.isSafeInteger(index) || index < 0 || index >= state.outputs.length)) {
    throw invalid("selected output index is outside the staged result set.");
  }
  return index === state.selectedIndex ? state : Object.freeze({ ...state, selectedIndex: index });
}

/** Zero owned pixel buffers before dropping the snapshot to make release explicit in tests and diagnostics. */
export function disposeStagedGridResults(state: StagedGridResultsSnapshot): StagedGridResultsSnapshot {
  for (const output of state.outputs) {
    try {
      new Uint8Array(output.surface.pixels).fill(0);
    } catch {
      // A detached buffer is already released; disposal remains idempotent.
    }
  }
  return clearSnapshot();
}

export function copyStagedGridPixels(output: StagedGridResultOutput): ArrayBuffer {
  if (!output || typeof output !== "object") throw invalid("output is required.");
  return new Uint8Array(output.surface.pixels).slice().buffer;
}
