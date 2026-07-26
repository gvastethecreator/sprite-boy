import { describe, expect, it } from "vitest";
import {
  ASSET_BLOB_KEY_INDEX,
  ASSET_METADATA_STORE,
  ASSET_PROJECT_INDEX,
  IndexedDbAssetStorage,
  computeAssetContentIdentity,
  type StoredAssetBlobEntry,
  type StoredAssetMetadataEntry,
} from "../../core/assets";
import type { AssetRecord } from "../../core/project";

interface AssetIdbHarness {
  readonly factory: IDBFactory;
  readonly metadata: Map<string, StoredAssetMetadataEntry>;
  readonly blobs: Map<string, StoredAssetBlobEntry>;
  readonly transactions: Array<{ readonly stores: readonly string[]; readonly mode: IDBTransactionMode }>;
}

function metadataMapKey(projectId: string, assetId: string): string {
  return `${projectId}\u0000${assetId}`;
}

function createAssetIdbHarness(): AssetIdbHarness {
  const metadata = new Map<string, StoredAssetMetadataEntry>();
  const blobs = new Map<string, StoredAssetBlobEntry>();
  const transactions: Array<{ stores: readonly string[]; mode: IDBTransactionMode }> = [];

  const database = {
    objectStoreNames: { contains: () => true },
    onversionchange: null as (() => void) | null,
    close() {},
    transaction(storeNames: string | string[], mode: IDBTransactionMode) {
      const stores = typeof storeNames === "string" ? [storeNames] : [...storeNames];
      transactions.push({ stores, mode });
      const metadataWork = new Map(metadata);
      const blobWork = new Map(blobs);
      let pending = 0;
      let aborted = false;
      let completionVersion = 0;

      const transaction = {
        error: null as DOMException | null,
        oncomplete: null as (() => void) | null,
        onabort: null as (() => void) | null,
        onerror: null as (() => void) | null,
        abort() {
          if (aborted) throw new DOMException("already aborted", "InvalidStateError");
          aborted = true;
          completionVersion += 1;
          queueMicrotask(() => transaction.onabort?.());
        },
        objectStore(storeName: string) {
          const isMetadata = storeName === ASSET_METADATA_STORE;
          const work = isMetadata ? metadataWork : blobWork;
          const keyFor = (value: StoredAssetMetadataEntry | StoredAssetBlobEntry): string => isMetadata
            ? metadataMapKey(
                (value as StoredAssetMetadataEntry).projectId,
                (value as StoredAssetMetadataEntry).assetId,
              )
            : (value as StoredAssetBlobEntry).blobKey;
          const normalizeKey = (key: IDBValidKey): string => isMetadata
            ? metadataMapKey(String((key as IDBValidKey[])[0]), String((key as IDBValidKey[])[1]))
            : String(key);
          const request = <T>(operation: () => T): IDBRequest<T> => {
            const result = {
              result: undefined as T,
              error: null as DOMException | null,
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null,
            };
            pending += 1;
            completionVersion += 1;
            queueMicrotask(() => {
              if (aborted) return;
              try {
                result.result = operation();
                result.onsuccess?.();
              } catch (error) {
                result.error = error as DOMException;
                transaction.error = result.error;
                result.onerror?.();
                if (!aborted) transaction.abort();
              } finally {
                pending -= 1;
                scheduleCompletion();
              }
            });
            return result as unknown as IDBRequest<T>;
          };
          const api = {
            get(key: IDBValidKey) {
              return request(() => work.get(normalizeKey(key)));
            },
            getAll() {
              return request(() => [...work.values()]);
            },
            add(value: StoredAssetMetadataEntry | StoredAssetBlobEntry) {
              return request(() => {
                const key = keyFor(value);
                if (work.has(key)) throw new DOMException("duplicate", "ConstraintError");
                work.set(key, value as never);
                return key;
              });
            },
            put(value: StoredAssetMetadataEntry | StoredAssetBlobEntry) {
              return request(() => {
                const key = keyFor(value);
                work.set(key, value as never);
                return key;
              });
            },
            delete(key: IDBValidKey) {
              return request(() => {
                work.delete(normalizeKey(key));
                return undefined;
              });
            },
            index(indexName: string) {
              return {
                getAll(query: IDBValidKey) {
                  return request(() => {
                    const entries = [...metadataWork.values()];
                    if (indexName === ASSET_PROJECT_INDEX) {
                      return entries.filter((entry) => entry.projectId === query);
                    }
                    return [];
                  });
                },
                count(query: IDBValidKey) {
                  return request(() => indexName === ASSET_BLOB_KEY_INDEX
                    ? [...metadataWork.values()].filter((entry) => entry.blobKey === query).length
                    : 0);
                },
              };
            },
          };
          return api;
        },
      };

      const scheduleCompletion = (): void => {
        if (aborted || pending !== 0) return;
        const version = ++completionVersion;
        queueMicrotask(() => {
          if (aborted || pending !== 0 || version !== completionVersion) return;
          if (mode === "readwrite") {
            metadata.clear();
            metadataWork.forEach((value, key) => metadata.set(key, value));
            blobs.clear();
            blobWork.forEach((value, key) => blobs.set(key, value));
          }
          transaction.oncomplete?.();
        });
      };
      scheduleCompletion();
      return transaction as unknown as IDBTransaction;
    },
  };

  const factory = {
    open() {
      const request = {
        result: database,
        transaction: null,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onblocked: null as (() => void) | null,
        error: null,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request as unknown as IDBOpenDBRequest;
    },
    deleteDatabase() {
      const request = {
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onblocked: null as (() => void) | null,
        error: null,
      };
      queueMicrotask(() => {
        metadata.clear();
        blobs.clear();
        request.onsuccess?.();
      });
      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;

  return { factory, metadata, blobs, transactions };
}

async function assetRecord(
  id: string,
  blob: Blob,
  mimeType = blob.type || "application/octet-stream",
): Promise<{ readonly identity: Awaited<ReturnType<typeof computeAssetContentIdentity>>; readonly record: AssetRecord }> {
  const identity = await computeAssetContentIdentity(blob);
  return {
    identity,
    record: {
      id,
      name: id,
      blobKey: identity.blobKey,
      contentHash: identity.contentHash,
      mimeType,
      media: mimeType.startsWith("image/") ? { type: "image" } : { type: "binary" },
      width: 8,
      height: 8,
      byteSize: identity.byteSize,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      provenance: { source: "test" },
    },
  };
}

describe("IndexedDbAssetStorage full lifecycle", () => {
  it("persists, deduplicates, replaces, filters and removes project assets atomically", async () => {
    const harness = createAssetIdbHarness();
    const storage = new IndexedDbAssetStorage("project-lifecycle", { factory: harness.factory });
    const firstBlob = new Blob(["first"], { type: "image/png" });
    const first = await assetRecord("asset-a", firstBlob);

    await expect(storage.put(first.record, firstBlob, undefined, first.identity)).resolves.toEqual({
      current: first.record,
      replacedBinary: false,
      removedPreviousBlob: false,
    });
    await expect(storage.getMetadata("asset-a")).resolves.toEqual(first.record);
    const restored = await storage.getBlob("asset-a");
    expect(restored.type).toBe("image/png");
    expect(await restored.text()).toBe("first");
    await expect(storage.list()).resolves.toEqual([first.record]);
    await expect(storage.list({ contentHash: "different" })).resolves.toEqual([]);

    const duplicate = { ...first.record, id: "asset-b", name: "asset-b" };
    await expect(storage.put(duplicate, firstBlob, undefined, first.identity)).resolves.toEqual({
      current: duplicate,
      replacedBinary: false,
      removedPreviousBlob: false,
    });
    expect((await storage.inspect()).metadataEntries).toHaveLength(2);
    expect((await storage.inspect()).blobEntries).toHaveLength(1);

    await expect(storage.remove("asset-a")).resolves.toEqual({
      assetId: "asset-a",
      blobKey: first.identity.blobKey,
      removedBlob: false,
    });
    const secondBlob = new Blob(["second"], { type: "image/png" });
    const second = await assetRecord("asset-b", secondBlob);
    await expect(storage.put(second.record, secondBlob)).resolves.toEqual({
      current: second.record,
      previous: duplicate,
      replacedBinary: true,
      removedPreviousBlob: true,
    });
    expect((await storage.inspect()).blobEntries.map((entry) => entry.blobKey)).toEqual([
      second.identity.blobKey,
    ]);
    await expect(storage.remove("asset-b")).resolves.toEqual({
      assetId: "asset-b",
      blobKey: second.identity.blobKey,
      removedBlob: true,
    });
    await expect(storage.list()).resolves.toEqual([]);
    await expect(storage.getMetadata("asset-b")).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
    await expect(storage.getBlob("asset-b")).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
    await expect(storage.remove("asset-b")).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });

    expect(harness.transactions.some(({ mode }) => mode === "readwrite")).toBe(true);
    await storage.destroy();
    expect(harness.metadata.size).toBe(0);
    expect(harness.blobs.size).toBe(0);
  });

  it("verifies and backfills a legacy blob identity before publishing metadata", async () => {
    const harness = createAssetIdbHarness();
    const storage = new IndexedDbAssetStorage("project-legacy", { factory: harness.factory });
    const blob = new Blob(["legacy"], { type: "image/png" });
    const value = await assetRecord("asset-legacy", blob);
    harness.blobs.set(value.identity.blobKey, {
      blobKey: value.identity.blobKey,
      blob,
    });

    await expect(storage.put(value.record, blob, undefined, value.identity)).resolves.toEqual({
      current: value.record,
      replacedBinary: false,
      removedPreviousBlob: false,
    });
    expect(harness.blobs.get(value.identity.blobKey)).toMatchObject({
      contentHash: value.identity.contentHash,
      verificationHash: value.identity.verificationHash,
      byteSize: value.identity.byteSize,
    });
  });

  it.each(["incomplete", "invalid", "collision", "missing-blob"] as const)(
    "preserves stored bytes when their identity is %s",
    async (kind) => {
      const harness = createAssetIdbHarness();
      const storage = new IndexedDbAssetStorage("project-collision", { factory: harness.factory });
      const blob = new Blob(["collision"], { type: "image/png" });
      const value = await assetRecord("asset-collision", blob);
      const stored: StoredAssetBlobEntry = {
        blobKey: value.identity.blobKey,
        contentHash: value.identity.contentHash,
        verificationHash: value.identity.verificationHash,
        byteSize: value.identity.byteSize,
        blob,
      };
      if (kind === "incomplete") delete stored.verificationHash;
      if (kind === "invalid") stored.contentHash = "invalid";
      if (kind === "collision") stored.verificationHash = "0".repeat(128);
      if (kind === "missing-blob") (stored as { blob: unknown }).blob = null;
      if (kind === "missing-blob") {
        delete stored.contentHash;
        delete stored.verificationHash;
        delete stored.byteSize;
      }
      harness.blobs.set(value.identity.blobKey, stored);

      await expect(storage.put(value.record, blob, undefined, value.identity)).rejects.toMatchObject({
        code: "ASSET_INTEGRITY_MISMATCH",
        operation: "put",
        assetId: value.record.id,
      });
      expect(harness.blobs.get(value.identity.blobKey)).toBe(stored);
      expect(harness.metadata.size).toBe(0);
    },
  );

  it("reports corrupt metadata, missing blobs and repairs a stored MIME view", async () => {
    const harness = createAssetIdbHarness();
    const storage = new IndexedDbAssetStorage("project-read-health", { factory: harness.factory });
    const blob = new Blob(["healthy"], { type: "image/png" });
    const value = await assetRecord("asset-health", blob);
    await storage.put(value.record, blob, undefined, value.identity);

    const metadataKey = metadataMapKey("project-read-health", value.record.id);
    const entry = harness.metadata.get(metadataKey)!;
    harness.metadata.set(metadataKey, {
      ...entry,
      record: { ...entry.record, media: { type: "binary" } },
    });
    await expect(storage.getMetadata(value.record.id)).rejects.toMatchObject({
      code: "ASSET_INTEGRITY_MISMATCH",
      operation: "get-metadata",
    });
    await expect(storage.list()).rejects.toMatchObject({
      code: "ASSET_INTEGRITY_MISMATCH",
      operation: "list",
    });

    harness.metadata.set(metadataKey, entry);
    harness.blobs.delete(value.identity.blobKey);
    await expect(storage.getBlob(value.record.id)).rejects.toMatchObject({
      code: "ASSET_BLOB_MISSING",
      operation: "get-blob",
    });

    harness.blobs.set(value.identity.blobKey, {
      blobKey: value.identity.blobKey,
      contentHash: value.identity.contentHash,
      verificationHash: value.identity.verificationHash,
      byteSize: value.identity.byteSize,
      blob: new Blob(["healthy"], { type: "application/octet-stream" }),
    });
    const restored = await storage.getBlob(value.record.id);
    expect(restored.type).toBe("image/png");
    expect(await restored.text()).toBe("healthy");
  });

  it("aborts an in-flight readonly transaction through the caller signal", async () => {
    const harness = createAssetIdbHarness();
    const storage = new IndexedDbAssetStorage("project-abort", { factory: harness.factory });
    const controller = new AbortController();
    const pending = storage.list({ signal: controller.signal });
    for (let turn = 0; turn < 10 && harness.transactions.length === 0; turn += 1) {
      await Promise.resolve();
    }
    expect(harness.transactions).toHaveLength(1);
    controller.abort("stop inventory");

    await expect(pending).rejects.toMatchObject({
      code: "ASSET_TRANSACTION_ABORTED",
      operation: "list",
    });
  });

  it("keeps shared old bytes when replacing one of two metadata owners", async () => {
    const harness = createAssetIdbHarness();
    const storage = new IndexedDbAssetStorage("project-shared", { factory: harness.factory });
    const sharedBlob = new Blob(["shared"], { type: "image/png" });
    const first = await assetRecord("asset-a", sharedBlob);
    const secondRecord = { ...first.record, id: "asset-b", name: "asset-b" };
    await storage.put(first.record, sharedBlob, undefined, first.identity);
    await storage.put(secondRecord, sharedBlob, undefined, first.identity);

    const replacementBlob = new Blob(["replacement"], { type: "image/png" });
    const replacement = await assetRecord("asset-a", replacementBlob);
    await expect(storage.put(replacement.record, replacementBlob, undefined, replacement.identity))
      .resolves.toMatchObject({
        current: replacement.record,
        previous: first.record,
        replacedBinary: true,
        removedPreviousBlob: false,
      });
    expect(harness.blobs.has(first.identity.blobKey)).toBe(true);
    expect(harness.blobs.has(replacement.identity.blobKey)).toBe(true);
  });
});
