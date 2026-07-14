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
  | "put"
  | "get-metadata"
  | "get-blob"
  | "list"
  | "verify"
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
        : name === "DataError" || name === "TypeError"
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
