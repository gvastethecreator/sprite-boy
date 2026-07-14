import { describe, expect, it } from "vitest";
import {
  ASSET_REPOSITORY_ERROR_CODES,
  AssetRepositoryError,
  isAssetRepositoryError,
  normalizeAssetRepositoryError,
} from "../../core/assets";
import type {
  AssetMetadata,
  AssetRepository,
  AssetRepositoryDiagnostic,
} from "../../core/assets";
import type { AssetRecord } from "../../core/project";

const metadata: AssetMetadata = {
  id: "asset-contract",
  name: "Contract sprite",
  width: 16,
  height: 16,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  provenance: { source: "fixture" },
  declaredMimeType: "image/png",
};

const contractRecord: AssetRecord = {
  id: metadata.id,
  name: metadata.name,
  width: metadata.width,
  height: metadata.height,
  createdAt: metadata.createdAt,
  updatedAt: metadata.updatedAt,
  provenance: metadata.provenance,
  blobKey: "sha256:contract",
  contentHash: "contract",
  mimeType: "image/png",
  byteSize: 4,
};

const fakeRepository: AssetRepository = {
  projectId: "project-contract",
  put: async () => contractRecord,
  getMetadata: async () => contractRecord,
  getBlob: async () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
  list: async () => [contractRecord],
  verify: async () => ({
    assetId: "asset-contract",
    status: "ok",
    expectedHash: contractRecord.contentHash,
    actualHash: contractRecord.contentHash,
    expectedByteSize: contractRecord.byteSize,
    actualByteSize: contractRecord.byteSize,
    expectedMimeType: contractRecord.mimeType,
    actualMimeType: contractRecord.mimeType,
  }),
  remove: async () => undefined,
  async *exportMany() {
    yield {
      record: await fakeRepository.getMetadata("asset-contract"),
      blob: await fakeRepository.getBlob("asset-contract"),
    };
  },
  createRuntimeUrl: async () => "blob:runtime-only",
  releaseRuntimeUrl: () => undefined,
  releaseOwner: () => undefined,
  dispose: () => undefined,
};

describe("AssetRepository contract (F2-01)", () => {
  it("keeps one project-scoped typed boundary for metadata, blobs, exports and leases", async () => {
    expect(fakeRepository.projectId).toBe("project-contract");
    const record = await fakeRepository.put(new Blob(["test"], { type: "image/png" }), metadata);
    expect(record).toMatchObject({
      id: "asset-contract",
      blobKey: "sha256:contract",
      contentHash: "contract",
      mimeType: "image/png",
      byteSize: 4,
    });
    expect(JSON.stringify(record)).not.toContain("blob:");
    const exported = [];
    for await (const payload of fakeRepository.exportMany([record.id])) exported.push(payload);
    expect(exported).toHaveLength(1);
    expect(exported[0].blob).toBeInstanceOf(Blob);
  });

  it("publishes unique stable error codes and safe recovery diagnostics", () => {
    expect(new Set(ASSET_REPOSITORY_ERROR_CODES).size).toBe(ASSET_REPOSITORY_ERROR_CODES.length);
    const cause = new Error("low-level detail");
    const error = new AssetRepositoryError(
      "ASSET_INTEGRITY_MISMATCH",
      "Stored bytes no longer match metadata.",
      { operation: "verify", assetId: "asset-corrupt", cause },
    );
    expect(isAssetRepositoryError(error)).toBe(true);
    expect(error).toBeInstanceOf(Error);
    expect(error.recoverable).toBe(true);
    expect(error.recoveryActions).toEqual(["relink", "remove-corrupt"]);
    expect(Object.isFrozen(error.recoveryActions)).toBe(true);
    const diagnostic: AssetRepositoryDiagnostic = error.toDiagnostic();
    expect(diagnostic).toEqual({
      code: "ASSET_INTEGRITY_MISMATCH",
      operation: "verify",
      message: "Stored bytes no longer match metadata.",
      recoverable: true,
      assetId: "asset-corrupt",
      recoveryActions: ["relink", "remove-corrupt"],
    });
    expect(diagnostic).not.toHaveProperty("cause");
  });

  it.each([
    ["QuotaExceededError", "ASSET_QUOTA_EXCEEDED", ["free-space", "export-project", "retry"]],
    ["NotFoundError", "ASSET_NOT_FOUND", ["relink", "retry"]],
    ["AbortError", "ASSET_TRANSACTION_ABORTED", ["retry"]],
    ["DataError", "ASSET_INVALID_INPUT", []],
  ] as const)("normalizes %s without exposing adapter-specific errors", (name, code, actions) => {
    const native = new Error("private adapter message");
    native.name = name;
    const normalized = normalizeAssetRepositoryError(native, {
      operation: "put",
      assetId: "asset-contract",
    });
    expect(normalized.code).toBe(code);
    expect(normalized.recoveryActions).toEqual(actions);
    expect(normalized.message).not.toContain("private adapter message");
    expect(normalized.cause).toBe(native);
  });

  it("normalizes branded DOMException names through the native getter", () => {
    const quota = new DOMException("private quota detail", "QuotaExceededError");
    const normalized = normalizeAssetRepositoryError(quota, {
      operation: "put",
      assetId: "asset-contract",
    });
    expect(normalized.code).toBe("ASSET_QUOTA_EXCEEDED");
    expect(normalized.message).not.toContain("private quota detail");

    let reads = 0;
    Object.defineProperty(quota, "name", {
      configurable: true,
      get() {
        reads += 1;
        throw new Error("must not execute override");
      },
    });
    expect(normalizeAssetRepositoryError(quota, { operation: "put" }).code).toBe(
      "ASSET_QUOTA_EXCEEDED",
    );
    expect(reads).toBe(0);
  });

  it("contains hostile error accessors and maps unknown failures to a recoverable storage error", () => {
    let reads = 0;
    const hostile = {};
    Object.defineProperty(hostile, "name", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not escape");
      },
    });
    const normalized = normalizeAssetRepositoryError(hostile, { operation: "list" });
    expect(reads).toBe(0);
    expect(normalized.code).toBe("ASSET_STORAGE_UNAVAILABLE");
    expect(normalized.recoverable).toBe(true);

    const hostileError = new Error("subclass-like");
    Object.defineProperty(hostileError, "name", {
      enumerable: true,
      get() {
        reads += 1;
        return "QuotaExceededError";
      },
    });
    const contained = normalizeAssetRepositoryError(hostileError, { operation: "put" });
    expect(reads).toBe(0);
    expect(contained.code).toBe("ASSET_STORAGE_UNAVAILABLE");
  });
});
