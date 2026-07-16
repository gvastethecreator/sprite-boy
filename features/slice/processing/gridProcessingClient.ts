import {
  GRID_PROCESSING_PROTOCOL_VERSION,
  GRID_PROCESSING_STAGES,
  assertGridProcessingRequest,
  assertGridProcessingResponse,
  gridProcessingRequestTransferables,
  isGridProcessingErrorRetryable,
  type GridProcessingErrorCode,
  type GridProcessingProcessRequestV1,
  type GridProcessingResultV1,
  type GridProcessingStage,
} from "../../../core/processing/gridProcessingProtocol";

type GridProcessingWorkerEvent = MessageEvent<unknown> | Event;
type GridProcessingWorkerListener = (event: GridProcessingWorkerEvent) => void;

export interface GridProcessingWorkerPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message" | "error" | "messageerror", listener: GridProcessingWorkerListener): void;
  removeEventListener(type: "message" | "error" | "messageerror", listener: GridProcessingWorkerListener): void;
  terminate(): void;
}

export interface GridProcessingClientProgress {
  readonly ratio: number;
  readonly stage: GridProcessingStage;
  readonly completed: number;
  readonly total: number;
}

export type GridProcessingClientErrorCode =
  | GridProcessingErrorCode
  | "invalid-response"
  | "cancelled";

export class GridProcessingClientError extends Error {
  readonly code: GridProcessingClientErrorCode;
  readonly stage: GridProcessingStage | null;
  readonly retryable: boolean;

  constructor(
    code: GridProcessingClientErrorCode,
    message: string,
    stage: GridProcessingStage | null,
    retryable: boolean,
  ) {
    super(message);
    this.name = "GridProcessingClientError";
    this.code = code;
    this.stage = stage;
    this.retryable = retryable;
  }
}

export interface GridProcessingClientProcessOptions {
  readonly request: GridProcessingProcessRequestV1;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: GridProcessingClientProgress) => void;
}

export interface GridProcessingClient {
  process(options: GridProcessingClientProcessOptions): Promise<GridProcessingResultV1>;
}

export interface CreateGridProcessingClientOptions {
  readonly workerFactory?: () => GridProcessingWorkerPort;
}

function defaultWorkerFactory(): GridProcessingWorkerPort {
  if (typeof Worker !== "function") {
    throw new GridProcessingClientError(
      "worker-crash",
      "Grid processing worker is unavailable.",
      null,
      true,
    );
  }
  return new Worker(new URL("./gridProcessing.worker.ts", import.meta.url), {
    type: "module",
    name: "sprite-boy-grid-processing-v1",
  }) as GridProcessingWorkerPort;
}

function createExpectation(request: GridProcessingProcessRequestV1) {
  return Object.freeze({
    requestId: request.requestId,
    source: Object.freeze({ width: request.source.width, height: request.source.height }),
    layout: request.recipe.layout.mode === "auto"
      ? Object.freeze({ mode: "auto" as const })
      : Object.freeze({
          mode: "manual" as const,
          rows: request.recipe.layout.rows,
          cols: request.recipe.layout.cols,
        }),
  });
}

function invalidResponse(): GridProcessingClientError {
  return new GridProcessingClientError(
    "invalid-response",
    "Grid processing worker returned an invalid response.",
    null,
    true,
  );
}

function workerCrash(): GridProcessingClientError {
  return new GridProcessingClientError(
    "worker-crash",
    "Grid processing worker stopped unexpectedly.",
    null,
    true,
  );
}

function cancelled(): GridProcessingClientError {
  return new GridProcessingClientError(
    "cancelled",
    "Grid processing was cancelled.",
    null,
    true,
  );
}

function isAbortSignal(value: unknown): value is AbortSignal {
  const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
  try {
    return Boolean(
      abortedGetter &&
      value &&
      typeof value === "object" &&
      typeof Reflect.apply(abortedGetter, value, []) === "boolean",
    );
  } catch {
    return false;
  }
}

class DefaultGridProcessingClient implements GridProcessingClient {
  private readonly workerFactory: () => GridProcessingWorkerPort;

  constructor(options: CreateGridProcessingClientOptions) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("Grid processing client options must be an object.");
    }
    if (options.workerFactory !== undefined && typeof options.workerFactory !== "function") {
      throw new TypeError("Grid processing worker factory must be a function.");
    }
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
  }

  process(options: GridProcessingClientProcessOptions): Promise<GridProcessingResultV1> {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      return Promise.reject(new TypeError("Grid processing client process options must be an object."));
    }
    try {
      assertGridProcessingRequest(options.request);
      if (options.request.type !== "process") throw new TypeError("Grid processing requires a process request.");
      if (options.onProgress !== undefined && typeof options.onProgress !== "function") {
        throw new TypeError("Grid processing progress callback must be a function.");
      }
      if (options.signal !== undefined && !isAbortSignal(options.signal)) {
        throw new TypeError("Grid processing abort signal is invalid.");
      }
    } catch (error) {
      return Promise.reject(error);
    }

    const request = options.request;
    const signal = options.signal;
    if (signal?.aborted) return Promise.reject(cancelled());
    const expectation = createExpectation(request);
    let worker: GridProcessingWorkerPort;
    try {
      worker = this.workerFactory();
    } catch (error) {
      return Promise.reject(error instanceof GridProcessingClientError ? error : workerCrash());
    }

    return new Promise<GridProcessingResultV1>((resolve, reject) => {
      let settled = false;
      let previousStageIndex = -1;
      let previousCompleted = 0;
      let previousTotal = 0;
      let previousRatio = 0;
      let abortListener: (() => void) | null = null;

      const cleanup = (): void => {
        if (abortListener && signal) signal.removeEventListener("abort", abortListener);
        abortListener = null;
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onWorkerFailure);
        worker.removeEventListener("messageerror", onWorkerFailure);
        try {
          worker.terminate();
        } catch {
          // The terminal promise remains authoritative when native cleanup is already complete.
        }
      };
      const settleResolve = (result: GridProcessingResultV1): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const settleReject = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onWorkerFailure: GridProcessingWorkerListener = () => settleReject(workerCrash());
      const onMessage: GridProcessingWorkerListener = (event) => {
        try {
          if (!(event instanceof MessageEvent)) throw invalidResponse();
          assertGridProcessingResponse(event.data, expectation);
          const response = event.data;
          if (response.type === "progress") {
            const stageIndex = GRID_PROCESSING_STAGES.indexOf(response.stage);
            if (
              stageIndex < previousStageIndex ||
              (stageIndex === previousStageIndex &&
                (response.total !== previousTotal || response.completed < previousCompleted))
            ) {
              throw invalidResponse();
            }
            const ratio = (stageIndex + response.completed / response.total) /
              GRID_PROCESSING_STAGES.length;
            if (ratio < previousRatio) throw invalidResponse();
            previousStageIndex = stageIndex;
            previousCompleted = response.completed;
            previousTotal = response.total;
            previousRatio = ratio;
            options.onProgress?.(Object.freeze({
              ratio,
              stage: response.stage,
              completed: response.completed,
              total: response.total,
            }));
            return;
          }
          if (response.type === "result") {
            settleResolve(response.result);
            return;
          }
          if (response.type === "cancelled") {
            settleReject(cancelled());
            return;
          }
          settleReject(new GridProcessingClientError(
            response.error.code,
            "Grid processing failed.",
            response.error.stage,
            isGridProcessingErrorRetryable(response.error.code),
          ));
        } catch (error) {
          settleReject(error instanceof GridProcessingClientError ? error : invalidResponse());
        }
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onWorkerFailure);
      worker.addEventListener("messageerror", onWorkerFailure);
      if (signal) {
        abortListener = () => {
          if (settled) return;
          try {
            worker.postMessage({
              version: GRID_PROCESSING_PROTOCOL_VERSION,
              type: "cancel",
              requestId: request.requestId,
            }, []);
          } catch {
            // Termination below remains the deterministic cancellation boundary.
          }
          settleReject(cancelled());
        };
        signal.addEventListener("abort", abortListener, { once: true });
      }
      try {
        if (signal?.aborted) {
          abortListener?.();
          return;
        }
        const transfer = [...gridProcessingRequestTransferables(request)] as Transferable[];
        worker.postMessage(request, transfer);
      } catch {
        settleReject(workerCrash());
      }
    });
  }
}

export function createGridProcessingClient(
  options: CreateGridProcessingClientOptions = {},
): GridProcessingClient {
  const client = new DefaultGridProcessingClient(options);
  return Object.freeze({
    process: (processOptions: GridProcessingClientProcessOptions) => client.process(processOptions),
  });
}
