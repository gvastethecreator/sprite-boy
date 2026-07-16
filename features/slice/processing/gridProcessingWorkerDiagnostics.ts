import type {
  GridProcessingErrorCode,
  GridProcessingStage,
} from "../../../core/processing/gridProcessingProtocol";

export class GridProcessingWorkerFailure extends Error {
  readonly code: GridProcessingErrorCode;
  readonly stage: GridProcessingStage | null;

  constructor(code: GridProcessingErrorCode, stage: GridProcessingStage | null) {
    super(code);
    this.name = "GridProcessingWorkerFailure";
    this.code = code;
    this.stage = stage;
  }
}

/** Retains only the public protocol stage; private algorithm details never cross the Worker boundary. */
export class GridProcessingStageBoundary {
  #stage: GridProcessingStage | null = null;

  get stage(): GridProcessingStage | null {
    return this.#stage;
  }

  async run<Result>(
    stage: GridProcessingStage,
    operation: () => Result | PromiseLike<Result>,
  ): Promise<Result> {
    this.#stage = stage;
    return await operation();
  }
}

export function diagnoseGridProcessingWorkerFailure(
  error: unknown,
  stage: GridProcessingStage | null,
): {
  readonly code: GridProcessingErrorCode;
  readonly stage: GridProcessingStage | null;
} {
  if (error instanceof GridProcessingWorkerFailure) {
    return { code: error.code, stage: error.stage };
  }
  if (error instanceof RangeError) return { code: "memory", stage };
  if (error instanceof TypeError) return { code: "invalid-input", stage };
  return { code: "worker-crash", stage };
}
