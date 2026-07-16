import { describe, expect, it } from "vitest";

import { evaluateSliceSourceEvidence } from "../../scripts/studio-slice-source-browser.mjs";

const passingEvidence = {
  busyAnnounced: true,
  replacementRaceRecovered: true,
  metadataVisible: true,
  previewLeaseReleased: true,
  actionsVisible: true,
  pickerCancelPreserved: true,
  pickerCancelFocusRestored: true,
  replaceKeptCurrentSource: true,
  retryableErrorFocused: true,
  retryFailureFocusRestored: true,
  retryBusyBlocksDuplicateActions: true,
  retrySucceeded: true,
  retrySuccessFocusRestored: true,
  resetConfirmationAccessible: true,
  resetCancelPreserved: true,
  resetCompleted: true,
  resetResourceReleased: true,
  resetFocusRestored: true,
  preferencesPreserved: true,
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
    ["metadataVisible", false],
    ["previewLeaseReleased", false],
    ["actionsVisible", false],
    ["pickerCancelPreserved", false],
    ["pickerCancelFocusRestored", false],
    ["replaceKeptCurrentSource", false],
    ["retryableErrorFocused", false],
    ["retryFailureFocusRestored", false],
    ["retryBusyBlocksDuplicateActions", false],
    ["retrySucceeded", false],
    ["retrySuccessFocusRestored", false],
    ["resetConfirmationAccessible", false],
    ["resetCancelPreserved", false],
    ["resetCompleted", false],
    ["resetResourceReleased", false],
    ["resetFocusRestored", false],
    ["preferencesPreserved", false],
    ["focusRestored", false],
    ["route", "#/studio/compose"],
    ["consoleErrorCount", 1],
  ])("fails when %s regresses", (key, value) => {
    expect(evaluateSliceSourceEvidence({ ...passingEvidence, [key]: value }).status).toBe("fail");
  });

});
