import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("grid processing pipeline round-trip smoke", () => {
  it("keeps canonical recipe state, stage order, reset and repeated pixels aligned", () => {
    const execution = spawnSync(process.platform === "win32" ? "bun.exe" : "bun", [
      "scripts/grid-processing-pipeline-smoke.ts",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    });

    expect(execution.error).toBeUndefined();
    expect(execution.status, execution.stderr).toBe(0);
    const output = JSON.parse(execution.stdout.trim()) as {
      status: string;
      recipe: { serializedStable: boolean };
      full: { operations: string[]; sourceDetached: boolean };
      repeat: { pixelsIdentical: boolean; operationsIdentical: boolean };
      reset: { enabled: boolean; size: number; quantize: boolean; colors: number; hasPalette: boolean; operations: string[] };
    };
    expect(output).toMatchObject({
      status: "pass",
      recipe: { serializedStable: true },
      full: { operations: ["chroma", "crop", "resize", "quantize"], sourceDetached: true },
      repeat: { pixelsIdentical: true, operationsIdentical: true },
      reset: {
        enabled: false,
        size: 16,
        quantize: false,
        colors: 16,
        hasPalette: false,
        operations: ["chroma", "crop"],
      },
    });
  }, 30_000);
});
