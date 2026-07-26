import type { JobSnapshot } from "../processing";
import type {
  LocalModelId,
  ModelBackend,
} from "./modelCatalog";
import type {
  LocalModelState,
  ModelCapacityAssessment,
} from "./modelReadiness";

export const LOCAL_MODEL_SERVICE_VERSION = 1 as const;

export interface LocalModelServiceSummary {
  readonly id: LocalModelId;
  readonly label: string;
  readonly repositoryId: string;
  readonly revision: string;
  readonly gated: boolean;
  readonly license: {
    readonly id: string;
    readonly name: string;
    readonly use: "permissive" | "non-commercial";
    readonly url: string;
    readonly acceptanceUrl: string | null;
  };
  readonly runtime: {
    readonly inputWidth: number;
    readonly inputHeight: number;
    readonly dtype: "fp16" | "fp32" | "q4f16";
    readonly preferredBackends: readonly ModelBackend[];
    readonly minimumMemoryBytes: number;
    readonly inputNormalization: "imagenet" | "zero-one";
    readonly outputNormalization: "min-max" | "sigmoid";
    readonly outputType: "float16" | "float32";
    readonly inputName: string | null;
    readonly outputName: string | null;
  };
  readonly status: {
    readonly state: LocalModelState;
    readonly verifiedBytes: number;
    readonly totalBytes: number;
    readonly problems: readonly string[];
  };
  readonly capacity: ModelCapacityAssessment;
  readonly job: JobSnapshot | null;
}

export interface LocalModelServiceSnapshot {
  readonly version: typeof LOCAL_MODEL_SERVICE_VERSION;
  readonly models: readonly LocalModelServiceSummary[];
}

export interface LocalModelSetupResponse {
  readonly version: typeof LOCAL_MODEL_SERVICE_VERSION;
  readonly modelId: LocalModelId;
  readonly outcome: "started" | "already-running" | "ready";
  readonly job: JobSnapshot | null;
}

export type LocalModelServiceErrorCode =
  | "authentication"
  | "connection"
  | "invalid-response"
  | "invalid-request"
  | "license-required"
  | "model-not-ready"
  | "not-found"
  | "setup-failed";

export interface LocalModelServiceFailureBody {
  readonly version: typeof LOCAL_MODEL_SERVICE_VERSION;
  readonly error: {
    readonly code: Exclude<LocalModelServiceErrorCode, "authentication" | "connection" | "invalid-response">;
    readonly message: string;
  };
}
