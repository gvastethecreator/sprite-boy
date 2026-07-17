import { describe, expect, it, vi } from "vitest";

import { AssetRepositoryError, type AssetMetadata, type AssetRepository } from "../../core/assets";
import { createEmptyStudioProject, type AssetRecord } from "../../core/project";
import { createProjectStoreWithHistory, type ProjectStore, type ProjectStoreDispatchResult } from "../../core/stores";
import {
  importSliceSource,
  restoreCanonicalSliceSource,
  SliceSourceImportError,
} from "../../features/slice/source/importSliceSource";

const NOW = "2026-07-16T12:00:00.000Z";

function repository(projectId: string, options: { readonly rejectAfterPut?: boolean } = {}) {
  const records = new Map<string, AssetRecord>();
  const blobs = new Map<string, Blob>();
  const put = vi.fn(async (blob: Blob, metadata: AssetMetadata): Promise<AssetRecord> => {
    const hash = "d".repeat(64);
    const record: AssetRecord = {
      id: metadata.id,
      name: metadata.name,
      blobKey: `sha256:${hash}`,
      contentHash: hash,
      mimeType: blob.type || metadata.declaredMimeType || "image/png",
      width: metadata.width,
      height: metadata.height,
      byteSize: blob.size,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      provenance: metadata.provenance,
    };
    records.set(record.id, record);
    blobs.set(record.id, blob);
    if (options.rejectAfterPut) throw new Error("late source storage failure");
    return record;
  });
  const getMetadata = vi.fn(async (assetId: string): Promise<AssetRecord> => {
    const record = records.get(assetId);
    if (!record) throw new AssetRepositoryError("ASSET_NOT_FOUND", "missing", { operation: "get-metadata", assetId });
    return record;
  });
  const remove = vi.fn(async (assetId: string): Promise<void> => {
    records.delete(assetId);
    blobs.delete(assetId);
  });
  const getBlob = vi.fn(async (assetId: string): Promise<Blob> => {
    const blob = blobs.get(assetId);
    if (!blob) throw new AssetRepositoryError("ASSET_NOT_FOUND", "missing", { operation: "get-blob", assetId });
    return blob;
  });
  const value = {
    projectId,
    put,
    getMetadata,
    remove,
    getBlob,
    list: vi.fn(async () => [...records.values()]),
    verify: vi.fn(),
    scanIntegrity: vi.fn(),
    exportMany: vi.fn(),
    createRuntimeUrl: vi.fn(),
    releaseRuntimeUrl: vi.fn(),
    releaseOwner: vi.fn(),
    dispose: vi.fn(),
  } as unknown as AssetRepository;
  return { value, put, getMetadata, remove, records };
}

function runtime() {
  return createProjectStoreWithHistory(createEmptyStudioProject({ id: "project-slice-source", now: NOW }), {
    context: { nextId: () => "unused-context-id", now: () => NOW },
  });
}

function options(store: ProjectStore, repositoryValue: AssetRepository) {
  return {
    store,
    repository: repositoryValue,
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    name: "hero/source.png",
    mimeType: "image/png",
    width: 96,
    height: 48,
    nextId: () => "asset-slice-source",
    now: () => NOW,
  };
}

describe("importSliceSource (G6-04 source binding)", () => {
  it("puts one canonical Asset, selects it in workspace and undoes as one history entry", async () => {
    const { store, history } = runtime();
    const repo = repository(store.getSnapshot().project.id);
    const result = await importSliceSource(options(store, repo.value));

    expect(result.asset.id).toBe("asset-slice-source");
    expect(repo.put).toHaveBeenCalledOnce();
    expect(store.getSnapshot().project.rootOrder.assetIds).toEqual(["asset-slice-source"]);
    expect(store.getSnapshot().project.workspace).toMatchObject({
      activeWorkspace: "slice",
      selectedAssetId: "asset-slice-source",
    });
    expect(history.getSnapshot().undoEntries).toHaveLength(1);

    const restored = await restoreCanonicalSliceSource({
      store,
      repository: repo.value,
      assetId: result.asset.id,
    });
    expect(restored.asset.id).toBe(result.asset.id);
    expect(restored.blob.size).toBe(3);

    expect(history.undo()).toMatchObject({ ok: true });
    expect(store.getSnapshot().project.assets).toEqual({});
    expect(store.getSnapshot().project.workspace).toEqual({});
    // ProjectStore undo removes canonical graph state; repository reconciliation
    // owns binary garbage collection on the next durable checkpoint.
    expect(repo.records.size).toBe(1);
  });

  it("rejects foreign repositories and canonical ID collisions before persistence", async () => {
    const foreignRuntime = runtime();
    const foreign = repository("project-other");
    await expect(importSliceSource(options(foreignRuntime.store, foreign.value))).rejects.toMatchObject({ code: "repository-mismatch" });
    expect(foreign.put).not.toHaveBeenCalled();

    const collisionRuntime = runtime();
    const collisionRepo = repository(collisionRuntime.store.getSnapshot().project.id);
    const collisionDispatch = collisionRuntime.store.dispatch({
      command: {
        type: "asset.import",
        asset: {
          id: "asset-slice-source",
          name: "existing.png",
          blobKey: `sha256:${"e".repeat(64)}`,
          contentHash: "e".repeat(64),
          mimeType: "image/png",
          width: 1,
          height: 1,
          byteSize: 1,
          createdAt: NOW,
          updatedAt: NOW,
          provenance: { source: "fixture" },
        },
      },
      metadata: { commandId: "existing-asset", origin: "user", history: "record", issuedAt: NOW },
    });
    expect(collisionDispatch.result.ok, JSON.stringify(collisionDispatch.result)).toBe(true);
    expect(collisionRuntime.store.getSnapshot().project.assets["asset-slice-source"]).toBeDefined();
    await expect(importSliceSource(options(collisionRuntime.store, collisionRepo.value))).rejects.toMatchObject({ code: "id-conflict" });
    expect(collisionRepo.put).not.toHaveBeenCalled();
  });

  it("cleans a late-written repository record when canonical dispatch fails", async () => {
    const baseStore = runtime().store;
    const store = {
      ...baseStore,
      dispatch: vi.fn(() => ({
        revision: baseStore.getSnapshot().revision,
        result: { ok: false, diagnostics: [{ code: "INVALID_PATCH", message: "forced rejection", path: "$" }] },
      } as unknown as ProjectStoreDispatchResult)),
    } as unknown as ProjectStore;
    const repo = repository(store.getSnapshot().project.id, { rejectAfterPut: true });

    await expect(importSliceSource(options(store, repo.value))).rejects.toMatchObject({ code: "repository-failed" } satisfies Partial<SliceSourceImportError>);
    expect(repo.put).toHaveBeenCalledOnce();
    expect(repo.remove).toHaveBeenCalledOnce();
    expect(repo.records.size).toBe(0);
  });
});
