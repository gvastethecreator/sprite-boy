import { describe, expect, it, vi } from "vitest";
import type { AssetIntegrity, AssetIntegrityStatus } from "../../core/assets";
import type { AssetRecord, StudioProjectV1 } from "../../core/project";
import {
  assessProjectRecovery,
  ProjectRecoveryError,
  projectCodec,
} from "../../core/persistence";
import type {
  AssessProjectRecoveryOptions,
  ProjectRecoveryAssetVerifier,
} from "../../core/persistence";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

function cloneFixture(): StudioProjectV1 {
  return structuredClone(studioProjectV1Fixture);
}

function observedIntegrity(record: AssetRecord, status: AssetIntegrityStatus): AssetIntegrity {
  if (status === "metadata-missing") return { assetId: record.id, status };
  if (status === "blob-missing") {
    return {
      assetId: record.id,
      status,
      expectedHash: record.contentHash,
      expectedByteSize: record.byteSize,
      expectedMimeType: record.mimeType,
    };
  }
  const observed = {
    assetId: record.id,
    status,
    expectedHash: record.contentHash,
    actualHash: status === "hash-mismatch" ? `${record.contentHash}:corrupt` : record.contentHash,
    expectedByteSize: record.byteSize,
    actualByteSize: status === "size-mismatch" ? record.byteSize + 1 : record.byteSize,
    expectedMimeType: record.mimeType,
    actualMimeType: status === "mime-mismatch" ? "application/octet-stream" : record.mimeType,
  } as const;
  return observed;
}

function verifierWith(
  statuses: Partial<Record<string, AssetIntegrityStatus>> = {},
): ProjectRecoveryAssetVerifier & { verify: ReturnType<typeof vi.fn> } {
  return {
    verify: vi.fn(async (assetId: string) => {
      const record = studioProjectV1Fixture.assets[assetId];
      if (!record) throw new Error("unknown test asset");
      return observedIntegrity(record, statuses[assetId] ?? "ok");
    }),
  };
}

describe("project recovery report (F3-06)", () => {
  it("quarantines a verified candidate and only marks it activatable when every asset is healthy", async () => {
    const verifier = verifierWith();
    const activeProject = cloneFixture();
    activeProject.name = "Active project must stay untouched";
    const before = structuredClone(activeProject);

    const assessment = await assessProjectRecovery(projectCodec.encode(studioProjectV1Fixture), {
      source: "autosave-checkpoint",
      assetVerifier: verifier,
    });

    expect(assessment.report).toEqual({
      format: "spriteboy-project-recovery",
      formatVersion: 1,
      source: "autosave-checkpoint",
      disposition: "ready",
      canActivate: true,
      schemaVersion: 1,
      projectId: studioProjectV1Fixture.id,
      issues: [],
      actions: [],
    });
    expect(assessment.quarantinedProject).toEqual(studioProjectV1Fixture);
    expect(Object.isFrozen(assessment)).toBe(true);
    expect(Object.isFrozen(assessment.report)).toBe(true);
    expect(Object.isFrozen(assessment.report.issues)).toBe(true);
    expect(Object.isFrozen(assessment.report.actions)).toBe(true);
    expect(Object.isFrozen(assessment.quarantinedProject)).toBe(true);
    expect(Object.isFrozen(assessment.quarantinedProject?.assets)).toBe(true);
    expect(Object.isFrozen(assessment.quarantinedProject?.assets["asset-sheet"])).toBe(true);
    expect(activeProject).toEqual(before);
    expect(verifier.verify.mock.calls.map(([assetId]) => assetId)).toEqual([
      "asset-processed",
      "asset-sheet",
    ]);
  });

  it("blocks future schemas before touching assets and offers upgrade-safe actions", async () => {
    const future = { ...cloneFixture(), schemaVersion: 99 };
    const verifier = verifierWith();

    const assessment = await assessProjectRecovery(JSON.stringify(future), {
      source: "project-file",
      assetVerifier: verifier,
    });

    expect(assessment.report).toMatchObject({
      source: "project-file",
      disposition: "blocked",
      canActivate: false,
      schemaVersion: 99,
      issues: [{ code: "PROJECT_FUTURE_VERSION", severity: "blocker" }],
      actions: [{ type: "export-backup" }, { type: "upgrade-studio" }],
    });
    expect(assessment.quarantinedProject).toBeUndefined();
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it("reports malformed and schema-invalid documents without exposing a candidate", async () => {
    const malformed = await assessProjectRecovery("{broken", { source: "project-file" });
    expect(malformed.report).toMatchObject({
      disposition: "blocked",
      issues: [{ code: "PROJECT_JSON_INVALID", severity: "blocker" }],
      actions: [{ type: "import-backup" }, { type: "restore-checkpoint" }],
    });
    expect(malformed.quarantinedProject).toBeUndefined();

    const invalid = cloneFixture();
    invalid.regions["region-hero"].assetId = "asset-missing";
    const schema = await assessProjectRecovery(JSON.stringify(invalid), {
      source: "autosave-journal",
    });
    expect(schema.report.disposition).toBe("blocked");
    expect(schema.report.canActivate).toBe(false);
    expect(schema.report.issues).toContainEqual(expect.objectContaining({
      code: "PROJECT_DOCUMENT_INVALID",
      path: expect.stringContaining("region-hero"),
    }));
    expect(schema.quarantinedProject).toBeUndefined();
  });

  it.each([
    ["metadata-missing", "ASSET_METADATA_MISSING", ["relink-asset"]],
    ["blob-missing", "ASSET_BLOB_MISSING", ["relink-asset"]],
    ["size-mismatch", "ASSET_SIZE_MISMATCH", ["relink-asset", "remove-corrupt-asset"]],
    ["hash-mismatch", "ASSET_HASH_MISMATCH", ["relink-asset", "remove-corrupt-asset"]],
    ["mime-mismatch", "ASSET_MIME_MISMATCH", ["relink-asset", "remove-corrupt-asset"]],
  ] as const)("classifies %s as a non-activatable recovery report", async (
    status,
    code,
    actionTypes,
  ) => {
    const verifier = verifierWith({ "asset-processed": status });
    const assessment = await assessProjectRecovery(projectCodec.encode(studioProjectV1Fixture), {
      source: "autosave-journal",
      assetVerifier: verifier,
    });

    expect(assessment.report).toMatchObject({
      disposition: "recoverable",
      canActivate: false,
      issues: [{
        code,
        severity: "error",
        assetId: "asset-processed",
        assetStatus: status,
      }],
    });
    expect(assessment.report.actions.map(({ type }) => type).sort()).toEqual([...actionTypes].sort());
    expect(assessment.report.actions.every(({ assetId }) => assetId === "asset-processed")).toBe(true);
    expect(assessment.quarantinedProject).toEqual(studioProjectV1Fixture);
  });

  it("derives integrity from observations and candidate metadata instead of verifier claims", async () => {
    const verifier = verifierWith();
    verifier.verify.mockImplementation(async (assetId: string) => {
      const record = studioProjectV1Fixture.assets[assetId];
      const result = observedIntegrity(record, "ok");
      return assetId === "asset-sheet" && result.status === "ok"
        ? { ...result, expectedHash: "foreign", actualHash: "foreign" }
        : result;
    });

    const assessment = await assessProjectRecovery(projectCodec.encode(studioProjectV1Fixture), {
      assetVerifier: verifier,
    });

    expect(assessment.report).toMatchObject({
      disposition: "recoverable",
      canActivate: false,
      issues: [expect.objectContaining({
        code: "ASSET_HASH_MISMATCH",
        assetId: "asset-sheet",
      })],
    });

    const falseMismatchVerifier: ProjectRecoveryAssetVerifier = {
      async verify(assetId) {
        const record = studioProjectV1Fixture.assets[assetId];
        const healthy = observedIntegrity(record, "ok");
        if (healthy.status !== "ok") throw new Error("invalid test fixture");
        return {
          ...healthy,
          status: "hash-mismatch",
          expectedHash: "foreign",
          expectedByteSize: record.byteSize + 1,
          expectedMimeType: "application/octet-stream",
        };
      },
    };
    const healthy = await assessProjectRecovery(projectCodec.encode(studioProjectV1Fixture), {
      assetVerifier: falseMismatchVerifier,
    });
    expect(healthy.report).toMatchObject({ disposition: "ready", canActivate: true });
    expect(healthy.report.issues).toEqual([]);
  });

  it("blocks valid documents when asset verification is unavailable or fails privately", async () => {
    const unavailable = await assessProjectRecovery(projectCodec.encode(studioProjectV1Fixture));
    expect(unavailable.report).toMatchObject({
      disposition: "blocked",
      canActivate: false,
      issues: [{ code: "ASSET_VERIFIER_UNAVAILABLE", severity: "blocker" }],
      actions: [{ type: "retry-asset-scan" }],
    });

    const verifier = verifierWith();
    verifier.verify.mockRejectedValueOnce(new Error("private storage path"));
    const failed = await assessProjectRecovery(projectCodec.encode(studioProjectV1Fixture), {
      assetVerifier: verifier,
    });
    expect(failed.report).toMatchObject({
      disposition: "blocked",
      canActivate: false,
      issues: [expect.objectContaining({
        code: "ASSET_CHECK_FAILED",
        severity: "blocker",
        assetId: "asset-processed",
      })],
    });
    expect(JSON.stringify(failed.report)).not.toContain("private storage path");
  });

  it("aborts a non-cooperative verifier promptly and redacts the abort cause", async () => {
    let calls = 0;
    const verifier: ProjectRecoveryAssetVerifier = {
      verify() {
        calls += 1;
        return new Promise(() => undefined);
      },
    };
    const controller = new AbortController();
    const pending = assessProjectRecovery(projectCodec.encode(studioProjectV1Fixture), {
      signal: controller.signal,
      assetVerifier: verifier,
    });
    for (let turn = 0; turn < 10 && calls === 0; turn += 1) await Promise.resolve();
    expect(calls).toBe(1);
    controller.abort("private abort reason");
    let failure: ProjectRecoveryError | undefined;
    try {
      await pending;
    } catch (error) {
      failure = error as ProjectRecoveryError;
    }
    expect(failure).toMatchObject({ code: "PROJECT_RECOVERY_ABORTED", operation: "assess" });
    expect(failure?.toDiagnostic()).not.toHaveProperty("cause");
    expect(JSON.stringify(failure?.toDiagnostic())).not.toContain("private abort reason");
  });

  it("removes every abort listener after successful verification", async () => {
    const addListener = vi.spyOn(AbortSignal.prototype, "addEventListener");
    const removeListener = vi.spyOn(AbortSignal.prototype, "removeEventListener");
    try {
      const controller = new AbortController();
      const assessment = await assessProjectRecovery(projectCodec.encode(studioProjectV1Fixture), {
        signal: controller.signal,
        assetVerifier: verifierWith(),
      });
      expect(assessment.report.disposition).toBe("ready");
      expect(addListener).toHaveBeenCalled();
      expect(removeListener.mock.calls).toHaveLength(addListener.mock.calls.length);
    } finally {
      addListener.mockRestore();
      removeListener.mockRestore();
    }
  });

  it("contains hostile option, verifier, result and then accessors without executing them", async () => {
    let optionReads = 0;
    const hostileOptions = {} as AssessProjectRecoveryOptions;
    Object.defineProperty(hostileOptions, "assetVerifier", {
      enumerable: true,
      get() {
        optionReads += 1;
        return verifierWith();
      },
    });
    await expect(assessProjectRecovery("{}", hostileOptions)).rejects.toMatchObject({
      code: "PROJECT_RECOVERY_INVALID_INPUT",
    });
    expect(optionReads).toBe(0);

    let methodReads = 0;
    const hostileVerifier = {} as ProjectRecoveryAssetVerifier;
    Object.defineProperty(hostileVerifier, "verify", {
      get() {
        methodReads += 1;
        return async () => ({ assetId: "x", status: "metadata-missing" });
      },
    });
    await expect(assessProjectRecovery(projectCodec.encode(studioProjectV1Fixture), {
      assetVerifier: hostileVerifier,
    })).rejects.toMatchObject({ code: "PROJECT_RECOVERY_INVALID_INPUT" });
    expect(methodReads).toBe(0);

    let thenReads = 0;
    const hostileThen = {};
    // oxlint-disable-next-line unicorn/no-thenable -- hostile accessor fixture must remain unread
    Object.defineProperty(hostileThen, "then", {
      get() {
        thenReads += 1;
        return undefined;
      },
    });
    const thenVerifier: ProjectRecoveryAssetVerifier = {
      verify: () => hostileThen as PromiseLike<AssetIntegrity>,
    };
    const thenAssessment = await assessProjectRecovery(projectCodec.encode(studioProjectV1Fixture), {
      assetVerifier: thenVerifier,
    });
    expect(thenAssessment.report.issues[0].code).toBe("ASSET_CHECK_FAILED");
    expect(thenReads).toBe(0);

    let nestedThenReads = 0;
    const nestedThenVerifier: ProjectRecoveryAssetVerifier = {
      verify(assetId) {
        const fulfilled = { assetId, status: "metadata-missing" };
        // oxlint-disable-next-line unicorn/no-thenable -- nested hostile accessor fixture must remain unread
        Object.defineProperty(fulfilled, "then", {
          enumerable: true,
          get() {
            nestedThenReads += 1;
            return undefined;
          },
        });
        const promiseLike = {};
        // oxlint-disable-next-line unicorn/no-thenable -- explicit data-method PromiseLike fixture
        Object.defineProperty(promiseLike, "then", {
          value(onFulfilled: (value: AssetIntegrity) => unknown) {
            onFulfilled(fulfilled as AssetIntegrity);
          },
        });
        return promiseLike as PromiseLike<AssetIntegrity>;
      },
    };
    const nestedAssessment = await assessProjectRecovery(projectCodec.encode(studioProjectV1Fixture), {
      assetVerifier: nestedThenVerifier,
    });
    expect(nestedAssessment.report.issues.every(({ code }) => code === "ASSET_CHECK_FAILED")).toBe(true);
    expect(nestedThenReads).toBe(0);

    let statusReads = 0;
    const hostileResult = {};
    Object.defineProperty(hostileResult, "status", {
      enumerable: true,
      get() {
        statusReads += 1;
        return "ok";
      },
    });
    const resultVerifier: ProjectRecoveryAssetVerifier = {
      verify: async () => hostileResult as AssetIntegrity,
    };
    const resultAssessment = await assessProjectRecovery(projectCodec.encode(studioProjectV1Fixture), {
      assetVerifier: resultVerifier,
    });
    expect(resultAssessment.report.issues[0].code).toBe("ASSET_CHECK_FAILED");
    expect(statusReads).toBe(0);
  });
});
