import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { cleanupBrowserRuntime } from "../../scripts/studio-browser-smoke.mjs";
import {
  evaluatePersistenceJourneyEvidence,
  normalizePersistenceBrowserResult,
  runStudioPersistenceBrowserCli,
  runWithPersistenceDeadline,
} from "../../scripts/studio-persistence-browser.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const PACKAGE_HASH = "c".repeat(64);

function passingEvidence() {
  const integrity = [
    { assetId: "asset-a", status: "ok" },
    { assetId: "asset-b", status: "ok" },
  ];
  return {
    prepare: {
      checkpointRevision: 1,
      projectBytes: 2_000,
      packageBytes: 1_200,
      packageSha256: PACKAGE_HASH,
      assetHashes: { "asset-a": HASH_A, "asset-b": HASH_A },
      uniqueBlobCount: 1,
      legacyExpiredBlobUrlCount: 2,
      legacyPreviewBlockingIssueCount: 3,
      legacyMigrationApplied: true,
      legacyMigrationIssueCount: 4,
    },
    resume: {
      preparePagehideDisposed: true,
      reloadDocumentExact: true,
      reloadIntegrity: integrity,
      importedBlobCount: 1,
      importedAssetCount: 2,
      importedCheckpointRevision: 1,
      deduplicated: true,
    },
    finish: {
      preparePagehideDisposed: true,
      importPagehideDisposed: true,
      finalDocumentExact: true,
      finalIntegrity: integrity,
      assetHashesExact: true,
      package: {
        exactBytes: true,
        originalSha256: PACKAGE_HASH,
        finalSha256: PACKAGE_HASH,
        hashExact: true,
        byteSize: 1_200,
      },
      cleanup: { databasesRemain: false, remainingTargetNames: [] },
    },
    diagnostics: {
      consoleErrorCount: 0,
      exceptionCount: 0,
      logErrorCount: 0,
      networkFailureCount: 0,
      httpErrorCount: 0,
    },
  };
}

describe("F3-07 persistence browser evidence", () => {
  it("reserves an internal deadline and still terminates both owned children", async () => {
    vi.useFakeTimers();
    try {
      const child = () => Object.assign(new EventEmitter(), {
        exitCode: null as number | null,
        signalCode: null as string | null,
        kill: vi.fn(function kill(this: EventEmitter & { exitCode: number | null }) {
          this.exitCode = 0;
          this.emit("exit", 0);
          return true;
        }),
      });
      const chrome = child();
      const vite = child();
      const client = {
        close: vi.fn(),
        send: vi.fn().mockRejectedValue(new Error("browser close unavailable")),
      };
      const pending = runWithPersistenceDeadline(
        () => new Promise(() => {}),
        () => cleanupBrowserRuntime(client, chrome, vite, undefined),
        25,
      );
      const rejected = expect(pending).rejects.toThrow(/deadline exceeded/);

      await vi.advanceTimersByTimeAsync(25);
      await rejected;
      expect(client.close).toHaveBeenCalledOnce();
      expect(chrome.kill).toHaveBeenCalledOnce();
      expect(vite.kill).toHaveBeenCalledOnce();
      expect(chrome.exitCode).toBe(0);
      expect(vite.exitCode).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts exact reload/import/package/cleanup evidence without exposing hashes", () => {
    const evidence = passingEvidence();
    const result = evaluatePersistenceJourneyEvidence(
      evidence.prepare,
      evidence.resume,
      evidence.finish,
      evidence.diagnostics,
    );
    expect(result).toMatchObject({
      schemaVersion: 1,
      check: "persistence-browser",
      status: "pass",
      metrics: {
        reloadCount: 2,
        assetCount: 2,
        uniqueBlobCount: 1,
        legacyMigrationApplied: true,
        packageHashExact: true,
        databasesRemain: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain(PACKAGE_HASH);
    expect(Object.isFrozen(result.metrics)).toBe(true);
  });

  it("fails closed on pagehide, hash, cleanup or browser diagnostic drift", () => {
    for (const mutate of [
      (value: ReturnType<typeof passingEvidence>) => { value.resume.preparePagehideDisposed = false; },
      (value: ReturnType<typeof passingEvidence>) => { value.finish.package.finalSha256 = HASH_A; },
      (value: ReturnType<typeof passingEvidence>) => { value.finish.cleanup.databasesRemain = true; },
      (value: ReturnType<typeof passingEvidence>) => { value.diagnostics.consoleErrorCount = 1; },
      (value: ReturnType<typeof passingEvidence>) => { value.resume.importedCheckpointRevision = 2; },
      (value: ReturnType<typeof passingEvidence>) => { value.prepare.assetHashes["asset-b"] = HASH_B; },
    ]) {
      const evidence = passingEvidence();
      mutate(evidence);
      expect(() => evaluatePersistenceJourneyEvidence(
        evidence.prepare,
        evidence.resume,
        evidence.finish,
        evidence.diagnostics,
      )).toThrow(/invalid/);
    }
  });

  it("contains runtime failures and rejects arguments", async () => {
    const stdout = { write: vi.fn() };
    expect(await runStudioPersistenceBrowserCli([], { stdout }, {
      runJourney: vi.fn().mockRejectedValue(new Error("private database path")),
    })).toBe(1);
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining('"status":"fail"'));
    expect(stdout.write).not.toHaveBeenCalledWith(expect.stringContaining("private database path"));
    expect(await runStudioPersistenceBrowserCli([], { stdout: { write: vi.fn() } }, {
      runJourney: async () => ({ schemaVersion: 1, check: "persistence-browser", status: "fail" }),
    })).toBe(1);
    const publicResult = evaluatePersistenceJourneyEvidence(
      passingEvidence().prepare,
      passingEvidence().resume,
      passingEvidence().finish,
      passingEvidence().diagnostics,
    );
    expect(normalizePersistenceBrowserResult(publicResult)).toEqual(publicResult);
    expect(await runStudioPersistenceBrowserCli(["--private"], {
      stderr: { write: vi.fn() },
    })).toBe(2);
  });
});
