// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MODEL_DOWNLOAD_MARKER, inspectLocalModel } from "../../core/models/nodeModelInventory";
import {
  parseModelStatusArguments,
  runStudioModelStatus,
  runStudioModelStatusCli,
} from "../../scripts/studio-model-status.mjs";

const temporaryDirectories: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sprite-boy-model-status-"));
  temporaryDirectories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

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

describe("studio model status CLI (M1-01)", () => {
  it("allowlists model arguments", () => {
    expect(parseModelStatusArguments([])).toEqual({ modelId: null });
    expect(parseModelStatusArguments(["--model", "birefnet-lite-512"]))
      .toEqual({ modelId: "birefnet-lite-512" });
    expect(() => parseModelStatusArguments(["--model", "../../secret"])).toThrow(/known local model ID/i);
    expect(() => parseModelStatusArguments(["--root", "C:/private"])).toThrow(/known local model ID/i);
  });

  it("reports real absent and license-required states without creating the root", async () => {
    const root = join(await temporaryRoot(), "not-created", "models");
    const result = await runStudioModelStatus({ root, modelId: null, now: 1 });

    expect(result.models.map(({ modelId, status }) => [modelId, status.state])).toEqual([
      ["birefnet-lite-512", "absent"],
      ["rmbg-2.0", "license-required"],
    ]);
    expect(result.models[0]?.capacity.requiredStorageBytes).toBeGreaterThan(98_485_002);
  });

  it("distinguishes a live download marker from an expired partial install", async () => {
    const root = await temporaryRoot();
    const modelRoot = join(root, "birefnet-lite-512");
    await mkdir(modelRoot, { recursive: true });
    await writeFile(join(modelRoot, MODEL_DOWNLOAD_MARKER), JSON.stringify({
      schemaVersion: 1,
      expiresAt: "2026-07-26T00:00:00.000Z",
    }));

    await expect(inspectLocalModel("birefnet-lite-512", {
      root,
      now: Date.parse("2026-07-25T23:00:00.000Z"),
    })).resolves.toMatchObject({ status: { state: "downloading" } });
    await expect(inspectLocalModel("birefnet-lite-512", {
      root,
      now: Date.parse("2026-07-26T01:00:00.000Z"),
    })).resolves.toMatchObject({ status: { state: "error", problems: ["stale-download"] } });
  });

  it("redacts runner failures", async () => {
    const output = outputBuffer();
    const run = vi.fn().mockRejectedValue(new Error("C:/private/token=secret"));
    await expect(runStudioModelStatusCli([], output.io, { run })).resolves.toBe(1);
    expect(output.stdout).toEqual([]);
    expect(JSON.parse(output.stderr.join(""))).toEqual({
      schemaVersion: 1,
      check: "model-status",
      status: "fail",
      reason: "model-status-unavailable",
    });
    expect(output.stderr.join("")).not.toMatch(/private|secret|token/i);
  });
});
