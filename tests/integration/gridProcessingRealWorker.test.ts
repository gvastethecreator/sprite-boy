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
    });
  });
});
