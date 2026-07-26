import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { createJobRunner, createQueuedJob, type JobRunHandle, type JobSnapshot } from "../processing";
import { createJobStore, type JobStoreState } from "../stores";
import {
  LOCAL_MODEL_CATALOG,
  getLocalModelDefinition,
  isLocalModelId,
  type LocalModelId,
} from "./modelCatalog";
import { createModelSetupJobTask } from "./modelSetupJobTask";
import { inspectLocalModel } from "./nodeModelInventory";
import { createNodeModelSetupPort } from "./nodeModelSetup";
import { createNodeOnnxSmokeRunner } from "./nodeOnnxSmoke";
import { LOCAL_MODEL_SERVICE_VERSION, type LocalModelServiceSnapshot, type LocalModelSetupResponse } from "./modelServiceProtocol";

export interface NodeModelWeightFile {
  readonly path: string;
  readonly byteSize: number;
  readonly contentType: "application/octet-stream";
}

export interface NodeModelService {
  list(): Promise<LocalModelServiceSnapshot>;
  setup(modelId: LocalModelId): Promise<LocalModelSetupResponse>;
  listJobs(): JobStoreState;
  getJob(jobId: string): JobSnapshot | null;
  cancelJob(jobId: string): JobSnapshot | null;
  resolveWeights(modelId: LocalModelId): Promise<NodeModelWeightFile | null>;
  dispose(): void;
}

export class NodeModelServiceError extends Error {
  readonly code: "invalid-request" | "license-required" | "model-not-ready" | "setup-failed";

  constructor(code: NodeModelServiceError["code"], message: string) {
    super(message);
    this.name = "NodeModelServiceError";
    this.code = code;
  }
}

function contained(root: string, target: string): boolean {
  const child = relative(root, target);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`);
}

export function createNodeModelService(options: { readonly root: string }): NodeModelService {
  if (!options || typeof options !== "object" || typeof options.root !== "string") {
    throw new TypeError("Node model service options are invalid.");
  }
  const root = resolve(options.root);
  const store = createJobStore();
  const runner = createJobRunner({ store });
  const port = createNodeModelSetupPort({ root, smoke: createNodeOnnxSmokeRunner() });
  const active = new Map<LocalModelId, JobRunHandle<unknown>>();
  const latest = new Map<LocalModelId, string>();

  const job = (jobId: string): JobSnapshot | null => {
    if (typeof jobId !== "string" || jobId.length === 0) return null;
    return store.getSnapshot().jobs[jobId] as JobSnapshot | undefined ?? null;
  };

  const service: NodeModelService = {
    async list() {
      const models = [];
      for (const id of Object.keys(LOCAL_MODEL_CATALOG)) {
        if (!isLocalModelId(id)) continue;
        const definition = getLocalModelDefinition(id);
        const inspection = await inspectLocalModel(id, { root });
        const latestJobId = latest.get(id);
        models.push(Object.freeze({
          id,
          label: definition.label,
          repositoryId: definition.repositoryId,
          revision: definition.revision,
          gated: definition.gated,
          license: Object.freeze({ ...definition.license }),
          runtime: Object.freeze({ ...definition.runtime }),
          status: inspection.status,
          capacity: inspection.capacity,
          job: latestJobId ? job(latestJobId) : null,
        }));
      }
      return Object.freeze({ version: LOCAL_MODEL_SERVICE_VERSION, models: Object.freeze(models) });
    },
    async setup(modelId) {
      if (!isLocalModelId(modelId)) {
        throw new NodeModelServiceError("invalid-request", "Unknown local model.");
      }
      const inspection = await inspectLocalModel(modelId, { root });
      if (inspection.status.state === "license-required") {
        throw new NodeModelServiceError("license-required", "Accept the model license and provide access before setup.");
      }
      if (inspection.status.state === "ready") {
        return Object.freeze({
          version: LOCAL_MODEL_SERVICE_VERSION,
          modelId,
          outcome: "ready" as const,
          job: null,
        });
      }
      const current = active.get(modelId);
      if (current) {
        return Object.freeze({
          version: LOCAL_MODEL_SERVICE_VERSION,
          modelId,
          outcome: "already-running" as const,
          job: job(current.jobId),
        });
      }
      const jobId = `model-setup-${randomUUID()}`;
      const requestId = `${jobId}-request`;
      const queued = createQueuedJob({
        id: jobId,
        requestId,
        kind: "model.setup",
        label: `Prepare ${getLocalModelDefinition(modelId).label}`,
        createdAt: new Date().toISOString(),
        timeoutMs: 45 * 60 * 1_000,
      });
      const handle = runner.run(queued, createModelSetupJobTask({ modelId, port }));
      active.set(modelId, handle as JobRunHandle<unknown>);
      latest.set(modelId, jobId);
      void handle.result.finally(() => {
        if (active.get(modelId)?.jobId === jobId) active.delete(modelId);
      });
      return Object.freeze({
        version: LOCAL_MODEL_SERVICE_VERSION,
        modelId,
        outcome: "started" as const,
        job: job(jobId),
      });
    },
    listJobs: () => store.getSnapshot(),
    getJob: job,
    cancelJob(jobId) {
      runner.cancel(jobId, "Model setup cancelled.");
      return job(jobId);
    },
    async resolveWeights(modelId) {
      if (!isLocalModelId(modelId)) return null;
      const definition = getLocalModelDefinition(modelId);
      const inspection = await inspectLocalModel(modelId, { root });
      if (inspection.status.state !== "ready") {
        throw new NodeModelServiceError("model-not-ready", "The local model is not ready.");
      }
      const weights = definition.files.find((file) => file.path.endsWith(".onnx"));
      if (!weights) throw new NodeModelServiceError("setup-failed", "The model has no ONNX weights.");
      const path = resolve(root, modelId, weights.path);
      if (!contained(root, path)) throw new NodeModelServiceError("setup-failed", "The model path is unsafe.");
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== weights.byteSize) {
        throw new NodeModelServiceError("model-not-ready", "The local model weights are invalid.");
      }
      return Object.freeze({ path, byteSize: weights.byteSize, contentType: "application/octet-stream" as const });
    },
    dispose() {
      runner.dispose();
      active.clear();
    },
  };
  return Object.freeze(service);
}
