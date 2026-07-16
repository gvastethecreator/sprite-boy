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
      resizeGolden: {
        enabledDimensions: [4, 4],
        enabledOperations: ["resize"],
        enabledPixels: [
          255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 192, 0, 255, 0, 192,
          255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 192, 0, 255, 0, 192,
          0, 0, 255, 64, 0, 0, 255, 64, 255, 255, 0, 0, 255, 255, 0, 0,
          0, 0, 255, 64, 0, 0, 255, 64, 255, 255, 0, 0, 255, 255, 0, 0,
        ],
        disabledDimensions: [2, 2],
        disabledOperations: [],
        disabledPixels: [
          255, 0, 0, 255,
          0, 255, 0, 192,
          0, 0, 255, 64,
          255, 255, 0, 0,
        ],
      },
      quantizeGolden: {
        autoDimensions: [6, 1],
        autoOperations: ["resize", "quantize"],
        autoWarnings: [],
        autoPixels: [
          245, 25, 25, 255,
          245, 25, 25, 255,
          25, 25, 235, 255,
          25, 25, 235, 255,
          10, 200, 10, 127,
          9, 9, 9, 0,
        ],
        autoRepeatPixels: [
          245, 25, 25, 255,
          245, 25, 25, 255,
          25, 25, 235, 255,
          25, 25, 235, 255,
          10, 200, 10, 127,
          9, 9, 9, 0,
        ],
        autoRepeatOperations: ["resize", "quantize"],
        fixedOperations: ["resize", "quantize"],
        fixedWarnings: [],
        fixedPixels: [
          255, 0, 0, 255,
          0, 0, 255, 255,
          250, 10, 10, 127,
          0, 255, 0, 0,
        ],
        fixedRepeatPixels: [
          255, 0, 0, 255,
          0, 0, 255, 255,
          250, 10, 10, 127,
          0, 255, 0, 0,
        ],
        fixedRepeatOperations: ["resize", "quantize"],
      },
      alphaCrop: {
        contentBounds: { x: 2, y: 0, width: 2, height: 1 },
        dimensions: { width: 2, height: 1 },
        operations: ["crop"],
        pixels: [
          7, 8, 9, 128,
          7, 8, 9, 255,
        ],
      },
      chromaGolden: {
        enabledPixels: [
          0, 0, 0, 0,
          10, 10, 10, 0,
          0, 55, 0, 70,
          255, 0, 0, 127,
          210, 150, 120, 255,
          0, 255, 0, 0,
        ],
        enabledOperations: ["chroma"],
        disabledPixels: [
          0, 255, 0, 255,
          10, 250, 10, 200,
          0, 200, 0, 255,
          255, 0, 0, 127,
          210, 150, 120, 255,
          0, 255, 0, 0,
        ],
        disabledOperations: [],
      },
      chromaOrder: {
        operations: ["chroma", "crop"],
        contentBounds: { x: 1, y: 0, width: 3, height: 1 },
        dimensions: [3, 1],
        pixels: [
          220, 20, 30, 255,
          0, 255, 0, 0,
          30, 80, 220, 255,
        ],
        repeatContentBounds: { x: 1, y: 0, width: 3, height: 1 },
        repeatDimensions: [3, 1],
        repeatPixels: [
          220, 20, 30, 255,
          0, 255, 0, 0,
          30, 80, 220, 255,
        ],
        repeatOperations: ["chroma", "crop"],
      },
      chromaHostile: {
        noMatch: {
          pixels: [220, 20, 30, 255, 0, 255, 0, 0, 30, 80, 220, 255],
          contentBounds: { x: 0, y: 0, width: 3, height: 1 },
          operations: ["chroma", "crop"],
          warnings: [],
        },
        extreme: {
          pixels: [0, 0, 0, 0],
          contentBounds: null,
          dimensions: [1, 1],
          operations: ["chroma", "crop"],
          warnings: ["empty-output"],
        },
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
