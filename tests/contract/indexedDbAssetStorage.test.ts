import { describe, expect, it } from "vitest";
import {
  AssetRepositoryError,
  IndexedDbAssetStorage,
} from "../../core/assets";
import type { AssetRecord } from "../../core/project";

const record: AssetRecord = {
  id: "asset-storage",
  name: "Storage asset",
  blobKey: "sha256:storage",
  contentHash: "storage",
  mimeType: "image/png",
  width: 8,
  height: 8,
  byteSize: 4,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  provenance: { source: "fixture" },
};

describe("IndexedDbAssetStorage preflight (F2-02)", () => {
  it("reports storage unavailable instead of throwing adapter strings when IndexedDB is absent", async () => {
    const storage = new IndexedDbAssetStorage("project-storage", { factory: null });
    await expect(storage.list()).rejects.toMatchObject({
      code: "ASSET_STORAGE_UNAVAILABLE",
      operation: "open",
      recoverable: true,
    });
  });

  it("rejects pre-aborted work before opening a database", async () => {
    const controller = new AbortController();
    controller.abort("test abort");
    const factory = {
      open() {
        throw new Error("must not open");
      },
    } as unknown as IDBFactory;
    const storage = new IndexedDbAssetStorage("project-storage", { factory });
    await expect(storage.put(record, new Blob(["test"]), { signal: controller.signal }))
      .rejects.toMatchObject({
        code: "ASSET_TRANSACTION_ABORTED",
        operation: "put",
        assetId: "asset-storage",
      });
  });

  it("rejects invalid IDs and non-Blob payloads before touching IndexedDB", async () => {
    const factory = {
      open() {
        throw new Error("must not open");
      },
    } as unknown as IDBFactory;
    expect(() => new IndexedDbAssetStorage("", { factory })).toThrow(AssetRepositoryError);
    const storage = new IndexedDbAssetStorage("project-storage", { factory });
    await expect(storage.put({ ...record, blobKey: "" }, new Blob()))
      .rejects.toMatchObject({ code: "ASSET_INVALID_INPUT" });
    await expect(storage.put(record, {} as Blob))
      .rejects.toMatchObject({ code: "ASSET_INVALID_INPUT" });
  });

  it("invalidates and closes a connection that succeeds after close()", async () => {
    const request = {} as IDBOpenDBRequest;
    let closeCalls = 0;
    const database = {
      close() {
        closeCalls += 1;
      },
    } as unknown as IDBDatabase;
    const factory = {
      open() {
        return request;
      },
    } as unknown as IDBFactory;
    const storage = new IndexedDbAssetStorage("project-storage", { factory });
    const pending = storage.list();
    storage.close();
    Object.defineProperty(request, "result", { configurable: true, value: database });
    (request.onsuccess as unknown as (() => void))();
    await expect(pending).rejects.toMatchObject({
      code: "ASSET_TRANSACTION_ABORTED",
      operation: "open",
    });
    expect(closeCalls).toBe(1);
  });

  it("waits for a blocked delete request to reach a terminal event", async () => {
    const request = {} as IDBOpenDBRequest;
    const factory = {
      deleteDatabase() {
        return request;
      },
    } as unknown as IDBFactory;
    const storage = new IndexedDbAssetStorage("project-storage", { factory });
    let settled = false;
    const pending = storage.destroy().then(
      () => { settled = true; },
      () => { settled = true; },
    );
    (request.onblocked as unknown as (() => void))();
    await Promise.resolve();
    expect(settled).toBe(false);
    (request.onsuccess as unknown as (() => void))();
    await pending;
    expect(settled).toBe(true);
  });

  it("types structural transaction failures as storage-unavailable", async () => {
    const request = {} as IDBOpenDBRequest;
    const database = {
      close() {},
      transaction() {
        throw new DOMException("missing store", "NotFoundError");
      },
    } as unknown as IDBDatabase;
    const factory = {
      open() {
        queueMicrotask(() => {
          Object.defineProperty(request, "result", { configurable: true, value: database });
          (request.onsuccess as unknown as (() => void))();
        });
        return request;
      },
    } as unknown as IDBFactory;
    const storage = new IndexedDbAssetStorage("project-storage", { factory });
    await expect(storage.list()).rejects.toMatchObject({
      code: "ASSET_STORAGE_UNAVAILABLE",
      operation: "list",
    });
  });

  it("does not settle a failed transaction before its terminal abort event", async () => {
    const openRequest = {} as IDBOpenDBRequest;
    const listRequest = {} as IDBRequest<unknown[]>;
    const transaction = {
      error: null,
      abort() {},
      objectStore() {
        return {
          index() {
            return { getAll: () => listRequest };
          },
        };
      },
    } as unknown as IDBTransaction;
    const database = {
      close() {},
      transaction: () => transaction,
    } as unknown as IDBDatabase;
    const factory = {
      open() {
        queueMicrotask(() => {
          Object.defineProperty(openRequest, "result", { configurable: true, value: database });
          (openRequest.onsuccess as unknown as (() => void))();
        });
        return openRequest;
      },
    } as unknown as IDBFactory;
    const storage = new IndexedDbAssetStorage("project-storage", { factory });
    let settled = false;
    const pending = storage.list();
    pending.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    for (let turn = 0; turn < 5 && typeof transaction.onerror !== "function"; turn += 1) {
      await Promise.resolve();
    }
    expect(typeof transaction.onerror).toBe("function");
    Object.defineProperty(transaction, "error", {
      configurable: true,
      value: new DOMException("request failed", "UnknownError"),
    });
    (transaction.onerror as unknown as (() => void))();
    await Promise.resolve();
    expect(settled).toBe(false);
    (transaction.onabort as unknown as (() => void))();
    await expect(pending).rejects.toMatchObject({ code: "ASSET_STORAGE_UNAVAILABLE" });
  });

  it("contains missing remove indices inside request callbacks", async () => {
    const openRequest = {} as IDBOpenDBRequest;
    const metadataRequest = {} as IDBRequest<unknown>;
    const metadataStore = {
      get: () => metadataRequest,
      delete() {},
      index() {
        throw new DOMException("missing index", "NotFoundError");
      },
    } as unknown as IDBObjectStore;
    const transaction = {
      error: null,
      objectStore(name: string) {
        if (name === "asset-metadata") return metadataStore;
        return { delete() {} } as unknown as IDBObjectStore;
      },
      abort() {
        queueMicrotask(() => (transaction.onabort as unknown as (() => void))());
      },
    } as unknown as IDBTransaction;
    const database = {
      close() {},
      transaction: () => transaction,
    } as unknown as IDBDatabase;
    const factory = {
      open() {
        queueMicrotask(() => {
          Object.defineProperty(openRequest, "result", { configurable: true, value: database });
          (openRequest.onsuccess as unknown as (() => void))();
        });
        return openRequest;
      },
    } as unknown as IDBFactory;
    const storage = new IndexedDbAssetStorage("project-storage", { factory });
    const pending = storage.remove("asset-storage");
    for (let turn = 0; turn < 5 && typeof metadataRequest.onsuccess !== "function"; turn += 1) {
      await Promise.resolve();
    }
    Object.defineProperty(metadataRequest, "result", {
      configurable: true,
      value: {
        projectId: "project-storage",
        assetId: "asset-storage",
        blobKey: "sha256:storage",
        contentHash: "storage",
        record,
      },
    });
    (metadataRequest.onsuccess as unknown as (() => void))();
    await expect(pending).rejects.toMatchObject({
      code: "ASSET_STORAGE_UNAVAILABLE",
      operation: "remove",
      assetId: "asset-storage",
    });
  });
});
