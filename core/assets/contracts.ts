import type {
  AssetProvenance,
  AssetRecord,
  EntityId,
  ISO8601Timestamp,
} from "../project/schema";

export const ASSET_REPOSITORY_ERROR_CODES = [
  "ASSET_NOT_FOUND",
  "ASSET_BLOB_MISSING",
  "ASSET_INTEGRITY_MISMATCH",
  "ASSET_QUOTA_EXCEEDED",
  "ASSET_INVALID_INPUT",
  "ASSET_STORAGE_UNAVAILABLE",
  "ASSET_TRANSACTION_ABORTED",
  "ASSET_LEASE_CONFLICT",
] as const;

export type AssetRepositoryErrorCode = (typeof ASSET_REPOSITORY_ERROR_CODES)[number];

export type AssetRepositoryOperation =
  | "open"
  | "put"
  | "get-metadata"
  | "get-blob"
  | "list"
  | "verify"
  | "scan-integrity"
  | "remove"
  | "export"
  | "create-url"
  | "release-url"
  | "dispose";

export type AssetRecoveryAction =
  | "retry"
  | "relink"
  | "free-space"
  | "remove-corrupt"
  | "release-leases"
  | "export-project";

export interface AssetRepositoryDiagnostic {
  code: AssetRepositoryErrorCode;
  operation: AssetRepositoryOperation;
  message: string;
  recoverable: boolean;
  assetId?: EntityId;
  recoveryActions: readonly AssetRecoveryAction[];
}

export interface AssetRepositoryErrorOptions {
  operation: AssetRepositoryOperation;
  assetId?: EntityId;
  recoverable?: boolean;
  recoveryActions?: readonly AssetRecoveryAction[];
  cause?: unknown;
}

const DEFAULT_RECOVERY: Record<
  AssetRepositoryErrorCode,
  { recoverable: boolean; actions: readonly AssetRecoveryAction[] }
> = {
  ASSET_NOT_FOUND: { recoverable: true, actions: ["relink", "retry"] },
  ASSET_BLOB_MISSING: { recoverable: true, actions: ["relink", "remove-corrupt"] },
  ASSET_INTEGRITY_MISMATCH: { recoverable: true, actions: ["relink", "remove-corrupt"] },
  ASSET_QUOTA_EXCEEDED: {
    recoverable: true,
    actions: ["free-space", "export-project", "retry"],
  },
  ASSET_INVALID_INPUT: { recoverable: false, actions: [] },
  ASSET_STORAGE_UNAVAILABLE: { recoverable: true, actions: ["retry", "export-project"] },
  ASSET_TRANSACTION_ABORTED: { recoverable: true, actions: ["retry"] },
  ASSET_LEASE_CONFLICT: { recoverable: true, actions: ["release-leases", "retry"] },
};

/** Stable error envelope used by every storage implementation and service. */
export class AssetRepositoryError extends Error {
  readonly code: AssetRepositoryErrorCode;
  readonly operation: AssetRepositoryOperation;
  readonly assetId?: EntityId;
  readonly recoverable: boolean;
  readonly recoveryActions: readonly AssetRecoveryAction[];
  override readonly cause?: unknown;

  constructor(
    code: AssetRepositoryErrorCode,
    message: string,
    options: AssetRepositoryErrorOptions,
  ) {
    super(message);
    this.name = "AssetRepositoryError";
    this.code = code;
    this.operation = options.operation;
    this.assetId = options.assetId;
    this.recoverable = options.recoverable ?? DEFAULT_RECOVERY[code].recoverable;
    this.recoveryActions = Object.freeze([
      ...(options.recoveryActions ?? DEFAULT_RECOVERY[code].actions),
    ]);
    this.cause = options.cause;
  }

  toDiagnostic(): AssetRepositoryDiagnostic {
    return {
      code: this.code,
      operation: this.operation,
      message: this.message,
      recoverable: this.recoverable,
      ...(this.assetId ? { assetId: this.assetId } : {}),
      recoveryActions: [...this.recoveryActions],
    };
  }
}

export function isAssetRepositoryError(value: unknown): value is AssetRepositoryError {
  try {
    return value instanceof AssetRepositoryError;
  } catch {
    return false;
  }
}

function safeErrorName(error: unknown): string | undefined {
  try {
    if (error === null || typeof error !== "object") return undefined;
    if (typeof DOMException !== "undefined" && error instanceof DOMException) {
      const descriptor = Object.getOwnPropertyDescriptor(DOMException.prototype, "name");
      if (descriptor?.get) {
        const nativeName = Reflect.apply(descriptor.get, error, []) as unknown;
        return typeof nativeName === "string" ? nativeName : undefined;
      }
    }
    let current: object | null = error;
    while (current) {
      const descriptor = Object.getOwnPropertyDescriptor(current, "name");
      if (descriptor) {
        return "value" in descriptor && typeof descriptor.value === "string"
          ? descriptor.value
          : undefined;
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Convert browser/adapter failures without leaking raw strings across the boundary. */
export function normalizeAssetRepositoryError(
  error: unknown,
  options: Pick<AssetRepositoryErrorOptions, "operation" | "assetId">,
): AssetRepositoryError {
  if (isAssetRepositoryError(error)) return error;
  const name = safeErrorName(error);
  const mappedCode: AssetRepositoryErrorCode = name === "QuotaExceededError"
    ? "ASSET_QUOTA_EXCEEDED"
    : name === "NotFoundError"
      ? "ASSET_NOT_FOUND"
      : name === "AbortError"
        ? "ASSET_TRANSACTION_ABORTED"
        : name === "DataError" || name === "DataCloneError" || name === "TypeError"
          ? "ASSET_INVALID_INPUT"
          : "ASSET_STORAGE_UNAVAILABLE";
  return new AssetRepositoryError(
    mappedCode,
    `Asset repository ${options.operation} failed${options.assetId ? ` for ${options.assetId}` : ""}.`,
    { ...options, cause: error },
  );
}

/** Input metadata; blob-derived fields are calculated by the repository. */
export interface AssetMetadata {
  id: EntityId;
  name: string;
  width: number;
  height: number;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
  provenance: AssetProvenance;
  declaredMimeType?: string;
  expectedContentHash?: string;
}

export interface AssetOperationOptions {
  signal?: AbortSignal;
}

/** Race non-cancelable browser work with AbortSignal and detach every listener. */
export function awaitAbortableAssetOperation<T>(
  work: PromiseLike<T>,
  options: AssetOperationOptions | undefined,
  operation: AssetRepositoryOperation,
  assetId?: EntityId,
): Promise<T> {
  const signal = options?.signal;
  if (!signal) return Promise.resolve(work);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = (): void => finish(() => reject(new AssetRepositoryError(
      "ASSET_TRANSACTION_ABORTED",
      `Asset repository ${operation} was aborted${assetId ? ` for ${assetId}` : ""}.`,
      { operation, assetId, cause: signal.reason },
    )));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(work).then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
    if (signal.aborted) onAbort();
  });
}

export interface AssetListOptions extends AssetOperationOptions {
  contentHash?: string;
}

export type AssetRemovalPolicy = "reject-if-leased" | "release-and-remove";

export interface AssetPayload {
  record: AssetRecord;
  blob: Blob;
}

export type AssetIntegrityStatus =
  | "ok"
  | "metadata-missing"
  | "blob-missing"
  | "size-mismatch"
  | "hash-mismatch"
  | "mime-mismatch";

interface AssetIntegrityIdentity {
  assetId: EntityId;
}

interface AssetIntegrityObserved {
  expectedHash: string;
  actualHash: string;
  expectedByteSize: number;
  actualByteSize: number;
  expectedMimeType: string;
  actualMimeType: string;
}

export type AssetIntegrity =
  | (AssetIntegrityIdentity & AssetIntegrityObserved & { status: "ok" })
  | (AssetIntegrityIdentity & { status: "metadata-missing" })
  | (AssetIntegrityIdentity & {
      status: "blob-missing";
      expectedHash: string;
      expectedByteSize: number;
      expectedMimeType: string;
    })
  | (AssetIntegrityIdentity & AssetIntegrityObserved & { status: "size-mismatch" })
  | (AssetIntegrityIdentity & AssetIntegrityObserved & { status: "hash-mismatch" })
  | (AssetIntegrityIdentity & AssetIntegrityObserved & { status: "mime-mismatch" });

export type AssetStorageIntegrityIssueCode =
  | "metadata-envelope-invalid"
  | "metadata-duplicate"
  | "blob-envelope-invalid"
  | "blob-duplicate"
  | "blob-identity-missing";

/** Corruption in the IndexedDB envelope that cannot be represented as one asset check. */
export interface AssetStorageIntegrityIssue {
  code: AssetStorageIntegrityIssueCode;
  assetId?: EntityId;
  blobKey?: string;
}

/** A global blob with no metadata references in any project at snapshot time. */
export interface AssetGarbageCollectionCandidate {
  blobKey: string;
  byteSize: number;
  contentHash?: string;
  reason: "unreferenced";
}

export interface AssetGarbageCollectionPreview {
  mode: "preview";
  candidates: readonly AssetGarbageCollectionCandidate[];
  reclaimableBytes: number;
}

export interface AssetIntegrityScanSummary {
  assetCount: number;
  okCount: number;
  assetIssueCount: number;
  storageIssueCount: number;
  orphanBlobCount: number;
  reclaimableBytes: number;
}

/** Deterministic, read-only health report from one consistent storage snapshot. */
export interface AssetIntegrityScan {
  projectId: EntityId;
  assets: readonly AssetIntegrity[];
  storageIssues: readonly AssetStorageIntegrityIssue[];
  garbageCollection: AssetGarbageCollectionPreview;
  summary: AssetIntegrityScanSummary;
}

/**
 * Project-scoped durable binary boundary. Runtime URL leases never enter the
 * returned AssetRecord or the canonical project document.
 */
export interface AssetRepository {
  readonly projectId: EntityId;
  put(
    blob: Blob,
    metadata: AssetMetadata,
    options?: AssetOperationOptions,
  ): Promise<AssetRecord>;
  getMetadata(assetId: EntityId, options?: AssetOperationOptions): Promise<AssetRecord>;
  getBlob(assetId: EntityId, options?: AssetOperationOptions): Promise<Blob>;
  list(options?: AssetListOptions): Promise<readonly AssetRecord[]>;
  verify(assetId: EntityId, options?: AssetOperationOptions): Promise<AssetIntegrity>;
  scanIntegrity(options?: AssetOperationOptions): Promise<AssetIntegrityScan>;
  remove(
    assetId: EntityId,
    policy: AssetRemovalPolicy,
    options?: AssetOperationOptions,
  ): Promise<void>;
  exportMany(
    assetIds: readonly EntityId[],
    options?: AssetOperationOptions,
  ): AsyncIterable<AssetPayload>;
  createRuntimeUrl(
    assetId: EntityId,
    owner: object,
    options?: AssetOperationOptions,
  ): Promise<string>;
  releaseRuntimeUrl(assetId: EntityId, owner: object): void;
  releaseOwner(owner: object): void;
  dispose(): void;
}
