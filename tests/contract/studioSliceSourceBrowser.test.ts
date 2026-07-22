import { describe, expect, it } from "vitest";

import { evaluateSliceSourceEvidence } from "../../scripts/studio-slice-source-browser.mjs";

const passingEvidence = {
  busyAnnounced: true,
  metadataVisible: true,
  actionsVisible: true,
  canvasVisible: true,
  dropzoneRemoved: true,
  manualGridControlsVisible: true,
  columnDividerResized: true,
  rowDividerResized: true,
  keyboardResizeWorks: true,
  pickerCancelPreserved: true,
  pickerCancelFocusRestored: true,
  replaceKeptCurrentSource: true,
  replacementSucceeded: true,
  resetConfirmationAccessible: true,
  resetCancelPreserved: true,
  resetCompleted: true,
  resetFocusRestored: true,
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
    ["metadataVisible", false],
    ["actionsVisible", false],
    ["canvasVisible", false],
    ["dropzoneRemoved", false],
    ["manualGridControlsVisible", false],
    ["columnDividerResized", false],
    ["rowDividerResized", false],
    ["keyboardResizeWorks", false],
    ["pickerCancelPreserved", false],
    ["pickerCancelFocusRestored", false],
    ["replaceKeptCurrentSource", false],
    ["replacementSucceeded", false],
    ["resetConfirmationAccessible", false],
    ["resetCancelPreserved", false],
    ["resetCompleted", false],
    ["resetFocusRestored", false],
    ["route", "#/studio/compose"],
    ["consoleErrorCount", 1],
  ])("fails when %s regresses", (key, value) => {
    expect(evaluateSliceSourceEvidence({ ...passingEvidence, [key]: value }).status).toBe("fail");
  });

});
