import type { EntityId } from "../project/schema";
import { isEntityId } from "../project/primitives";
import {
  AssetRepositoryError,
  awaitAbortableAssetOperation,
  isAssetRepositoryError,
  normalizeAssetRepositoryError,
} from "./contracts";
import type {
  AssetOperationOptions,
  AssetRepositoryDiagnostic,
} from "./contracts";

export type AssetBlobLoader = (
  assetId: EntityId,
  options?: AssetOperationOptions,
) => Promise<Blob>;

export interface RuntimeObjectUrlHost {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export interface RuntimeUrlRegistryOptions {
  host?: RuntimeObjectUrlHost | null;
  onError?: (diagnostic: AssetRepositoryDiagnostic) => void;
}

interface OwnerLease {
  readonly released: Promise<void>;
  release(): void;
}

interface RuntimeUrlEntry {
  readonly assetId: EntityId;
  readonly leases: Map<object, OwnerLease>;
  readonly loadController: AbortController;
  readonly promise: Promise<string>;
  url?: string;
}

type LeaseWaitResult =
  | { status: "ready"; url: string }
  | { status: "released" };

function createOwnerLease(): OwnerLease {
  let resolveReleased!: () => void;
  let released = false;
  const promise = new Promise<void>((resolve) => {
    resolveReleased = resolve;
  });
  return {
    released: promise,
    release() {
      if (released) return;
      released = true;
      resolveReleased();
    },
  };
}

function defaultHost(): RuntimeObjectUrlHost | null {
  try {
    if (
      typeof URL === "undefined"
      || typeof URL.createObjectURL !== "function"
      || typeof URL.revokeObjectURL !== "function"
    ) {
      return null;
    }
    return {
      createObjectURL: (blob) => URL.createObjectURL(blob),
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
    };
  } catch {
    return null;
  }
}

function isOwner(value: unknown): value is object {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function invalidInput(message: string, assetId?: EntityId): AssetRepositoryError {
  return new AssetRepositoryError("ASSET_INVALID_INPUT", message, {
    operation: "create-url",
    assetId,
  });
}

function leaseConflict(message: string, assetId?: EntityId, cause?: unknown): AssetRepositoryError {
  return new AssetRepositoryError("ASSET_LEASE_CONFLICT", message, {
    operation: "create-url",
    assetId,
    cause,
  });
}

function createUrlError(error: unknown, assetId: EntityId): AssetRepositoryError {
  if (isAssetRepositoryError(error)) {
    if (error.operation === "create-url" && error.assetId === assetId) return error;
    return new AssetRepositoryError(error.code, error.message, {
      operation: "create-url",
      assetId,
      recoverable: error.recoverable,
      recoveryActions: error.recoveryActions,
      cause: error,
    });
  }
  return normalizeAssetRepositoryError(error, { operation: "create-url", assetId });
}

/**
 * Runtime-only Object URL owner registry. One owner has at most one lease per
 * asset; one asset has at most one URL regardless of owner count.
 */
export class RuntimeUrlRegistry {
  private readonly loadBlob: AssetBlobLoader;
  private readonly host: RuntimeObjectUrlHost | null;
  private readonly onError?: (diagnostic: AssetRepositoryDiagnostic) => void;
  private readonly entries = new Map<EntityId, RuntimeUrlEntry>();
  private readonly assetsByOwner = new Map<object, Set<EntityId>>();
  private readonly assetByUrl = new Map<string, EntityId>();
  private disposed = false;

  constructor(loadBlob: AssetBlobLoader, options: RuntimeUrlRegistryOptions = {}) {
    if (typeof loadBlob !== "function") {
      throw invalidInput("Runtime URL registry requires an asset Blob loader.");
    }
    this.loadBlob = loadBlob;
    this.host = options.host === undefined ? defaultHost() : options.host;
    this.onError = options.onError;
  }

  private report(error: AssetRepositoryError): void {
    if (!this.onError) return;
    try {
      this.onError(error.toDiagnostic());
    } catch {
      // Diagnostics must never break lease cleanup.
    }
  }

  private requireHost(assetId: EntityId): RuntimeObjectUrlHost {
    if (this.host) return this.host;
    throw new AssetRepositoryError(
      "ASSET_STORAGE_UNAVAILABLE",
      "Object URL APIs are unavailable in this environment.",
      { operation: "create-url", assetId },
    );
  }

  private addReverseLease(owner: object, assetId: EntityId): void {
    const assets = this.assetsByOwner.get(owner) ?? new Set<EntityId>();
    assets.add(assetId);
    this.assetsByOwner.set(owner, assets);
  }

  private removeReverseLease(owner: object, assetId: EntityId): void {
    const assets = this.assetsByOwner.get(owner);
    if (!assets) return;
    assets.delete(assetId);
    if (assets.size === 0) this.assetsByOwner.delete(owner);
  }

  private clearEntryLeases(entry: RuntimeUrlEntry, signalRelease = true): void {
    for (const [owner, lease] of entry.leases) {
      this.removeReverseLease(owner, entry.assetId);
      if (signalRelease) lease.release();
    }
    entry.leases.clear();
  }

  private revoke(entry: RuntimeUrlEntry): void {
    const url = entry.url;
    entry.url = undefined;
    if (!url) return;
    if (this.assetByUrl.get(url) === entry.assetId) this.assetByUrl.delete(url);
    try {
      this.requireHost(entry.assetId).revokeObjectURL(url);
    } catch (cause) {
      const error = new AssetRepositoryError(
        "ASSET_STORAGE_UNAVAILABLE",
        `Object URL revoke failed for ${entry.assetId}.`,
        { operation: "release-url", assetId: entry.assetId, cause },
      );
      this.report(error);
    }
  }

  private discardEntry(entry: RuntimeUrlEntry): void {
    if (this.entries.get(entry.assetId) === entry) this.entries.delete(entry.assetId);
    this.clearEntryLeases(entry);
    entry.loadController.abort("No runtime URL leases remain.");
    this.revoke(entry);
  }

  private createEntry(assetId: EntityId): RuntimeUrlEntry {
    const loadController = new AbortController();
    const entry: RuntimeUrlEntry = {
      assetId,
      leases: new Map<object, OwnerLease>(),
      loadController,
      promise: undefined as unknown as Promise<string>,
    };
    const promise = Promise.resolve()
      .then(() => this.loadBlob(assetId, { signal: loadController.signal }))
      .then((blob) => {
        if (!(blob instanceof Blob)) {
          throw new AssetRepositoryError(
            "ASSET_BLOB_MISSING",
            `Asset Blob ${assetId} is unavailable for a runtime URL.`,
            { operation: "create-url", assetId },
          );
        }
        const host = this.requireHost(assetId);
        const url = host.createObjectURL(blob);
        if (typeof url !== "string" || url.length === 0) {
          throw new AssetRepositoryError(
            "ASSET_STORAGE_UNAVAILABLE",
            `Object URL host returned an invalid URL for ${assetId}.`,
            { operation: "create-url", assetId },
          );
        }
        const existingAssetId = this.assetByUrl.get(url);
        if (existingAssetId !== undefined) {
          throw leaseConflict(
            `Object URL host reused a URL already owned by ${existingAssetId}.`,
            assetId,
          );
        }
        if (
          this.disposed
          || this.entries.get(assetId) !== entry
          || entry.leases.size === 0
        ) {
          try {
            host.revokeObjectURL(url);
          } catch (cause) {
            this.report(new AssetRepositoryError(
              "ASSET_STORAGE_UNAVAILABLE",
              `Discarded Object URL revoke failed for ${assetId}.`,
              { operation: "release-url", assetId, cause },
            ));
          }
          return url;
        }
        entry.url = url;
        this.assetByUrl.set(url, assetId);
        return url;
      })
      .catch((error: unknown) => {
        const normalized = createUrlError(error, assetId);
        if (this.entries.get(assetId) === entry) this.entries.delete(assetId);
        this.clearEntryLeases(entry, false);
        throw normalized;
      });
    Object.defineProperty(entry, "promise", { value: promise });
    // A released last owner may leave no waiter while host work settles.
    void promise.catch(() => undefined);
    return entry;
  }

  async acquire(
    assetId: EntityId,
    owner: object,
    options?: AssetOperationOptions,
  ): Promise<string> {
    if (!isEntityId(assetId)) throw invalidInput("Asset id must be a non-empty string.");
    if (!isOwner(owner)) throw invalidInput("Runtime URL owner must be an object.", assetId);
    if (options?.signal?.aborted) {
      throw new AssetRepositoryError(
        "ASSET_TRANSACTION_ABORTED",
        `Runtime URL acquisition was aborted for ${assetId}.`,
        { operation: "create-url", assetId, cause: options.signal.reason },
      );
    }
    if (this.disposed) throw leaseConflict("Runtime URL registry is disposed.", assetId);
    this.requireHost(assetId);

    let entry = this.entries.get(assetId);
    if (!entry) {
      entry = this.createEntry(assetId);
      this.entries.set(assetId, entry);
    }
    let lease = entry.leases.get(owner);
    if (!lease) {
      lease = createOwnerLease();
      entry.leases.set(owner, lease);
      this.addReverseLease(owner, assetId);
    }
    if (entry.url) return entry.url;

    try {
      const result = await awaitAbortableAssetOperation<LeaseWaitResult>(
        Promise.race([
          entry.promise.then((url): LeaseWaitResult => ({ status: "ready", url })),
          lease.released.then((): LeaseWaitResult => ({ status: "released" })),
        ]),
        options,
        "create-url",
        assetId,
      );
      if (result.status === "released" || !entry.leases.has(owner) || entry.url !== result.url) {
        throw leaseConflict(`Runtime URL lease was released before ${assetId} became ready.`, assetId);
      }
      return result.url;
    } catch (error) {
      if (options?.signal?.aborted) this.release(assetId, owner);
      throw createUrlError(error, assetId);
    }
  }

  release(assetId: EntityId, owner: object): void {
    if (!isEntityId(assetId) || !isOwner(owner)) return;
    const entry = this.entries.get(assetId);
    const lease = entry?.leases.get(owner);
    if (!entry || !lease) return;
    entry.leases.delete(owner);
    this.removeReverseLease(owner, assetId);
    lease.release();
    if (entry.leases.size === 0) this.discardEntry(entry);
  }

  releaseOwner(owner: object): void {
    if (!isOwner(owner)) return;
    const assetIds = [...(this.assetsByOwner.get(owner) ?? [])];
    for (const assetId of assetIds) this.release(assetId, owner);
  }

  releaseAsset(assetId: EntityId): void {
    if (!isEntityId(assetId)) return;
    const entry = this.entries.get(assetId);
    if (entry) this.discardEntry(entry);
  }

  hasLeases(assetId: EntityId): boolean {
    return (this.entries.get(assetId)?.leases.size ?? 0) > 0;
  }

  leaseCount(assetId: EntityId): number {
    return this.entries.get(assetId)?.leases.size ?? 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) this.discardEntry(entry);
    this.entries.clear();
    this.assetsByOwner.clear();
    this.assetByUrl.clear();
  }
}
