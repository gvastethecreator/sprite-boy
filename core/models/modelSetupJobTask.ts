import { getLocalModelDefinition, isLocalModelId, type LocalModelId } from "./modelCatalog";
import { parseModelInstallManifest, type ModelInstallManifest } from "./modelInstallManifest";
import { JobTaskError, type JobTask } from "../processing/jobRunner";

export interface ModelSetupProgress {
  readonly ratio: number;
  readonly phase: "prepare" | "download" | "verify" | "smoke";
  readonly message: string;
}

export interface ModelSetupPort {
  install(options: {
    readonly modelId: LocalModelId;
    readonly requestId: string;
    readonly signal: AbortSignal;
    readonly onProgress: (progress: ModelSetupProgress) => void;
  }): PromiseLike<ModelInstallManifest>;
}

export class ModelSetupPortError extends Error {
  readonly code: "invalid-input" | "license-required" | "download-failed" | "storage-failed" | "verification-failed" | "smoke-failed";
  readonly retryable: boolean;

  constructor(code: ModelSetupPortError["code"], message: string, retryable: boolean) {
    super(message);
    this.name = "ModelSetupPortError";
    this.code = code;
    this.retryable = retryable;
  }
}

function toJobError(error: unknown): JobTaskError {
  if (!(error instanceof ModelSetupPortError)) {
    return new JobTaskError("runtime-failure", "No se pudo preparar el modelo local.", true);
  }
  const code = error.code === "invalid-input" || error.code === "license-required"
    ? "invalid-input"
    : error.code === "storage-failed"
      ? "storage-failure"
      : "provider-failure";
  return new JobTaskError(code, error.message, error.retryable);
}

export function createModelSetupJobTask(options: {
  readonly modelId: LocalModelId;
  readonly port: ModelSetupPort;
}): JobTask<ModelInstallManifest> {
  if (!options || typeof options !== "object" || !isLocalModelId(options.modelId)) {
    throw new TypeError("Model setup job options are invalid.");
  }
  if (!options.port || typeof options.port !== "object" || typeof options.port.install !== "function") {
    throw new TypeError("Model setup port is invalid.");
  }
  const modelId = options.modelId;
  const install = options.port.install.bind(options.port);
  return async ({ requestId, signal, reportProgress }) => {
    try {
      const manifest = await install({
        modelId,
        requestId,
        signal,
        onProgress: ({ ratio, phase, message }) => {
          reportProgress({ ratio, phase, message });
        },
      });
      return parseModelInstallManifest(manifest, getLocalModelDefinition(modelId));
    } catch (error) {
      throw toJobError(error);
    }
  };
}
