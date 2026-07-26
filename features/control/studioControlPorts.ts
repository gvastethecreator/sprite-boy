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
import { navigateStudioWorkspace } from "../../components/studio/useStudioNavigation";

export interface StudioControlPortDependencies {
  readonly projectStore: ProjectStore;
  readonly jobStore: JobStore;
  readonly jobRunner: JobRunner;
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
    getModelStatus: (_params, context) => guard(context, unsupported),
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
