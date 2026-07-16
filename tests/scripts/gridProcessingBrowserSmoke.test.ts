import { describe, expect, it } from "vitest";

import { evaluateGridProcessingBrowserEvidence } from "../../scripts/grid-processing-browser-smoke.mjs";

const canonicalEvidence = {
  workerConstructed: true,
  workerType: "module",
  outputCount: 2,
  sourceDetached: true,
  progressMonotonic: true,
  progressStages: [
    "decode",
    "detect",
    "chroma",
    "chroma",
    "crop",
    "crop",
    "resize",
    "resize",
    "quantize",
    "quantize",
    "finalize",
  ],
  outputDimensions: [[2, 2], [1, 1]],
  outputPixels: [
    [
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
    ],
    [0, 0, 0, 0],
  ],
  consoleErrorCount: 0,
  exceptionCount: 0,
  logErrorCount: 0,
  networkFailureCount: 0,
  httpErrorCount: 0,
};

describe("grid processing production-browser evidence", () => {
  it("accepts the canonical default-client to real-Worker journey", () => {
    expect(evaluateGridProcessingBrowserEvidence(canonicalEvidence)).toMatchObject({
      schemaVersion: 1,
      check: "grid-processing-browser",
      status: "pass",
    });
  });

  it.each([
    ["workerConstructed", false],
    ["workerType", "classic"],
    ["sourceDetached", false],
    ["progressMonotonic", false],
    ["outputCount", 1],
    ["consoleErrorCount", 1],
    ["exceptionCount", 1],
    ["logErrorCount", 1],
    ["networkFailureCount", 1],
    ["httpErrorCount", 1],
  ])("fails closed when %s regresses", (key, value) => {
    expect(evaluateGridProcessingBrowserEvidence({
      ...canonicalEvidence,
      [key]: value,
    }).status).toBe("fail");
  });

  it("rejects structurally invalid evidence", () => {
    expect(() => evaluateGridProcessingBrowserEvidence({
      ...canonicalEvidence,
      outputPixels: "private-browser-value",
    })).toThrow(TypeError);
  });
});
