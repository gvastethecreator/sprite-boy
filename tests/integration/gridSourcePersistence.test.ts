import { describe, expect, it, vi } from "vitest";

import { AssetRepositoryError, reconcileProjectAssetRepository, type AssetMetadata, type AssetRepository } from "../../core/assets";
import { createEmptyStudioProject, type AssetRecord, type GridSplitRecipeV1, type StudioProjectV1 } from "../../core/project";
import { createProjectStoreWithHistory } from "../../core/stores";
import {
  AUTOSAVE_JOURNAL_FORMAT,
  AUTOSAVE_JOURNAL_VERSION,
  ProjectAutosaveJournal,
  projectCodec,
  type AutosaveJournalStorage,
  type AutosaveStorageSnapshot,
  type StoredAutosaveJournal,
  type StoredProjectCheckpoint,
} from "../../core/persistence";
import {
  beginStagedGridProcessing,
  completeStagedGridProcessing,
  createIdleStagedGridResults,
} from "../../features/slice/results/stagedGridResults";
import { commitStagedGridResults } from "../../features/slice/results/commitStagedGridResults";
import {
  importSliceSource,
  restoreCanonicalSliceSource,
} from "../../features/slice/source/importSliceSource";

const NOW = "2026-07-16T12:00:00.000Z";

class MemoryAutosaveStorage implements AutosaveJournalStorage {
  checkpoint?: StoredProjectCheckpoint;
  journal?: StoredAutosaveJournal;

  async readState(_projectId: string): Promise<AutosaveStorageSnapshot> {
    return {
      ...(this.checkpoint ? { checkpoint: this.checkpoint } : {}),
      ...(this.journal ? { journal: this.journal } : {}),
    };
  }

  async stageJournal(journal: StoredAutosaveJournal): Promise<void> {
    this.journal = journal;
  }

  async commitJournal(_projectId: string, journalId: string): Promise<StoredProjectCheckpoint> {
    if (!this.journal || this.journal.journalId !== journalId) throw new Error("missing journal");
    const checkpoint: StoredProjectCheckpoint = Object.freeze({
      format: AUTOSAVE_JOURNAL_FORMAT,
      formatVersion: AUTOSAVE_JOURNAL_VERSION,
      kind: "checkpoint",
      projectId: this.journal.projectId,
      revision: this.journal.revision,
      projectJson: this.journal.projectJson,
      sha256: this.journal.sha256,
      byteSize: this.journal.byteSize,
      checkpointId: this.journal.journalId,
      parentCheckpointId: this.journal.baseCheckpointId,
      committedAt: NOW,
    });
    this.checkpoint = checkpoint;
    this.journal = undefined;
    return checkpoint;
  }

  async discardJournal(): Promise<void> {
    this.journal = undefined;
  }
}

function repository(projectId: string) {
  const records = new Map<string, AssetRecord>();
  const blobs = new Map<string, Blob>();
  const put = vi.fn(async (blob: Blob, metadata: AssetMetadata): Promise<AssetRecord> => {
    const hash = "f".repeat(64);
    const record: AssetRecord = {
      id: metadata.id,
      name: metadata.name,
      blobKey: `sha256:${hash}`,
      contentHash: hash,
      mimeType: blob.type || "image/png",
      width: metadata.width,
      height: metadata.height,
      byteSize: blob.size,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      provenance: metadata.provenance,
    };
    records.set(record.id, record);
    blobs.set(record.id, blob);
    return record;
  });
  const getMetadata = vi.fn(async (assetId: string): Promise<AssetRecord> => {
    const record = records.get(assetId);
    if (!record) throw new AssetRepositoryError("ASSET_NOT_FOUND", "missing", { operation: "get-metadata", assetId });
    return record;
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
    getBlob,
    remove: vi.fn(async (assetId: string) => { records.delete(assetId); blobs.delete(assetId); }),
    list: vi.fn(async () => [...records.values()]),
    verify: vi.fn(),
    scanIntegrity: vi.fn(),
    exportMany: vi.fn(),
    createRuntimeUrl: vi.fn(),
    releaseRuntimeUrl: vi.fn(),
    releaseOwner: vi.fn(),
    dispose: vi.fn(),
  } as unknown as AssetRepository;
  return { value, records, blobs };
}

function staged(sourceAssetId: string) {
  const recipe: GridSplitRecipeV1 = {
    kind: "grid-split",
    version: 1,
    sourceAssetId,
    layout: { mode: "manual", rows: 1, cols: 2 },
    crop: { threshold: 0, padding: 0 },
    chroma: { enabled: false, color: "#00ff00", tolerance: 0, smoothness: 0, spill: 0 },
    pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
  };
  const processing = beginStagedGridProcessing(createIdleStagedGridResults(), {
    requestId: "grid-persistence",
    source: { width: 4, height: 2, format: "rgba8", colorSpace: "srgb", pixels: new ArrayBuffer(32) },
    recipe,
  });
  const outputs = [0, 1].map((index) => ({
    index,
    row: 0,
    column: index,
    cellBounds: { x: index * 2, y: 0, width: 2, height: 2 },
    contentBounds: { x: index * 2, y: 0, width: 2, height: 2 },
    surface: { width: 1, height: 1, format: "rgba8" as const, colorSpace: "srgb" as const, pixels: new ArrayBuffer(4) },
    cropReductionRatio: 0,
    operations: [],
    warnings: [],
  }));
  return completeStagedGridProcessing(processing, {
    source: { width: 4, height: 2 },
    layout: { origin: "manual", rows: 1, cols: 2 },
    outputs,
    summary: { outputCount: 2, outputPixelCount: 2, cropReductionRatio: 0, warnings: [] },
  });
}

describe("Grid source persistence and reconstruction (G6-04)", () => {
  it("saves, reloads and reconstructs source/recipe/region provenance without runtime URLs", async () => {
    const project = createEmptyStudioProject({ id: "project-grid-persistence", now: NOW });
    const first = createProjectStoreWithHistory(project, { context: { nextId: () => "unused", now: () => NOW } });
    const repo = repository(project.id);
    const imported = await importSliceSource({
      store: first.store,
      repository: repo.value,
      blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
      name: "sheet.png",
      mimeType: "image/png",
      width: 4,
      height: 2,
      nextId: () => "asset-persisted-source",
      now: () => NOW,
    });
    const committed = await commitStagedGridResults({
      store: first.store,
      repository: repo.value,
      staged: staged(imported.asset.id),
      sourceAssetId: imported.asset.id,
      nextId: (() => {
        const ids = ["recipe-persisted", "region-persisted-1", "region-persisted-2"];
        return () => ids.shift() ?? "unexpected";
      })(),
      now: () => NOW,
    });
    const autosaveStorage = new MemoryAutosaveStorage();
    const autosave = new ProjectAutosaveJournal(autosaveStorage, { now: () => NOW });
    await autosave.checkpoint(first.store.getSnapshot().project as StudioProjectV1);
    const inspection = await autosave.inspect(project.id);
    const encoded = inspection.confirmed?.record.projectJson;
    expect(encoded).toBeDefined();
    const reloadedProject = projectCodec.decode(encoded!);
    const reloaded = createProjectStoreWithHistory(reloadedProject, { context: { nextId: () => "unused-reload", now: () => NOW } });
    const restoredSource = await restoreCanonicalSliceSource({
      store: reloaded.store,
      repository: repo.value,
      assetId: imported.asset.id,
    });

    expect(restoredSource.asset.id).toBe(imported.asset.id);
    expect(restoredSource.blob.size).toBe(4);
    expect(reloadedProject.processingRecipes[committed.recipe.id]).toMatchObject({ sourceAssetId: imported.asset.id });
    expect(reloadedProject.regions[committed.regions[0]!.id]?.provenance).toMatchObject({
      source: "grid-split",
      sourceId: committed.recipe.id,
    });
    expect(reloadedProject.regions[committed.regions[0]!.id]?.assetId).toBe(imported.asset.id);
  });

  it("rechecks the active graph before startup cleanup removes a concurrently imported source", async () => {
    const project = createEmptyStudioProject({ id: "project-grid-reconcile-race", now: NOW });
    const repo = repository(project.id);
    const source: AssetRecord = {
      id: "asset-race-source",
      name: "race.png",
      blobKey: "sha256:" + "e".repeat(64),
      contentHash: "e".repeat(64),
      mimeType: "image/png",
      width: 4,
      height: 2,
      byteSize: 4,
      createdAt: NOW,
      updatedAt: NOW,
      provenance: { source: "import", importedAt: NOW },
    };
    repo.records.set(source.id, source);
    repo.blobs.set(source.id, new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }));
    const currentProject = { ...project, assets: { [source.id]: source } };

    await expect(reconcileProjectAssetRepository(repo.value, project, {
      getProject: () => currentProject,
    })).resolves.toEqual({
      complete: true,
      removedAssetIds: [],
      pendingAssetIds: [],
      listFailed: false,
    });
    expect(repo.records.has(source.id)).toBe(true);
  });
});
