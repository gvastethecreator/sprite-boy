import { createQueuedJob, JobTaskError, type JobRunner } from "../../core/processing";
import type { AssetRepository } from "../../core/assets";
import type {
  JobStore,
  ProjectStore,
  ProjectStoreDispatchResult,
} from "../../core/stores";
import type {
  StudioControlPortContext,
  StudioControlPortFailure,
  StudioControlPortResult,
  StudioControlPorts,
} from "../../core/control/controlService";
import type { WorkspaceId } from "../../core/project";
import { LocalModelServiceError, type LocalModelServiceClient } from "../../core/models";
import {
  HostFileServiceError,
  type HostFileServiceClient,
} from "../../core/control/hostFileServiceClient";
import { LazyMediabunnyVideoAdapter } from "../../core/media/lazyMediabunnyVideoAdapter";
import {
  importSliceSource,
  SliceSourceImportError,
} from "../slice/source/importSliceSource";
import {
  prepareSourceFile,
  type SourceFileError,
} from "../slice/source/sourceFilePolicy";
import {
  closeDecodedSourceImage,
  createBrowserSourceDecoder,
  type SourceDecoder,
} from "../slice/source/browserSourceDecoder";
import {
  createVideoImportJobTask,
  type VideoImportAdapter,
} from "../slice/video/videoImportJobTask";
import { navigateStudioWorkspace } from "../../components/studio/useStudioNavigation";

const BROWSER_STUDIO_CONTROL_BASE_COMMANDS = Object.freeze([
  "capabilities.get",
  "project.get",
  "selection.get",
  "workspace.navigate",
] as const);

export interface StudioControlPortDependencies {
  readonly projectStore: ProjectStore;
  readonly assetRepository?: AssetRepository;
  readonly jobStore: JobStore;
  readonly jobRunner: JobRunner;
  readonly models?: LocalModelServiceClient;
  readonly hostFiles?: HostFileServiceClient;
  readonly videoAdapter?: VideoImportAdapter;
  readonly sourceDecoder?: SourceDecoder;
  readonly reportAssetCleanupDebt?: (projectId: string, assetId: string, pending: boolean) => void;
  readonly navigate: (workspaceId: WorkspaceId) => ProjectStoreDispatchResult;
}

export function getBrowserStudioControlSupportedCommands(
  dependencies: StudioControlPortDependencies,
) {
  return Object.freeze([
    ...BROWSER_STUDIO_CONTROL_BASE_COMMANDS,
    ...(dependencies.hostFiles && dependencies.assetRepository
      ? ["asset.import" as const, "video.import" as const]
      : []),
    ...(dependencies.models ? ["model.status" as const, "model.setup" as const] : []),
    "jobs.list" as const,
    "jobs.cancel" as const,
  ]);
}

const VIDEO_IMPORT_TIMEOUT_MS = 30 * 60 * 1_000;
let controlIdentity = 0;

function nextControlId(prefix: string): string {
  try {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID === "function") return `${prefix}-${randomUUID.call(globalThis.crypto)}`;
  } catch {
    // A process-local fallback is enough for one browser document.
  }
  controlIdentity += 1;
  return `${prefix}-${Date.now().toString(36)}-${controlIdentity.toString(36)}`;
}

function cancelled(revision: number): StudioControlPortFailure {
  return {
    ok: false,
    revision,
    error: {
      code: "cancelled",
      message: "The control operation was cancelled.",
      retryable: false,
    },
  };
}

function revisionConflict(revision: number): StudioControlPortFailure {
  return {
    ok: false,
    revision,
    error: {
      code: "revision-conflict",
      message: "The project changed while the control import was prepared.",
      retryable: true,
    },
  };
}

function unsupported(revision: number): StudioControlPortFailure {
  return {
    ok: false,
    revision,
    error: {
      code: "unsupported-command",
      message: "This control command is not connected to the Studio yet.",
      retryable: false,
    },
  };
}

function serviceUnavailable(revision: number): StudioControlPortFailure {
  return {
    ok: false,
    revision,
    error: {
      code: "internal",
      message: "The local model service is unavailable.",
      retryable: true,
    },
  };
}

function modelFailure(revision: number, error: unknown): StudioControlPortFailure {
  if (error instanceof LocalModelServiceError) {
    if (error.code === "not-found") {
      return {
        ok: false,
        revision,
        error: { code: "not-found", message: error.message, retryable: false },
      };
    }
    if (error.code === "license-required" || error.code === "invalid-request") {
      return {
        ok: false,
        revision,
        error: { code: "invalid-request", message: error.message, retryable: false },
      };
    }
  }
  return serviceUnavailable(revision);
}

function mergeJobStores(
  browser: ReturnType<JobStore["getSnapshot"]>,
  models: ReturnType<JobStore["getSnapshot"]>,
): ReturnType<JobStore["getSnapshot"]> {
  const jobs = { ...browser.jobs };
  const order = [...browser.order];
  for (const jobId of models.order) {
    if (jobs[jobId]) throw new Error("Job stores contain the same job ID.");
    const job = models.jobs[jobId];
    if (!job) throw new Error("Model job store order is invalid.");
    jobs[jobId] = job;
    order.push(jobId);
  }
  return Object.freeze({
    jobs: Object.freeze(jobs),
    order: Object.freeze(order),
    retiredRequestIds: Object.freeze([...new Set([
      ...browser.retiredRequestIds,
      ...models.retiredRequestIds,
    ])]),
    retiredJobIds: Object.freeze([...new Set([
      ...browser.retiredJobIds,
      ...models.retiredJobIds,
    ])]),
    consumedRetrySourceIds: Object.freeze([...new Set([
      ...browser.consumedRetrySourceIds,
      ...models.consumedRetrySourceIds,
    ])]),
  });
}

function importFailure(revision: number, error: unknown): StudioControlPortFailure {
  if (error instanceof HostFileServiceError) {
    if (error.code === "cancelled") return cancelled(revision);
    const retryable = error.code === "connection" || error.code === "changed"
      || error.code === "read-failed" || error.code === "busy";
    return {
      ok: false,
      revision,
      error: {
        code: retryable ? "internal" : error.code === "not-found" ? "not-found" : "invalid-request",
        message: error.message,
        retryable,
      },
    };
  }
  if (error instanceof SliceSourceImportError) {
    return {
      ok: false,
      revision,
      error: {
        code: error.code === "cancelled" ? "cancelled" : "internal",
        message: error.message,
        retryable: error.code === "project-changed" || error.code === "repository-failed",
      },
    };
  }
  return {
    ok: false,
    revision,
    error: {
      code: "invalid-request",
      message: "The requested import could not be prepared.",
      retryable: false,
    },
  };
}

function hostFileJobError(error: unknown): JobTaskError {
  if (error instanceof HostFileServiceError) {
    const retryable = error.code === "connection" || error.code === "changed"
      || error.code === "read-failed" || error.code === "busy" || error.code === "cancelled";
    return new JobTaskError(retryable ? "runtime-failure" : "invalid-input", error.message, retryable);
  }
  return new JobTaskError("runtime-failure", "Video source could not be read.", true);
}

function pathFileName(path: string): string {
  const name = path.split(/[\\/]/u).pop()?.replace(/[\p{Cc}]/gu, "-").trim();
  return (name || "video").slice(0, 120);
}

function sourcePolicyFailure(revision: number, error: SourceFileError): StudioControlPortFailure {
  return {
    ok: false,
    revision,
    error: {
      code: error.code === "aborted" ? "cancelled" : "invalid-request",
      message: error.message,
      retryable: error.retryable,
    },
  };
}

export function createBrowserStudioControlPorts(
  dependencies: StudioControlPortDependencies,
): StudioControlPorts {
  const revision = (): number => dependencies.projectStore.getSnapshot().revision;
  const sourceDecoder = dependencies.sourceDecoder ?? createBrowserSourceDecoder();
  const guard = (
    context: StudioControlPortContext,
    run: (currentRevision: number) => StudioControlPortResult,
  ): StudioControlPortResult => {
    const currentRevision = revision();
    return context.signal.aborted ? cancelled(currentRevision) : run(currentRevision);
  };

  const ports: StudioControlPorts = {
    getRevision: revision,
    getProject: (context) => guard(context, (currentRevision) => ({
      ok: true,
      revision: currentRevision,
      result: dependencies.projectStore.getSnapshot().project,
    })),
    getSelection: (context) => guard(context, (currentRevision) => ({
      ok: true,
      revision: currentRevision,
      result: dependencies.projectStore.getSnapshot().project.workspace,
    })),
    navigate: (params, context) => guard(context, () => {
      const result = dependencies.navigate(params.workspaceId);
      if (result.result.ok) navigateStudioWorkspace(params.workspaceId);
      return result.result.ok
        ? {
            ok: true,
            revision: result.revision,
            result: { workspaceId: params.workspaceId },
          }
        : {
            ok: false,
            revision: result.revision,
            error: {
              code: "invalid-request",
              message: "The Studio could not open that workspace.",
              retryable: false,
            },
          };
    }),
    importAsset: async (params, context) => {
      const currentRevision = revision();
      const currentProjectId = dependencies.projectStore.getSnapshot().project.id;
      if (context.signal.aborted) return cancelled(currentRevision);
      if (!dependencies.hostFiles || !dependencies.assetRepository) return unsupported(currentRevision);
      try {
        const file = await dependencies.hostFiles.read(params.path, "image", context.signal);
        const prepared = await prepareSourceFile({
          name: file.name,
          type: file.blob.type,
          size: file.byteSize,
          arrayBuffer: () => file.blob.arrayBuffer(),
        }, { signal: context.signal });
        if (!prepared.valid) return sourcePolicyFailure(revision(), prepared.error);
        const beforeDecode = dependencies.projectStore.getSnapshot();
        if (beforeDecode.revision !== currentRevision || beforeDecode.project.id !== currentProjectId) {
          return revisionConflict(beforeDecode.revision);
        }
        const decoded = await sourceDecoder.decode(prepared.source.blob, { signal: context.signal });
        let imported;
        try {
          const beforeImport = dependencies.projectStore.getSnapshot();
          if (beforeImport.revision !== currentRevision || beforeImport.project.id !== currentProjectId) {
            return revisionConflict(beforeImport.revision);
          }
          imported = await importSliceSource({
            store: dependencies.projectStore,
            repository: dependencies.assetRepository,
            blob: prepared.source.blob,
            name: prepared.source.metadata.name,
            mimeType: prepared.source.metadata.mimeType,
            width: decoded.width,
            height: decoded.height,
            signal: context.signal,
          });
        } finally {
          closeDecodedSourceImage(decoded);
        }
        navigateStudioWorkspace("slice");
        return {
          ok: true,
          revision: imported.revision,
          result: { assetId: imported.asset.id, name: imported.asset.name },
        };
      } catch (error) {
        if (error instanceof SliceSourceImportError && error.cleanupAssetIds.length > 0) {
          for (const assetId of error.cleanupAssetIds) {
            dependencies.reportAssetCleanupDebt?.(currentProjectId, assetId, true);
          }
        }
        return context.signal.aborted ? cancelled(revision()) : importFailure(revision(), error);
      }
    },
    importVideo: async (params, context) => {
      const currentRevision = revision();
      const currentProjectId = dependencies.projectStore.getSnapshot().project.id;
      if (context.signal.aborted) return cancelled(currentRevision);
      if (!dependencies.hostFiles || !dependencies.assetRepository) return unsupported(currentRevision);
      try {
        const createdAt = new Date().toISOString();
        const job = createQueuedJob({
          id: nextControlId("video-job"),
          requestId: nextControlId("video-request"),
          kind: "video.import",
          label: `Extract ${pathFileName(params.path)}`,
          createdAt,
          timeoutMs: VIDEO_IMPORT_TIMEOUT_MS,
        });
        const handle = dependencies.jobRunner.run(job, async (jobContext) => {
          jobContext.reportProgress({ ratio: 0.01, phase: "video.transfer", message: null });
          let file;
          try {
            file = await dependencies.hostFiles!.read(params.path, "video", jobContext.signal);
          } catch (error) {
            throw hostFileJobError(error);
          }
          const beforeImport = dependencies.projectStore.getSnapshot();
          if (beforeImport.revision !== currentRevision || beforeImport.project.id !== currentProjectId) {
            throw new JobTaskError(
              "runtime-failure",
              "The project changed while the video source was read.",
              true,
            );
          }
          return createVideoImportJobTask({
            adapter: dependencies.videoAdapter ?? new LazyMediabunnyVideoAdapter(),
            store: dependencies.projectStore,
            repository: dependencies.assetRepository!,
            file: file.blob,
            fileName: file.name,
            selection: {
              trackIndex: 0,
              range: { startUs: params.startUs, endUs: params.endUs },
              sampling: params.sampling,
            },
            reportAssetCleanupDebt: dependencies.reportAssetCleanupDebt,
          })(jobContext);
        }, { signal: context.signal });
        void handle.result.catch(() => undefined);
        if (context.signal.aborted) {
          handle.cancel("Control operation was cancelled.");
          return cancelled(revision());
        }
        return {
          ok: true,
          revision: revision(),
          result: { jobId: handle.jobId, requestId: handle.requestId },
        };
      } catch (error) {
        return context.signal.aborted ? cancelled(revision()) : importFailure(revision(), error);
      }
    },
    getModelStatus: async (params, context) => {
      const currentRevision = revision();
      if (context.signal.aborted) return cancelled(currentRevision);
      if (!dependencies.models) return unsupported(currentRevision);
      try {
        const snapshot = await dependencies.models.list(context.signal);
        if (context.signal.aborted) return cancelled(revision());
        const model = snapshot.models.find((entry) => entry.id === params.modelId);
        return model
          ? { ok: true, revision: revision(), result: model }
          : {
              ok: false,
              revision: revision(),
              error: {
                code: "not-found",
                message: "The requested local model was not found.",
                retryable: false,
              },
            };
      } catch {
        return context.signal.aborted ? cancelled(revision()) : serviceUnavailable(revision());
      }
    },
    setupModel: async (params, context) => {
      const currentRevision = revision();
      if (context.signal.aborted) return cancelled(currentRevision);
      if (!dependencies.models) return unsupported(currentRevision);
      try {
        const result = await dependencies.models.setup(params.modelId, context.signal);
        return context.signal.aborted
          ? cancelled(revision())
          : { ok: true, revision: revision(), result };
      } catch (error) {
        return context.signal.aborted ? cancelled(revision()) : modelFailure(revision(), error);
      }
    },
    listJobs: async (context) => {
      const currentRevision = revision();
      if (context.signal.aborted) return cancelled(currentRevision);
      if (!dependencies.models) {
        return { ok: true, revision: currentRevision, result: dependencies.jobStore.getSnapshot() };
      }
      try {
        const modelJobs = await dependencies.models.listJobs(context.signal);
        return context.signal.aborted
          ? cancelled(revision())
          : {
              ok: true,
              revision: revision(),
              result: mergeJobStores(dependencies.jobStore.getSnapshot(), modelJobs),
            };
      } catch (error) {
        return context.signal.aborted ? cancelled(revision()) : modelFailure(revision(), error);
      }
    },
    cancelJob: async (params, context) => {
      const currentRevision = revision();
      if (context.signal.aborted) return cancelled(currentRevision);
      const didCancel = dependencies.jobRunner.cancel(
        params.jobId,
        "Cancelled by the local control bridge.",
      );
      if (didCancel) return { ok: true, revision: currentRevision, result: { jobId: params.jobId } };
      if (dependencies.models) {
        try {
          const job = await dependencies.models.cancelJob(params.jobId, context.signal);
          if (context.signal.aborted) return cancelled(revision());
          if (job.status === "cancelled") {
            return { ok: true, revision: revision(), result: { jobId: params.jobId } };
          }
        } catch (error) {
          return context.signal.aborted ? cancelled(revision()) : modelFailure(revision(), error);
        }
      }
      return {
        ok: false,
        revision: currentRevision,
        error: {
          code: "not-found",
          message: "The requested active job was not found.",
          retryable: false,
        },
      };
    },
    runExport: (_params, context) => guard(context, unsupported),
  };
  return Object.freeze(ports);
}
