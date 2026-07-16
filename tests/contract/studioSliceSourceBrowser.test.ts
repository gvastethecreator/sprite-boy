import { describe, expect, it } from "vitest";

import { evaluateSliceSourceEvidence } from "../../scripts/studio-slice-source-browser.mjs";

const passingEvidence = {
  busyAnnounced: true,
  replacementRaceRecovered: true,
  canvasVisible: true,
  dropzoneRemoved: true,
  focusRestored: true,
  pageFits: true,
  route: "#/studio/slice",
  consoleErrorCount: 0,
  exceptionCount: 0,
  logErrorCount: 0,
  networkFailureCount: 0,
  httpErrorCount: 0,
};

describe("Slice source browser evidence", () => {
  it("accepts the complete picker-to-canvas journey", () => {
    expect(evaluateSliceSourceEvidence(passingEvidence)).toMatchObject({
      check: "slice-source-browser",
      status: "pass",
    });
  });

  it.each([
    ["busyAnnounced", false],
    ["replacementRaceRecovered", false],
    ["focusRestored", false],
    ["route", "#/studio/compose"],
    ["consoleErrorCount", 1],
  ])("fails when %s regresses", (key, value) => {
    expect(evaluateSliceSourceEvidence({ ...passingEvidence, [key]: value }).status).toBe("fail");
  });
});
