import type { JobRunner } from "../../core/processing";
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
import type { LocalModelServiceClient } from "../../core/models";
import { navigateStudioWorkspace } from "../../components/studio/useStudioNavigation";

export const BROWSER_STUDIO_CONTROL_SUPPORTED_COMMANDS = Object.freeze([
  "capabilities.get",
  "project.get",
  "selection.get",
  "workspace.navigate",
  "model.status",
  "jobs.list",
  "jobs.cancel",
] as const);

export interface StudioControlPortDependencies {
  readonly projectStore: ProjectStore;
  readonly jobStore: JobStore;
  readonly jobRunner: JobRunner;
  readonly models?: LocalModelServiceClient;
  readonly navigate: (workspaceId: WorkspaceId) => ProjectStoreDispatchResult;
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

export function createBrowserStudioControlPorts(
  dependencies: StudioControlPortDependencies,
): StudioControlPorts {
  const revision = (): number => dependencies.projectStore.getSnapshot().revision;
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
    importAsset: (_params, context) => guard(context, unsupported),
    importVideo: (_params, context) => guard(context, unsupported),
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
    setupModel: (_params, context) => guard(context, unsupported),
    listJobs: (context) => guard(context, (currentRevision) => ({
      ok: true,
      revision: currentRevision,
      result: dependencies.jobStore.getSnapshot(),
    })),
    cancelJob: (params, context) => guard(context, (currentRevision) => {
      const didCancel = dependencies.jobRunner.cancel(
        params.jobId,
        "Cancelled by the local control bridge.",
      );
      return didCancel
        ? { ok: true, revision: currentRevision, result: { jobId: params.jobId } }
        : {
            ok: false,
            revision: currentRevision,
            error: {
              code: "not-found",
              message: "The requested active job was not found.",
              retryable: false,
            },
          };
    }),
    runExport: (_params, context) => guard(context, unsupported),
  };
  return Object.freeze(ports);
}
