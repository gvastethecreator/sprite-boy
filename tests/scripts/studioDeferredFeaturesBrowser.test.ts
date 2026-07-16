import { describe, expect, it } from "vitest";
import { evaluateDeferredFeatureEvidence } from "../../scripts/studio-deferred-features-browser.mjs";

const chunks = {
  ai: "/assets/aiService-A.js",
  gif: "/assets/gifshot-B.js",
  zip: "/assets/jszip.min-C.js",
  exportModal: "/assets/ExportModal-D.js",
};

function evidence() {
  return {
    initialRequestPaths: ["/assets/index.js"],
    finalRequestPaths: [
      "/assets/index.js",
      chunks.zip,
      chunks.gif,
      chunks.ai,
      chunks.exportModal,
    ],
    zipSucceeded: true,
    gifSucceeded: true,
    aiFailureContained: true,
    pageFits: true,
    dialogVisible: true,
    finalRoute: "#/studio/export",
    consoleErrorCount: 0,
    exceptionCount: 0,
    logErrorCount: 0,
    networkFailureCount: 0,
    httpErrorCount: 0,
  };
}

describe("deferred feature production browser evidence", () => {
  it("requires zero eager requests and one request per exercised feature", () => {
    expect(evaluateDeferredFeatureEvidence(evidence(), chunks)).toMatchObject({
      status: "pass",
      metrics: {
        initialFeatureRequests: { ai: 0, gif: 0, zip: 0, exportModal: 0 },
        finalFeatureRequests: { ai: 1, gif: 1, zip: 1, exportModal: 1 },
        errors: { console: 0, exception: 0, log: 0, network: 0, http: 0 },
      },
    });
  });

  it("fails closed on eager, duplicate, error and incomplete journey evidence", () => {
    const eager = evidence();
    eager.initialRequestPaths.push(chunks.ai);
    expect(evaluateDeferredFeatureEvidence(eager, chunks).status).toBe("fail");

    const duplicate = evidence();
    duplicate.finalRequestPaths.push(chunks.zip);
    expect(evaluateDeferredFeatureEvidence(duplicate, chunks).status).toBe("fail");

    const eagerModal = evidence();
    eagerModal.initialRequestPaths.push(chunks.exportModal);
    expect(evaluateDeferredFeatureEvidence(eagerModal, chunks).status).toBe("fail");

    const errored = evidence();
    errored.consoleErrorCount = 1;
    expect(evaluateDeferredFeatureEvidence(errored, chunks).status).toBe("fail");

    const incomplete = evidence();
    incomplete.gifSucceeded = false;
    expect(evaluateDeferredFeatureEvidence(incomplete, chunks).status).toBe("fail");
    expect(() => evaluateDeferredFeatureEvidence({}, chunks)).toThrow(/invalid/);
  });
});
