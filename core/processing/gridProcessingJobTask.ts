import { isEntityId, type GridSplitRecipeV1 } from "../project";
import {
  GRID_PROCESSING_PROTOCOL_VERSION,
  GRID_PROCESSING_STAGES,
  assertGridProcessingRequest,
  type GridProcessingProcessRequestV1,
  type GridProcessingResultV1,
  type GridProcessingStage,
  type GridProcessingSurfaceV1,
} from "./gridProcessingProtocol";
import { JobTaskError, type JobTask, type JobTaskContext } from "./jobRunner";

/** Structural client seam keeps core independent from the browser Worker implementation. */
export interface GridProcessingJobTaskProgress {
  readonly ratio: number;
  readonly stage: GridProcessingStage;
  readonly completed: number;
  readonly total: number;
}

export interface GridProcessingJobTaskClient {
  process(options: {
    readonly request: GridProcessingProcessRequestV1;
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: GridProcessingJobTaskProgress) => void;
  }): PromiseLike<GridProcessingResultV1>;
}

export interface CreateGridProcessingJobTaskOptions {
  readonly client: GridProcessingJobTaskClient;
  readonly source: GridProcessingSurfaceV1;
  readonly recipe: GridSplitRecipeV1;
}

interface GridClientErrorShape {
  readonly code:
    | "invalid-input"
    | "decode"
    | "detect"
    | "memory"
    | "worker-crash"
    | "timeout"
    | "invalid-response"
    | "cancelled";
  readonly retryable: boolean;
}

const CLIENT_ERROR_CODES = Object.freeze([
  "invalid-input",
  "decode",
  "detect",
  "memory",
  "worker-crash",
  "timeout",
  "invalid-response",
  "cancelled",
] as const);
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;

function ownDataValue(record: object, key: PropertyKey, label: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch {
    throw new TypeError(`${label} could not be read.`);
  }
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError(`${label} must be an enumerable data property.`);
  }
  return descriptor.value;
}

function requireExactKeys(record: object, expected: readonly string[], label: string): void {
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(record);
  } catch {
    throw new TypeError(`${label} fields could not be read.`);
  }
  if (
    keys.length !== expected.length ||
    keys.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    throw new TypeError(`${label} fields are invalid.`);
  }
}

function captureClient(value: unknown): GridProcessingJobTaskClient["process"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Grid processing job client must be an object.");
  }
  const process = ownDataValue(value, "process", "Grid processing job client.process");
  if (typeof process !== "function") {
    throw new TypeError("Grid processing job client.process must be a function.");
  }
  return ((options) => Reflect.apply(process, value, [options])) as GridProcessingJobTaskClient["process"];
}

function captureInput(source: unknown, recipe: unknown): {
  readonly source: GridProcessingSurfaceV1;
  readonly recipe: GridSplitRecipeV1;
} {
  const validationRequest = {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "process",
    requestId: "grid-job-validation",
    source,
    recipe,
  };
  assertGridProcessingRequest(validationRequest);
  if (validationRequest.type !== "process") throw new TypeError("Grid processing input is invalid.");
  const capturedSource = Object.freeze({
    width: validationRequest.source.width,
    height: validationRequest.source.height,
    format: "rgba8" as const,
    colorSpace: "srgb" as const,
    pixels: validationRequest.source.pixels,
  });
  const inputRecipe = validationRequest.recipe;
  const capturedRecipe = Object.freeze({
    kind: "grid-split" as const,
    version: 1 as const,
    sourceAssetId: inputRecipe.sourceAssetId,
    layout: inputRecipe.layout.mode === "auto"
      ? Object.freeze({ mode: "auto" as const })
      : Object.freeze({ mode: "manual" as const, rows: inputRecipe.layout.rows, cols: inputRecipe.layout.cols }),
    crop: Object.freeze({ threshold: inputRecipe.crop.threshold, padding: inputRecipe.crop.padding }),
    chroma: Object.freeze({ ...inputRecipe.chroma }),
    pixel: Object.freeze({
      enabled: inputRecipe.pixel.enabled,
      size: inputRecipe.pixel.size,
      quantize: inputRecipe.pixel.quantize,
      colors: inputRecipe.pixel.colors,
      ...(inputRecipe.pixel.palette ? { palette: Object.freeze([...inputRecipe.pixel.palette]) } : {}),
    }),
  }) as GridSplitRecipeV1;
  return Object.freeze({ source: capturedSource, recipe: capturedRecipe });
}

function captureContext(context: JobTaskContext): {
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly reportProgress: JobTaskContext["reportProgress"];
} {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new JobTaskError("invalid-input", "Grid processing job context is invalid.", false);
  }
  try {
    const requestId = ownDataValue(context, "requestId", "Grid processing request ID");
    const signal = ownDataValue(context, "signal", "Grid processing abort signal");
    const reportProgress = ownDataValue(context, "reportProgress", "Grid processing progress reporter");
    if (!isEntityId(requestId) || typeof reportProgress !== "function" || !ABORTED_GETTER) throw new TypeError();
    Reflect.apply(ABORTED_GETTER, signal, []);
    return Object.freeze({
      requestId,
      signal: signal as AbortSignal,
      reportProgress: reportProgress as JobTaskContext["reportProgress"],
    });
  } catch {
    throw new JobTaskError("invalid-input", "Grid processing job context is invalid.", false);
  }
}

function readClientError(error: unknown): GridClientErrorShape | null {
  if (!(error instanceof Error)) return null;
  try {
    const code = ownDataValue(error, "code", "Grid processing client error code");
    const retryable = ownDataValue(error, "retryable", "Grid processing client retry policy");
    if (!CLIENT_ERROR_CODES.includes(code as GridClientErrorShape["code"]) || typeof retryable !== "boolean") {
      return null;
    }
    return { code: code as GridClientErrorShape["code"], retryable };
  } catch {
    return null;
  }
}

export function toGridProcessingJobTaskError(error: unknown): JobTaskError {
  const clientError = readClientError(error);
  if (!clientError) {
    return new JobTaskError("runtime-failure", "Grid processing failed.", true);
  }
  switch (clientError.code) {
    case "invalid-input":
      return new JobTaskError("invalid-input", "Grid processing input is invalid.", false);
    case "worker-crash":
    case "timeout":
    case "invalid-response":
      return new JobTaskError("worker-crash", "Grid processing worker stopped.", true);
    case "memory":
      return new JobTaskError("runtime-failure", "Grid processing exceeded available memory.", true);
    case "decode":
      return new JobTaskError("runtime-failure", "Grid processing could not read source pixels.", false);
    case "detect":
      return new JobTaskError("runtime-failure", "Grid processing could not detect a grid.", false);
    case "cancelled":
      return new JobTaskError("runtime-failure", "Grid processing stopped before completion.", true);
  }
}

function validateProgress(progress: GridProcessingJobTaskProgress): void {
  if (
    !progress ||
    typeof progress !== "object" ||
    !Number.isFinite(progress.ratio) ||
    progress.ratio < 0 ||
    progress.ratio > 1 ||
    !GRID_PROCESSING_STAGES.includes(progress.stage as GridProcessingStage)
  ) {
    throw new JobTaskError("invalid-input", "Grid processing reported invalid progress.", false);
  }
}

export function createGridProcessingJobTask(
  options: CreateGridProcessingJobTaskOptions,
): JobTask<GridProcessingResultV1> {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Grid processing job task options must be an object.");
  }
  requireExactKeys(options, ["client", "source", "recipe"], "Grid processing job task options");
  const process = captureClient(ownDataValue(options, "client", "Grid processing job client"));
  const input = captureInput(
    ownDataValue(options, "source", "Grid processing job source"),
    ownDataValue(options, "recipe", "Grid processing job recipe"),
  );
  let consumed = false;

  const task: JobTask<GridProcessingResultV1> = async (context) => {
    const capturedContext = captureContext(context);
    if (consumed) {
      throw new JobTaskError("invalid-input", "Grid processing source ownership was already transferred.", false);
    }
    consumed = true;
    const request: GridProcessingProcessRequestV1 = {
      version: GRID_PROCESSING_PROTOCOL_VERSION,
      type: "process",
      requestId: capturedContext.requestId,
      source: input.source,
      recipe: input.recipe,
    };
    try {
      return await process({
        request,
        signal: capturedContext.signal,
        onProgress: (progress) => {
          validateProgress(progress);
          capturedContext.reportProgress({
            ratio: progress.ratio,
            phase: `grid.${progress.stage}`,
            message: null,
          });
        },
      });
    } catch (error) {
      if (error instanceof JobTaskError) throw error;
      throw toGridProcessingJobTaskError(error);
    }
  };
  return Object.freeze(task);
}
