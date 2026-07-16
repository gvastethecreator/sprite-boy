import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("grid processing real Worker integration", () => {
  it("executes the protocol pipeline in a separate real Worker with transferred buffers", () => {
    const execution = spawnSync(process.platform === "win32" ? "bun.exe" : "bun", [
      "scripts/grid-processing-worker-smoke.ts",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    });

    expect(execution.error).toBeUndefined();
    expect(execution.status, execution.stderr).toBe(0);
    const output = JSON.parse(execution.stdout.trim()) as Record<string, unknown>;
    expect(output).toEqual({
      schemaVersion: 1,
      status: "pass",
      outputCount: 2,
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
      sourceDetached: true,
      outputPixels: [
        [
          255, 0, 0, 255,
          255, 0, 0, 255,
          255, 0, 0, 255,
          255, 0, 0, 255,
        ],
        [0, 0, 0, 0],
      ],
      alphaCrop: {
        contentBounds: { x: 2, y: 0, width: 2, height: 1 },
        dimensions: { width: 2, height: 1 },
        operations: ["crop"],
        pixels: [
          7, 8, 9, 128,
          7, 8, 9, 255,
        ],
      },
      reductionEdge: {
        recipeUnchanged: true,
        outputCount: 6,
        indexes: ["0:0:0", "1:0:1", "2:0:2", "3:1:0", "4:1:1", "5:1:2"],
        contentBounds: [
          null,
          { x: 2, y: 0, width: 2, height: 2 },
          { x: 5, y: 0, width: 2, height: 2 },
          { x: 0, y: 2, width: 2, height: 3 },
          null,
          { x: 4, y: 2, width: 3, height: 3 },
        ],
        dimensions: [[1, 1], [2, 2], [2, 2], [2, 3], [1, 1], [3, 3]],
        reductions: [1, 0, 1 / 3, 0, 1, 0],
        warnings: [["empty-output"], [], [], [], ["empty-output"], []],
        outputPixelCount: 25,
        summaryReduction: 12 / 35,
      },
      allEmpty: {
        outputCount: 6,
        indexes: ["0:0:0", "1:0:1", "2:0:2", "3:1:0", "4:1:1", "5:1:2"],
        dimensions: [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1]],
        reductions: [1, 1, 1, 1, 1, 1],
        warnings: [
          ["empty-output"], ["empty-output"], ["empty-output"],
          ["empty-output"], ["empty-output"], ["empty-output"],
        ],
        summary: {
          outputCount: 6,
          outputPixelCount: 6,
          cropReductionRatio: 1,
          warnings: ["empty-output"],
        },
      },
      cropDisabledTransparent: {
        contentBounds: { x: 0, y: 0, width: 2, height: 2 },
        dimensions: [2, 2],
        reduction: 0,
        operations: [],
        warnings: [],
        summary: {
          outputCount: 1,
          outputPixelCount: 4,
          cropReductionRatio: 0,
          warnings: [],
        },
      },
      maxEmpty: {
        outputCount: 4_096,
        first: { index: 0, row: 0, column: 0 },
        last: { index: 4_095, row: 0, column: 4_095 },
        exactPolicy: true,
        summary: {
          outputCount: 4_096,
          outputPixelCount: 4_096,
          cropReductionRatio: 1,
          warnings: ["empty-output"],
        },
      },
    });
  }, 30_000);
});
