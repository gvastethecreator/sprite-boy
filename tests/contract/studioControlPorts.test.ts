import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyStudioProject, type WorkspaceId } from "../../core/project";
import { createJobRunner, type JobRunner } from "../../core/processing";
import { createJobStore, createProjectStore } from "../../core/stores";
import type { StudioControlPortContext } from "../../core/control/controlService";
import type { LocalModelServiceClient } from "../../core/models";
import { createBrowserStudioControlPorts } from "../../features/control/studioControlPorts";

const NOW = "2026-07-26T00:00:00.000Z";

function context(signal = new AbortController().signal): StudioControlPortContext {
  return Object.freeze({
    signal,
    requestId: "request-1",
    idempotencyKey: "key-1",
    expectedRevision: null,
  });
}

function runtime(cancel = false, models?: LocalModelServiceClient) {
  let identity = 0;
  const projectStore = createProjectStore(
    createEmptyStudioProject({ id: "project-control", now: NOW }),
    {
      context: {
        now: () => NOW,
        nextId: () => `control-${++identity}`,
      },
    },
  );
  const jobStore = createJobStore();
  const realRunner = createJobRunner({ store: jobStore });
  const cancelMock = vi.fn(() => cancel);
  const jobRunner: JobRunner = {
    run: realRunner.run,
    cancel: cancelMock,
    getActiveCount: realRunner.getActiveCount,
    dispose: realRunner.dispose,
  };
  const navigate = vi.fn((workspaceId: WorkspaceId) => projectStore.dispatch({
    command: { type: "workspace.update", patch: { activeWorkspace: workspaceId } },
    metadata: {
      commandId: `navigate-${workspaceId}`,
      origin: "user",
      history: "ignore",
      issuedAt: NOW,
    },
  }));
  return {
    projectStore,
    jobStore,
    jobRunner,
    cancelMock,
    navigate,
    ports: createBrowserStudioControlPorts({ projectStore, jobStore, jobRunner, navigate, models }),
  };
}

afterEach(() => {
  window.history.replaceState(window.history.state, "", "#/studio/slice");
});

describe("browser Studio control ports", () => {
  it("reads the canonical project, selection, and job store", async () => {
    const value = runtime();
    const project = await value.ports.getProject(context());
    const selection = await value.ports.getSelection(context());
    const jobs = await value.ports.listJobs(context());

    expect(project).toMatchObject({
      ok: true,
      revision: 0,
      result: { id: "project-control", schemaVersion: 2 },
    });
    expect(selection).toMatchObject({ ok: true, result: {} });
    expect(jobs).toMatchObject({ ok: true, result: { order: [], jobs: {} } });
  });

  it("updates the project and shell route for workspace.navigate", async () => {
    const value = runtime();
    window.history.replaceState(window.history.state, "", "#/studio/slice");

    const response = await value.ports.navigate({ workspaceId: "compose" }, context());

    expect(response).toMatchObject({
      ok: true,
      revision: 1,
      result: { workspaceId: "compose" },
    });
    expect(value.navigate).toHaveBeenCalledWith("compose");
    expect(value.projectStore.getSnapshot().project.workspace.activeWorkspace).toBe("compose");
    expect(window.location.hash).toBe("#/studio/compose");
  });

  it("does not navigate after cancellation", async () => {
    const value = runtime();
    const controller = new AbortController();
    controller.abort();

    const response = await value.ports.navigate(
      { workspaceId: "compose" },
      context(controller.signal),
    );

    expect(response).toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(value.navigate).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/studio/slice");
  });

  it("routes job cancellation and reports a missing active job", async () => {
    const accepted = runtime(true);
    const missing = runtime(false);

    expect(await accepted.ports.cancelJob({ jobId: "job-1" }, context())).toMatchObject({
      ok: true,
      result: { jobId: "job-1" },
    });
    expect(await missing.ports.cancelJob({ jobId: "job-2" }, context())).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
    expect(accepted.cancelMock).toHaveBeenCalledWith(
      "job-1",
      "Cancelled by the local control bridge.",
    );
  });

  it("returns typed unsupported failures for ports that still need host adapters", async () => {
    const value = runtime();
    const response = await value.ports.setupModel(
      { modelId: "birefnet-lite-512", acceptLicense: false },
      context(),
    );

    expect(response).toMatchObject({
      ok: false,
      revision: 0,
      error: { code: "unsupported-command", retryable: false },
    });
  });

  it("reads real local model status through the connected model service", async () => {
    const model = {
      id: "birefnet-lite-512" as const,
      label: "BiRefNet Lite 512",
      repositoryId: "studioludens/birefnet-lite-512",
      revision: "a".repeat(40),
      gated: false,
      license: { id: "MIT", name: "MIT License", use: "permissive" as const, url: "https://example.test/model", acceptanceUrl: null },
      runtime: { inputWidth: 512, inputHeight: 512, dtype: "fp16", preferredBackends: ["wasm" as const], minimumMemoryBytes: 1 },
      status: { modelId: "birefnet-lite-512" as const, state: "ready" as const, verifiedBytes: 10, totalBytes: 10, problems: [] },
      capacity: { state: "supported" as const, canInstall: true, requiredStorageBytes: 10, requiredMemoryBytes: 1, problems: [] },
      job: null,
    };
    const models = {
      list: vi.fn(async () => ({ version: 1 as const, models: [model] })),
    } as unknown as LocalModelServiceClient;
    const value = runtime(false, models);

    await expect(value.ports.getModelStatus(
      { modelId: "birefnet-lite-512" },
      context(),
    )).resolves.toMatchObject({
      ok: true,
      revision: 0,
      result: { id: "birefnet-lite-512", status: { state: "ready" } },
    });
    expect(models.list).toHaveBeenCalledTimes(1);
  });
});
