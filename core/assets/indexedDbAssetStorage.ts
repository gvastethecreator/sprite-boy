import type { AssetRecord, EntityId } from "../project/schema";
import { isEntityId } from "../project/primitives";
import {
  AssetRepositoryError,
  awaitAbortableAssetOperation,
  isAssetRepositoryError,
  normalizeAssetRepositoryError,
} from "./contracts";
import type {
  AssetOperationOptions,
  AssetRepositoryOperation,
} from "./contracts";
import {
  assertAssetRecordContentIdentity,
  assertNoAssetContentCollision,
  computeAssetContentIdentity,
  validateAssetContentIdentity,
} from "./contentIdentity";
import type {
  AssetContentIdentity,
  AssetContentIdentityProvider,
} from "./contentIdentity";

export const ASSET_DATABASE_NAME = "sprite-boy-studio-assets";
export const ASSET_DATABASE_VERSION = 2;
export const ASSET_METADATA_STORE = "asset-metadata";
export const ASSET_BLOB_STORE = "asset-blobs";
export const ASSET_PROJECT_INDEX = "by-project";
export const ASSET_PROJECT_HASH_INDEX = "by-project-content-hash";
export const ASSET_BLOB_KEY_INDEX = "by-blob-key";

export interface StoredAssetMetadataEntry {
  projectId: EntityId;
  assetId: EntityId;
  contentHash: string;
  blobKey: string;
  record: AssetRecord;
}

export interface StoredAssetBlobEntry {
  blobKey: string;
  /** Added in database v2; absent entries are verified and backfilled on put. */
  contentHash?: string;
  verificationHash?: string;
  byteSize?: number;
  blob: Blob;
}

export interface IndexedDbAssetStorageOptions {
  databaseName?: string;
  factory?: IDBFactory | null;
  identityProvider?: AssetContentIdentityProvider;
}

export interface AssetStorageListOptions extends AssetOperationOptions {
  contentHash?: string;
}

export interface AssetStorageRemoval {
  assetId: EntityId;
  blobKey: string;
  removedBlob: boolean;
}

interface TransactionMonitor<T> {
  promise: Promise<T>;
  setResult(value: T): void;
  fail(error: AssetRepositoryError): void;
}

function abortedError(
  operation: AssetRepositoryOperation,
  assetId: EntityId | undefined,
  cause?: unknown,
): AssetRepositoryError {
  return new AssetRepositoryError(
    "ASSET_TRANSACTION_ABORTED",
    `Asset repository ${operation} was aborted${assetId ? ` for ${assetId}` : ""}.`,
    { operation, assetId, cause },
  );
}

function invalidInput(
  operation: AssetRepositoryOperation,
  message: string,
  assetId?: EntityId,
): AssetRepositoryError {
  return new AssetRepositoryError("ASSET_INVALID_INPUT", message, {
    operation,
    assetId,
  });
}

function structuralStorageError(
  operation: AssetRepositoryOperation,
  error: unknown,
  assetId?: EntityId,
): AssetRepositoryError {
  if (error instanceof AssetRepositoryError) return error;
  return new AssetRepositoryError(
    "ASSET_STORAGE_UNAVAILABLE",
    `Asset database schema is unavailable during ${operation}${assetId ? ` for ${assetId}` : ""}.`,
    { operation, assetId, cause: error },
  );
}

function createTransaction(
  database: IDBDatabase,
  storeNames: string | string[],
  mode: IDBTransactionMode,
  operation: AssetRepositoryOperation,
  assetId?: EntityId,
): IDBTransaction {
  try {
    return database.transaction(storeNames, mode);
  } catch (error) {
    throw structuralStorageError(operation, error, assetId);
  }
}

function throwIfAborted(
  options: AssetOperationOptions | undefined,
  operation: AssetRepositoryOperation,
  assetId?: EntityId,
): void {
  if (options?.signal?.aborted) throw abortedError(operation, assetId, options.signal.reason);
}

function monitorTransaction<T>(
  transaction: IDBTransaction,
  operation: AssetRepositoryOperation,
  assetId: EntityId | undefined,
  options: AssetOperationOptions | undefined,
  defaultResult: T,
): TransactionMonitor<T> {
  let result = defaultResult;
  let customError: AssetRepositoryError | undefined;
  let observedError: DOMException | null = null;
  let settled = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const signal = options?.signal;
  const cleanup = (): void => signal?.removeEventListener("abort", onSignalAbort);
  const rejectOnce = (error: unknown): void => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectPromise(error);
  };
  const onSignalAbort = (): void => {
    customError = abortedError(operation, assetId, signal?.reason);
    try {
      transaction.abort();
    } catch {
      rejectOnce(customError);
    }
  };
  transaction.oncomplete = () => {
    if (settled) return;
    if (customError || observedError) {
      rejectOnce(
        customError ?? normalizeAssetRepositoryError(observedError, { operation, assetId }),
      );
      return;
    }
    settled = true;
    cleanup();
    resolvePromise(result);
  };
  transaction.onabort = () => {
    rejectOnce(
      customError ?? normalizeAssetRepositoryError(transaction.error ?? observedError, { operation, assetId }),
    );
  };
  transaction.onerror = () => {
    observedError = transaction.error;
  };
  signal?.addEventListener("abort", onSignalAbort, { once: true });
  if (signal?.aborted) onSignalAbort();
  return {
    promise,
    setResult(value) {
      result = value;
    },
    fail(error) {
      customError = error;
      try {
        transaction.abort();
      } catch {
        rejectOnce(error);
      }
    },
  };
}

function validatePutInput(projectId: EntityId, record: AssetRecord, blob: Blob): void {
  if (!isEntityId(projectId)) throw invalidInput("put", "Project id must be a non-empty string.");
  if (!isEntityId(record?.id)) throw invalidInput("put", "Asset id must be a non-empty string.");
  if (!isEntityId(record.blobKey)) {
    throw invalidInput("put", "Asset blobKey must be a non-empty string.", record.id);
  }
  if (!(blob instanceof Blob)) throw invalidInput("put", "Asset payload must be a Blob.", record.id);
}

function metadataKey(projectId: EntityId, assetId: EntityId): [EntityId, EntityId] {
  return [projectId, assetId];
}

function storedContentIdentity(
  stored: StoredAssetBlobEntry,
  assetId: EntityId,
): AssetContentIdentity | undefined {
  const fields = [stored.contentHash, stored.verificationHash, stored.byteSize];
  if (fields.every((value) => value === undefined)) return undefined;
  if (fields.some((value) => value === undefined)) {
    throw new AssetRepositoryError(
      "ASSET_INTEGRITY_MISMATCH",
      "Stored asset identity is incomplete; existing bytes were preserved.",
      { operation: "put", assetId },
    );
  }
  try {
    return validateAssetContentIdentity({
      blobKey: stored.blobKey,
      contentHash: stored.contentHash,
      verificationHash: stored.verificationHash,
      byteSize: stored.byteSize,
    }, { operation: "put", assetId });
  } catch (cause) {
    throw new AssetRepositoryError(
      "ASSET_INTEGRITY_MISMATCH",
      "Stored asset identity is invalid; existing bytes were preserved.",
      { operation: "put", assetId, cause },
    );
  }
}

/**
 * Project-scoped IndexedDB storage primitive. It persists metadata and blobs in
 * one transaction, while keeping blobs keyed independently for later hash
 * deduplication and garbage-collection previews.
 */
export class IndexedDbAssetStorage {
  readonly projectId: EntityId;
  readonly databaseName: string;
  private readonly factory: IDBFactory | null;
  private readonly identityProvider: AssetContentIdentityProvider;
  private databasePromise?: Promise<IDBDatabase>;
  private database?: IDBDatabase;
  private openGeneration = 0;

  constructor(projectId: EntityId, options: IndexedDbAssetStorageOptions = {}) {
    if (!isEntityId(projectId)) throw invalidInput("open", "Project id must be a non-empty string.");
    this.projectId = projectId;
    this.databaseName = options.databaseName ?? ASSET_DATABASE_NAME;
    this.factory = options.factory === undefined
      ? (typeof indexedDB === "undefined" ? null : indexedDB)
      : options.factory;
    this.identityProvider = options.identityProvider ?? computeAssetContentIdentity;
  }

  private getDatabase(): Promise<IDBDatabase> {
    if (this.database) return Promise.resolve(this.database);
    if (this.databasePromise) return this.databasePromise;
    if (!this.factory) {
      return Promise.reject(new AssetRepositoryError(
        "ASSET_STORAGE_UNAVAILABLE",
        "IndexedDB is unavailable in this environment.",
        { operation: "open" },
      ));
    }
    const generation = this.openGeneration;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      let settled = false;
      const rejectOnce = (error: unknown): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      try {
        request = this.factory!.open(this.databaseName, ASSET_DATABASE_VERSION);
      } catch (error) {
        rejectOnce(normalizeAssetRepositoryError(error, { operation: "open" }));
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        const transaction = request.transaction;
        if (!transaction) return;
        const metadataStore = database.objectStoreNames.contains(ASSET_METADATA_STORE)
          ? transaction.objectStore(ASSET_METADATA_STORE)
          : database.createObjectStore(ASSET_METADATA_STORE, {
              keyPath: ["projectId", "assetId"],
            });
        if (!metadataStore.indexNames.contains(ASSET_PROJECT_INDEX)) {
          metadataStore.createIndex(ASSET_PROJECT_INDEX, "projectId", { unique: false });
        }
        if (!metadataStore.indexNames.contains(ASSET_PROJECT_HASH_INDEX)) {
          metadataStore.createIndex(
            ASSET_PROJECT_HASH_INDEX,
            ["projectId", "contentHash"],
            { unique: false },
          );
        }
        if (!metadataStore.indexNames.contains(ASSET_BLOB_KEY_INDEX)) {
          metadataStore.createIndex(ASSET_BLOB_KEY_INDEX, "blobKey", { unique: false });
        }
        if (!database.objectStoreNames.contains(ASSET_BLOB_STORE)) {
          database.createObjectStore(ASSET_BLOB_STORE, { keyPath: "blobKey" });
        }
      };
      request.onerror = () => rejectOnce(normalizeAssetRepositoryError(request.error, { operation: "open" }));
      request.onblocked = () => rejectOnce(new AssetRepositoryError(
        "ASSET_STORAGE_UNAVAILABLE",
        "Asset database upgrade is blocked by another open connection.",
        { operation: "open" },
      ));
      request.onsuccess = () => {
        const database = request.result;
        if (settled || generation !== this.openGeneration) {
          database.close();
          rejectOnce(abortedError("open", undefined, "Connection closed while opening."));
          return;
        }
        settled = true;
        this.database = database;
        database.onversionchange = () => {
          database.close();
          if (this.database === database) {
            this.database = undefined;
            this.databasePromise = undefined;
            this.openGeneration += 1;
          }
        };
        resolve(database);
      };
    });
    const tracked = opening.catch((error: unknown) => {
      if (this.databasePromise === tracked) this.databasePromise = undefined;
      throw error;
    });
    this.databasePromise = tracked;
    return tracked;
  }

  private async getBlobEntryForPut(
    database: IDBDatabase,
    blobKey: string,
    assetId: EntityId,
    options?: AssetOperationOptions,
  ): Promise<StoredAssetBlobEntry | undefined> {
    const transaction = createTransaction(database, ASSET_BLOB_STORE, "readonly", "put", assetId);
    const monitor = monitorTransaction<StoredAssetBlobEntry | undefined>(
      transaction,
      "put",
      assetId,
      options,
      undefined,
    );
    let request: IDBRequest<unknown>;
    try {
      request = transaction.objectStore(ASSET_BLOB_STORE).get(blobKey);
    } catch (error) {
      monitor.fail(structuralStorageError("put", error, assetId));
      return monitor.promise;
    }
    request.onsuccess = () => {
      if (request.result !== undefined) {
        monitor.setResult(request.result as StoredAssetBlobEntry);
      }
    };
    return monitor.promise;
  }

  private async prepareLegacyBlobIdentity(
    database: IDBDatabase,
    incoming: AssetContentIdentity,
    assetId: EntityId,
    options?: AssetOperationOptions,
  ): Promise<AssetContentIdentity | undefined> {
    const stored = await this.getBlobEntryForPut(database, incoming.blobKey, assetId, options);
    if (!stored) return undefined;
    const currentIdentity = storedContentIdentity(stored, assetId);
    if (currentIdentity) return undefined;
    if (!(stored.blob instanceof Blob)) {
      throw new AssetRepositoryError(
        "ASSET_INTEGRITY_MISMATCH",
        "Legacy stored asset has no readable Blob; existing data was preserved.",
        { operation: "put", assetId },
      );
    }
    let legacyIdentity: AssetContentIdentity;
    try {
      legacyIdentity = await computeAssetContentIdentity(stored.blob, options);
    } catch (cause) {
      if (isAssetRepositoryError(cause) && cause.code === "ASSET_TRANSACTION_ABORTED") {
        throw abortedError("put", assetId, cause);
      }
      throw new AssetRepositoryError(
        "ASSET_INTEGRITY_MISMATCH",
        "Legacy stored asset could not be verified; existing data was preserved.",
        { operation: "put", assetId, cause },
      );
    }
    assertNoAssetContentCollision(legacyIdentity, incoming, assetId);
    return legacyIdentity;
  }

  async put(
    record: AssetRecord,
    blob: Blob,
    options?: AssetOperationOptions,
  ): Promise<void> {
    throwIfAborted(options, "put", record?.id);
    validatePutInput(this.projectId, record, blob);
    let identity: AssetContentIdentity;
    try {
      identity = validateAssetContentIdentity(
        await awaitAbortableAssetOperation(
          Promise.resolve().then(() => this.identityProvider(blob, options)),
          options,
          "put",
          record.id,
        ),
        { operation: "put", assetId: record.id },
      );
      assertAssetRecordContentIdentity(record, blob, identity);
    } catch (error) {
      if (options?.signal?.aborted) {
        throw abortedError("put", record.id, options.signal.reason);
      }
      if (isAssetRepositoryError(error)) {
        throw new AssetRepositoryError(error.code, error.message, {
          operation: "put",
          assetId: record.id,
          recoverable: error.recoverable,
          recoveryActions: error.recoveryActions,
          cause: error,
        });
      }
      throw normalizeAssetRepositoryError(error, { operation: "put", assetId: record.id });
    }
    const database = await this.getDatabase();
    throwIfAborted(options, "put", record.id);
    const legacyIdentity = await this.prepareLegacyBlobIdentity(
      database,
      identity,
      record.id,
      options,
    );
    throwIfAborted(options, "put", record.id);
    const transaction = createTransaction(database,
      [ASSET_METADATA_STORE, ASSET_BLOB_STORE],
      "readwrite",
      "put",
      record.id,
    );
    const monitor = monitorTransaction(transaction, "put", record.id, options, undefined);
    let metadataStore: IDBObjectStore;
    let blobStore: IDBObjectStore;
    let blobRequest: IDBRequest<unknown>;
    try {
      metadataStore = transaction.objectStore(ASSET_METADATA_STORE);
      blobStore = transaction.objectStore(ASSET_BLOB_STORE);
      blobRequest = blobStore.get(record.blobKey);
    } catch (error) {
      monitor.fail(structuralStorageError("put", error, record.id));
      await monitor.promise;
      return;
    }
    blobRequest.onsuccess = () => {
      try {
        if (blobRequest.result === undefined) {
          blobStore.add({
            blobKey: identity.blobKey,
            contentHash: identity.contentHash,
            verificationHash: identity.verificationHash,
            byteSize: identity.byteSize,
            blob,
          } satisfies StoredAssetBlobEntry);
        } else {
          const stored = blobRequest.result as StoredAssetBlobEntry;
          const existingIdentity = storedContentIdentity(stored, record.id);
          if (existingIdentity) {
            assertNoAssetContentCollision(existingIdentity, identity, record.id);
          } else {
            if (!legacyIdentity) {
              throw new AssetRepositoryError(
                "ASSET_INTEGRITY_MISMATCH",
                "Legacy asset changed before verification; existing bytes were preserved.",
                { operation: "put", assetId: record.id },
              );
            }
            assertNoAssetContentCollision(legacyIdentity, identity, record.id);
            blobStore.put({
              ...stored,
              contentHash: legacyIdentity.contentHash,
              verificationHash: legacyIdentity.verificationHash,
              byteSize: legacyIdentity.byteSize,
            } satisfies StoredAssetBlobEntry);
          }
        }
        metadataStore.put({
          projectId: this.projectId,
          assetId: record.id,
          contentHash: record.contentHash,
          blobKey: record.blobKey,
          record,
        } satisfies StoredAssetMetadataEntry);
      } catch (error) {
        monitor.fail(normalizeAssetRepositoryError(error, {
          operation: "put",
          assetId: record.id,
        }));
      }
    };
    await monitor.promise;
  }

  async getMetadata(
    assetId: EntityId,
    options?: AssetOperationOptions,
  ): Promise<AssetRecord> {
    if (!isEntityId(assetId)) throw invalidInput("get-metadata", "Asset id must be a non-empty string.");
    throwIfAborted(options, "get-metadata", assetId);
    const database = await this.getDatabase();
    throwIfAborted(options, "get-metadata", assetId);
    const transaction = createTransaction(
      database,
      ASSET_METADATA_STORE,
      "readonly",
      "get-metadata",
      assetId,
    );
    const monitor = monitorTransaction<AssetRecord | undefined>(
      transaction,
      "get-metadata",
      assetId,
      options,
      undefined,
    );
    let request: IDBRequest<unknown>;
    try {
      request = transaction.objectStore(ASSET_METADATA_STORE).get(
        metadataKey(this.projectId, assetId),
      );
    } catch (error) {
      monitor.fail(structuralStorageError("get-metadata", error, assetId));
      await monitor.promise;
      throw structuralStorageError("get-metadata", error, assetId);
    }
    request.onsuccess = () => {
      const entry = request.result as StoredAssetMetadataEntry | undefined;
      if (!entry) {
        monitor.fail(new AssetRepositoryError(
          "ASSET_NOT_FOUND",
          `Asset metadata ${assetId} was not found.`,
          { operation: "get-metadata", assetId },
        ));
        return;
      }
      monitor.setResult(entry.record);
    };
    const result = await monitor.promise;
    if (!result) throw new AssetRepositoryError(
      "ASSET_NOT_FOUND",
      `Asset metadata ${assetId} was not found.`,
      { operation: "get-metadata", assetId },
    );
    return result;
  }

  async getBlob(assetId: EntityId, options?: AssetOperationOptions): Promise<Blob> {
    if (!isEntityId(assetId)) throw invalidInput("get-blob", "Asset id must be a non-empty string.");
    throwIfAborted(options, "get-blob", assetId);
    const database = await this.getDatabase();
    throwIfAborted(options, "get-blob", assetId);
    const transaction = createTransaction(database,
      [ASSET_METADATA_STORE, ASSET_BLOB_STORE],
      "readonly",
      "get-blob",
      assetId,
    );
    const monitor = monitorTransaction<Blob | undefined>(
      transaction,
      "get-blob",
      assetId,
      options,
      undefined,
    );
    let metadataRequest: IDBRequest<unknown>;
    try {
      metadataRequest = transaction.objectStore(ASSET_METADATA_STORE).get(
        metadataKey(this.projectId, assetId),
      );
    } catch (error) {
      monitor.fail(structuralStorageError("get-blob", error, assetId));
      await monitor.promise;
      throw structuralStorageError("get-blob", error, assetId);
    }
    metadataRequest.onsuccess = () => {
      const entry = metadataRequest.result as StoredAssetMetadataEntry | undefined;
      if (!entry) {
        monitor.fail(new AssetRepositoryError(
          "ASSET_NOT_FOUND",
          `Asset metadata ${assetId} was not found.`,
          { operation: "get-blob", assetId },
        ));
        return;
      }
      let blobRequest: IDBRequest<unknown>;
      try {
        blobRequest = transaction.objectStore(ASSET_BLOB_STORE).get(entry.blobKey);
      } catch (error) {
        monitor.fail(structuralStorageError("get-blob", error, assetId));
        return;
      }
      blobRequest.onsuccess = () => {
        const stored = blobRequest.result as StoredAssetBlobEntry | undefined;
        if (!stored?.blob) {
          monitor.fail(new AssetRepositoryError(
            "ASSET_BLOB_MISSING",
            `Blob ${entry.blobKey} for ${assetId} was not found.`,
            { operation: "get-blob", assetId },
          ));
          return;
        }
        monitor.setResult(
          stored.blob.type === entry.record.mimeType
            ? stored.blob
            : stored.blob.slice(0, stored.blob.size, entry.record.mimeType),
        );
      };
    };
    const result = await monitor.promise;
    if (!result) throw new AssetRepositoryError(
      "ASSET_BLOB_MISSING",
      `Blob for ${assetId} was not found.`,
      { operation: "get-blob", assetId },
    );
    return result;
  }

  async list(options?: AssetStorageListOptions): Promise<readonly AssetRecord[]> {
    throwIfAborted(options, "list");
    const database = await this.getDatabase();
    throwIfAborted(options, "list");
    const transaction = createTransaction(database, ASSET_METADATA_STORE, "readonly", "list");
    const monitor = monitorTransaction<readonly AssetRecord[]>(
      transaction,
      "list",
      undefined,
      options,
      [],
    );
    let request: IDBRequest<unknown[]>;
    try {
      request = transaction
        .objectStore(ASSET_METADATA_STORE)
        .index(ASSET_PROJECT_INDEX)
        .getAll(this.projectId);
    } catch (error) {
      monitor.fail(structuralStorageError("list", error));
      await monitor.promise;
      throw structuralStorageError("list", error);
    }
    request.onsuccess = () => {
      const entries = request.result as StoredAssetMetadataEntry[];
      monitor.setResult(entries
        .filter((entry) => !options?.contentHash || entry.contentHash === options.contentHash)
        .map((entry) => entry.record)
        .sort((left, right) => left.id.localeCompare(right.id)));
    };
    return monitor.promise;
  }

  async remove(
    assetId: EntityId,
    options?: AssetOperationOptions,
  ): Promise<AssetStorageRemoval> {
    if (!isEntityId(assetId)) throw invalidInput("remove", "Asset id must be a non-empty string.");
    throwIfAborted(options, "remove", assetId);
    const database = await this.getDatabase();
    throwIfAborted(options, "remove", assetId);
    const transaction = createTransaction(database,
      [ASSET_METADATA_STORE, ASSET_BLOB_STORE],
      "readwrite",
      "remove",
      assetId,
    );
    const monitor = monitorTransaction<AssetStorageRemoval | undefined>(
      transaction,
      "remove",
      assetId,
      options,
      undefined,
    );
    let metadataStore: IDBObjectStore;
    let request: IDBRequest<unknown>;
    try {
      metadataStore = transaction.objectStore(ASSET_METADATA_STORE);
      request = metadataStore.get(metadataKey(this.projectId, assetId));
    } catch (error) {
      monitor.fail(structuralStorageError("remove", error, assetId));
      await monitor.promise;
      throw structuralStorageError("remove", error, assetId);
    }
    request.onsuccess = () => {
      const entry = request.result as StoredAssetMetadataEntry | undefined;
      if (!entry) {
        monitor.fail(new AssetRepositoryError(
          "ASSET_NOT_FOUND",
          `Asset metadata ${assetId} was not found.`,
          { operation: "remove", assetId },
        ));
        return;
      }
      try {
        metadataStore.delete(metadataKey(this.projectId, assetId));
        const countRequest = metadataStore.index(ASSET_BLOB_KEY_INDEX).count(entry.blobKey);
        countRequest.onsuccess = () => {
          try {
            const removedBlob = countRequest.result === 0;
            if (removedBlob) transaction.objectStore(ASSET_BLOB_STORE).delete(entry.blobKey);
            monitor.setResult({ assetId, blobKey: entry.blobKey, removedBlob });
          } catch (error) {
            monitor.fail(structuralStorageError("remove", error, assetId));
          }
        };
      } catch (error) {
        monitor.fail(structuralStorageError("remove", error, assetId));
      }
    };
    const result = await monitor.promise;
    if (!result) throw new AssetRepositoryError(
      "ASSET_NOT_FOUND",
      `Asset metadata ${assetId} was not found.`,
      { operation: "remove", assetId },
    );
    return result;
  }

  close(): void {
    this.openGeneration += 1;
    this.database?.close();
    this.database = undefined;
    this.databasePromise = undefined;
  }

  async destroy(): Promise<void> {
    this.close();
    if (!this.factory) return;
    await new Promise<void>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = this.factory!.deleteDatabase(this.databaseName);
      } catch (error) {
        reject(normalizeAssetRepositoryError(error, { operation: "dispose" }));
        return;
      }
      request.onsuccess = () => resolve();
      request.onerror = () => reject(normalizeAssetRepositoryError(request.error, { operation: "dispose" }));
      request.onblocked = () => undefined;
    });
  }
}
