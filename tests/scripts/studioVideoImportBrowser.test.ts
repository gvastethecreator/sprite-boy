import { describe, expect, it, vi } from "vitest";

import {
  evaluateVideoImportEvidence,
  runStudioVideoImportBrowserCli,
} from "../../scripts/studio-video-import-browser.mjs";

function passingEvidence() {
  return {
    malformedRejected: true,
    malformedNoJob: true,
    malformedProjectEmpty: true,
    malformedCloseFocusRestored: true,
    preflightMetadataVisible: true,
    rangeControlsVisible: true,
    samplingControlsVisible: true,
    exactFrameCountVisible: true,
    closeNoJob: true,
    closeFocusRestored: true,
    closeObjectUrlsBalanced: true,
    importCompleted: true,
    jobRecorded: true,
    noActiveJobs: true,
    firstFrameOpened: true,
    durableReloadRestored: true,
    mobilePageFits: true,
    finalObjectUrlsBounded: true,
    route: "#/studio/slice",
    frameCount: 4,
    dimensions: "16x16",
    initialObjectUrlStats: { created: 7, revoked: 0, live: 7 },
    closeObjectUrlStats: { created: 7, revoked: 0, live: 7 },
    preReloadObjectUrlStats: { created: 8, revoked: 1, live: 7 },
    finalObjectUrlStats: { created: 8, revoked: 1, live: 7 },
    consoleErrorCount: 0,
    exceptionCount: 0,
    logErrorCount: 0,
    networkFailureCount: 0,
    httpErrorCount: 0,
  };
}

function outputBuffer() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: { write: (value: string) => stdout.push(value) },
      stderr: { write: (value: string) => stderr.push(value) },
    },
  };
}

describe("V1-05 video import browser evidence", () => {
  it("accepts complete success and freezes the public result", () => {
    const result = evaluateVideoImportEvidence(passingEvidence());

    expect(result).toMatchObject({
      schemaVersion: 1,
      check: "video-import-browser",
      status: "pass",
      metrics: { route: "#/studio/slice", frameCount: 4, dimensions: "16x16" },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.metrics)).toBe(true);
    expect(Object.isFrozen(result.metrics.errors)).toBe(true);
  });

  it("fails closed on any proof, scalar or diagnostic drift", () => {
    for (const mutate of [
      (value: ReturnType<typeof passingEvidence>) => { value.closeNoJob = false; },
      (value: ReturnType<typeof passingEvidence>) => { value.route = "#/studio/compose"; },
      (value: ReturnType<typeof passingEvidence>) => { value.frameCount = 3; },
      (value: ReturnType<typeof passingEvidence>) => { value.dimensions = "32x32"; },
      (value: ReturnType<typeof passingEvidence>) => { value.consoleErrorCount = 1; },
    ]) {
      const evidence = passingEvidence();
      mutate(evidence);
      expect(evaluateVideoImportEvidence(evidence).status).toBe("fail");
    }
  });

  it("rejects malformed evidence", () => {
    expect(() => evaluateVideoImportEvidence(null)).toThrow(/must be an object/i);
    expect(() => evaluateVideoImportEvidence({ ...passingEvidence(), closeNoJob: "yes" }))
      .toThrow(/closeNoJob must be boolean/i);
    expect(() => evaluateVideoImportEvidence({ ...passingEvidence(), httpErrorCount: -1 }))
      .toThrow(/nonnegative integer/i);
    expect(() => evaluateVideoImportEvidence({
      ...passingEvidence(),
      closeObjectUrlStats: { created: 8, revoked: 0, live: 7 },
    })).toThrow(/counters are inconsistent/i);
  });

  it("returns a redacted failure code without leaking runner errors", async () => {
    const output = outputBuffer();
    const run = vi.fn().mockRejectedValue(new Error("C:/private/video.mp4 token=secret"));

    await expect(runStudioVideoImportBrowserCli(output.io, { run })).resolves.toBe(1);
    expect(output.stdout).toEqual([]);
    expect(JSON.parse(output.stderr.join(""))).toEqual({
      schemaVersion: 1,
      check: "video-import-browser",
      status: "fail",
      reason: "video-import-browser-unavailable",
    });
    expect(output.stderr.join("")).not.toMatch(/private|secret|video\.mp4/i);
  });
});
