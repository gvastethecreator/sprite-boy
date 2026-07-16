import { describe, expect, it, vi } from "vitest";
import {
  AssetRepositoryError,
  reconcileProjectAssetRepository,
  type AssetMetadata,
  type AssetRepository,
} from "../../core/assets";
import {
  createEmptyStudioProject,
  type AssetRecord,
  type StudioProjectV1,
} from "../../core/project";
import { createProjectStoreWithHistory } from "../../core/stores";
import {
  deriveCompositionEntryIdentity,
  importComposeAsset,
  retryComposeAssetCleanup,
} from "../../features/compose/project";

const NOW = "2026-07-16T12:00:00.000Z";
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function imageFile(type = "image/png") {
  return new File([PNG_BYTES], "hero.png", { type, lastModified: 1 });
}

function runtime(project = createEmptyStudioProject({ id: "project-compose-import", now: NOW })) {
  return createProjectStoreWithHistory(project, {
    context: {
      nextId: () => "unused-context-id",
      now: () => NOW,
    },
  });
}

function fakeRepository(
  projectId: string,
  options: {
    readonly putFails?: boolean;
    readonly removeFailures?: number;
    readonly onPut?: () => void;
  } = {},
) {
  const records = new Map<string, AssetRecord>();
  let removeFailures = options.removeFailures ?? 0;
  const put = vi.fn(async (blob: Blob, metadata: AssetMetadata): Promise<AssetRecord> => {
    if (options.putFails) throw new Error("redacted storage failure");
    const hash = "a".repeat(64);
    const record: AssetRecord = {
      id: metadata.id,
      name: metadata.name,
      blobKey: `sha256:${hash}`,
      contentHash: hash,
      mimeType: blob.type,
      width: metadata.width,
      height: metadata.height,
      byteSize: blob.size,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      provenance: metadata.provenance,
    };
    records.set(record.id, record);
    options.onPut?.();
    return record;
  });
  const remove = vi.fn(async (assetId: string): Promise<void> => {
    if (removeFailures > 0) {
      removeFailures -= 1;
      throw new Error("redacted cleanup failure");
    }
    records.delete(assetId);
  });
  const repository = {
    projectId,
    put,
    remove,
    getMetadata: vi.fn(),
    getBlob: vi.fn(),
    list: vi.fn(async () => [...records.values()]),
    verify: vi.fn(),
    scanIntegrity: vi.fn(),
    exportMany: vi.fn(),
    createRuntimeUrl: vi.fn(),
    releaseRuntimeUrl: vi.fn(),
    releaseOwner: vi.fn(),
    dispose: vi.fn(),
  } as unknown as AssetRepository;
  return { repository, records, put, remove };
}

function ports(
  store: ReturnType<typeof runtime>["store"],
  assets: AssetRepository,
) {
  let command = 0;
  return {
    store,
    assets,
    nextId: (kind: "asset" | "command") => kind === "asset"
      ? "asset-imported"
      : `command-import-${++command}`,
    now: () => NOW,
    decoder: {
      decode: vi.fn(async () => ({
        image: {},
        width: 96,
        height: 48,
        close: vi.fn(),
      })),
    },
  };
}

describe("canonical Compose asset import", () => {
  it("treats an already-removed cleanup record as resolved", async () => {
    const repo = fakeRepository("project-idempotent-cleanup");
    repo.remove.mockRejectedValueOnce(new AssetRepositoryError(
      "ASSET_NOT_FOUND",
      "Already removed.",
      { operation: "remove", assetId: "asset-removed" },
    ));

    await expect(retryComposeAssetCleanup(repo.repository, "asset-removed"))
      .resolves.toEqual({ ok: true });
  });

  it("stores one Asset and opens its first Composition and Layer on the same ProjectStore", async () => {
    const { store, history } = runtime();
    const repo = fakeRepository(store.getSnapshot().project.id);

    const result = await importComposeAsset(imageFile(), ports(store, repo.repository));

    expect(result).toMatchObject({
      ok: true,
      outcome: "created",
      assetId: "asset-imported",
      dimensions: { width: 96, height: 48 },
    });
    const project = store.getSnapshot().project;
    const identity = deriveCompositionEntryIdentity({ type: "asset", id: "asset-imported" });
    expect(project.rootOrder.assetIds).toEqual(["asset-imported"]);
    expect(project.rootOrder.compositionIds).toEqual([identity.compositionId]);
    expect(project.compositions[identity.compositionId]?.layerIds).toEqual([identity.layerId]);
    expect(project.layers[identity.layerId]?.source).toEqual({ type: "asset", id: "asset-imported" });
    expect(project.workspace).toMatchObject({
      activeWorkspace: "compose",
      selectedAssetId: "asset-imported",
      selectedCompositionId: identity.compositionId,
      selectedLayerId: identity.layerId,
    });
    expect(repo.records.has("asset-imported")).toBe(true);

    expect(history.undo().ok).toBe(true);
    expect(store.getSnapshot().project.assets["asset-imported"]).toBeDefined();
    expect(store.getSnapshot().project.compositions[identity.compositionId]).toBeUndefined();
  });

  it("rejects spoofed MIME before decode or repository mutation", async () => {
    const { store } = runtime();
    const repo = fakeRepository(store.getSnapshot().project.id);
    const adapter = ports(store, repo.repository);

    const result = await importComposeAsset(imageFile("image/jpeg"), adapter);

    expect(result).toMatchObject({ ok: false, code: "INVALID_FILE" });
    expect(adapter.decoder.decode).not.toHaveBeenCalled();
    expect(repo.put).not.toHaveBeenCalled();
    expect(store.getSnapshot().revision).toBe(0);
  });

  it("redacts repository failure and leaves the graph empty", async () => {
    const { store } = runtime();
    const repo = fakeRepository(store.getSnapshot().project.id, { putFails: true });

    const result = await importComposeAsset(imageFile(), ports(store, repo.repository));

    expect(result).toEqual({
      ok: false,
      code: "STORAGE_FAILED",
      message: "Image bytes could not be stored in the active project.",
    });
    expect(store.getSnapshot().revision).toBe(0);
    expect(store.getSnapshot().project.rootOrder.assetIds).toEqual([]);
  });

  it("compensates repository and graph state when a reserved Composition identity conflicts", async () => {
    const identity = deriveCompositionEntryIdentity({ type: "asset", id: "asset-imported" });
    const project = createEmptyStudioProject({ id: "project-compose-conflict", now: NOW });
    const conflicted: StudioProjectV1 = {
      ...project,
      rootOrder: { ...project.rootOrder, compositionIds: [identity.compositionId] },
      compositions: {
        [identity.compositionId]: {
          id: identity.compositionId,
          name: "Reserved conflict",
          owner: { type: "project" },
          layerIds: [],
          width: 1,
          height: 1,
          background: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
    };
    const { store, history } = runtime(conflicted);
    const repo = fakeRepository(conflicted.id);
    store.dispatch({
      command: { type: "project.rename", name: "Edited before import", updatedAt: NOW },
      metadata: {
        commandId: "prior-edit",
        origin: "user",
        history: "record",
        issuedAt: NOW,
      },
    });
    const historyBefore = history.getSnapshot();

    const result = await importComposeAsset(imageFile(), ports(store, repo.repository));

    expect(result).toMatchObject({ ok: false, code: "COMPOSITION_REJECTED" });
    expect(store.getSnapshot().project.assets["asset-imported"]).toBeUndefined();
    expect(repo.records.has("asset-imported")).toBe(false);
    expect(repo.remove).toHaveBeenCalledWith("asset-imported", "release-and-remove");
    expect(store.getSnapshot().project.compositions[identity.compositionId]?.name)
      .toBe("Reserved conflict");
    expect(history.getSnapshot()).toEqual(historyBefore);
    expect(history.undo().ok).toBe(true);
    expect(store.getSnapshot().project.name).toBe(conflicted.name);
  });

  it("reports durable cleanup debt and exposes an exact retry path", async () => {
    const identity = deriveCompositionEntryIdentity({ type: "asset", id: "asset-imported" });
    const project = createEmptyStudioProject({ id: "project-cleanup-debt", now: NOW });
    const conflicted: StudioProjectV1 = {
      ...project,
      rootOrder: { ...project.rootOrder, compositionIds: [identity.compositionId] },
      compositions: {
        [identity.compositionId]: {
          id: identity.compositionId,
          name: "Reserved conflict",
          owner: { type: "project" },
          layerIds: [],
          width: 1,
          height: 1,
          background: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
    };
    const { store } = runtime(conflicted);
    const repo = fakeRepository(conflicted.id, { removeFailures: 2 });

    const result = await importComposeAsset(imageFile(), ports(store, repo.repository));

    expect(result).toEqual({
      ok: false,
      code: "CLEANUP_FAILED",
      message: "Temporary image data could not be removed. Retry cleanup after storage access recovers.",
      cleanup: { assetId: "asset-imported" },
    });
    expect(repo.records.has("asset-imported")).toBe(true);
    await expect(retryComposeAssetCleanup(repo.repository, "asset-imported"))
      .resolves.toMatchObject({ ok: false, code: "CLEANUP_FAILED" });
    expect(repo.records.has("asset-imported")).toBe(true);

    await expect(reconcileProjectAssetRepository(
      repo.repository,
      store.getSnapshot().project as StudioProjectV1,
    )).resolves.toEqual({
      complete: true,
      removedAssetIds: ["asset-imported"],
      pendingAssetIds: [],
      listFailed: false,
    });
    expect(repo.records.has("asset-imported")).toBe(false);
  });

  it("does not start work for an already-aborted import", async () => {
    const { store } = runtime();
    const repo = fakeRepository(store.getSnapshot().project.id);
    const controller = new AbortController();
    controller.abort();

    const result = await importComposeAsset(
      imageFile(),
      ports(store, repo.repository),
      { signal: controller.signal },
    );

    expect(result).toEqual({ ok: false, code: "CANCELLED", message: "Image import was cancelled." });
    expect(repo.put).not.toHaveBeenCalled();
  });

  it("returns identified cleanup debt when cancellation wins after repository commit", async () => {
    const { store } = runtime();
    const controller = new AbortController();
    const repo = fakeRepository(store.getSnapshot().project.id, {
      removeFailures: 1,
      onPut: () => controller.abort(),
    });

    const result = await importComposeAsset(
      imageFile(),
      ports(store, repo.repository),
      { signal: controller.signal },
    );

    expect(result).toMatchObject({
      ok: false,
      code: "CLEANUP_FAILED",
      cleanup: { assetId: "asset-imported" },
    });
    expect(store.getSnapshot().revision).toBe(0);
    expect(repo.records.has("asset-imported")).toBe(true);
  });
});
