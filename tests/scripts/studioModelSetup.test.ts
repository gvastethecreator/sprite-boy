// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  parseModelSetupArguments,
  runStudioModelSetupCli,
} from "../../scripts/studio-model-setup.mjs";

function outputBuffer() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: { write: (value: string) => stdout.push(value) },
      stderr: { write: (value: string) => stderr.push(value) },
    },
  };
}

describe("studio model setup CLI (M1-02)", () => {
  it("requires an allowlisted model", () => {
    expect(parseModelSetupArguments(["--model", "birefnet-lite-512"]))
      .toEqual({ modelId: "birefnet-lite-512" });
    expect(() => parseModelSetupArguments([])).toThrow(/known local model ID/i);
    expect(() => parseModelSetupArguments(["--model", "../../secret"])).toThrow(/known local model ID/i);
  });

  it("emits a bounded success result", async () => {
    const output = outputBuffer();
    const result = {
      status: "succeeded",
      value: { modelId: "birefnet-lite-512", revision: "a".repeat(40) },
    };
    await expect(runStudioModelSetupCli(
      ["--model", "birefnet-lite-512"],
      output.io,
      { run: vi.fn(async () => result) },
    )).resolves.toBe(0);
    expect(JSON.parse(output.stdout.join(""))).toMatchObject({ status: "succeeded", manifest: result.value });
    expect(output.stderr).toEqual([]);
  });

  it("redacts unexpected setup failures", async () => {
    const output = outputBuffer();
    await expect(runStudioModelSetupCli(
      ["--model", "birefnet-lite-512"],
      output.io,
      { run: vi.fn(async () => { throw new Error("token=secret C:/private"); }) },
    )).resolves.toBe(1);
    expect(output.stdout).toEqual([]);
    expect(output.stderr.join("")).not.toMatch(/secret|private|token/i);
    expect(JSON.parse(output.stderr.join(""))).toMatchObject({ reason: "model-setup-unavailable" });
  });
});
