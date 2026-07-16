import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("G1-05 grid processing golden real Worker gate", () => {
  it("matches the frozen geometry, reduction and normalized RGBA hashes without timing assertions", () => {
    const execution = spawnSync(process.platform === "win32" ? "bun.exe" : "bun", [
      "scripts/grid-processing-golden-verify.ts",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    });

    expect(execution.error).toBeUndefined();
    expect(execution.status, execution.stderr).toBe(0);
    expect(JSON.parse(execution.stdout.trim())).toEqual({
      schemaVersion: 1,
      status: "pass",
      fixtureCount: 8,
      outputCount: 59,
      normalization: "rgba8-srgb-row-major-v1",
      fixtureIds: [
        "single-pixel-1x1",
        "single-row-1xn",
        "single-column-nx1",
        "detected-grid-3x3",
        "fully-transparent-grid",
        "seeded-noisy-pipeline",
        "non-divisible-3x3",
        "large-safe-4x4",
      ],
    });
  });
});
