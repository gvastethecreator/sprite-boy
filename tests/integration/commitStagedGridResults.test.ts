import { describe, expect, it, vi } from "vitest";

import { AssetRepositoryError, type AssetMetadata, type AssetRepository } from "../../core/assets";
import {
  createEmptyStudioProject,
  type AssetRecord,
  type GridSplitRecipeV1,
  type StudioProjectV1,
} from "../../core/project";
import { createProjectStoreWithHistory, type ProjectStore, type ProjectStoreDispatchResult } from "../../core/stores";
import {
  beginStagedGridProcessing,
  completeStagedGridProcessing,
  createIdleStagedGridResults,
  type StagedGridResultsSnapshot,
} from "../../features/slice/results/stagedGridResults";
import {
  commitStagedGridResults,
  StagedGridCommitError,
} from "../../features/slice/results/commitStagedGridResults";

const NOW = "2026-07-16T12:00:00.000Z";
const SOURCE_ID = "asset-source";
const HASH = "a".repeat(64);

function sourceAsset(): AssetRecord {
  return {
    id: SOURCE_ID,
    name: "sheet.png",
    blobKey: `sha256:${HASH}`,
    contentHash: HASH,
    mimeType: "image/png",
    width: 4,
    height: 2,
    byteSize: 32,
    createdAt: NOW,
    updatedAt: NOW,
    provenance: { source: "import" },
  };
}

function recipe(options: { readonly derived?: boolean } = {}): GridSplitRecipeV1 {
  return {
    kind: "grid-split",
    version: 1,
    sourceAssetId: SOURCE_ID,
    layout: { mode: "manual", rows: 1, cols: 2 },
    crop: { threshold: 0, padding: 0 },
    chroma: { enabled: false, color: "#00ff00", tolerance: 0, smoothness: 0, spill: 0 },
    pixel: {
      enabled: options.derived ?? false,
      size: 16,
      quantize: options.derived ?? false,
      colors: 16,
    },
  };
}

function staged(options: { readonly derived?: boolean } = {}): StagedGridResultsSnapshot {
  const draft = recipe(options);
  const processing = beginStagedGridProcessing(createIdleStagedGridResults(), {
    requestId: "request-commit",
    source: {
      width: 4,
      height: 2,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: new ArrayBuffer(32),
    },
    recipe: draft,
  });
  const outputs = [0, 1].map((index) => ({
    index,
    row: 0,
    column: index,
    cellBounds: { x: index * 2, y: 0, width: 2, height: 2 },
    contentBounds: { x: index * 2, y: 0, width: 2, height: 2 },
    surface: {
      width: 1,
      height: 1,
      format: "rgba8" as const,
      colorSpace: "srgb" as const,
      pixels: new Uint8Array([index + 1, 2, 3, 255]).buffer,
    },
    cropReductionRatio: 0,
    operations: options.derived ? ["resize" as const, "quantize" as const] : [],
    warnings: [],
  }));
  return completeStagedGridProcessing(processing, {
    source: { width: 4, height: 2 },
    layout: { origin: "manual", rows: 1, cols: 2 },
    outputs,
    summary: { outputCount: 2, outputPixelCount: 2, cropReductionRatio: 0, warnings: [] },
  });
}

function projectWithSource(extra: Partial<StudioProjectV1> = {}): StudioProjectV1 {
  const empty = createEmptyStudioProject({ id: "project-grid-commit", now: NOW });
  return {
    ...empty,
    ...extra,
    rootOrder: { ...empty.rootOrder, ...extra.rootOrder, assetIds: [SOURCE_ID, ...(extra.rootOrder?.assetIds ?? [])] },
    assets: { [SOURCE_ID]: sourceAsset(), ...extra.assets },
  };
}

function repository(projectId: string, options: { readonly rejectAfterPut?: boolean } = {}) {
  const records = new Map<string, AssetRecord>();
  const put = vi.fn(async (blob: Blob, metadata: AssetMetadata): Promise<AssetRecord> => {
    const contentHash = "b".repeat(64);
    const record: AssetRecord = {
      id: metadata.id,
      name: metadata.name,
      blobKey: `sha256:${contentHash}`,
      contentHash,
      mimeType: blob.type || "image/png",
      width: metadata.width,
      height: metadata.height,
      byteSize: blob.size,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      provenance: metadata.provenance,
    };
    records.set(record.id, record);
    if (options.rejectAfterPut) throw new Error("late storage acknowledgement failure");
    return record;
  });
  const remove = vi.fn(async (assetId: string): Promise<void> => {
    records.delete(assetId);
  });
  const getMetadata = vi.fn(async (assetId: string): Promise<AssetRecord> => {
    const record = records.get(assetId);
    if (!record) throw new AssetRepositoryError("ASSET_NOT_FOUND", "missing", { operation: "get-metadata", assetId });
    return record;
  });
  const value = {
    projectId,
    put,
    remove,
    getMetadata,
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
  return { value, put, remove, records };
}

function runtime(project = projectWithSource()) {
  return createProjectStoreWithHistory(project, {
    context: { nextId: () => "unused-context-id", now: () => NOW },
  });
}

describe("commitStagedGridResults (G6-03)", () => {
  it("commits source-backed regions atomically and undoes the durable command", async () => {
    const { store, history } = runtime();
    const repo = repository(store.getSnapshot().project.id);
    const result = await commitStagedGridResults({
      store,
      repository: repo.value,
      staged: staged(),
      sourceAssetId: SOURCE_ID,
      name: "Walk cycle",
      nextId: (() => {
        const ids = ["recipe-source", "region-source-1", "region-source-2"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
      now: () => NOW,
    });

    expect(result.usedDerivedAssets).toBe(false);
    expect(result.derivedAssets).toHaveLength(0);
    expect(repo.put).not.toHaveBeenCalled();
    expect(result.regions.map((region) => region.assetId)).toEqual([SOURCE_ID, SOURCE_ID]);
    expect(store.getSnapshot().project.processingRecipes["recipe-source"]).toBeDefined();
    expect(store.getSnapshot().project.rootOrder.regionIds).toEqual(["region-source-1", "region-source-2"]);
    expect(history.getSnapshot().undoEntries).toHaveLength(1);

    expect(history.undo()).toMatchObject({ ok: true });
    expect(store.getSnapshot().project.processingRecipes["recipe-source"]).toBeUndefined();
    expect(store.getSnapshot().project.regions).toEqual({});
    expect(store.getSnapshot().project.assets[SOURCE_ID]).toBeDefined();
  });

  it("stores transformed outputs as derived Assets and binds Regions to them", async () => {
    const { store } = runtime();
    const repo = repository(store.getSnapshot().project.id);
    const result = await commitStagedGridResults({
      store,
      repository: repo.value,
      staged: staged({ derived: true }),
      sourceAssetId: SOURCE_ID,
      name: "Pixel walk",
      nextId: (() => {
        const ids = ["recipe-derived", "asset-derived-1", "region-derived-1", "asset-derived-2", "region-derived-2"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
      now: () => NOW,
      encode: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })),
    });

    expect(result.usedDerivedAssets).toBe(true);
    expect(repo.put).toHaveBeenCalledTimes(2);
    expect(result.derivedAssets.map((asset) => asset.id)).toEqual(["asset-derived-1", "asset-derived-2"]);
    expect(result.regions.map((region) => region.assetId)).toEqual(["asset-derived-1", "asset-derived-2"]);
    expect(result.regions.every((region) => region.bounds.x === 0 && region.bounds.y === 0)).toBe(true);
    expect(store.getSnapshot().project.assets["asset-derived-1"]).toBeDefined();
    expect(store.getSnapshot().project.regions["region-derived-2"]).toBeDefined();
  });

  it("cleans derived repository entries when the canonical dispatch rejects", async () => {
    const baseStore = runtime().store;
    const store = {
      ...baseStore,
      dispatch: vi.fn(() => ({
        revision: baseStore.getSnapshot().revision,
        result: {
          ok: false,
          diagnostics: [{ code: "INVALID_PATCH", message: "forced rejection", path: "$" }],
        },
      } as unknown as ProjectStoreDispatchResult)),
    } as unknown as ProjectStore;
    const repo = repository(store.getSnapshot().project.id);

    await expect(commitStagedGridResults({
      store,
      repository: repo.value,
      staged: staged({ derived: true }),
      sourceAssetId: SOURCE_ID,
      nextId: (() => {
        const ids = ["recipe-rejected", "asset-orphan-1", "region-orphan-1", "asset-orphan-2", "region-orphan-2"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
      now: () => NOW,
      encode: async () => new Blob([new Uint8Array([1])], { type: "image/png" }),
    })).rejects.toMatchObject({ code: "project-dispatch-failed" } satisfies Partial<StagedGridCommitError>);

    expect(repo.put).toHaveBeenCalledTimes(2);
    expect(repo.remove).toHaveBeenCalledTimes(2);
    expect(repo.records.size).toBe(0);
    expect(store.getSnapshot().project.regions).toEqual({});
  });

  it("fails closed on cross-project repositories and generated ID collisions before any put", async () => {
    const crossProjectRuntime = runtime();
    const foreign = repository("project-foreign");
    await expect(commitStagedGridResults({
      store: crossProjectRuntime.store,
      repository: foreign.value,
      staged: staged({ derived: true }),
      sourceAssetId: SOURCE_ID,
      nextId: (() => {
        const ids = ["recipe-foreign", "asset-foreign-1", "region-foreign-1", "asset-foreign-2", "region-foreign-2"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
      now: () => NOW,
      encode: async () => new Blob([new Uint8Array([1])], { type: "image/png" }),
    })).rejects.toMatchObject({ code: "repository-mismatch" });
    expect(foreign.put).not.toHaveBeenCalled();

    const collisionRuntime = runtime();
    const collisionRepo = repository(collisionRuntime.store.getSnapshot().project.id);
    await expect(commitStagedGridResults({
      store: collisionRuntime.store,
      repository: collisionRepo.value,
      staged: staged({ derived: true }),
      sourceAssetId: SOURCE_ID,
      nextId: (() => {
        const ids = ["recipe-collision", SOURCE_ID, "region-collision-1", "asset-collision-2", "region-collision-2"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
      now: () => NOW,
      encode: async () => new Blob([new Uint8Array([1])], { type: "image/png" }),
    })).rejects.toMatchObject({ code: "id-conflict" });
    expect(collisionRepo.put).not.toHaveBeenCalled();
  });

  it("reconciles a late repository rejection and removes the attempt-owned record", async () => {
    const { store } = runtime();
    const repo = repository(store.getSnapshot().project.id, { rejectAfterPut: true });
    await expect(commitStagedGridResults({
      store,
      repository: repo.value,
      staged: staged({ derived: true }),
      sourceAssetId: SOURCE_ID,
      nextId: (() => {
        const ids = ["recipe-late", "asset-late-1", "region-late-1", "asset-late-2", "region-late-2"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
      now: () => NOW,
      encode: async () => new Blob([new Uint8Array([1])], { type: "image/png" }),
    })).rejects.toMatchObject({ code: "repository-failed" });
    expect(repo.put).toHaveBeenCalledOnce();
    expect(repo.remove).toHaveBeenCalledOnce();
    expect(repo.records.size).toBe(0);
  });

  it("rejects a source replacement that occurs during async encoding and still cleans attempt assets", async () => {
    const { store } = runtime();
    const repo = repository(store.getSnapshot().project.id);
    let replaced = false;
    const encode = vi.fn(async () => {
      if (!replaced) {
        replaced = true;
        const source = store.getSnapshot().project.assets[SOURCE_ID]!;
        store.dispatch({
          command: {
            type: "asset.replace",
            assetId: SOURCE_ID,
            replacement: {
              ...source,
              blobKey: `sha256:${"c".repeat(64)}`,
              contentHash: "c".repeat(64),
              updatedAt: "2026-07-16T12:00:01.000Z",
            },
          },
          metadata: {
            commandId: "source-replacement-during-grid",
            origin: "user",
            history: "record",
            issuedAt: "2026-07-16T12:00:01.000Z",
          },
        });
      }
      return new Blob([new Uint8Array([1])], { type: "image/png" });
    });

    await expect(commitStagedGridResults({
      store,
      repository: repo.value,
      staged: staged({ derived: true }),
      sourceAssetId: SOURCE_ID,
      nextId: (() => {
        const ids = ["recipe-concurrent", "asset-concurrent-1", "region-concurrent-1", "asset-concurrent-2", "region-concurrent-2"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
      now: () => NOW,
      encode,
    })).rejects.toMatchObject({ code: "project-changed" });
    expect(encode).toHaveBeenCalledTimes(2);
    expect(repo.remove).toHaveBeenCalledTimes(2);
    expect(repo.records.size).toBe(0);
  });

  it("rejects an unrelated project mutation because the prepared revision is stale", async () => {
    const { store } = runtime();
    const repo = repository(store.getSnapshot().project.id);
    let renamed = false;
    const encode = vi.fn(async () => {
      if (!renamed) {
        renamed = true;
        store.dispatch({
          command: { type: "project.rename", name: "Renamed while processing", updatedAt: "2026-07-16T12:00:01.000Z" },
          metadata: {
            commandId: "unrelated-project-mutation",
            origin: "user",
            history: "record",
            issuedAt: "2026-07-16T12:00:01.000Z",
          },
        });
      }
      return new Blob([new Uint8Array([1])], { type: "image/png" });
    });

    await expect(commitStagedGridResults({
      store,
      repository: repo.value,
      staged: staged({ derived: true }),
      sourceAssetId: SOURCE_ID,
      nextId: (() => {
        const ids = ["recipe-stale", "asset-stale-1", "region-stale-1", "asset-stale-2", "region-stale-2"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
      now: () => NOW,
      encode,
    })).rejects.toMatchObject({ code: "project-changed" });
    expect(repo.remove).toHaveBeenCalledTimes(2);
    expect(repo.records.size).toBe(0);
  });
});
