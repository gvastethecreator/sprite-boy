// @vitest-environment node
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inspectLocalModel: vi.fn(),
  install: vi.fn(),
  createNodeModelSetupPort: vi.fn(),
  createNodeOnnxSmokeRunner: vi.fn(),
}));

vi.mock("../../core/models/nodeModelInventory", () => ({
  inspectLocalModel: mocks.inspectLocalModel,
}));

vi.mock("../../core/models/nodeModelSetup", () => ({
  createNodeModelSetupPort: mocks.createNodeModelSetupPort,
}));

vi.mock("../../core/models/nodeOnnxSmoke", () => ({
  createNodeOnnxSmokeRunner: mocks.createNodeOnnxSmokeRunner,
}));

import { getLocalModelDefinition, type LocalModelId } from "../../core/models/modelCatalog";
import {
  createNodeModelService,
  NodeModelServiceError,
} from "../../core/models/nodeModelService";

const temporaryDirectories: string[] = [];

function inspection(modelId: LocalModelId, state: "absent" | "ready" | "license-required") {
  const definition = getLocalModelDefinition(modelId);
  return Object.freeze({
    status: Object.freeze({
      modelId,
      state,
      verifiedBytes: state === "ready" ? definition.files.reduce((sum, file) => sum + file.byteSize, 0) : 0,
      totalBytes: definition.files.reduce((sum, file) => sum + file.byteSize, 0),
      problems: Object.freeze([]),
    }),
    capacity: Object.freeze({
      state: "supported" as const,
      canInstall: state !== "license-required",
      requiredStorageBytes: 1,
      requiredMemoryBytes: 1,
      problems: Object.freeze([]),
    }),
  });
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sprite-boy-model-service-"));
  temporaryDirectories.push(root);
  return root;
}

beforeEach(() => {
  mocks.inspectLocalModel.mockReset();
  mocks.install.mockReset();
  mocks.createNodeModelSetupPort.mockReset();
  mocks.createNodeOnnxSmokeRunner.mockReset();
  mocks.createNodeOnnxSmokeRunner.mockReturnValue({ run: vi.fn() });
  mocks.createNodeModelSetupPort.mockReturnValue({ install: mocks.install });
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("node model service", () => {
  it("lists both catalog models with isolated inspection and latest-job state", async () => {
    const root = await temporaryRoot();
    mocks.inspectLocalModel.mockImplementation(async (modelId: LocalModelId) => inspection(modelId, "absent"));
    mocks.install.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const service = createNodeModelService({ root });

    const started = await service.setup("birefnet-lite-512");
    const snapshot = await service.list();

    expect(snapshot.version).toBe(1);
    expect(snapshot.models.map(({ id }) => id)).toEqual(["birefnet-lite-512", "rmbg-2.0"]);
    expect(snapshot.models[0]).toMatchObject({
      id: "birefnet-lite-512",
      repositoryId: "studioludens/birefnet-lite-512",
      status: { state: "absent" },
      job: { id: started.job?.id, kind: "model.setup" },
    });
    expect(snapshot.models[1]).toMatchObject({ id: "rmbg-2.0", status: { state: "absent" }, job: null });
    expect(mocks.inspectLocalModel.mock.calls.map(([modelId]) => modelId)).toEqual([
      "birefnet-lite-512",
      "birefnet-lite-512",
      "rmbg-2.0",
    ]);
    service.cancelJob(started.job!.id);
    service.dispose();
  });

  it("returns ready, blocks gated setup, and rejects unknown model IDs without starting jobs", async () => {
    const root = await temporaryRoot();
    mocks.inspectLocalModel.mockImplementation(async (modelId: LocalModelId) => inspection(
      modelId,
      modelId === "birefnet-lite-512" ? "ready" : "license-required",
    ));
    const service = createNodeModelService({ root });

    await expect(service.setup("birefnet-lite-512")).resolves.toEqual({
      version: 1,
      modelId: "birefnet-lite-512",
      outcome: "ready",
      job: null,
    });
    await expect(service.setup("rmbg-2.0")).rejects.toEqual(
      new NodeModelServiceError("license-required", "Accept the model license and provide access before setup."),
    );
    await expect(service.setup("unknown" as LocalModelId)).rejects.toMatchObject({ code: "invalid-request" });
    expect(service.listJobs().order).toEqual([]);
    expect(mocks.install).not.toHaveBeenCalled();
    service.dispose();
  });

  it("deduplicates an active setup, exposes it by ID, and permits a fresh setup after cancellation", async () => {
    const root = await temporaryRoot();
    mocks.inspectLocalModel.mockResolvedValue(inspection("birefnet-lite-512", "absent"));
    mocks.install.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const service = createNodeModelService({ root });

    const first = await service.setup("birefnet-lite-512");
    const duplicate = await service.setup("birefnet-lite-512");

    expect(first).toMatchObject({ outcome: "started", job: { kind: "model.setup", status: "running" } });
    expect(duplicate).toMatchObject({ outcome: "already-running", job: { id: first.job?.id } });
    expect(mocks.install).toHaveBeenCalledOnce();
    expect(service.getJob(first.job!.id)).toMatchObject({ id: first.job!.id, status: "running" });
    expect(service.getJob("")).toBeNull();
    expect(service.cancelJob("missing-job")).toBeNull();
    expect(service.cancelJob(first.job!.id)).toMatchObject({ id: first.job!.id, status: "cancelled" });
    await vi.waitFor(() => expect(service.getJob(first.job!.id)?.status).toBe("cancelled"));

    const retry = await service.setup("birefnet-lite-512");
    expect(retry).toMatchObject({ outcome: "started", job: { status: "running" } });
    expect(retry.job?.id).not.toBe(first.job?.id);
    expect(mocks.install).toHaveBeenCalledTimes(2);
    service.cancelJob(retry.job!.id);
    service.dispose();
  });

  it("serves only a ready regular ONNX file with the catalog byte size", async () => {
    const root = await temporaryRoot();
    const definition = getLocalModelDefinition("birefnet-lite-512");
    const weights = definition.files.find((file) => file.path.endsWith(".onnx"));
    expect(weights).toBeDefined();
    const path = join(root, definition.id, weights!.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, new Uint8Array());
    mocks.inspectLocalModel.mockResolvedValue(inspection("birefnet-lite-512", "ready"));
    const service = createNodeModelService({ root });

    await truncate(path, weights!.byteSize - 1);
    await expect(service.resolveWeights("birefnet-lite-512")).rejects.toMatchObject({
      code: "model-not-ready",
      message: "The local model weights are invalid.",
    });

    await truncate(path, weights!.byteSize);
    await expect(service.resolveWeights("birefnet-lite-512")).resolves.toEqual({
      path,
      byteSize: 98_484_532,
      contentType: "application/octet-stream",
    });
    await expect(service.resolveWeights("unknown" as LocalModelId)).resolves.toBeNull();
    service.dispose();
  });

  it("refuses weight access until inventory reports a ready install", async () => {
    const root = await temporaryRoot();
    mocks.inspectLocalModel.mockResolvedValue(inspection("birefnet-lite-512", "absent"));
    const service = createNodeModelService({ root });

    await expect(service.resolveWeights("birefnet-lite-512")).rejects.toEqual(
      new NodeModelServiceError("model-not-ready", "The local model is not ready."),
    );
    service.dispose();
  });
});
