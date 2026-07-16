import { describe, expect, it } from "vitest";

import {
  GridProcessingStageBoundary,
  diagnoseGridProcessingWorkerFailure,
} from "../../features/slice/processing/gridProcessingWorkerDiagnostics";
import { GRID_PROCESSING_STAGES } from "../../core/processing/gridProcessingProtocol";

describe("grid processing Worker stage diagnostics", () => {
  it.each(GRID_PROCESSING_STAGES)(
    "attributes an unexpected RangeError to the active %s stage",
    async (stage) => {
      const boundary = new GridProcessingStageBoundary();
      let failure: unknown;

      try {
        await boundary.run(stage, () => {
          throw new RangeError("hostile private allocation detail");
        });
      } catch (error) {
        failure = error;
      }

      expect(diagnoseGridProcessingWorkerFailure(failure, boundary.stage)).toEqual({
        code: "memory",
        stage,
      });
    },
  );

  it("attributes an unexpected TypeError without exposing its message", async () => {
    const boundary = new GridProcessingStageBoundary();
    let failure: unknown;

    try {
      await boundary.run("quantize", () => {
        throw new TypeError("hostile private algorithm detail");
      });
    } catch (error) {
      failure = error;
    }

    expect(diagnoseGridProcessingWorkerFailure(failure, boundary.stage)).toEqual({
      code: "invalid-input",
      stage: "quantize",
    });
  });
});
