// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getLocalModelDefinition } from "../../core/models/modelCatalog";
import {
  inspectLocalModel,
  MODEL_DOWNLOAD_MARKER,
  MODEL_ERROR_MARKER,
  MODEL_INSTALL_MANIFEST,
  MODEL_LICENSE_ACCEPTANCE,
} from "../../core/models/nodeModelInventory";

const temporaryDirectories: string[] = [];
const NOW = Date.parse("2026-07-26T04:00:00.000Z");

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sprite-boy-model-inventory-"));
  temporaryDirectories.push(root);
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("node model inventory", () => {
  it("reports an ungated model as absent when no local evidence exists", async () => {
    const root = await temporaryRoot();

    const result = await inspectLocalModel("birefnet-lite-512", { root, now: NOW });

    expect(result.modelId).toBe("birefnet-lite-512");
    expect(result.status).toMatchObject({ state: "absent", verifiedBytes: 0, problems: [] });
    expect(result.capacity.requiredStorageBytes).toBeGreaterThan(0);
  });

  it("distinguishes a live download marker from an expired one", async () => {
    const root = await temporaryRoot();
    const model = getLocalModelDefinition("birefnet-lite-512");
    const modelRoot = join(root, model.id);
    await mkdir(modelRoot, { recursive: true });
    const markerPath = join(modelRoot, MODEL_DOWNLOAD_MARKER);
    const marker = {
      schemaVersion: 1,
      modelId: model.id,
      revision: model.revision,
      requestId: "request-1",
      startedAt: "2026-07-26T03:59:00.000Z",
      expiresAt: "2026-07-26T04:01:00.000Z",
    };
    await writeJson(markerPath, marker);

    await expect(inspectLocalModel(model.id, { root, now: NOW })).resolves.toMatchObject({
      status: { state: "downloading" },
    });

    await writeJson(markerPath, { ...marker, expiresAt: "2026-07-26T03:59:59.000Z" });
    await expect(inspectLocalModel(model.id, { root, now: NOW })).resolves.toMatchObject({
      status: { state: "error", problems: ["stale-download"] },
    });
  });

  it("accepts only bounded error marker codes", async () => {
    const root = await temporaryRoot();
    const modelRoot = join(root, "birefnet-lite-512");
    await mkdir(modelRoot, { recursive: true });
    const markerPath = join(modelRoot, MODEL_ERROR_MARKER);
    await writeJson(markerPath, { schemaVersion: 1, code: "smoke-failed" });

    await expect(inspectLocalModel("birefnet-lite-512", { root, now: NOW })).resolves.toMatchObject(
      {
        status: { state: "error", problems: ["smoke-failed"] },
      },
    );

    await writeJson(markerPath, { schemaVersion: 1, code: "private/path token=secret" });
    await expect(inspectLocalModel("birefnet-lite-512", { root, now: NOW })).resolves.toMatchObject(
      {
        status: { state: "absent", problems: [] },
      },
    );
  });

  it("keeps a gated model license-required until exact acceptance matches", async () => {
    const root = await temporaryRoot();
    const model = getLocalModelDefinition("rmbg-2.0");
    const modelRoot = join(root, model.id);
    await mkdir(modelRoot, { recursive: true });

    await expect(inspectLocalModel(model.id, { root, now: NOW })).resolves.toMatchObject({
      status: { state: "license-required" },
    });

    await writeJson(join(modelRoot, MODEL_LICENSE_ACCEPTANCE), {
      schemaVersion: 1,
      modelId: model.id,
      revision: model.revision,
      licenseId: model.license.id,
      acceptedAt: "2026-07-26T03:00:00.000Z",
    });
    await expect(inspectLocalModel(model.id, { root, now: NOW })).resolves.toMatchObject({
      status: { state: "absent" },
    });
  });

  it("rejects an install manifest that has no model files", async () => {
    const root = await temporaryRoot();
    const modelRoot = join(root, "birefnet-lite-512");
    await mkdir(modelRoot, { recursive: true });
    await writeJson(join(modelRoot, MODEL_INSTALL_MANIFEST), { schemaVersion: 1, files: [] });

    await expect(inspectLocalModel("birefnet-lite-512", { root, now: NOW })).resolves.toMatchObject({
      status: { state: "error", problems: ["manifest-without-files"] },
    });
  });
});
