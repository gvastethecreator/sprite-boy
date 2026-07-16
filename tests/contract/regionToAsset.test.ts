import { describe, expect, it } from "vitest";
import {
  AssetRepositoryError,
  computeAssetContentIdentity,
  type AssetMetadata,
  type AssetRepository,
} from "../../core/assets";
import type { AssetRecord, StudioProjectV1 } from "../../core/project";
import { projectCodec } from "../../core/persistence";
import { createProjectStoreWithHistory, type ProjectStore } from "../../core/stores";
import {
  convertRegionToAsset,
  parseRegionAssetProvenanceNote,
  RegionToAssetError,
  retryRegionToAssetCleanup,
  type RegionToAssetCleanupDebt,
} from "../../features/slice/assets";
import type { RegionCropPort } from "../../features/slice/assets/browserRegionCrop";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const timestamp = "2026-07-16T14:00:00.000Z";
const request = Object.freeze({
  regionId: "region-hero",
  name: "Hero frame.png",
  timestamp,
  grid: Object.freeze({ marginX: 7, marginY: 5, gapX: 3, gapY: 2 }),
});
const context = { nextId: () => "generated", now: () => timestamp };
const sourceBlob = new Blob(["source-not-reimported"], { type: "image/png" });
const sourceIdentity = await computeAssetContentIdentity(sourceBlob);
const croppedBlob = new Blob([new Uint8Array([0, 1, 2, 0, 255, 7, 9])], { type: "image/png" });
const canonicalProject = structuredClone(studioProjectV1Fixture);
canonicalProject.assets["asset-sheet"] = {
  ...canonicalProject.assets["asset-sheet"],
  blobKey: sourceIdentity.blobKey,
  contentHash: sourceIdentity.contentHash,
  mimeType: sourceBlob.type,
  byteSize: sourceBlob.size,
};

interface FakeRepositoryControl {
  readonly records: Map<string, AssetRecord>;
  readonly blobs: Map<string, Blob>;
  sourceBlob: Blob;
  putCount: number;
  removeCount: number;
  cropCount: number;
  failGetSource?: boolean;
  failPut?: boolean;
  throwAfterPut?: boolean;
  failDestinationMetadata?: boolean;
  failRemove?: boolean;
  afterPut?: () => void;
  putReturn?: (record: AssetRecord) => unknown;
  metadataReturn?: (record: AssetRecord) => unknown;
  afterDestinationBlobRead?: (record: AssetRecord) => void | Promise<void>;
  afterRemove?: (record: AssetRecord, blob: Blob) => void | Promise<void>;
}

function createRepository(control: FakeRepositoryControl): AssetRepository {
  const repository = {
    projectId: canonicalProject.id,
    async put(blob: Blob, metadata: AssetMetadata): Promise<AssetRecord> {
      control.putCount += 1;
      if (control.failPut) throw new AssetRepositoryError("ASSET_QUOTA_EXCEEDED", "quota", { operation: "put", assetId: metadata.id });
      const identity = await computeAssetContentIdentity(blob);
      const record: AssetRecord = Object.freeze({
        id: metadata.id,
        name: metadata.name,
        blobKey: identity.blobKey,
        contentHash: identity.contentHash,
        mimeType: blob.type,
        width: metadata.width,
        height: metadata.height,
        byteSize: blob.size,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        provenance: Object.freeze({ ...metadata.provenance }),
      });
      control.records.set(record.id, record);
      control.blobs.set(record.id, blob);
      control.afterPut?.();
      if (control.throwAfterPut) throw new AssetRepositoryError("ASSET_STORAGE_UNAVAILABLE", "post-write throw", { operation: "put", assetId: metadata.id });
      return (control.putReturn ? control.putReturn(record) : record) as AssetRecord;
    },
    async getMetadata(assetId: string): Promise<AssetRecord> {
      const record = control.records.get(assetId);
      if (!record) throw new AssetRepositoryError("ASSET_NOT_FOUND", "missing", { operation: "get-metadata", assetId });
      if (control.failDestinationMetadata) throw new AssetRepositoryError("ASSET_STORAGE_UNAVAILABLE", "metadata unavailable", { operation: "get-metadata", assetId });
      return (control.metadataReturn ? control.metadataReturn(record) : record) as AssetRecord;
    },
    async getBlob(assetId: string): Promise<Blob> {
      if (assetId === "asset-sheet") {
        if (control.failGetSource) throw new AssetRepositoryError("ASSET_BLOB_MISSING", "missing", { operation: "get-blob", assetId });
        return control.sourceBlob;
      }
      const blob = control.blobs.get(assetId);
      if (!blob) throw new AssetRepositoryError("ASSET_BLOB_MISSING", "missing", { operation: "get-blob", assetId });
      const record = control.records.get(assetId);
      if (record) await control.afterDestinationBlobRead?.(record);
      return blob;
    },
    async remove(assetId: string): Promise<void> {
      control.removeCount += 1;
      if (control.failRemove) throw new AssetRepositoryError("ASSET_STORAGE_UNAVAILABLE", "remove failed", { operation: "remove", assetId });
      if (!control.records.has(assetId)) throw new AssetRepositoryError("ASSET_NOT_FOUND", "missing", { operation: "remove", assetId });
      const record = control.records.get(assetId)!;
      const blob = control.blobs.get(assetId)!;
      control.records.delete(assetId);
      control.blobs.delete(assetId);
      await control.afterRemove?.(record, blob);
    },
    async list() { return [...control.records.values()]; },
    async verify() { throw new Error("unused"); },
    async scanIntegrity() { throw new Error("unused"); },
    async *exportMany() { /* unused */ },
    async createRuntimeUrl() { throw new Error("unused"); },
    releaseRuntimeUrl() {}, releaseOwner() {}, dispose() {},
  };
  return repository as unknown as AssetRepository;
}

function setup(cropper?: RegionCropPort) {
  const runtime = createProjectStoreWithHistory(canonicalProject, { context });
  const control: FakeRepositoryControl = {
    records: new Map(), blobs: new Map(), sourceBlob,
    putCount: 0, removeCount: 0, cropCount: 0,
  };
  const actualCropper: RegionCropPort = cropper ?? {
    crop: async () => { control.cropCount += 1; return croppedBlob; },
  };
  return { ...runtime, control, repository: createRepository(control), cropper: actualCropper };
}

function storeWrapper(actual: ProjectStore, overrides: {
  getSnapshot?: () => unknown;
  dispatch?: (envelope: unknown) => unknown;
}): ProjectStore {
  return Object.freeze({
    kind: "project",
    persistence: "durable",
    history: "command",
    getSnapshot: overrides.getSnapshot ?? actual.getSnapshot.bind(actual),
    subscribe: actual.subscribe.bind(actual),
    dispatch: overrides.dispatch ?? actual.dispatch.bind(actual),
  }) as unknown as ProjectStore;
}

async function captured(work: () => Promise<unknown>): Promise<RegionToAssetError> {
  try { await work(); }
  catch (error) {
    expect(error).toBeInstanceOf(RegionToAssetError);
    return error as RegionToAssetError;
  }
  throw new Error("Expected RegionToAssetError.");
}

function derivedIds(store: ProjectStore): string[] {
  return Object.keys(store.getSnapshot().project.assets).filter((id) => id.startsWith("asset:region:"));
}

function accessorRecord(record: AssetRecord): AssetRecord {
  const hostile = { ...record } as Record<string, unknown>;
  Object.defineProperty(hostile, "name", { enumerable: true, get: () => { throw new Error("secret"); } });
  return hostile as unknown as AssetRecord;
}

function revokedRecord(): AssetRecord {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy as AssetRecord;
}

type MutableNote = Omit<NonNullable<ReturnType<typeof parseRegionAssetProvenanceNote>>, "sourceContentHash" | "sourceBounds" | "grid"> & {
  sourceContentHash: string;
  sourceBounds: { x: number; y: number; width: number; height: number };
  grid: { marginX: number; marginY: number; gapX: number; gapY: number };
};

function changedNote(record: AssetRecord, change: (note: MutableNote) => void): AssetRecord {
  const note = structuredClone(parseRegionAssetProvenanceNote(record.provenance.note)!) as MutableNote;
  change(note);
  return {
    ...record,
    provenance: { ...record.provenance, note: `sprite-boy.region-to-asset/v2:${JSON.stringify(note)}` },
  };
}

describe("Region-to-Asset compensated transaction (S1-05)", () => {
  it("verifies source identity, preserves provenance v2, reloads, and keeps one undo/redo", async () => {
    const { store, history, control, repository, cropper } = setup();
    const first = await convertRegionToAsset({ store, repository, cropper }, request);
    const note = parseRegionAssetProvenanceNote(first.asset.provenance.note);

    expect(first.reused).toBe(false);
    expect(first.asset.id).toMatch(/^asset:region:region-hero:sha256:[0-9a-f]{64}$/u);
    expect(note).toEqual({
      kind: "region-to-asset", version: 2, sourceAssetId: "asset-sheet",
      sourceContentHash: sourceIdentity.contentHash, sourceRegionId: "region-hero",
      sourceBounds: { x: 0, y: 0, width: 128, height: 128 },
      grid: { marginX: 7, marginY: 5, gapX: 3, gapY: 2 },
    });
    const reloaded = projectCodec.decode(projectCodec.encode(store.getSnapshot().project as StudioProjectV1));
    expect(parseRegionAssetProvenanceNote(reloaded.assets[first.asset.id]?.provenance.note)).toEqual(note);
    expect(history.undo()).toMatchObject({ ok: true });
    expect(control.blobs.has(first.asset.id)).toBe(true);
    expect(history.redo()).toMatchObject({ ok: true });
    expect(store.getSnapshot().project.assets[first.asset.id]).toEqual(first.asset);
    const retry = await convertRegionToAsset({ store, repository, cropper }, request);
    expect(retry.reused).toBe(true);
    expect(control.putCount).toBe(1);
  });

  it("rejects corrupt source bytes before crop or write", async () => {
    for (const corrupt of [
      new Blob(["source-not-reimported"], { type: "image/jpeg" }),
      new Blob(["source-not-reimported-corrupt"], { type: "image/png" }),
    ]) {
      const value = setup();
      value.control.sourceBlob = corrupt;
      const error = await captured(() => convertRegionToAsset(value, request));
      expect(error.code).toBe("SOURCE_INTEGRITY_MISMATCH");
      expect(value.control.cropCount).toBe(0);
      expect(value.control.putCount).toBe(0);
      expect(derivedIds(value.store)).toEqual([]);
    }
  });

  it("fails closed for missing source and quota, and emits debt for cancel after put", async () => {
    const missing = setup(); missing.control.failGetSource = true;
    expect((await captured(() => convertRegionToAsset(missing, request))).code).toBe("SOURCE_BLOB_FAILED");
    const quota = setup(); quota.control.failPut = true;
    expect((await captured(() => convertRegionToAsset(quota, request))).code).toBe("REPOSITORY_PUT_FAILED");

    const cancelled = setup();
    const controller = new AbortController();
    cancelled.control.afterPut = () => controller.abort("test");
    expect((await captured(() => convertRegionToAsset(cancelled, request, { signal: controller.signal }))).code).toBe("CLEANUP_DEBT");
    expect(cancelled.control.removeCount).toBe(0);
    expect(cancelled.control.records.size).toBe(1);
    expect(derivedIds(cancelled.store)).toEqual([]);
  });

  it("emits cleanup debt without deleting when this attempt created a stale destination", async () => {
    const value = setup();
    value.control.afterPut = () => value.store.dispatch({
      command: { type: "project.rename", name: "Changed", updatedAt: timestamp },
      metadata: { commandId: "stale-after-put", origin: "user", history: "record" },
    });
    expect((await captured(() => convertRegionToAsset(value, request))).code).toBe("CLEANUP_DEBT");
    expect(value.control.removeCount).toBe(0);
    expect(value.control.records.size).toBe(1);
  });

  it("reconciles put persist-then-throw even when destination metadata becomes unavailable", async () => {
    const cleaned = setup();
    cleaned.control.throwAfterPut = true;
    cleaned.control.failDestinationMetadata = true;
    expect((await captured(() => convertRegionToAsset(cleaned, request))).code).toBe("CLEANUP_DEBT");
    expect(cleaned.control.removeCount).toBe(0);
    expect(cleaned.control.records.size).toBe(1);
    expect(derivedIds(cleaned.store)).toEqual([]);

    const debt = setup();
    debt.control.throwAfterPut = true;
    debt.control.failDestinationMetadata = true;
    debt.control.failRemove = true;
    const error = await captured(() => convertRegionToAsset(debt, request));
    expect(error.code).toBe("CLEANUP_DEBT");
    expect(error.cleanupDebt).toMatchObject({ createdByAttempt: true, graphOwnership: "absent" });
    expect(debt.control.records.size).toBe(1);
    expect(derivedIds(debt.store)).toEqual([]);
  });

  it("rejects every wrong returned AssetRecord field and hostile metadata without graph writes", async () => {
    const mutations: Array<(record: AssetRecord) => unknown> = [
      (record) => ({ ...record, id: "wrong" }),
      (record) => ({ ...record, name: "wrong" }),
      (record) => ({ ...record, blobKey: `sha256:${"0".repeat(64)}` }),
      (record) => ({ ...record, contentHash: "0".repeat(64) }),
      (record) => ({ ...record, mimeType: "image/jpeg" }),
      (record) => ({ ...record, width: record.width + 1 }),
      (record) => ({ ...record, height: record.height + 1 }),
      (record) => ({ ...record, byteSize: record.byteSize + 1 }),
      (record) => ({ ...record, createdAt: "2026-07-16T15:00:00.000Z" }),
      (record) => ({ ...record, updatedAt: "2026-07-16T15:00:00.000Z" }),
      (record) => ({ ...record, provenance: { ...record.provenance, source: "wrong" } }),
      (record) => ({ ...record, provenance: { ...record.provenance, sourceId: "wrong" } }),
      (record) => ({ ...record, provenance: { ...record.provenance, importedAt: "2026-07-16T15:00:00.000Z" } }),
      (record) => ({ ...record, provenance: { ...record.provenance, parentAssetId: "wrong" } }),
      (record) => ({ ...record, provenance: { ...record.provenance, note: `${record.provenance.note}x` } }),
      (record) => changedNote(record, (note) => { note.sourceContentHash = "0".repeat(64); }),
      (record) => changedNote(record, (note) => { note.sourceBounds.x += 1; }),
      (record) => changedNote(record, (note) => { note.grid.gapX += 1; }),
      accessorRecord,
      () => null,
      () => revokedRecord(),
    ];
    for (const [index, mutate] of mutations.entries()) {
      const value = setup(); value.control.putReturn = mutate;
      const error = await captured(() => convertRegionToAsset(value, request));
      expect(error.code).toBe("CLEANUP_DEBT");
      expect(value.control.removeCount, `mutation ${index}`).toBe(0);
      expect(value.control.records.size).toBe(1);
      expect(derivedIds(value.store)).toEqual([]);
    }
  });

  it("contains null, forged, getter, and revoked dispatch results", async () => {
    const getterResult = {};
    Object.defineProperty(getterResult, "result", { enumerable: true, get: () => { throw new Error("secret"); } });
    const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
    for (const returned of [null, { revision: 999, result: { ok: true } }, getterResult, proxy]) {
      const value = setup();
      const store = storeWrapper(value.store, { dispatch: () => returned });
      const error = await captured(() => convertRegionToAsset({ ...value, store }, request));
      expect(error.code).toBe("CLEANUP_DEBT");
      expect(value.control.removeCount).toBe(0);
      expect(value.control.records.size).toBe(1);
    }
  });

  it("reconciles throw-after-commit as success and never removes graph-owned Blob", async () => {
    const value = setup();
    const store = storeWrapper(value.store, {
      dispatch: (envelope) => {
        value.store.dispatch(envelope as never);
        throw new Error("throw after commit");
      },
    });
    const result = await convertRegionToAsset({ ...value, store }, request);
    expect(result.asset).toEqual(value.store.getSnapshot().project.assets[result.asset.id]);
    expect(value.control.removeCount).toBe(0);
    expect(value.control.blobs.has(result.asset.id)).toBe(true);
  });

  it("preserves binary and emits redacted uncertainty when post-dispatch graph snapshot is hostile", async () => {
    for (const mode of ["throw", "project-getter", "revoked", "null", "forged"] as const) {
      const value = setup();
      let dispatched = false;
      const revoked = Proxy.revocable({}, {}); revoked.revoke();
      const store = storeWrapper(value.store, {
        dispatch: () => { dispatched = true; return null; },
        getSnapshot: () => {
          if (!dispatched) return value.store.getSnapshot();
          if (mode === "throw") throw new Error("secret snapshot");
          if (mode === "revoked") return revoked.proxy;
          if (mode === "null") return null;
          if (mode === "forged") return { revision: "wrong", project: {} };
          const snapshot = { revision: value.store.getSnapshot().revision } as Record<string, unknown>;
          Object.defineProperty(snapshot, "project", { enumerable: true, get: () => { throw new Error("secret project"); } });
          return snapshot;
        },
      });
      const error = await captured(() => convertRegionToAsset({ ...value, store }, request));
      expect(error.code).toBe("OWNERSHIP_UNCERTAIN");
      expect(error.message).not.toContain("secret");
      expect(error.ownershipDebt).toMatchObject({
        kind: "region-to-asset-ownership-uncertain", createdByAttempt: true,
        graphOwnership: "unknown", retryable: true,
      });
      expect(Object.keys(error.ownershipDebt ?? {})).toEqual([
        "kind", "assetId", "expectedContentHash", "expectedRecordFingerprint",
        "createdByAttempt", "graphOwnership", "retryable",
      ]);
      expect(value.control.removeCount).toBe(0);
      expect(value.control.records.size).toBe(1);
    }
  });

  it("never removes a preexisting destination after undo and failed reconvert; redo/reload stay valid", async () => {
    const value = setup();
    const first = await convertRegionToAsset(value, request);
    expect(value.history.undo()).toMatchObject({ ok: true });
    const removesBefore = value.control.removeCount;
    const store = storeWrapper(value.store, { dispatch: () => null });
    const error = await captured(() => convertRegionToAsset({ ...value, store }, request));
    expect(error.code).toBe("PROJECT_DISPATCH_FAILED");
    expect(error.cleanupDebt).toBeUndefined();
    expect(value.control.putCount).toBe(1);
    expect(value.control.removeCount).toBe(removesBefore);
    expect(value.control.blobs.has(first.asset.id)).toBe(true);
    expect(value.history.redo()).toMatchObject({ ok: true });
    const reloaded = projectCodec.decode(projectCodec.encode(value.store.getSnapshot().project as StudioProjectV1));
    expect(reloaded.assets[first.asset.id]).toEqual(first.asset);
    expect(value.control.blobs.has(first.asset.id)).toBe(true);
  });

  it("preexisting hostile metadata never causes removal", async () => {
    const value = setup();
    const first = await convertRegionToAsset(value, request);
    value.history.undo();
    value.control.metadataReturn = accessorRecord;
    const error = await captured(() => convertRegionToAsset(value, request));
    expect(error.code).toBe("OUTPUT_ASSET_CONFLICT");
    expect(value.control.removeCount).toBe(0);
    expect(value.control.blobs.has(first.asset.id)).toBe(true);
  });

  it("rejects a destination Blob without metadata before put", async () => {
    const value = setup();
    const first = await convertRegionToAsset(value, request);
    value.history.undo();
    value.control.records.delete(first.asset.id);
    const putsBefore = value.control.putCount;
    const error = await captured(() => convertRegionToAsset(value, request));
    expect(error.code).toBe("OUTPUT_ASSET_CONFLICT");
    expect(value.control.putCount).toBe(putsBefore);
    expect(value.control.removeCount).toBe(0);
    expect(value.control.blobs.has(first.asset.id)).toBe(true);
  });

  it("cleanup debt is exact, identity-gated, graph-aware, and idempotent", async () => {
    const value = setup();
    const store = storeWrapper(value.store, { dispatch: () => null });
    const error = await captured(() => convertRegionToAsset({ ...value, store }, request));
    expect(error.code).toBe("CLEANUP_DEBT");
    const debt = error.cleanupDebt as RegionToAssetCleanupDebt;
    expect(debt).toMatchObject({ createdByAttempt: true, graphOwnership: "absent", retryable: true });
    const original = value.control.records.get(debt.orphanAssetId)!;
    value.control.records.set(debt.orphanAssetId, { ...original, name: "new owner.png" });
    value.control.failRemove = false;
    expect((await captured(() => retryRegionToAssetCleanup(value, debt))).code).toBe("OUTPUT_ASSET_CONFLICT");
    expect(value.control.records.has(debt.orphanAssetId)).toBe(true);
    value.control.records.set(debt.orphanAssetId, { ...original, contentHash: "0".repeat(64) });
    expect((await captured(() => retryRegionToAssetCleanup(value, debt))).code).toBe("OUTPUT_ASSET_CONFLICT");
    expect(value.control.records.has(debt.orphanAssetId)).toBe(true);
    value.control.records.set(debt.orphanAssetId, original);
    let acquired = false;
    const removesBeforeRace = value.control.removeCount;
    value.control.afterDestinationBlobRead = (record) => {
      if (acquired) return;
      acquired = true;
      value.store.dispatch({
        command: { type: "asset.import", asset: record },
        metadata: { commandId: "cleanup-race-owner", origin: "user", history: "record" },
      });
    };
    await retryRegionToAssetCleanup(value, debt);
    expect(value.control.removeCount).toBe(removesBeforeRace);
    expect(value.store.getSnapshot().project.assets[debt.orphanAssetId]).toEqual(original);
    expect(value.control.records.has(debt.orphanAssetId)).toBe(true);
    expect(value.history.undo()).toMatchObject({ ok: true });
    value.control.afterDestinationBlobRead = undefined;
    await retryRegionToAssetCleanup(value, debt);
    await retryRegionToAssetCleanup(value, debt);
    expect(value.control.records.has(debt.orphanAssetId)).toBe(false);
  });

  it("preserves storage when metadata is unavailable during conditional cleanup", async () => {
    const value = setup();
    const store = storeWrapper(value.store, { dispatch: () => null });
    const error = await captured(() => convertRegionToAsset({ ...value, store }, request));
    const debt = error.cleanupDebt as RegionToAssetCleanupDebt;
    const removesBefore = value.control.removeCount;
    value.control.failDestinationMetadata = true;

    expect((await captured(() => retryRegionToAssetCleanup(value, debt))).code).toBe("CLEANUP_DEBT");
    expect(value.control.removeCount).toBe(removesBefore);
    expect(value.control.records.has(debt.orphanAssetId)).toBe(true);
  });

  it("rechecks the exact record fingerprint after the first cleanup read", async () => {
    const value = setup();
    const store = storeWrapper(value.store, { dispatch: () => null });
    const error = await captured(() => convertRegionToAsset({ ...value, store }, request));
    const debt = error.cleanupDebt as RegionToAssetCleanupDebt;
    let changed = false;
    value.control.afterDestinationBlobRead = (record) => {
      if (changed) return;
      changed = true;
      value.control.records.set(record.id, Object.freeze({ ...record, name: "new owner.png" }));
    };
    const removesBefore = value.control.removeCount;

    expect((await captured(() => retryRegionToAssetCleanup(value, debt))).code).toBe("OUTPUT_ASSET_CONFLICT");
    expect(value.control.removeCount).toBe(removesBefore);
    expect(value.control.records.get(debt.orphanAssetId)?.name).toBe("new owner.png");
    expect(value.control.blobs.has(debt.orphanAssetId)).toBe(true);
  });

  it("restores the exact record and Blob when graph ownership appears during remove", async () => {
    const value = setup();
    const store = storeWrapper(value.store, { dispatch: () => null });
    const error = await captured(() => convertRegionToAsset({ ...value, store }, request));
    const debt = error.cleanupDebt as RegionToAssetCleanupDebt;
    const expected = value.control.records.get(debt.orphanAssetId)!;
    value.control.afterRemove = (record) => {
      value.store.dispatch({
        command: { type: "asset.import", asset: record },
        metadata: { commandId: "cleanup-post-remove-owner", origin: "user", history: "record" },
      });
    };

    await retryRegionToAssetCleanup(value, debt);
    expect(value.control.removeCount).toBe(1);
    expect(value.store.getSnapshot().project.assets[debt.orphanAssetId]).toEqual(expected);
    expect(value.control.records.get(debt.orphanAssetId)).toEqual(expected);
    expect(value.control.blobs.get(debt.orphanAssetId)).toBe(croppedBlob);
  });

  it("restores storage and emits ownership debt when graph becomes unknown during remove", async () => {
    const value = setup();
    const rejectingStore = storeWrapper(value.store, { dispatch: () => null });
    const error = await captured(() => convertRegionToAsset({ ...value, store: rejectingStore }, request));
    const debt = error.cleanupDebt as RegionToAssetCleanupDebt;
    const expected = value.control.records.get(debt.orphanAssetId)!;
    let graphUnavailable = false;
    value.control.afterRemove = () => { graphUnavailable = true; };
    const uncertainStore = storeWrapper(value.store, {
      getSnapshot: () => {
        if (graphUnavailable) throw new Error("secret graph failure");
        return value.store.getSnapshot();
      },
    });

    const uncertain = await captured(() => retryRegionToAssetCleanup({ ...value, store: uncertainStore }, debt));
    expect(uncertain.code).toBe("OWNERSHIP_UNCERTAIN");
    expect(uncertain.message).not.toContain("secret");
    expect(uncertain.ownershipDebt).toMatchObject({ assetId: debt.orphanAssetId, graphOwnership: "unknown" });
    expect(value.control.records.get(debt.orphanAssetId)).toEqual(expected);
    expect(value.control.blobs.get(debt.orphanAssetId)).toBe(croppedBlob);
  });

  it("serializes cleanup retry and conversion for the same destination id", async () => {
    const value = setup();
    const rejectingStore = storeWrapper(value.store, { dispatch: () => null });
    const error = await captured(() => convertRegionToAsset({ ...value, store: rejectingStore }, request));
    const debt = error.cleanupDebt as RegionToAssetCleanupDebt;
    const events: string[] = [];
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    let enteredRead!: () => void;
    const readEntered = new Promise<void>((resolve) => { enteredRead = resolve; });
    let firstRead = true;
    value.control.afterDestinationBlobRead = async () => {
      events.push("retry-read");
      if (!firstRead) return;
      firstRead = false;
      enteredRead();
      await readGate;
    };
    value.control.afterRemove = () => { events.push("remove"); };
    value.control.afterPut = () => { events.push("put"); };

    const retry = retryRegionToAssetCleanup(value, debt);
    await readEntered;
    const conversion = convertRegionToAsset(value, request);
    releaseRead();
    await retry;
    const result = await conversion;

    expect(events.indexOf("remove")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("put")).toBeGreaterThan(events.indexOf("remove"));
    expect(result.reused).toBe(false);
    expect(value.store.getSnapshot().project.assets[result.asset.id]).toEqual(result.asset);
    expect(value.control.records.get(result.asset.id)).toEqual(result.asset);
  });
});
