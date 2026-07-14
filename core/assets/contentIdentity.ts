import type { AssetRecord, EntityId } from "../project/schema";
import { AssetRepositoryError, awaitAbortableAssetOperation } from "./contracts";
import type { AssetOperationOptions, AssetRepositoryOperation } from "./contracts";

export const ASSET_CONTENT_HASH_ALGORITHM = "SHA-256" as const;
export const ASSET_COLLISION_HASH_ALGORITHM = "SHA-512" as const;
export const ASSET_BLOB_KEY_PREFIX = "sha256:" as const;

export interface AssetContentIdentity {
  contentHash: string;
  blobKey: `${typeof ASSET_BLOB_KEY_PREFIX}${string}`;
  verificationHash: string;
  byteSize: number;
}

export type AssetDigest = (
  algorithm: typeof ASSET_CONTENT_HASH_ALGORITHM | typeof ASSET_COLLISION_HASH_ALGORITHM,
  data: ArrayBuffer,
) => Promise<ArrayBuffer>;

export interface AssetContentIdentityOptions extends AssetOperationOptions {
  /** Test/host injection point. `null` explicitly models unavailable Web Crypto. */
  digest?: AssetDigest | null;
}

export type AssetContentIdentityProvider = (
  blob: Blob,
  options?: AssetOperationOptions,
) => Promise<AssetContentIdentity>;

interface IdentityErrorContext {
  operation: AssetRepositoryOperation;
  assetId?: EntityId;
}

function throwIfHashingAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new AssetRepositoryError(
    "ASSET_TRANSACTION_ABORTED",
    "Asset content hashing was aborted.",
    { operation: "verify", cause: signal.reason },
  );
}

function defaultDigest(): AssetDigest | null {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    return (algorithm, data) => subtle.digest(algorithm, data);
  } catch {
    return null;
  }
}

function bytesToHex(buffer: unknown, expectedBytes: number): string {
  let byteLength: number | undefined;
  try {
    const getter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;
    if (getter && buffer !== null && typeof buffer === "object") {
      byteLength = Reflect.apply(getter, buffer, []) as number;
    }
  } catch {
    byteLength = undefined;
  }
  if (byteLength === undefined) {
    throw new AssetRepositoryError(
      "ASSET_STORAGE_UNAVAILABLE",
      "Digest provider returned a non-ArrayBuffer result.",
      { operation: "verify" },
    );
  }
  if (byteLength !== expectedBytes) {
    throw new AssetRepositoryError(
      "ASSET_STORAGE_UNAVAILABLE",
      `Digest provider returned ${byteLength} bytes; expected ${expectedBytes}.`,
      { operation: "verify" },
    );
  }
  try {
    return Array.from(
      new Uint8Array(buffer as ArrayBuffer),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch (cause) {
    throw new AssetRepositoryError(
      "ASSET_STORAGE_UNAVAILABLE",
      "Digest provider result could not be read.",
      { operation: "verify", cause },
    );
  }
}

/** Calculate stable public identity plus an independent collision verifier. */
export async function computeAssetContentIdentity(
  blob: Blob,
  options: AssetContentIdentityOptions = {},
): Promise<AssetContentIdentity> {
  if (!(blob instanceof Blob)) {
    throw new AssetRepositoryError(
      "ASSET_INVALID_INPUT",
      "Asset content identity requires a Blob.",
      { operation: "verify" },
    );
  }
  throwIfHashingAborted(options.signal);
  const digest = options.digest === undefined ? defaultDigest() : options.digest;
  if (!digest) {
    throw new AssetRepositoryError(
      "ASSET_STORAGE_UNAVAILABLE",
      "Web Crypto digest support is unavailable for asset hashing.",
      { operation: "verify" },
    );
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await awaitAbortableAssetOperation(blob.arrayBuffer(), options, "verify");
  } catch (cause) {
    throwIfHashingAborted(options.signal);
    throw new AssetRepositoryError(
      "ASSET_INVALID_INPUT",
      "Asset bytes could not be read for hashing.",
      { operation: "verify", cause },
    );
  }
  throwIfHashingAborted(options.signal);

  let primary: ArrayBuffer;
  let verification: ArrayBuffer;
  try {
    [primary, verification] = await awaitAbortableAssetOperation(
      Promise.all([
        digest(ASSET_CONTENT_HASH_ALGORITHM, bytes),
        digest(ASSET_COLLISION_HASH_ALGORITHM, bytes),
      ]),
      options,
      "verify",
    );
  } catch (cause) {
    throwIfHashingAborted(options.signal);
    throw new AssetRepositoryError(
      "ASSET_STORAGE_UNAVAILABLE",
      "Asset digest computation failed.",
      { operation: "verify", cause },
    );
  }
  throwIfHashingAborted(options.signal);

  const contentHash = bytesToHex(primary, 32);
  return Object.freeze({
    contentHash,
    blobKey: `${ASSET_BLOB_KEY_PREFIX}${contentHash}`,
    verificationHash: bytesToHex(verification, 64),
    byteSize: blob.size,
  });
}

function ownDataValue(value: object, key: keyof AssetContentIdentity): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError(`Asset identity ${key} must be an own data property.`);
  }
  return descriptor.value;
}

function isLowerHex(value: unknown, length: number): value is string {
  return typeof value === "string"
    && value.length === length
    && /^[0-9a-f]+$/.test(value);
}

/** Close the runtime provider boundary without invoking identity accessors. */
export function validateAssetContentIdentity(
  value: unknown,
  context: IdentityErrorContext = { operation: "verify" },
): AssetContentIdentity {
  try {
    if (value === null || typeof value !== "object") throw new TypeError("Identity must be an object.");
    const contentHash = ownDataValue(value, "contentHash");
    const blobKey = ownDataValue(value, "blobKey");
    const verificationHash = ownDataValue(value, "verificationHash");
    const byteSize = ownDataValue(value, "byteSize");
    if (!isLowerHex(contentHash, 64)) throw new TypeError("contentHash must be 64 lowercase hex characters.");
    if (blobKey !== `${ASSET_BLOB_KEY_PREFIX}${contentHash}`) {
      throw new TypeError("blobKey must be derived from contentHash.");
    }
    if (!isLowerHex(verificationHash, 128)) {
      throw new TypeError("verificationHash must be 128 lowercase hex characters.");
    }
    if (!Number.isSafeInteger(byteSize) || (byteSize as number) < 0) {
      throw new TypeError("byteSize must be a non-negative safe integer.");
    }
    return Object.freeze({
      contentHash,
      blobKey: blobKey as AssetContentIdentity["blobKey"],
      verificationHash,
      byteSize: byteSize as number,
    });
  } catch (cause) {
    throw new AssetRepositoryError(
      "ASSET_STORAGE_UNAVAILABLE",
      "Asset content identity provider returned an invalid result.",
      { ...context, cause },
    );
  }
}

function integrityMismatch(message: string, context: IdentityErrorContext): AssetRepositoryError {
  return new AssetRepositoryError("ASSET_INTEGRITY_MISMATCH", message, context);
}

/** Ensure durable metadata describes the exact incoming bytes. */
export function assertAssetRecordContentIdentity(
  record: AssetRecord,
  blob: Blob,
  identity: AssetContentIdentity,
  operation: AssetRepositoryOperation = "put",
): void {
  const context = { operation, assetId: record.id } satisfies IdentityErrorContext;
  if (record.contentHash !== identity.contentHash) {
    throw integrityMismatch("Asset metadata contentHash does not match the payload.", context);
  }
  if (record.blobKey !== identity.blobKey) {
    throw integrityMismatch("Asset metadata blobKey does not match the payload.", context);
  }
  if (record.byteSize !== identity.byteSize || record.byteSize !== blob.size) {
    throw integrityMismatch("Asset metadata byteSize does not match the payload.", context);
  }
  if (record.mimeType !== blob.type) {
    throw integrityMismatch("Asset metadata mimeType does not match the payload.", context);
  }
}

/** Reject a same-key/different-bytes result before metadata can reference it. */
export function assertNoAssetContentCollision(
  stored: AssetContentIdentity,
  incoming: AssetContentIdentity,
  assetId?: EntityId,
): void {
  if (
    stored.blobKey === incoming.blobKey
    && stored.contentHash === incoming.contentHash
    && stored.verificationHash === incoming.verificationHash
    && stored.byteSize === incoming.byteSize
  ) {
    return;
  }
  throw new AssetRepositoryError(
    "ASSET_INTEGRITY_MISMATCH",
    "Asset content key collision detected; existing bytes were preserved.",
    { operation: "put", assetId },
  );
}
