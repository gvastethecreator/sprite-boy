import { describe, expect, it, vi } from "vitest";
import {
  AssetRepositoryError,
  type AssetMetadata,
  type AssetPayload,
  type AssetRepository,
} from "../../core/assets";
import { VideoMediaError, type VideoExtractedFrame, type VideoPreflight } from "../../core/media";
import { createEmptyStudioProject } from "../../core/project";
import {
  createJobRunner,
  createQueuedJob,
  JobTaskError,
  type JobTaskContext,
} from "../../core/processing";
import { createJobStore, createProjectStoreWithHistory } from "../../core/stores";
import {
  createVideoImportJobTask,
  type CreateVideoImportJobTaskOptions,
  type VideoImportAdapter,
} from "../../features/slice/video";

const NOW = "2026-07-25T18:00:00.000Z";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createRuntime(projectId = "project-video") {
  let contextId = 0;
  return createProjectStoreWithHistory(createEmptyStudioProject({
    id: projectId,
    name: "Video test",
    createdAt: NOW,
    updatedAt: NOW,
  }), {
    context: {
      nextId: () => `context-${++contextId}`,
      now: () => NOW,
    },
  });
}

function createIdFactory(prefix = "video") {
  let sequence = 0;
  return () => `${prefix}-${++sequence}`;
}

const PREFLIGHT: VideoPreflight = {
  byteSize: 4,
  mimeType: "video/mp4",
  durationUs: 1_000_000,
  timelineOffsetUs: 0,
  trackCount: 1,
  track: {
    index: 0,
    codec: "avc1.42001e",
    codedWidth: 16,
    codedHeight: 16,
    displayWidth: 16,
    displayHeight: 16,
    rotationDegrees: 0,
    frameRate: 2,
    sampleCount: 2,
  },
  decodable: true,
  variableFrameRate: false,
  sampleTimestampsUs: [0, 500_000],
};

function extractedFrames(): readonly VideoExtractedFrame[] {
  return [0, 500_000].map((timestampUs) => ({
    blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
    mimeType: "image/png" as const,
    timestampUs,
    durationUs: 500_000,
    width: 16,
    height: 16,
  }));
}

function createAdapter(overrides: Partial<VideoImportAdapter> = {}): VideoImportAdapter {
  return {
    preflight: async () => PREFLIGHT,
    extractFrames: async (_blob, options) => {
      options.onProgress?.({ completed: 1, total: 2, ratio: 0.5 });
      options.onProgress?.({ completed: 2, total: 2, ratio: 1 });
      return extractedFrames();
    },
    ...overrides,
  };
}

interface RepositoryControl {
  readonly records: Map<string, AssetPayload>;
  readonly requestedIds: string[];
  putCount: number;
  failAt: number | null;
  failCode: "ASSET_STORAGE_UNAVAILABLE" | "ASSET_QUOTA_EXCEEDED";
  throwAfterWriteAt: number | null;
  delayAt: number | null;
  failRemove: boolean;
  readonly removedIds: string[];
  readonly putStarted: ReturnType<typeof deferred<void>>;
  readonly releasePut: ReturnType<typeof deferred<void>>;
}

function createRepository(projectId: string): {
  readonly repository: AssetRepository;
  readonly control: RepositoryControl;
} {
  const control: RepositoryControl = {
    records: new Map(),
    requestedIds: [],
    putCount: 0,
    failAt: null,
    failCode: "ASSET_STORAGE_UNAVAILABLE",
    throwAfterWriteAt: null,
    delayAt: null,
    failRemove: false,
    removedIds: [],
    putStarted: deferred<void>(),
    releasePut: deferred<void>(),
  };

  const missing = (operation: "get-metadata" | "get-blob" | "remove", assetId: string) =>
    new AssetRepositoryError("ASSET_NOT_FOUND", `Missing ${assetId}.`, { operation, assetId });

  const repository: AssetRepository = {
    projectId,
    async put(blob: Blob, metadata: AssetMetadata) {
      control.putCount += 1;
      control.requestedIds.push(metadata.id);
      if (control.delayAt === control.putCount) {
        control.putStarted.resolve();
        await control.releasePut.promise;
      }
      if (control.failAt === control.putCount) {
        throw new AssetRepositoryError(control.failCode, "Injected put failure.", {
          operation: "put",
          assetId: metadata.id,
        });
      }
      const media = metadata.media ?? { type: blob.type.startsWith("image/") ? "image" as const : "binary" as const };
      const record = {
        id: metadata.id,
        name: metadata.name,
        blobKey: `blob/${metadata.id}`,
        contentHash: `sha256:${metadata.id}`,
        mimeType: metadata.declaredMimeType ?? blob.type,
        width: metadata.width,
        height: metadata.height,
        byteSize: blob.size,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        provenance: { ...metadata.provenance },
        media,
      };
      control.records.set(record.id, { record, blob });
      if (control.throwAfterWriteAt === control.putCount) {
        throw new AssetRepositoryError("ASSET_STORAGE_UNAVAILABLE", "Injected late put failure.", {
          operation: "put",
          assetId: metadata.id,
        });
      }
      return record;
    },
    async getMetadata(assetId) {
      const payload = control.records.get(assetId);
      if (!payload) throw missing("get-metadata", assetId);
      return payload.record;
    },
    async getBlob(assetId) {
      const payload = control.records.get(assetId);
      if (!payload) throw missing("get-blob", assetId);
      return payload.blob;
    },
    async list() {
      return [...control.records.values()].map(({ record }) => record);
    },
    async verify() {
      throw new Error("Not used by video import tests.");
    },
    async scanIntegrity() {
      throw new Error("Not used by video import tests.");
    },
    async remove(assetId) {
      control.removedIds.push(assetId);
      if (control.failRemove) {
        throw new AssetRepositoryError("ASSET_STORAGE_UNAVAILABLE", "Injected remove failure.", {
          operation: "remove",
          assetId,
        });
      }
      if (!control.records.delete(assetId)) throw missing("remove", assetId);
    },
    async *exportMany(assetIds): AsyncIterable<AssetPayload> {
      for (const assetId of assetIds) {
        const payload = control.records.get(assetId);
        if (payload) yield payload;
      }
    },
    async createRuntimeUrl(assetId) {
      if (!control.records.has(assetId)) throw missing("get-blob", assetId);
      return `blob:${assetId}`;
    },
    releaseRuntimeUrl() {},
    releaseOwner() {},
    dispose() {},
  };
  return { repository, control };
}

function createOptions(
  adapter: VideoImportAdapter,
  store: ReturnType<typeof createRuntime>["store"],
  repository: AssetRepository,
  nextId = createIdFactory(),
): CreateVideoImportJobTaskOptions {
  return {
    adapter,
    store,
    repository,
    file: new Blob([new Uint8Array([0, 0, 0, 1])], { type: "video/mp4" }),
    fileName: "walk.mp4",
    selection: {
      trackIndex: 0,
      range: { startUs: 0, endUs: 1_000_000 },
      sampling: { mode: "all" },
    },
    nextId,
    now: () => NOW,
  };
}

function taskContext(signal = new AbortController().signal, ratios: number[] = []): JobTaskContext {
  return {
    requestId: "video-request",
    signal,
    reportProgress: (progress) => {
      ratios.push(progress.ratio);
      return true;
    },
  };
}

function renameProject(store: ReturnType<typeof createRuntime>["store"], suffix: string): void {
  const result = store.dispatch({
    command: { type: "project.rename", name: `Changed ${suffix}`, updatedAt: NOW },
    metadata: { commandId: `external-${suffix}`, origin: "user", history: "record" },
  });
  expect(result.result.ok).toBe(true);
}

function switchWorkspace(store: ReturnType<typeof createRuntime>["store"]): void {
  const result = store.dispatch({
    command: { type: "workspace.update", patch: { activeWorkspace: "compose" } },
    metadata: { commandId: "external-workspace", origin: "user", history: "record" },
  });
  expect(result.result.ok).toBe(true);
}

describe("video import job task (V1-03)", () => {
  it("stores the video and frames, then commits the full graph in one history entry", async () => {
    const runtime = createRuntime();
    const { repository, control } = createRepository("project-video");
    const ratios: number[] = [];
    const task = createVideoImportJobTask(createOptions(
      createAdapter(),
      runtime.store,
      repository,
    ));

    const result = await task(taskContext(undefined, ratios));
    const snapshot = runtime.store.getSnapshot();

    expect(result.revision).toBe(1);
    expect(snapshot.revision).toBe(1);
    expect(control.records.size).toBe(3);
    expect(Object.keys(snapshot.project.assets)).toHaveLength(3);
    expect(Object.keys(snapshot.project.regions)).toHaveLength(2);
    expect(Object.keys(snapshot.project.processingRecipes)).toHaveLength(1);
    expect(Object.keys(snapshot.project.sequences)).toHaveLength(1);
    expect(Object.keys(snapshot.project.cels)).toHaveLength(2);
    expect(snapshot.project.assets[result.sourceAsset.id]?.media).toMatchObject({
      type: "video",
      durationUs: 1_000_000,
      track: { index: 0, displayWidth: 16, displayHeight: 16 },
    });
    expect(snapshot.project.sequences[result.sequence.id]?.celIds).toEqual(
      result.cels.map(({ id }) => id),
    );
    expect(snapshot.project.workspace).toEqual({
      activeWorkspace: "slice",
      selectedAssetId: result.frames[0]?.id,
      selectedRegionId: result.regions[0]?.id,
      selectedSequenceId: result.sequence.id,
      selectedCelIds: [result.cels[0]?.id],
    });
    expect(runtime.history.getSnapshot().undoEntries).toHaveLength(1);
    expect(ratios.every((ratio, index) => index === 0 || ratio >= ratios[index - 1]!)).toBe(true);
  });

  it("cleans a write that throws after storage and leaves the project unchanged", async () => {
    const runtime = createRuntime();
    const { repository, control } = createRepository("project-video");
    control.throwAfterWriteAt = 2;
    const task = createVideoImportJobTask(createOptions(createAdapter(), runtime.store, repository));

    await expect(task(taskContext())).rejects.toBeInstanceOf(JobTaskError);
    expect(runtime.store.getSnapshot().revision).toBe(0);
    expect(runtime.store.getSnapshot().project.assets).toEqual({});
    expect(control.records.size).toBe(0);
    expect(runtime.history.getSnapshot().undoEntries).toHaveLength(0);
  });

  it("preserves an existing destination when preflight finds an ID conflict", async () => {
    const runtime = createRuntime();
    const { repository, control } = createRepository("project-video");
    const foreignMetadata: AssetMetadata = {
      id: "conflict-1",
      name: "foreign.png",
      width: 1,
      height: 1,
      createdAt: NOW,
      updatedAt: NOW,
      provenance: { source: "import", importedAt: NOW },
      media: { type: "image" },
      declaredMimeType: "image/png",
    };
    const foreign = await repository.put(new Blob(["foreign"], { type: "image/png" }), foreignMetadata);
    control.putCount = 0;
    control.requestedIds.length = 0;
    const task = createVideoImportJobTask(createOptions(
      createAdapter(),
      runtime.store,
      repository,
      createIdFactory("conflict"),
    ));

    await expect(task(taskContext())).rejects.toMatchObject({ code: "runtime-failure" });
    await expect(repository.getMetadata(foreign.id)).resolves.toEqual(foreign);
    expect(control.removedIds).toEqual([]);
    expect(runtime.store.getSnapshot().revision).toBe(0);
  });

  it("never removes a foreign asset returned for an attempted write", async () => {
    const runtime = createRuntime();
    const { repository, control } = createRepository("project-video");
    const foreignMetadata: AssetMetadata = {
      id: "foreign-asset",
      name: "foreign.png",
      width: 1,
      height: 1,
      createdAt: NOW,
      updatedAt: NOW,
      provenance: { source: "import", importedAt: NOW },
      media: { type: "image" },
      declaredMimeType: "image/png",
    };
    const foreign = await repository.put(new Blob(["foreign"], { type: "image/png" }), foreignMetadata);
    control.putCount = 0;
    control.requestedIds.length = 0;
    const basePut = repository.put.bind(repository);
    repository.put = async (blob, metadata) => {
      await basePut(blob, metadata);
      return foreign;
    };
    const task = createVideoImportJobTask(createOptions(createAdapter(), runtime.store, repository));

    await expect(task(taskContext())).rejects.toMatchObject({ code: "runtime-failure" });
    await expect(repository.getMetadata(foreign.id)).resolves.toEqual(foreign);
    expect(control.removedIds).not.toContain(foreign.id);
    expect([...control.records.keys()]).toEqual([foreign.id]);
  });

  it("reports exact durable debt when an owned late write cannot be removed", async () => {
    const runtime = createRuntime();
    const { repository, control } = createRepository("project-video");
    const debt = vi.fn();
    control.throwAfterWriteAt = 1;
    control.failRemove = true;
    const task = createVideoImportJobTask({
      ...createOptions(createAdapter(), runtime.store, repository),
      reportAssetCleanupDebt: debt,
    });

    await expect(task(taskContext())).rejects.toMatchObject({
      code: "runtime-failure",
      retryable: true,
      message: "Video import cleanup failed for 1 asset.",
    });
    expect(debt).toHaveBeenCalledWith("project-video", "video-1", true);
    expect(control.records.has("video-1")).toBe(true);
  });

  it("maps storage quota exhaustion to a retryable clean failure", async () => {
    const runtime = createRuntime();
    const { repository, control } = createRepository("project-video");
    control.failAt = 1;
    control.failCode = "ASSET_QUOTA_EXCEEDED";
    const task = createVideoImportJobTask(createOptions(createAdapter(), runtime.store, repository));

    await expect(task(taskContext())).rejects.toMatchObject({
      code: "runtime-failure",
      retryable: true,
      message: "Storage quota was exceeded during video import.",
    });
    expect(control.records.size).toBe(0);
    expect(runtime.store.getSnapshot().revision).toBe(0);
    expect(runtime.history.getSnapshot().undoEntries).toHaveLength(0);
  });

  it("rejects a project revision change before dispatch and removes written assets", async () => {
    const runtime = createRuntime();
    const { repository, control } = createRepository("project-video");
    const basePut = repository.put.bind(repository);
    let changed = false;
    repository.put = async (...args) => {
      const record = await basePut(...args);
      if (!changed && control.putCount === 3) {
        changed = true;
        renameProject(runtime.store, "during-import");
      }
      return record;
    };
    const task = createVideoImportJobTask(createOptions(createAdapter(), runtime.store, repository));

    await expect(task(taskContext())).rejects.toMatchObject({
      code: "runtime-failure",
      retryable: true,
    });
    const snapshot = runtime.store.getSnapshot();
    expect(snapshot.revision).toBe(1);
    expect(snapshot.project.name).toBe("Changed during-import");
    expect(snapshot.project.assets).toEqual({});
    expect(control.records.size).toBe(0);
  });

  it("stops cleanly when the user changes workspace during decode", async () => {
    const runtime = createRuntime();
    const { repository, control } = createRepository("project-video");
    const extractionStarted = deferred<void>();
    const releaseExtraction = deferred<readonly VideoExtractedFrame[]>();
    const adapter = createAdapter({
      extractFrames: async () => {
        extractionStarted.resolve();
        return releaseExtraction.promise;
      },
    });
    const task = createVideoImportJobTask(createOptions(adapter, runtime.store, repository));
    const result = task(taskContext());
    await extractionStarted.promise;
    switchWorkspace(runtime.store);
    releaseExtraction.resolve(extractedFrames());

    await expect(result).rejects.toMatchObject({ code: "runtime-failure", retryable: true });
    expect(runtime.store.getSnapshot().project.workspace.activeWorkspace).toBe("compose");
    expect(control.records.size).toBe(0);
    expect(control.putCount).toBe(0);
  });

  it("writes nothing when extraction is cancelled", async () => {
    const runtime = createRuntime();
    const { repository, control } = createRepository("project-video");
    const extractionStarted = deferred<void>();
    const adapter = createAdapter({
      extractFrames: async (_blob, options) => {
        extractionStarted.resolve();
        return new Promise((_, reject) => {
          options.signal?.addEventListener("abort", () => reject(new VideoMediaError(
            "VIDEO_CANCELLED",
            "Cancelled.",
          )), { once: true });
        });
      },
    });
    const controller = new AbortController();
    const task = createVideoImportJobTask(createOptions(adapter, runtime.store, repository));
    const result = task(taskContext(controller.signal));
    await extractionStarted.promise;
    controller.abort("test cancel");

    await expect(result).rejects.toMatchObject({ code: "runtime-failure" });
    expect(control.putCount).toBe(0);
    expect(runtime.store.getSnapshot().revision).toBe(0);
  });

  it("waits for a delayed put, then cleans its late record after cancellation", async () => {
    const runtime = createRuntime();
    const { repository, control } = createRepository("project-video");
    control.delayAt = 1;
    const controller = new AbortController();
    const task = createVideoImportJobTask(createOptions(createAdapter(), runtime.store, repository));
    const result = task(taskContext(controller.signal));
    await control.putStarted.promise;
    controller.abort("cancel storage");
    control.releasePut.resolve();

    await expect(result).rejects.toMatchObject({ code: "runtime-failure" });
    expect(control.records.size).toBe(0);
    expect(runtime.store.getSnapshot().revision).toBe(0);
    expect(runtime.history.getSnapshot().undoEntries).toHaveLength(0);
  });

  it("uses fresh entity IDs when a caller creates a retry task", async () => {
    const runtime = createRuntime();
    const { repository } = createRepository("project-video");
    const nextId = createIdFactory("retry");
    const first = createVideoImportJobTask(createOptions(createAdapter(), runtime.store, repository, nextId));
    const firstResult = await first(taskContext());
    const second = createVideoImportJobTask(createOptions(createAdapter(), runtime.store, repository, nextId));
    const secondResult = await second(taskContext());

    expect(secondResult.sourceAsset.id).not.toBe(firstResult.sourceAsset.id);
    expect(new Set([
      firstResult.sourceAsset.id,
      ...firstResult.frames.map(({ id }) => id),
      secondResult.sourceAsset.id,
      ...secondResult.frames.map(({ id }) => id),
    ]).size).toBe(6);
    expect(runtime.store.getSnapshot().revision).toBe(2);
  });

  it("reports monotonic progress and lets JobRunner own the success terminal state", async () => {
    const runtime = createRuntime();
    const { repository } = createRepository("project-video");
    const adapter = createAdapter({
      extractFrames: async (_blob, options) => {
        options.onProgress?.({ completed: 1, total: 2, ratio: 0.8 });
        options.onProgress?.({ completed: 1, total: 2, ratio: 0.3 });
        options.onProgress?.({ completed: 2, total: 2, ratio: 1 });
        return extractedFrames();
      },
    });
    const jobStore = createJobStore();
    const runner = createJobRunner({ store: jobStore });
    const task = createVideoImportJobTask(createOptions(adapter, runtime.store, repository));
    const progress: number[] = [];
    const unsubscribe = jobStore.subscribe(() => {
      const ratio = jobStore.getSnapshot().jobs["video-job"]?.progress.ratio;
      if (ratio !== undefined) progress.push(ratio);
    });
    const handle = runner.run(createQueuedJob({
      id: "video-job",
      requestId: "video-job-request",
      kind: "video.import",
      label: "Import video",
      createdAt: NOW,
      timeoutMs: null,
    }), task);

    await expect(handle.result).resolves.toMatchObject({
      status: "succeeded",
      job: { progress: { ratio: 1, phase: "completed" } },
    });
    unsubscribe();
    expect(progress.every((ratio, index) => index === 0 || ratio >= progress[index - 1]!)).toBe(true);
    expect(progress.at(-1)).toBe(1);
  });
});
