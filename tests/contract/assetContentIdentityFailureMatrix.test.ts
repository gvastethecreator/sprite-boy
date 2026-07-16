import { describe, expect, it, vi } from "vitest";
import {
  assertAssetRecordContentIdentity,
  computeAssetContentIdentity,
  inspectNativeAssetBlob,
  validateAssetContentIdentity,
} from "../../core/assets";
import type { AssetContentIdentity, AssetDigest } from "../../core/assets";
import type { AssetRecord } from "../../core/project";

const HASH = "a".repeat(64);
const VERIFICATION_HASH = "b".repeat(128);

function identity(): AssetContentIdentity {
  return {
    contentHash: HASH,
    blobKey: `sha256:${HASH}`,
    verificationHash: VERIFICATION_HASH,
    byteSize: 3,
  };
}

function record(): AssetRecord {
  return {
    id: "asset-boundary",
    name: "Boundary asset",
    blobKey: `sha256:${HASH}`,
    contentHash: HASH,
    mimeType: "text/plain",
    width: 1,
    height: 1,
    byteSize: 3,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    provenance: { source: "fixture" },
  };
}

describe("asset content identity failure matrix", () => {
  it("rejects non-native Blob values without consulting hostile properties", async () => {
    expect(inspectNativeAssetBlob(null)).toBeUndefined();
    expect(inspectNativeAssetBlob({})).toBeUndefined();
    expect(inspectNativeAssetBlob(new Proxy(new Blob(["abc"]), {}))).toMatchObject({
      byteSize: 3,
      mimeType: "",
    });

    await expect(computeAssetContentIdentity({} as Blob)).rejects.toMatchObject({
      code: "ASSET_INVALID_INPUT",
      operation: "verify",
    });

    const sliceDescriptor = Object.getOwnPropertyDescriptor(Blob.prototype, "slice");
    if (!sliceDescriptor) throw new Error("Blob.slice descriptor missing in test runtime.");
    Object.defineProperty(Blob.prototype, "slice", { configurable: true, value: null });
    try {
      expect(inspectNativeAssetBlob(new Blob(["abc"]))).toBeUndefined();
    } finally {
      Object.defineProperty(Blob.prototype, "slice", sliceDescriptor);
    }
  });

  it("types Blob read, digest rejection and unreadable digest failures", async () => {
    const arrayBuffer = vi.spyOn(Blob.prototype, "arrayBuffer")
      .mockRejectedValueOnce(new Error("fixture read failure"));
    try {
      await expect(computeAssetContentIdentity(new Blob(["abc"]))).rejects.toMatchObject({
        code: "ASSET_INVALID_INPUT",
        operation: "verify",
      });
    } finally {
      arrayBuffer.mockRestore();
    }

    const rejected: AssetDigest = async () => {
      throw new Error("fixture digest failure");
    };
    await expect(computeAssetContentIdentity(new Blob(["abc"]), { digest: rejected }))
      .rejects.toMatchObject({ code: "ASSET_STORAGE_UNAVAILABLE", operation: "verify" });

    const unreadable = new Proxy(new ArrayBuffer(32), {});
    const unreadableDigest: AssetDigest = async (algorithm) => (
      algorithm === "SHA-256" ? unreadable : new ArrayBuffer(64)
    );
    await expect(computeAssetContentIdentity(new Blob(["abc"]), { digest: unreadableDigest }))
      .rejects.toMatchObject({ code: "ASSET_STORAGE_UNAVAILABLE", operation: "verify" });
  });

  it("validates every identity field as an own canonical data value", () => {
    expect(validateAssetContentIdentity(identity())).toEqual(identity());

    const invalidValues: unknown[] = [
      null,
      {},
      { ...identity(), contentHash: "A".repeat(64) },
      { ...identity(), blobKey: `sha256:${"c".repeat(64)}` },
      { ...identity(), verificationHash: "short" },
      { ...identity(), byteSize: -1 },
      { ...identity(), byteSize: 1.5 },
    ];
    for (const value of invalidValues) {
      expect(() => validateAssetContentIdentity(value, {
        operation: "get-blob",
        assetId: "asset-boundary",
      })).toThrowError(expect.objectContaining({
        code: "ASSET_STORAGE_UNAVAILABLE",
        operation: "get-blob",
        assetId: "asset-boundary",
      }));
    }
  });

  it("checks every durable asset metadata field against verified bytes", () => {
    const blob = new Blob(["abc"], { type: "text/plain" });
    const verified = identity();
    const failures: Array<{ blob: Blob; record: AssetRecord }> = [
      { blob: {} as Blob, record: record() },
      { blob, record: { ...record(), contentHash: "c".repeat(64) } },
      { blob, record: { ...record(), blobKey: `sha256:${"c".repeat(64)}` } },
      { blob, record: { ...record(), byteSize: 4 } },
      { blob, record: { ...record(), mimeType: "image/png" } },
    ];

    for (const failure of failures) {
      expect(() => assertAssetRecordContentIdentity(
        failure.record,
        failure.blob,
        verified,
        "verify",
      )).toThrowError(expect.objectContaining({
        code: "ASSET_INTEGRITY_MISMATCH",
        operation: "verify",
        assetId: "asset-boundary",
      }));
    }
  });
});
