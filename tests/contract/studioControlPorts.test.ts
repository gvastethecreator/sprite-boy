import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetRepositoryError, type AssetMetadata, type AssetRepository } from "../../core/assets";
import {
  HostFileServiceError,
  type HostFileServiceClient,
} from "../../core/control/hostFileServiceClient";
import { createEmptyStudioProject, type AssetRecord, type WorkspaceId } from "../../core/project";
import { createJobRunner, createQueuedJob, type JobRunner } from "../../core/processing";
import { createJobStore, createProjectStore } from "../../core/stores";
import type { StudioControlPortContext } from "../../core/control/controlService";
import type { LocalModelServiceClient } from "../../core/models";
import type { VideoImportAdapter } from "../../features/slice/video/videoImportJobTask";
import {
  createBrowserStudioControlPorts,
  getBrowserStudioControlSupportedCommands,
} from "../../features/control/studioControlPorts";

const NOW = "2026-07-26T00:00:00.000Z";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function context(signal = new AbortController().signal): StudioControlPortContext {
  return Object.freeze({
    signal,
    requestId: "request-1",
    idempotencyKey: "key-1",
    expectedRevision: null,
  });
}

function repository(
  projectId: string,
  options: { readonly throwAfterPut?: boolean; readonly failRemove?: boolean } = {},
): AssetRepository {
  const records = new Map<string, { record: AssetRecord; blob: Blob }>();
  const missing = (assetId: string) => new AssetRepositoryError("ASSET_NOT_FOUND", "Missing.", {
    operation: "get-metadata",
    assetId,
  });
  return {
    projectId,
    async put(blob: Blob, metadata: AssetMetadata) {
      const record: AssetRecord = {
        id: metadata.id,
        name: metadata.name,
        blobKey: `sha256:${"a".repeat(64)}`,
        contentHash: "a".repeat(64),
        mimeType: metadata.declaredMimeType ?? blob.type,
        media: metadata.media ?? { type: "image" },
        width: metadata.width,
        height: metadata.height,
        byteSize: blob.size,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        provenance: metadata.provenance,
      };
      records.set(record.id, { record, blob });
      if (options.throwAfterPut) throw new Error("Injected late put failure.");
      return record;
    },
    async getMetadata(assetId) {
      const value = records.get(assetId);
      if (!value) throw missing(assetId);
      return value.record;
    },
    async getBlob(assetId) {
      const value = records.get(assetId);
      if (!value) throw missing(assetId);
      return value.blob;
    },
    async list() { return [...records.values()].map(({ record }) => record); },
    async verify() { throw new Error("Unused."); },
    async scanIntegrity() { throw new Error("Unused."); },
    async remove(assetId) {
      if (options.failRemove) throw new Error("Injected cleanup failure.");
      records.delete(assetId);
    },
    async *exportMany() { /* Unused. */ },
    async createRuntimeUrl() { throw new Error("Unused."); },
    releaseRuntimeUrl() {},
    releaseOwner() {},
    dispose() {},
  };
}

interface RuntimeOptions {
  readonly cancel?: boolean;
  readonly models?: LocalModelServiceClient;
  readonly hostFiles?: HostFileServiceClient;
  readonly videoAdapter?: VideoImportAdapter;
  readonly withRepository?: boolean;
  readonly assetRepository?: AssetRepository;
  readonly useDefaultSourceDecoder?: boolean;
  readonly reportAssetCleanupDebt?: (projectId: string, assetId: string, pending: boolean) => void;
}

function runtime(options: RuntimeOptions = {}) {
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
  const cancelMock = vi.fn((jobId: string, message?: string) => options.cancel
    ? true
    : realRunner.cancel(jobId, message));
  const jobRunner: JobRunner = {
    run: (job, task, runOptions) => realRunner.run(job, task, runOptions),
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
  const assetRepository = options.assetRepository
    ?? (options.withRepository ? repository("project-control") : undefined);
  const portDependencies = {
    projectStore,
    jobStore,
    jobRunner,
    navigate,
    models: options.models,
    hostFiles: options.hostFiles,
    videoAdapter: options.videoAdapter,
    assetRepository,
    sourceDecoder: options.useDefaultSourceDecoder
      ? undefined
      : { decode: async () => Object.freeze({ image: {}, width: 16, height: 8, close: vi.fn() }) },
    reportAssetCleanupDebt: options.reportAssetCleanupDebt,
  };
  return {
    projectStore,
    jobStore,
    jobRunner,
    cancelMock,
    navigate,
    portDependencies,
    ports: createBrowserStudioControlPorts(portDependencies),
  };
}

afterEach(() => {
  window.history.replaceState(window.history.state, "", "#/studio/slice");
  vi.unstubAllGlobals();
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
    const accepted = runtime({ cancel: true });
    const missing = runtime();

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
    const value = runtime({ models });

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

  it("imports a brokered PNG through the canonical Slice source boundary", async () => {
    const png = new Blob([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ], { type: "image/png" });
    const hostFiles = {
      read: vi.fn(async () => ({ blob: png, name: "hero.png", byteSize: png.size })),
    } as HostFileServiceClient;
    const value = runtime({ hostFiles, withRepository: true });

    const result = await value.ports.importAsset({ path: "D:\\media\\hero.png" }, context());

    expect(result).toMatchObject({
      ok: true,
      revision: 1,
      result: { name: "hero.png" },
    });
    expect(hostFiles.read).toHaveBeenCalledWith("D:\\media\\hero.png", "image", expect.any(AbortSignal));
    expect(value.projectStore.getSnapshot().project.workspace).toMatchObject({
      activeWorkspace: "slice",
      selectedAssetId: expect.any(String),
    });
    expect(window.location.hash).toBe("#/studio/slice");
  });

  it("rejects an image import when the authorized revision changes during transfer", async () => {
    const png = new Blob([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ], { type: "image/png" });
    const pending = deferred<{ blob: Blob; name: string; byteSize: number }>();
    const hostFiles = { read: vi.fn(() => pending.promise) } as unknown as HostFileServiceClient;
    const value = runtime({ hostFiles, withRepository: true });

    const importing = value.ports.importAsset({ path: "D:\\media\\hero.png" }, context());
    value.navigate("compose");
    pending.resolve({ blob: png, name: "hero.png", byteSize: png.size });

    await expect(importing).resolves.toMatchObject({
      ok: false,
      revision: 1,
      error: { code: "revision-conflict", retryable: true },
    });
    expect(value.projectStore.getSnapshot().project.assets).toEqual({});
  });

  it("uses the bounded browser decoder before storing a brokered image", async () => {
    const png = new Blob([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ], { type: "image/png" });
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 16_385, height: 1, close })));
    const hostFiles = {
      read: vi.fn(async () => ({ blob: png, name: "wide.png", byteSize: png.size })),
    } as HostFileServiceClient;
    const value = runtime({ hostFiles, withRepository: true, useDefaultSourceDecoder: true });

    await expect(value.ports.importAsset({ path: "D:\\media\\wide.png" }, context())).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-request" },
    });
    expect(close).toHaveBeenCalledOnce();
    expect(value.projectStore.getSnapshot().project.assets).toEqual({});
  });

  it("reports durable cleanup debt when an image write cannot roll back", async () => {
    const png = new Blob([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ], { type: "image/png" });
    const hostFiles = {
      read: vi.fn(async () => ({ blob: png, name: "hero.png", byteSize: png.size })),
    } as HostFileServiceClient;
    const debt = vi.fn();
    const value = runtime({
      hostFiles,
      assetRepository: repository("project-control", { throwAfterPut: true, failRemove: true }),
      reportAssetCleanupDebt: debt,
    });

    await expect(value.ports.importAsset({ path: "D:\\media\\hero.png" }, context())).resolves.toMatchObject({
      ok: false,
      error: { code: "internal" },
    });
    expect(debt).toHaveBeenCalledWith("project-control", expect.any(String), true);
    expect(value.projectStore.getSnapshot().project.assets).toEqual({});
  });

  it("queues brokered video work and exposes the same job to list and cancel", async () => {
    const video = new Blob([new Uint8Array([0, 0, 0, 1])], { type: "video/mp4" });
    const hostFiles = {
      read: vi.fn(async () => ({ blob: video, name: "walk.mp4", byteSize: video.size })),
    } as HostFileServiceClient;
    const videoAdapter: VideoImportAdapter = {
      preflight: () => new Promise(() => undefined),
      extractFrames: () => new Promise(() => undefined),
    };
    const value = runtime({ hostFiles, videoAdapter, withRepository: true });

    const queued = await value.ports.importVideo({
      path: "D:\\media\\walk.mp4",
      startUs: 0,
      endUs: 1_000_000,
      sampling: { mode: "fps", fps: 12 },
    }, context());

    expect(queued).toMatchObject({ ok: true, result: { jobId: expect.any(String) } });
    const jobId = queued.ok ? (queued.result as { jobId: string }).jobId : "";
    expect(await value.ports.listJobs(context())).toMatchObject({
      ok: true,
      result: { order: [jobId], jobs: { [jobId]: { kind: "video.import" } } },
    });
    expect(await value.ports.cancelJob({ jobId }, context())).toMatchObject({ ok: true });
    expect(hostFiles.read).toHaveBeenCalledWith("D:\\media\\walk.mp4", "video", expect.any(AbortSignal));
  });

  it("reports video cleanup debt through the canonical project callback", async () => {
    const video = new Blob([new Uint8Array([0, 0, 0, 1])], { type: "video/mp4" });
    const hostFiles = {
      read: vi.fn(async () => ({ blob: video, name: "walk.mp4", byteSize: video.size })),
    } as HostFileServiceClient;
    const videoAdapter: VideoImportAdapter = {
      preflight: async () => ({
        byteSize: video.size,
        mimeType: "video/mp4",
        durationUs: 1_000_000,
        timelineOffsetUs: 0,
        trackCount: 1,
        track: {
          index: 0,
          codec: "avc1",
          codedWidth: 16,
          codedHeight: 16,
          displayWidth: 16,
          displayHeight: 16,
          rotationDegrees: 0,
          frameRate: 1,
          sampleCount: 1,
        },
        decodable: true,
        variableFrameRate: false,
        sampleTimestampsUs: [0],
      }),
      extractFrames: async () => [{
        blob: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }),
        mimeType: "image/png",
        timestampUs: 0,
        durationUs: 1_000_000,
        width: 16,
        height: 16,
      }],
    };
    const debt = vi.fn();
    const value = runtime({
      hostFiles,
      videoAdapter,
      assetRepository: repository("project-control", { throwAfterPut: true, failRemove: true }),
      reportAssetCleanupDebt: debt,
    });

    const queued = await value.ports.importVideo({
      path: "D:\\media\\walk.mp4",
      startUs: 0,
      endUs: 1_000_000,
      sampling: { mode: "all" },
    }, context());
    const jobId = queued.ok ? (queued.result as { jobId: string }).jobId : "";

    await vi.waitFor(() => {
      expect(value.jobStore.getSnapshot().jobs[jobId]?.status).toBe("failed");
      expect(debt).toHaveBeenCalledWith("project-control", expect.any(String), true);
    });
    expect(value.projectStore.getSnapshot().project.assets).toEqual({});
  });

  it("cancels video transfer when the control operation is aborted", async () => {
    const readStarted = deferred<AbortSignal>();
    const hostFiles = {
      read: vi.fn((_path: string, _kind: string, signal?: AbortSignal) => new Promise((_, reject) => {
        if (!signal) return;
        readStarted.resolve(signal);
        signal.addEventListener("abort", () => reject(
          new HostFileServiceError("cancelled", "Host file read was cancelled."),
        ), { once: true });
      })),
    } as unknown as HostFileServiceClient;
    const controller = new AbortController();
    const value = runtime({ hostFiles, withRepository: true });

    const queued = await value.ports.importVideo({
      path: "D:\\media\\walk.mp4",
      startUs: 0,
      endUs: 1_000_000,
      sampling: { mode: "all" },
    }, context(controller.signal));
    const jobId = queued.ok ? (queued.result as { jobId: string }).jobId : "";
    const taskSignal = await readStarted.promise;
    controller.abort();

    await vi.waitFor(() => {
      expect(taskSignal.aborted).toBe(true);
      expect(value.jobStore.getSnapshot().jobs[jobId]?.status).toBe("cancelled");
    });
    expect(value.projectStore.getSnapshot().project.assets).toEqual({});
  });

  it("fails the queued video job when the project changes during transfer", async () => {
    const video = new Blob([
      new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
    ], { type: "video/mp4" });
    const pending = deferred<{ blob: Blob; name: string; byteSize: number }>();
    const hostFiles = { read: vi.fn(() => pending.promise) } as unknown as HostFileServiceClient;
    const value = runtime({ hostFiles, withRepository: true });

    const queued = await value.ports.importVideo({
      path: "D:\\media\\walk.mp4",
      startUs: 0,
      endUs: 1_000_000,
      sampling: { mode: "all" },
    }, context());
    const jobId = queued.ok ? (queued.result as { jobId: string }).jobId : "";
    value.navigate("compose");
    pending.resolve({ blob: video, name: "walk.mp4", byteSize: video.size });

    await vi.waitFor(() => {
      expect(value.jobStore.getSnapshot().jobs[jobId]?.status).toBe("failed");
    });
    expect(value.projectStore.getSnapshot().project.assets).toEqual({});
  });

  it("declares only ports backed by real browser services", () => {
    const disconnected = runtime();
    const connected = runtime({
      hostFiles: { read: vi.fn() } as unknown as HostFileServiceClient,
      models: {} as LocalModelServiceClient,
      withRepository: true,
    });
    expect(getBrowserStudioControlSupportedCommands(disconnected.portDependencies)).toEqual([
      "capabilities.get",
      "project.get",
      "selection.get",
      "workspace.navigate",
      "jobs.list",
      "jobs.cancel",
    ]);
    expect(getBrowserStudioControlSupportedCommands(connected.portDependencies)).toEqual([
      "capabilities.get",
      "project.get",
      "selection.get",
      "workspace.navigate",
      "asset.import",
      "video.import",
      "model.status",
      "model.setup",
      "jobs.list",
      "jobs.cancel",
    ]);
    expect(getBrowserStudioControlSupportedCommands(connected.portDependencies)).not.toContain("export.run");
  });

  it("starts model setup and federates model jobs with browser jobs", async () => {
    const modelJob = createQueuedJob({
      id: "model-job-1",
      requestId: "model-request-1",
      kind: "model.setup",
      label: "Prepare BiRefNet",
      createdAt: NOW,
      timeoutMs: 60_000,
    });
    const models = {
      setup: vi.fn(async () => ({
        version: 1 as const,
        modelId: "birefnet-lite-512" as const,
        outcome: "started" as const,
        job: modelJob,
      })),
      listJobs: vi.fn(async () => ({
        jobs: { [modelJob.id]: modelJob },
        order: [modelJob.id],
        retiredRequestIds: [],
        retiredJobIds: [],
        consumedRetrySourceIds: [],
      })),
    } as unknown as LocalModelServiceClient;
    const value = runtime({ models });

    await expect(value.ports.setupModel(
      { modelId: "birefnet-lite-512", acceptLicense: false },
      context(),
    )).resolves.toMatchObject({
      ok: true,
      result: { outcome: "started", job: { id: "model-job-1" } },
    });
    await expect(value.ports.listJobs(context())).resolves.toMatchObject({
      ok: true,
      result: {
        order: ["model-job-1"],
        jobs: { "model-job-1": { kind: "model.setup" } },
      },
    });
  });

  it("routes model job cancellation after the browser runner declines it", async () => {
    const models = {
      cancelJob: vi.fn(async () => ({ id: "model-job-1", status: "cancelled" })),
    } as unknown as LocalModelServiceClient;
    const value = runtime({ models });

    await expect(value.ports.cancelJob({ jobId: "model-job-1" }, context())).resolves.toMatchObject({
      ok: true,
      result: { jobId: "model-job-1" },
    });
    expect(models.cancelJob).toHaveBeenCalledWith("model-job-1", expect.any(AbortSignal));
  });
});
