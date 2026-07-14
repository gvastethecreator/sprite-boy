import { describe, expect, it, vi } from "vitest";
import {
  AssetRepositoryError,
  IndexedDbAssetRepository,
  computeAssetContentIdentity,
} from "../../core/assets";
import type {
  AssetContentIdentity,
  AssetMetadata,
  AssetOperationOptions,
  AssetStorageListOptions,
  AssetStorageInventory,
  AssetStoragePort,
  AssetStoragePutResult,
  AssetStorageRemoval,
  RuntimeObjectUrlHost,
} from "../../core/assets";
import type { AssetRecord, EntityId } from "../../core/project";

const ABC_HASH = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

const metadata = (id = "asset-a"): AssetMetadata => ({
  id,
  name: `Asset ${id}`,
  width: 16,
  height: 12,
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
  provenance: { source: "fixture" },
  declaredMimeType: "text/plain",
});

class MemoryAssetStorage implements AssetStoragePort {
  readonly projectId = "project-assets";
  readonly records = new Map<EntityId, AssetRecord>();
  readonly blobs = new Map<EntityId, Blob>();
  putCalls = 0;
  removeCalls = 0;
  closeCalls = 0;
  failPut = false;
  failRemove = false;
  removeBarrier?: Promise<void>;

  async put(
    record: AssetRecord,
    blob: Blob,
    _options?: AssetOperationOptions,
    _identity?: AssetContentIdentity,
  ): Promise<AssetStoragePutResult> {
    this.putCalls += 1;
    if (this.failPut) throw new Error("injected put failure");
    const previous = this.records.get(record.id);
    this.records.set(record.id, record);
    this.blobs.set(record.id, blob);
    return {
      current: record,
      ...(previous ? { previous } : {}),
      replacedBinary: previous !== undefined && previous.blobKey !== record.blobKey,
      removedPreviousBlob: previous !== undefined && previous.blobKey !== record.blobKey,
    };
  }

  async getMetadata(assetId: EntityId): Promise<AssetRecord> {
    const record = this.records.get(assetId);
    if (!record) throw new AssetRepositoryError(
      "ASSET_NOT_FOUND",
      "missing metadata",
      { operation: "get-metadata", assetId },
    );
    return record;
  }

  async getBlob(assetId: EntityId): Promise<Blob> {
    const blob = this.blobs.get(assetId);
    if (!blob) throw new AssetRepositoryError(
      "ASSET_BLOB_MISSING",
      "missing blob",
      { operation: "get-blob", assetId },
    );
    return blob;
  }

  async list(options?: AssetStorageListOptions): Promise<readonly AssetRecord[]> {
    return [...this.records.values()]
      .filter((record) => !options?.contentHash || record.contentHash === options.contentHash)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async inspect(): Promise<AssetStorageInventory> {
    const metadataEntries = [...this.records.values()].map((record) => ({
      projectId: this.projectId,
      assetId: record.id,
      contentHash: record.contentHash,
      blobKey: record.blobKey,
      record,
    }));
    const blobEntries = [];
    const seen = new Set<string>();
    for (const record of this.records.values()) {
      if (seen.has(record.blobKey)) continue;
      const blob = this.blobs.get(record.id);
      if (!blob) continue;
      seen.add(record.blobKey);
      const identity = await computeAssetContentIdentity(blob);
      blobEntries.push({
        blobKey: record.blobKey,
        contentHash: identity.contentHash,
        verificationHash: identity.verificationHash,
        byteSize: identity.byteSize,
        blob,
      });
    }
    return { metadataEntries, blobEntries };
  }

  async remove(assetId: EntityId): Promise<AssetStorageRemoval> {
    this.removeCalls += 1;
    if (this.failRemove) throw new Error("injected remove failure");
    await this.removeBarrier;
    const record = await this.getMetadata(assetId);
    this.records.delete(assetId);
    this.blobs.delete(assetId);
    return { assetId, blobKey: record.blobKey, removedBlob: true };
  }

  close(): void {
    this.closeCalls += 1;
  }
}

function createHost() {
  let next = 0;
  return {
    createObjectURL: vi.fn((_blob: Blob) => `blob:repository-${++next}`),
    revokeObjectURL: vi.fn((_url: string) => undefined),
  } satisfies RuntimeObjectUrlHost;
}

describe("IndexedDbAssetRepository mutations (F2-05)", () => {
  it("imports validated bytes and returns canonical metadata", async () => {
    const storage = new MemoryAssetStorage();
    const repository = new IndexedDbAssetRepository("project-assets", {
      storage,
      runtimeUrlHost: createHost(),
    });
    const record = await repository.put(
      new Blob(["abc"], { type: "text/plain" }),
      { ...metadata(), expectedContentHash: ABC_HASH },
    );
    expect(record).toMatchObject({
      id: "asset-a",
      contentHash: ABC_HASH,
      blobKey: `sha256:${ABC_HASH}`,
      mimeType: "text/plain",
      byteSize: 3,
    });
    expect(JSON.stringify(record)).not.toContain("blob:");
    expect(await repository.getMetadata("asset-a")).toEqual(record);
    expect(await (await repository.getBlob("asset-a")).text()).toBe("abc");
    expect(storage.putCalls).toBe(1);
  });

  it("preserves the complete canonical provenance envelope", async () => {
    const storage = new MemoryAssetStorage();
    const repository = new IndexedDbAssetRepository("project-assets", {
      storage,
      runtimeUrlHost: createHost(),
    });
    const record = await repository.put(
      new Blob(["abc"], { type: "text/plain" }),
      {
        ...metadata(),
        provenance: {
          source: "derived",
          sourceId: "source-a",
          importedAt: "2026-07-14T00:30:00.000Z",
          note: "kept exactly",
          recipeId: "recipe-a",
          artifactId: "artifact-a",
          parentAssetId: "parent-a",
        },
      },
    );
    expect(record.provenance).toEqual({
      source: "derived",
      sourceId: "source-a",
      importedAt: "2026-07-14T00:30:00.000Z",
      note: "kept exactly",
      recipeId: "recipe-a",
      artifactId: "artifact-a",
      parentAssetId: "parent-a",
    });
  });

  it("rejects MIME/hash mismatches and invalid metadata before storage", async () => {
    const storage = new MemoryAssetStorage();
    const repository = new IndexedDbAssetRepository("project-assets", {
      storage,
      runtimeUrlHost: createHost(),
    });
    await expect(repository.put(
      new Blob(["abc"], { type: "text/plain" }),
      { ...metadata(), declaredMimeType: "image/png" },
    )).rejects.toMatchObject({ code: "ASSET_INTEGRITY_MISMATCH" });
    await expect(repository.put(
      new Blob(["abc"], { type: "text/plain" }),
      { ...metadata(), expectedContentHash: "0".repeat(64) },
    )).rejects.toMatchObject({ code: "ASSET_INTEGRITY_MISMATCH" });
    await expect(repository.put(
      new Blob(["abc"], { type: "text/plain" }),
      { ...metadata(), width: 0 },
    )).rejects.toMatchObject({ code: "ASSET_INVALID_INPUT" });
    expect(storage.putCalls).toBe(0);
  });

  it("aborts promptly when an injected identity provider never settles", async () => {
    const storage = new MemoryAssetStorage();
    let calls = 0;
    const repository = new IndexedDbAssetRepository("project-assets", {
      storage,
      runtimeUrlHost: createHost(),
      identityProvider: () => {
        calls += 1;
        return new Promise(() => undefined);
      },
    });
    const controller = new AbortController();
    const pending = repository.put(
      new Blob(["abc"], { type: "text/plain" }),
      metadata(),
      { signal: controller.signal },
    );
    for (let turn = 0; turn < 5 && calls < 1; turn += 1) await Promise.resolve();
    controller.abort("stop repository import");
    await expect(pending).rejects.toMatchObject({
      code: "ASSET_TRANSACTION_ABORTED",
      operation: "put",
      assetId: "asset-a",
    });
    expect(storage.putCalls).toBe(0);
  });

  it("dispose aborts an identity in flight before it can commit", async () => {
    const storage = new MemoryAssetStorage();
    const identity = await computeAssetContentIdentity(
      new Blob(["abc"], { type: "text/plain" }),
    );
    let resolveIdentity!: (value: AssetContentIdentity) => void;
    let providerCalls = 0;
    const repository = new IndexedDbAssetRepository("project-assets", {
      storage,
      runtimeUrlHost: createHost(),
      identityProvider: () => {
        providerCalls += 1;
        return new Promise((resolve) => { resolveIdentity = resolve; });
      },
    });
    const pending = repository.put(
      new Blob(["abc"], { type: "text/plain" }),
      metadata(),
    );
    for (let turn = 0; turn < 5 && providerCalls < 1; turn += 1) await Promise.resolve();
    repository.dispose();
    await expect(pending).rejects.toMatchObject({
      code: "ASSET_TRANSACTION_ABORTED",
      operation: "put",
    });
    resolveIdentity(identity);
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
    expect(storage.putCalls).toBe(0);
    expect(storage.closeCalls).toBe(1);
  });

  it("preserves the old record and URL when replace fails, then revokes after commit", async () => {
    const storage = new MemoryAssetStorage();
    const host = createHost();
    const repository = new IndexedDbAssetRepository("project-assets", {
      storage,
      runtimeUrlHost: host,
    });
    const oldRecord = await repository.put(
      new Blob(["old"], { type: "text/plain" }),
      metadata(),
    );
    const owner = {};
    const oldUrl = await repository.createRuntimeUrl("asset-a", owner);

    storage.failPut = true;
    await expect(repository.put(
      new Blob(["new"], { type: "text/plain" }),
      { ...metadata(), updatedAt: "2026-07-14T01:00:00.000Z" },
    )).rejects.toMatchObject({
      code: "ASSET_STORAGE_UNAVAILABLE",
      operation: "put",
    });
    expect(await repository.getMetadata("asset-a")).toEqual(oldRecord);
    expect(await repository.createRuntimeUrl("asset-a", owner)).toBe(oldUrl);
    expect(host.revokeObjectURL).not.toHaveBeenCalled();

    storage.failPut = false;
    const replacement = await repository.put(
      new Blob(["new"], { type: "text/plain" }),
      { ...metadata(), updatedAt: "2026-07-14T01:00:00.000Z" },
    );
    expect(replacement.contentHash).not.toBe(oldRecord.contentHash);
    expect(host.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(oldUrl);
    expect(await (await repository.getBlob("asset-a")).text()).toBe("new");
  });

  it("uses the previous record observed by the storage commit to invalidate URLs", async () => {
    const storage = new MemoryAssetStorage();
    const host = createHost();
    const repository = new IndexedDbAssetRepository("project-assets", {
      storage,
      runtimeUrlHost: host,
    });
    const original = await repository.put(
      new Blob(["old"], { type: "text/plain" }),
      metadata(),
    );
    const concurrentRecord = {
      ...original,
      blobKey: `sha256:${"f".repeat(64)}`,
      contentHash: "f".repeat(64),
      byteSize: 12,
    };
    storage.records.set("asset-a", concurrentRecord);
    storage.blobs.set("asset-a", new Blob(["intermediate"], { type: "text/plain" }));
    const owner = {};
    const intermediateUrl = await repository.createRuntimeUrl("asset-a", owner);

    await repository.put(
      new Blob(["old"], { type: "text/plain" }),
      { ...metadata(), updatedAt: "2026-07-14T02:00:00.000Z" },
    );
    expect(host.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(intermediateUrl);
  });

  it("invalidates a live URL when identical bytes change MIME wrapper", async () => {
    const storage = new MemoryAssetStorage();
    const host = createHost();
    const repository = new IndexedDbAssetRepository("project-assets", {
      storage,
      runtimeUrlHost: host,
    });
    await repository.put(new Blob(["abc"], { type: "text/plain" }), metadata());
    const owner = {};
    const oldUrl = await repository.createRuntimeUrl("asset-a", owner);
    const replacement = await repository.put(
      new Blob(["abc"], { type: "application/octet-stream" }),
      {
        ...metadata(),
        declaredMimeType: "application/octet-stream",
        updatedAt: "2026-07-14T03:00:00.000Z",
      },
    );
    expect(replacement.contentHash).toBe(ABC_HASH);
    expect(replacement.mimeType).toBe("application/octet-stream");
    expect(host.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(oldUrl);
  });

  it("enforces removal policy and preserves leases when durable removal fails", async () => {
    const storage = new MemoryAssetStorage();
    const host = createHost();
    const repository = new IndexedDbAssetRepository("project-assets", {
      storage,
      runtimeUrlHost: host,
    });
    await repository.put(new Blob(["abc"], { type: "text/plain" }), metadata());
    const owner = {};
    const url = await repository.createRuntimeUrl("asset-a", owner);

    await expect(repository.remove("asset-a", "reject-if-leased"))
      .rejects.toMatchObject({ code: "ASSET_LEASE_CONFLICT", operation: "remove" });
    expect(storage.removeCalls).toBe(0);

    storage.failRemove = true;
    await expect(repository.remove("asset-a", "release-and-remove"))
      .rejects.toMatchObject({ code: "ASSET_STORAGE_UNAVAILABLE", operation: "remove" });
    expect(await repository.createRuntimeUrl("asset-a", owner)).toBe(url);
    expect(host.revokeObjectURL).not.toHaveBeenCalled();

    storage.failRemove = false;
    await repository.remove("asset-a", "release-and-remove");
    expect(host.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(url);
    await expect(repository.getMetadata("asset-a")).rejects.toMatchObject({
      code: "ASSET_NOT_FOUND",
    });
  });

  it("blocks new URL leases for the entire reject-if-leased removal window", async () => {
    const storage = new MemoryAssetStorage();
    let resolveRemove!: () => void;
    storage.removeBarrier = new Promise((resolve) => { resolveRemove = resolve; });
    const repository = new IndexedDbAssetRepository("project-assets", {
      storage,
      runtimeUrlHost: createHost(),
    });
    await repository.put(new Blob(["abc"], { type: "text/plain" }), metadata());
    const removing = repository.remove("asset-a", "reject-if-leased");
    for (let turn = 0; turn < 5 && storage.removeCalls < 1; turn += 1) await Promise.resolve();
    await expect(repository.createRuntimeUrl("asset-a", {})).rejects.toMatchObject({
      code: "ASSET_LEASE_CONFLICT",
      operation: "create-url",
    });
    resolveRemove();
    await expect(removing).resolves.toBeUndefined();
  });

  it("contains hostile metadata accessors without invoking them", async () => {
    const storage = new MemoryAssetStorage();
    const repository = new IndexedDbAssetRepository("project-assets", {
      storage,
      runtimeUrlHost: createHost(),
    });
    let reads = 0;
    const hostile = { ...metadata() };
    Object.defineProperty(hostile, "name", {
      enumerable: true,
      get() {
        reads += 1;
        return "Hostile";
      },
    });
    await expect(repository.put(
      new Blob(["abc"], { type: "text/plain" }),
      hostile,
    )).rejects.toMatchObject({ code: "ASSET_INVALID_INPUT" });
    expect(reads).toBe(0);
    expect(storage.putCalls).toBe(0);
  });

  it("reports integrity states without throwing for absent metadata/blob", async () => {
    const storage = new MemoryAssetStorage();
    const repository = new IndexedDbAssetRepository("project-assets", {
      storage,
      runtimeUrlHost: createHost(),
    });
    expect(await repository.verify("missing")).toEqual({
      assetId: "missing",
      status: "metadata-missing",
    });
    const record = await repository.put(new Blob(["abc"], { type: "text/plain" }), metadata());
    storage.blobs.delete("asset-a");
    expect(await repository.verify("asset-a")).toMatchObject({
      status: "blob-missing",
      expectedHash: record.contentHash,
    });
    storage.blobs.set("asset-a", new Blob(["changed"], { type: "text/plain" }));
    expect(await repository.verify("asset-a")).toMatchObject({ status: "size-mismatch" });
  });

  it("exports in requested order and stops at an abort boundary", async () => {
    const storage = new MemoryAssetStorage();
    const repository = new IndexedDbAssetRepository("project-assets", {
      storage,
      runtimeUrlHost: createHost(),
    });
    await repository.put(new Blob(["a"], { type: "text/plain" }), metadata("asset-a"));
    await repository.put(new Blob(["b"], { type: "text/plain" }), metadata("asset-b"));
    const controller = new AbortController();
    const iterator = repository.exportMany(["asset-b", "asset-a"], {
      signal: controller.signal,
    })[Symbol.asyncIterator]();
    expect((await iterator.next()).value?.record.id).toBe("asset-b");
    controller.abort("stop export");
    await expect(iterator.next()).rejects.toMatchObject({
      code: "ASSET_TRANSACTION_ABORTED",
      operation: "export",
      assetId: "asset-a",
    });
  });

  it("disposes URLs/storage once and rejects later operations", async () => {
    const storage = new MemoryAssetStorage();
    const host = createHost();
    const repository = new IndexedDbAssetRepository("project-assets", {
      storage,
      runtimeUrlHost: host,
    });
    await repository.put(new Blob(["abc"], { type: "text/plain" }), metadata());
    await repository.createRuntimeUrl("asset-a", {});
    repository.dispose();
    repository.dispose();
    expect(storage.closeCalls).toBe(1);
    expect(host.revokeObjectURL).toHaveBeenCalledTimes(1);
    await expect(repository.list()).rejects.toMatchObject({
      code: "ASSET_STORAGE_UNAVAILABLE",
      recoverable: false,
    });
  });
});
