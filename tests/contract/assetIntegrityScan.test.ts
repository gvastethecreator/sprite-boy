import { describe, expect, it, vi } from "vitest";
import {
  AssetRepositoryError,
  IndexedDbAssetRepository,
  computeAssetContentIdentity,
} from "../../core/assets";
import type {
  AssetContentIdentity,
  AssetStorageInventory,
  AssetStorageListOptions,
  AssetStoragePort,
  AssetStoragePutResult,
  AssetStorageRemoval,
} from "../../core/assets";
import type { AssetRecord, EntityId } from "../../core/project";

function assetRecord(
  id: EntityId,
  identity: AssetContentIdentity,
  mimeType = "text/plain",
): AssetRecord {
  return {
    id,
    name: `Asset ${id}`,
    blobKey: identity.blobKey,
    contentHash: identity.contentHash,
    mimeType,
    width: 8,
    height: 8,
    byteSize: identity.byteSize,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
    provenance: { source: "fixture" },
  };
}

function metadataEntry(projectId: EntityId, record: AssetRecord) {
  return {
    projectId,
    assetId: record.id,
    blobKey: record.blobKey,
    contentHash: record.contentHash,
    record,
  };
}

function blobEntry(blob: Blob, identity: AssetContentIdentity) {
  return {
    blobKey: identity.blobKey,
    contentHash: identity.contentHash,
    verificationHash: identity.verificationHash,
    byteSize: identity.byteSize,
    blob,
  };
}

class InventoryStorage implements AssetStoragePort {
  readonly projectId = "project-assets";
  inspectCalls = 0;
  removeCalls = 0;
  closeCalls = 0;
  inspectBarrier?: Promise<AssetStorageInventory>;

  constructor(readonly inventory: AssetStorageInventory) {}

  async put(record: AssetRecord): Promise<AssetStoragePutResult> {
    return {
      current: record,
      replacedBinary: false,
      removedPreviousBlob: false,
    };
  }

  async getMetadata(assetId: EntityId): Promise<AssetRecord> {
    const match = this.inventory.metadataEntries.find((entry) => (
      entry.projectId === this.projectId && entry.assetId === assetId
    ));
    if (!match) throw new AssetRepositoryError(
      "ASSET_NOT_FOUND",
      "missing metadata",
      { operation: "get-metadata", assetId },
    );
    return match.record;
  }

  async getBlob(assetId: EntityId): Promise<Blob> {
    const record = await this.getMetadata(assetId);
    const match = this.inventory.blobEntries.find((entry) => entry.blobKey === record.blobKey);
    if (!match) throw new AssetRepositoryError(
      "ASSET_BLOB_MISSING",
      "missing blob",
      { operation: "get-blob", assetId },
    );
    return match.blob;
  }

  async list(options?: AssetStorageListOptions): Promise<readonly AssetRecord[]> {
    return this.inventory.metadataEntries
      .filter((entry) => entry.projectId === this.projectId)
      .map((entry) => entry.record)
      .filter((record) => !options?.contentHash || record.contentHash === options.contentHash);
  }

  async inspect(): Promise<AssetStorageInventory> {
    this.inspectCalls += 1;
    return this.inspectBarrier ?? this.inventory;
  }

  async remove(assetId: EntityId): Promise<AssetStorageRemoval> {
    this.removeCalls += 1;
    return { assetId, blobKey: "unused", removedBlob: false };
  }

  close(): void {
    this.closeCalls += 1;
  }
}

describe("Asset integrity and garbage-collection preview (F2-06)", () => {
  it("finds missing/corrupt assets and only globally unreferenced blobs", async () => {
    const okBlob = new Blob(["healthy"], { type: "text/plain" });
    const missingBlob = new Blob(["missing"], { type: "text/plain" });
    const expectedCorruptBlob = new Blob(["aaaa"], { type: "text/plain" });
    const actualCorruptBlob = new Blob(["bbbb"], { type: "text/plain" });
    const orphanBlob = new Blob(["orphan"], { type: "text/plain" });
    const sharedBlob = new Blob(["shared"], { type: "text/plain" });
    const [okIdentity, missingIdentity, corruptIdentity, orphanIdentity, sharedIdentity] =
      await Promise.all([
        computeAssetContentIdentity(okBlob),
        computeAssetContentIdentity(missingBlob),
        computeAssetContentIdentity(expectedCorruptBlob),
        computeAssetContentIdentity(orphanBlob),
        computeAssetContentIdentity(sharedBlob),
      ]);
    const okRecord = assetRecord("asset-ok", okIdentity);
    const missingRecord = assetRecord("asset-missing", missingIdentity);
    const corruptRecord = assetRecord("asset-corrupt", corruptIdentity);
    const sharedRecord = assetRecord("asset-other-project", sharedIdentity);
    const storage = new InventoryStorage({
      metadataEntries: [
        metadataEntry("project-assets", corruptRecord),
        metadataEntry("project-assets", missingRecord),
        metadataEntry("other-project", sharedRecord),
        metadataEntry("project-assets", okRecord),
      ],
      blobEntries: [
        blobEntry(sharedBlob, sharedIdentity),
        blobEntry(actualCorruptBlob, corruptIdentity),
        blobEntry(orphanBlob, orphanIdentity),
        blobEntry(okBlob, okIdentity),
      ],
    });
    const repository = new IndexedDbAssetRepository("project-assets", { storage });

    const report = await repository.scanIntegrity();

    expect(report.assets.map(({ assetId, status }) => ({ assetId, status }))).toEqual([
      { assetId: "asset-corrupt", status: "hash-mismatch" },
      { assetId: "asset-missing", status: "blob-missing" },
      { assetId: "asset-ok", status: "ok" },
    ]);
    expect(report.garbageCollection).toEqual({
      mode: "preview",
      candidates: [{
        blobKey: orphanIdentity.blobKey,
        byteSize: orphanBlob.size,
        contentHash: orphanIdentity.contentHash,
        reason: "unreferenced",
      }],
      reclaimableBytes: orphanBlob.size,
    });
    expect(report.summary).toEqual({
      assetCount: 3,
      okCount: 1,
      assetIssueCount: 2,
      storageIssueCount: 0,
      orphanBlobCount: 1,
      reclaimableBytes: orphanBlob.size,
    });
    expect(storage.removeCalls).toBe(0);
    expect(storage.inspectCalls).toBe(1);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.assets)).toBe(true);
    expect(Object.isFrozen(report.garbageCollection.candidates)).toBe(true);
  });

  it("reports legacy identity and invalid envelopes without deleting them", async () => {
    const blob = new Blob(["legacy"], { type: "text/plain" });
    const identity = await computeAssetContentIdentity(blob);
    const record = assetRecord("asset-legacy", identity);
    let reads = 0;
    const hostileMetadata = {
      projectId: "project-assets",
      assetId: "asset-hostile",
      contentHash: identity.contentHash,
      record,
    };
    Object.defineProperty(hostileMetadata, "blobKey", {
      enumerable: true,
      get() {
        reads += 1;
        return identity.blobKey;
      },
    });
    const storage = new InventoryStorage({
      metadataEntries: [
        metadataEntry("project-assets", record),
        hostileMetadata as never,
      ],
      blobEntries: [{ blobKey: identity.blobKey, blob }],
    });
    const repository = new IndexedDbAssetRepository("project-assets", { storage });

    const first = await repository.scanIntegrity();
    const second = await repository.scanIntegrity();

    expect(first).toEqual(second);
    expect(first.assets).toHaveLength(1);
    expect(first.assets[0].status).toBe("ok");
    expect(first.storageIssues).toEqual([
      { code: "blob-identity-missing", blobKey: identity.blobKey },
      { code: "metadata-envelope-invalid", assetId: "asset-hostile" },
    ]);
    expect(first.garbageCollection.candidates).toEqual([]);
    expect(reads).toBe(0);
    expect(storage.removeCalls).toBe(0);
  });

  it("hashes a shared blob once per scan", async () => {
    const blob = new Blob(["shared-once"], { type: "text/plain" });
    const identity = await computeAssetContentIdentity(blob);
    const identify = vi.fn(computeAssetContentIdentity);
    const first = assetRecord("asset-a", identity);
    const second = assetRecord("asset-b", identity);
    const storage = new InventoryStorage({
      metadataEntries: [
        metadataEntry("project-assets", first),
        metadataEntry("project-assets", second),
      ],
      blobEntries: [blobEntry(blob, identity)],
    });
    const repository = new IndexedDbAssetRepository("project-assets", {
      storage,
      identityProvider: identify,
    });

    const report = await repository.scanIntegrity();

    expect(report.assets.map((asset) => asset.status)).toEqual(["ok", "ok"]);
    expect(identify).toHaveBeenCalledTimes(1);
  });

  it("rejects hostile hash coercion and Blob proxies without executing traps", async () => {
    const firstBlob = new Blob(["hostile-hash"], { type: "text/plain" });
    const secondBlob = new Blob(["hostile-proxy"], { type: "text/plain" });
    const [firstIdentity, secondIdentity] = await Promise.all([
      computeAssetContentIdentity(firstBlob),
      computeAssetContentIdentity(secondBlob),
    ]);
    let coercionReads = 0;
    let proxyTraps = 0;
    const hostileHash = {};
    Object.defineProperty(hostileHash, "toString", {
      get() {
        coercionReads += 1;
        throw new Error("coercion getter invoked");
      },
    });
    const proxyBlob = new Proxy(secondBlob, {
      getPrototypeOf() {
        proxyTraps += 1;
        throw new Error("blob proxy trap invoked");
      },
    });
    const storage = new InventoryStorage({
      metadataEntries: [],
      blobEntries: [
        {
          ...blobEntry(firstBlob, firstIdentity),
          contentHash: hostileHash as never,
        },
        {
          ...blobEntry(secondBlob, secondIdentity),
          blob: proxyBlob,
        },
      ],
    });
    const repository = new IndexedDbAssetRepository("project-assets", { storage });

    const report = await repository.scanIntegrity();

    expect(report.storageIssues).toEqual([
      { code: "blob-envelope-invalid", blobKey: firstIdentity.blobKey },
    ]);
    expect(coercionReads).toBe(0);
    expect(proxyTraps).toBe(0);
    expect(report.garbageCollection.candidates).toEqual([{
      blobKey: secondIdentity.blobKey,
      byteSize: secondBlob.size,
      contentHash: secondIdentity.contentHash,
      reason: "unreferenced",
    }]);
  });

  it("aborts a non-cooperative snapshot on caller cancellation", async () => {
    const storage = new InventoryStorage({ metadataEntries: [], blobEntries: [] });
    storage.inspectBarrier = new Promise(() => undefined);
    const repository = new IndexedDbAssetRepository("project-assets", { storage });
    const controller = new AbortController();
    const pending = repository.scanIntegrity({ signal: controller.signal });
    for (let turn = 0; turn < 5 && storage.inspectCalls < 1; turn += 1) await Promise.resolve();
    controller.abort("stop scan");
    await expect(pending).rejects.toMatchObject({
      code: "ASSET_TRANSACTION_ABORTED",
      operation: "scan-integrity",
    });
  });

  it("contains hostile inventory accessors without invoking them", async () => {
    const storage = new InventoryStorage({ metadataEntries: [], blobEntries: [] });
    let reads = 0;
    const hostile = { blobEntries: [] };
    Object.defineProperty(hostile, "metadataEntries", {
      enumerable: true,
      get() {
        reads += 1;
        return [];
      },
    });
    storage.inspectBarrier = Promise.resolve(hostile as never);
    const repository = new IndexedDbAssetRepository("project-assets", { storage });

    await expect(repository.scanIntegrity()).rejects.toMatchObject({
      code: "ASSET_STORAGE_UNAVAILABLE",
      operation: "scan-integrity",
    });
    expect(reads).toBe(0);
  });

  it("dispose aborts hashing in flight and closes storage once", async () => {
    const blob = new Blob(["stuck"], { type: "text/plain" });
    const identity = await computeAssetContentIdentity(blob);
    let identityCalls = 0;
    const record = assetRecord("asset-stuck", identity);
    const storage = new InventoryStorage({
      metadataEntries: [metadataEntry("project-assets", record)],
      blobEntries: [blobEntry(blob, identity)],
    });
    const repository = new IndexedDbAssetRepository("project-assets", {
      storage,
      identityProvider: () => {
        identityCalls += 1;
        return new Promise(() => undefined);
      },
    });
    const pending = repository.scanIntegrity();
    for (let turn = 0; turn < 10 && identityCalls < 1; turn += 1) await Promise.resolve();

    repository.dispose();

    await expect(pending).rejects.toMatchObject({
      code: "ASSET_TRANSACTION_ABORTED",
      operation: "scan-integrity",
      assetId: "asset-stuck",
    });
    expect(storage.closeCalls).toBe(1);
  });
});
