import { describe, expect, it } from "vitest";
import {
  assertAssetRecordContentIdentity,
  assertNoAssetContentCollision,
  computeAssetContentIdentity,
  validateAssetContentIdentity,
} from "../../core/assets";
import type { AssetDigest, AssetContentIdentity } from "../../core/assets";
import type { AssetRecord } from "../../core/project";

const ABC_SHA256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const ABC_SHA512 = "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f";
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const record = (identity: AssetContentIdentity): AssetRecord => ({
  id: "asset-identity",
  name: "Identity asset",
  blobKey: identity.blobKey,
  contentHash: identity.contentHash,
  mimeType: "text/plain",
  width: 1,
  height: 1,
  byteSize: identity.byteSize,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  provenance: { source: "fixture" },
});

describe("asset content identity (F2-03)", () => {
  it("matches known SHA-256 and SHA-512 vectors", async () => {
    const abc = await computeAssetContentIdentity(new Blob(["abc"], { type: "text/plain" }));
    const empty = await computeAssetContentIdentity(new Blob([]));

    expect(abc).toEqual({
      contentHash: ABC_SHA256,
      blobKey: `sha256:${ABC_SHA256}`,
      verificationHash: ABC_SHA512,
      byteSize: 3,
    });
    expect(empty.contentHash).toBe(EMPTY_SHA256);
    expect(empty.blobKey).toBe(`sha256:${EMPTY_SHA256}`);
    expect(empty.byteSize).toBe(0);
  });

  it("deduplicates by bytes independently of the Blob MIME wrapper", async () => {
    const plain = await computeAssetContentIdentity(new Blob(["abc"], { type: "text/plain" }));
    const binary = await computeAssetContentIdentity(
      new Blob(["abc"], { type: "application/octet-stream" }),
    );
    expect(binary).toEqual(plain);
    expect(() => assertNoAssetContentCollision(plain, binary, "asset-identity"))
      .not.toThrow();
  });

  it("rejects a forced SHA-256 key collision when the independent verifier differs", () => {
    const first: AssetContentIdentity = {
      contentHash: "a".repeat(64),
      blobKey: `sha256:${"a".repeat(64)}`,
      verificationHash: "b".repeat(128),
      byteSize: 4,
    };
    const colliding: AssetContentIdentity = {
      ...first,
      verificationHash: "c".repeat(128),
    };
    expect(() => assertNoAssetContentCollision(first, colliding, "asset-collision"))
      .toThrowError(expect.objectContaining({
        code: "ASSET_INTEGRITY_MISMATCH",
        operation: "put",
        assetId: "asset-collision",
      }));
  });

  it("rejects metadata that does not describe the payload", async () => {
    const blob = new Blob(["abc"], { type: "text/plain" });
    const identity = await computeAssetContentIdentity(blob);
    expect(() => assertAssetRecordContentIdentity(
      { ...record(identity), contentHash: "0".repeat(64) },
      blob,
      identity,
    )).toThrowError(expect.objectContaining({
      code: "ASSET_INTEGRITY_MISMATCH",
      operation: "put",
    }));
  });

  it("aborts after an in-flight digest without returning an identity", async () => {
    const controller = new AbortController();
    const pendingResolvers: Array<(value: ArrayBuffer) => void> = [];
    const digest: AssetDigest = (_algorithm, data) => new Promise((resolve) => {
      pendingResolvers.push(() => resolve(data.slice(0)));
    });
    const pending = computeAssetContentIdentity(new Blob(["abc"]), {
      signal: controller.signal,
      digest,
    });
    for (let turn = 0; turn < 5 && pendingResolvers.length < 2; turn += 1) {
      await Promise.resolve();
    }
    controller.abort("cancel hashing");
    pendingResolvers.forEach((resolve) => resolve(new ArrayBuffer(0)));
    await expect(pending).rejects.toMatchObject({
      code: "ASSET_TRANSACTION_ABORTED",
      operation: "verify",
    });
  });

  it("settles promptly when an in-flight digest never resolves", async () => {
    const controller = new AbortController();
    let calls = 0;
    const digest: AssetDigest = () => {
      calls += 1;
      return new Promise(() => undefined);
    };
    const pending = computeAssetContentIdentity(new Blob(["abc"]), {
      signal: controller.signal,
      digest,
    });
    for (let turn = 0; turn < 10 && calls < 2; turn += 1) await Promise.resolve();
    expect(calls).toBe(2);
    controller.abort("cancel stuck digest");
    await expect(pending).rejects.toMatchObject({
      code: "ASSET_TRANSACTION_ABORTED",
      operation: "verify",
    });
  });

  it("reports missing or malformed digest providers as typed failures", async () => {
    await expect(computeAssetContentIdentity(new Blob(["abc"]), { digest: null }))
      .rejects.toMatchObject({
        code: "ASSET_STORAGE_UNAVAILABLE",
        operation: "verify",
      });
    const malformed: AssetDigest = async () => new ArrayBuffer(1);
    await expect(computeAssetContentIdentity(new Blob(["abc"]), { digest: malformed }))
      .rejects.toMatchObject({
        code: "ASSET_STORAGE_UNAVAILABLE",
        operation: "verify",
      });
    const missing: AssetDigest = async () => undefined as unknown as ArrayBuffer;
    await expect(computeAssetContentIdentity(new Blob(["abc"]), { digest: missing }))
      .rejects.toMatchObject({
        code: "ASSET_STORAGE_UNAVAILABLE",
        operation: "verify",
      });
  });

  it("rejects accessor-based provider results without invoking the accessor", () => {
    let reads = 0;
    const identity = {
      contentHash: ABC_SHA256,
      blobKey: `sha256:${ABC_SHA256}`,
      verificationHash: ABC_SHA512,
      byteSize: 3,
    };
    Object.defineProperty(identity, "contentHash", {
      enumerable: true,
      get() {
        reads += 1;
        return ABC_SHA256;
      },
    });
    expect(() => validateAssetContentIdentity(identity))
      .toThrowError(expect.objectContaining({
        code: "ASSET_STORAGE_UNAVAILABLE",
        operation: "verify",
      }));
    expect(reads).toBe(0);
  });
});
