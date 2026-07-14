import type {
  AssetProvenance,
  AssetRecord,
  EntityId,
} from "../project/schema";
import { isEntityId, isISO8601Timestamp } from "../project/primitives";
import {
  AssetRepositoryError,
  awaitAbortableAssetOperation,
  isAssetRepositoryError,
  normalizeAssetRepositoryError,
} from "./contracts";
import type {
  AssetIntegrity,
  AssetListOptions,
  AssetMetadata,
  AssetOperationOptions,
  AssetPayload,
  AssetRemovalPolicy,
  AssetRepository,
  AssetRepositoryDiagnostic,
  AssetRepositoryOperation,
} from "./contracts";
import {
  computeAssetContentIdentity,
  validateAssetContentIdentity,
} from "./contentIdentity";
import type {
  AssetContentIdentity,
  AssetContentIdentityProvider,
} from "./contentIdentity";
import {
  IndexedDbAssetStorage,
} from "./indexedDbAssetStorage";
import type {
  AssetStorageListOptions,
  AssetStorageRemoval,
  AssetStoragePutResult,
  IndexedDbAssetStorageOptions,
} from "./indexedDbAssetStorage";
import {
  RuntimeUrlRegistry,
} from "./runtimeUrlRegistry";
import type {
  RuntimeObjectUrlHost,
} from "./runtimeUrlRegistry";

export interface AssetStoragePort {
  readonly projectId: EntityId;
  put(
    record: AssetRecord,
    blob: Blob,
    options?: AssetOperationOptions,
    identity?: AssetContentIdentity,
  ): Promise<AssetStoragePutResult>;
  getMetadata(assetId: EntityId, options?: AssetOperationOptions): Promise<AssetRecord>;
  getBlob(assetId: EntityId, options?: AssetOperationOptions): Promise<Blob>;
  list(options?: AssetStorageListOptions): Promise<readonly AssetRecord[]>;
  remove(assetId: EntityId, options?: AssetOperationOptions): Promise<AssetStorageRemoval>;
  close(): void;
}

export interface IndexedDbAssetRepositoryOptions extends IndexedDbAssetStorageOptions {
  storage?: AssetStoragePort;
  identityProvider?: AssetContentIdentityProvider;
  runtimeUrlHost?: RuntimeObjectUrlHost | null;
  onRuntimeUrlError?: (diagnostic: AssetRepositoryDiagnostic) => void;
}

interface SanitizedMetadata {
  id: EntityId;
  name: string;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
  provenance: AssetProvenance;
  declaredMimeType?: string;
  expectedContentHash?: string;
}

function ownDataValue(
  value: object,
  key: string,
  optional = false,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) {
    if (optional) return undefined;
    throw new TypeError(`Missing metadata property ${key}.`);
  }
  if (!("value" in descriptor)) throw new TypeError(`Metadata ${key} must be a data property.`);
  return descriptor.value;
}

function optionalEntityId(value: object, key: string): EntityId | undefined {
  const field = ownDataValue(value, key, true);
  if (field === undefined) return undefined;
  if (!isEntityId(field)) throw new TypeError(`Provenance ${key} must be a non-empty string.`);
  return field;
}

function sanitizeProvenance(value: unknown): AssetProvenance {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Asset provenance must be an object.");
  }
  const source = ownDataValue(value, "source");
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new TypeError("Asset provenance source must be a non-empty string.");
  }
  const recipeId = optionalEntityId(value, "recipeId");
  const artifactId = optionalEntityId(value, "artifactId");
  const parentAssetId = optionalEntityId(value, "parentAssetId");
  const sourceId = optionalEntityId(value, "sourceId");
  const importedAt = ownDataValue(value, "importedAt", true);
  const note = ownDataValue(value, "note", true);
  if (importedAt !== undefined && !isISO8601Timestamp(importedAt)) {
    throw new TypeError("Asset provenance importedAt must be a valid ISO-8601 value.");
  }
  if (note !== undefined && typeof note !== "string") {
    throw new TypeError("Asset provenance note must be a string.");
  }
  return Object.freeze({
    source: source.trim(),
    ...(sourceId ? { sourceId } : {}),
    ...(importedAt ? { importedAt } : {}),
    ...(note !== undefined ? { note } : {}),
    ...(recipeId ? { recipeId } : {}),
    ...(artifactId ? { artifactId } : {}),
    ...(parentAssetId ? { parentAssetId } : {}),
  });
}

function sanitizeMetadata(value: unknown): SanitizedMetadata {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Asset metadata must be an object.");
  }
  const id = ownDataValue(value, "id");
  const name = ownDataValue(value, "name");
  const width = ownDataValue(value, "width");
  const height = ownDataValue(value, "height");
  const createdAt = ownDataValue(value, "createdAt");
  const updatedAt = ownDataValue(value, "updatedAt");
  const declaredMimeType = ownDataValue(value, "declaredMimeType", true);
  const expectedContentHash = ownDataValue(value, "expectedContentHash", true);
  if (!isEntityId(id)) throw new TypeError("Asset id must be a non-empty string.");
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new TypeError("Asset name must be a non-empty string.");
  }
  if (!Number.isSafeInteger(width) || (width as number) <= 0) {
    throw new TypeError("Asset width must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(height) || (height as number) <= 0) {
    throw new TypeError("Asset height must be a positive safe integer.");
  }
  if (!isISO8601Timestamp(createdAt) || !isISO8601Timestamp(updatedAt)) {
    throw new TypeError("Asset timestamps must be valid ISO-8601 values.");
  }
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new TypeError("Asset updatedAt cannot precede createdAt.");
  }
  if (declaredMimeType !== undefined && (
    typeof declaredMimeType !== "string" || declaredMimeType.trim().length === 0
  )) {
    throw new TypeError("Declared MIME type must be a non-empty string.");
  }
  if (expectedContentHash !== undefined && (
    typeof expectedContentHash !== "string" || !/^[0-9a-f]{64}$/.test(expectedContentHash)
  )) {
    throw new TypeError("Expected content hash must be 64 lowercase hex characters.");
  }
  return {
    id,
    name: name.trim(),
    width: width as number,
    height: height as number,
    createdAt,
    updatedAt,
    provenance: sanitizeProvenance(ownDataValue(value, "provenance")),
    ...(declaredMimeType ? { declaredMimeType: declaredMimeType.trim().toLowerCase() } : {}),
    ...(expectedContentHash ? { expectedContentHash } : {}),
  };
}

function boundaryError(
  error: unknown,
  operation: AssetRepositoryOperation,
  assetId?: EntityId,
): AssetRepositoryError {
  if (isAssetRepositoryError(error)) {
    if (error.operation === operation && error.assetId === assetId) return error;
    return new AssetRepositoryError(error.code, error.message, {
      operation,
      assetId,
      recoverable: error.recoverable,
      recoveryActions: error.recoveryActions,
      cause: error,
    });
  }
  return normalizeAssetRepositoryError(error, { operation, assetId });
}

function invalidPut(error: unknown, assetId?: EntityId): AssetRepositoryError {
  return new AssetRepositoryError(
    "ASSET_INVALID_INPUT",
    "Asset import metadata or payload is invalid.",
    { operation: "put", assetId, cause: error },
  );
}

function invalidInput(
  operation: AssetRepositoryOperation,
  message: string,
  assetId?: EntityId,
  cause?: unknown,
): AssetRepositoryError {
  return new AssetRepositoryError("ASSET_INVALID_INPUT", message, {
    operation,
    assetId,
    cause,
  });
}

function assertAssetId(assetId: unknown, operation: AssetRepositoryOperation): asserts assetId is EntityId {
  if (!isEntityId(assetId)) throw invalidInput(operation, "Asset id must be a non-empty string.");
}

function throwIfAborted(
  options: AssetOperationOptions | undefined,
  operation: AssetRepositoryOperation,
  assetId?: EntityId,
): void {
  if (!options?.signal?.aborted) return;
  throw new AssetRepositoryError(
    "ASSET_TRANSACTION_ABORTED",
    `Asset repository ${operation} was aborted${assetId ? ` for ${assetId}` : ""}.`,
    { operation, assetId, cause: options.signal.reason },
  );
}

/** Concrete project-scoped repository joining identity, storage and URL leases. */
export class IndexedDbAssetRepository implements AssetRepository {
  readonly projectId: EntityId;
  private readonly storage: AssetStoragePort;
  private readonly identify: AssetContentIdentityProvider;
  private readonly runtimeUrls: RuntimeUrlRegistry;
  private readonly lifetimeController = new AbortController();
  private readonly mutatingAssets = new Set<EntityId>();
  private disposed = false;

  constructor(projectId: EntityId, options: IndexedDbAssetRepositoryOptions = {}) {
    if (!isEntityId(projectId)) {
      throw invalidInput("open", "Project id must be a non-empty string.");
    }
    this.projectId = projectId;
    this.identify = options.identityProvider ?? computeAssetContentIdentity;
    this.storage = options.storage ?? new IndexedDbAssetStorage(projectId, {
      databaseName: options.databaseName,
      factory: options.factory,
      identityProvider: this.identify,
    });
    if (this.storage.projectId !== projectId) {
      throw invalidInput("open", "Injected storage project id does not match repository project id.");
    }
    this.runtimeUrls = new RuntimeUrlRegistry(
      (assetId, operationOptions) => this.getBlob(assetId, operationOptions),
      {
        host: options.runtimeUrlHost,
        onError: options.onRuntimeUrlError,
      },
    );
  }

  private ensureActive(operation: AssetRepositoryOperation, assetId?: EntityId): void {
    if (!this.disposed) return;
    throw new AssetRepositoryError(
      "ASSET_STORAGE_UNAVAILABLE",
      "Asset repository is disposed.",
      { operation, assetId, recoverable: false, recoveryActions: [] },
    );
  }

  private operationOptions(options?: AssetOperationOptions): AssetOperationOptions {
    const callerSignal = options?.signal;
    return {
      signal: callerSignal
        ? AbortSignal.any([callerSignal, this.lifetimeController.signal])
        : this.lifetimeController.signal,
    };
  }

  private beginMutation(assetId: EntityId, operation: "put" | "remove"): () => void {
    if (this.mutatingAssets.has(assetId)) {
      throw new AssetRepositoryError(
        "ASSET_TRANSACTION_ABORTED",
        `Another asset mutation is already active for ${assetId}.`,
        { operation, assetId },
      );
    }
    this.mutatingAssets.add(assetId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.mutatingAssets.delete(assetId);
    };
  }

  async put(
    blob: Blob,
    metadata: AssetMetadata,
    options?: AssetOperationOptions,
  ): Promise<AssetRecord> {
    this.ensureActive("put");
    throwIfAborted(options, "put");
    let safe: SanitizedMetadata;
    try {
      safe = sanitizeMetadata(metadata);
      if (!(blob instanceof Blob)) throw new TypeError("Asset payload must be a Blob.");
    } catch (error) {
      throw invalidPut(error);
    }
    const assetId = safe.id;
    let payload = blob;
    const declaredMimeType = safe.declaredMimeType;
    if (declaredMimeType && blob.type && declaredMimeType !== blob.type) {
      throw new AssetRepositoryError(
        "ASSET_INTEGRITY_MISMATCH",
        "Declared MIME type does not match the Blob MIME type.",
        { operation: "put", assetId },
      );
    }
    if (!blob.type && declaredMimeType) payload = blob.slice(0, blob.size, declaredMimeType);
    if (!payload.type) throw invalidPut("Asset MIME type is required.", assetId);

    const scopedOptions = this.operationOptions(options);
    throwIfAborted(scopedOptions, "put", assetId);
    const endMutation = this.beginMutation(assetId, "put");
    try {

      let identity: AssetContentIdentity;
      try {
        identity = validateAssetContentIdentity(
          await awaitAbortableAssetOperation(
            Promise.resolve().then(() => this.identify(payload, scopedOptions)),
            scopedOptions,
            "put",
            assetId,
          ),
          { operation: "put", assetId },
        );
      } catch (error) {
        throw boundaryError(error, "put", assetId);
      }
      if (safe.expectedContentHash && safe.expectedContentHash !== identity.contentHash) {
        throw new AssetRepositoryError(
          "ASSET_INTEGRITY_MISMATCH",
          "Expected content hash does not match the imported bytes.",
          { operation: "put", assetId },
        );
      }
      const record: AssetRecord = Object.freeze({
        id: assetId,
        name: safe.name,
        blobKey: identity.blobKey,
        contentHash: identity.contentHash,
        mimeType: payload.type,
        width: safe.width,
        height: safe.height,
        byteSize: identity.byteSize,
        createdAt: safe.createdAt,
        updatedAt: safe.updatedAt,
        provenance: safe.provenance,
      });
      let committed: AssetStoragePutResult;
      try {
        committed = await awaitAbortableAssetOperation(
          this.storage.put(record, payload, scopedOptions, identity),
          scopedOptions,
          "put",
          assetId,
        );
      } catch (error) {
        throw boundaryError(error, "put", assetId);
      }
      if (committed.previous && (
        committed.previous.blobKey !== record.blobKey
        || committed.previous.mimeType !== record.mimeType
      )) {
        this.runtimeUrls.releaseAsset(assetId);
      }
      return record;
    } finally {
      endMutation();
    }
  }

  async getMetadata(assetId: EntityId, options?: AssetOperationOptions): Promise<AssetRecord> {
    assertAssetId(assetId, "get-metadata");
    this.ensureActive("get-metadata", assetId);
    const scopedOptions = this.operationOptions(options);
    throwIfAborted(scopedOptions, "get-metadata", assetId);
    try {
      return await awaitAbortableAssetOperation(
        this.storage.getMetadata(assetId, scopedOptions),
        scopedOptions,
        "get-metadata",
        assetId,
      );
    } catch (error) {
      throw boundaryError(error, "get-metadata", assetId);
    }
  }

  async getBlob(assetId: EntityId, options?: AssetOperationOptions): Promise<Blob> {
    assertAssetId(assetId, "get-blob");
    this.ensureActive("get-blob", assetId);
    const scopedOptions = this.operationOptions(options);
    throwIfAborted(scopedOptions, "get-blob", assetId);
    try {
      return await awaitAbortableAssetOperation(
        this.storage.getBlob(assetId, scopedOptions),
        scopedOptions,
        "get-blob",
        assetId,
      );
    } catch (error) {
      throw boundaryError(error, "get-blob", assetId);
    }
  }

  async list(options?: AssetListOptions): Promise<readonly AssetRecord[]> {
    this.ensureActive("list");
    const scopedOptions = this.operationOptions(options);
    throwIfAborted(scopedOptions, "list");
    if (options?.contentHash !== undefined && !/^[0-9a-f]{64}$/.test(options.contentHash)) {
      throw invalidInput("list", "Content hash filter must be 64 lowercase hex characters.");
    }
    try {
      return await awaitAbortableAssetOperation(
        this.storage.list({ ...options, signal: scopedOptions.signal }),
        scopedOptions,
        "list",
      );
    } catch (error) {
      throw boundaryError(error, "list");
    }
  }

  async verify(assetId: EntityId, options?: AssetOperationOptions): Promise<AssetIntegrity> {
    assertAssetId(assetId, "verify");
    this.ensureActive("verify", assetId);
    const scopedOptions = this.operationOptions(options);
    throwIfAborted(scopedOptions, "verify", assetId);
    let record: AssetRecord;
    try {
      record = await awaitAbortableAssetOperation(
        this.storage.getMetadata(assetId, scopedOptions),
        scopedOptions,
        "verify",
        assetId,
      );
    } catch (error) {
      if (isAssetRepositoryError(error) && error.code === "ASSET_NOT_FOUND") {
        return { assetId, status: "metadata-missing" };
      }
      throw boundaryError(error, "verify", assetId);
    }
    let blob: Blob;
    try {
      blob = await awaitAbortableAssetOperation(
        this.storage.getBlob(assetId, scopedOptions),
        scopedOptions,
        "verify",
        assetId,
      );
    } catch (error) {
      if (isAssetRepositoryError(error) && error.code === "ASSET_BLOB_MISSING") {
        return {
          assetId,
          status: "blob-missing",
          expectedHash: record.contentHash,
          expectedByteSize: record.byteSize,
          expectedMimeType: record.mimeType,
        };
      }
      throw boundaryError(error, "verify", assetId);
    }
    let actual: AssetContentIdentity;
    try {
      actual = await computeAssetContentIdentity(blob, scopedOptions);
    } catch (error) {
      throw boundaryError(error, "verify", assetId);
    }
    const observed = {
      assetId,
      expectedHash: record.contentHash,
      actualHash: actual.contentHash,
      expectedByteSize: record.byteSize,
      actualByteSize: actual.byteSize,
      expectedMimeType: record.mimeType,
      actualMimeType: blob.type,
    };
    if (record.byteSize !== actual.byteSize) return { ...observed, status: "size-mismatch" };
    if (record.contentHash !== actual.contentHash) return { ...observed, status: "hash-mismatch" };
    if (record.mimeType !== blob.type) return { ...observed, status: "mime-mismatch" };
    return { ...observed, status: "ok" };
  }

  async remove(
    assetId: EntityId,
    policy: AssetRemovalPolicy,
    options?: AssetOperationOptions,
  ): Promise<void> {
    assertAssetId(assetId, "remove");
    this.ensureActive("remove", assetId);
    const scopedOptions = this.operationOptions(options);
    throwIfAborted(scopedOptions, "remove", assetId);
    if (policy !== "reject-if-leased" && policy !== "release-and-remove") {
      throw new AssetRepositoryError("ASSET_INVALID_INPUT", "Unknown asset removal policy.", {
        operation: "remove",
        assetId,
      });
    }
    const endMutation = this.beginMutation(assetId, "remove");
    try {
      if (policy === "reject-if-leased" && this.runtimeUrls.hasLeases(assetId)) {
        throw new AssetRepositoryError(
          "ASSET_LEASE_CONFLICT",
          `Asset ${assetId} still has runtime URL leases.`,
          { operation: "remove", assetId },
        );
      }
      try {
        await awaitAbortableAssetOperation(
          this.storage.remove(assetId, scopedOptions),
          scopedOptions,
          "remove",
          assetId,
        );
      } catch (error) {
        throw boundaryError(error, "remove", assetId);
      }
      this.runtimeUrls.releaseAsset(assetId);
    } finally {
      endMutation();
    }
  }

  async *exportMany(
    assetIds: readonly EntityId[],
    options?: AssetOperationOptions,
  ): AsyncIterable<AssetPayload> {
    this.ensureActive("export");
    const scopedOptions = this.operationOptions(options);
    throwIfAborted(scopedOptions, "export");
    if (!Array.isArray(assetIds) || assetIds.some((assetId) => !isEntityId(assetId))) {
      throw new AssetRepositoryError("ASSET_INVALID_INPUT", "Export asset ids are invalid.", {
        operation: "export",
      });
    }
    const stableAssetIds = Array.from(assetIds);
    for (const assetId of stableAssetIds) {
      if (scopedOptions.signal?.aborted) {
        throw new AssetRepositoryError(
          "ASSET_TRANSACTION_ABORTED",
          `Asset export was aborted for ${assetId}.`,
          { operation: "export", assetId, cause: scopedOptions.signal.reason },
        );
      }
      try {
        const [record, payloadBlob] = await awaitAbortableAssetOperation(
          Promise.all([
            this.storage.getMetadata(assetId, scopedOptions),
            this.storage.getBlob(assetId, scopedOptions),
          ]),
          scopedOptions,
          "export",
          assetId,
        );
        yield { record, blob: payloadBlob };
      } catch (error) {
        throw boundaryError(error, "export", assetId);
      }
    }
  }

  async createRuntimeUrl(
    assetId: EntityId,
    owner: object,
    options?: AssetOperationOptions,
  ): Promise<string> {
    assertAssetId(assetId, "create-url");
    this.ensureActive("create-url", assetId);
    const scopedOptions = this.operationOptions(options);
    throwIfAborted(scopedOptions, "create-url", assetId);
    if (this.mutatingAssets.has(assetId)) {
      throw new AssetRepositoryError(
        "ASSET_LEASE_CONFLICT",
        `Asset ${assetId} is being mutated; retry URL acquisition after it settles.`,
        { operation: "create-url", assetId },
      );
    }
    return this.runtimeUrls.acquire(assetId, owner, scopedOptions);
  }

  releaseRuntimeUrl(assetId: EntityId, owner: object): void {
    this.runtimeUrls.release(assetId, owner);
  }

  releaseOwner(owner: object): void {
    this.runtimeUrls.releaseOwner(owner);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lifetimeController.abort("Asset repository disposed.");
    this.runtimeUrls.dispose();
    this.storage.close();
  }
}
