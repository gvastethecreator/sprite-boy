// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ortMocks = vi.hoisted(() => {
  class Tensor {
    readonly type: string;
    readonly data: Float32Array | Uint8Array;
    readonly dims: readonly number[];
    readonly size: number;

    constructor(type: string, data: Float32Array | Uint8Array, dims: readonly number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
      this.size = dims.reduce((product, value) => product * value, 1);
    }
  }
  return {
    Tensor,
    create: vi.fn(),
    env: { wasm: { numThreads: 0 } },
  };
});

vi.mock("onnxruntime-web", () => ({
  Tensor: ortMocks.Tensor,
  InferenceSession: { create: ortMocks.create },
  env: ortMocks.env,
}));

import {
  getLocalModelDefinition,
  modelCatalogFingerprint,
  type LocalModelDefinition,
} from "../../core/models/modelCatalog";
import { createNodeOnnxSmokeRunner } from "../../core/models/nodeOnnxSmoke";

const temporaryDirectories: string[] = [];
const model = getLocalModelDefinition("birefnet-lite-512");
const pixelCount = model.runtime.inputWidth * model.runtime.inputHeight;

interface FakeSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  readonly run: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
}

function tensor(
  data: Float32Array | Uint8Array = new Float32Array(pixelCount),
  type = "float32",
  dims: readonly number[] = [1, 1, model.runtime.inputHeight, model.runtime.inputWidth],
) {
  return new ortMocks.Tensor(type, data, dims);
}

function session(options: {
  readonly inputNames?: readonly string[];
  readonly outputNames?: readonly string[];
  readonly run?: FakeSession["run"];
} = {}): FakeSession {
  return {
    inputNames: options.inputNames ?? ["input_image"],
    outputNames: options.outputNames ?? ["output_image"],
    run: options.run ?? vi.fn(async () => ({ output_image: tensor() })),
    release: vi.fn(async () => undefined),
  };
}

async function modelRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sprite-boy-onnx-smoke-"));
  temporaryDirectories.push(root);
  const onnx = model.files.find((file) => file.path.endsWith(".onnx"));
  expect(onnx).toBeDefined();
  const path = join(root, model.id, onnx!.path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, new Uint8Array([0x08, 0x01, 0x12, 0x02]));
  return root;
}

function run(root: string, signal = new AbortController().signal, definition: LocalModelDefinition = model) {
  return createNodeOnnxSmokeRunner().run({ model: definition, modelsRoot: root, signal });
}

beforeEach(() => {
  ortMocks.create.mockReset();
  ortMocks.env.wasm.numThreads = 0;
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("node ONNX smoke runner", () => {
  it("runs the pinned WASM contract and returns deterministic mask evidence", async () => {
    const root = await modelRoot();
    const fake = session();
    ortMocks.create.mockResolvedValue(fake);

    const evidence = await run(root);

    expect(ortMocks.env.wasm.numThreads).toBe(1);
    expect(Array.from(ortMocks.create.mock.calls[0]![0] as Uint8Array)).toEqual([0x08, 0x01, 0x12, 0x02]);
    expect(ortMocks.create.mock.calls[0]![1]).toEqual({
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
      logSeverityLevel: 3,
    });
    expect(fake.run).toHaveBeenCalledOnce();
    const feeds = fake.run.mock.calls[0]![0] as { input_image: InstanceType<typeof ortMocks.Tensor> };
    expect(feeds.input_image).toMatchObject({
      type: "float32",
      dims: [1, 3, 512, 512],
      size: 786_432,
    });
    expect(evidence).toMatchObject({
      status: "passed",
      backend: "wasm",
      catalogFingerprint: modelCatalogFingerprint(model),
      outputSha256: "sha256:6c9b7fcf875d48a0ef17ac32c5c3793e8dea7fe199e7d3370032a00b21f7c94c",
    });
    expect(evidence.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
    expect(evidence.peakMemoryBytes).toBeGreaterThan(0);
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("rejects unsupported models and an already-aborted request before creating a session", async () => {
    const root = await modelRoot();
    const unsupported = getLocalModelDefinition("rmbg-2.0");
    const controller = new AbortController();
    controller.abort(new DOMException("Stopped", "AbortError"));

    await expect(run(root, new AbortController().signal, unsupported)).rejects.toThrow(
      "No WASM smoke is defined for rmbg-2.0.",
    );
    await expect(run(root, controller.signal)).rejects.toMatchObject({ name: "AbortError", message: "Stopped" });
    expect(ortMocks.create).not.toHaveBeenCalled();
  });

  it("releases a bad session and lets the serialized queue continue", async () => {
    const root = await modelRoot();
    const invalid = session({ outputNames: ["mask"] });
    const valid = session();
    ortMocks.create.mockResolvedValueOnce(invalid).mockResolvedValueOnce(valid);

    await expect(run(root)).rejects.toThrow("Model input or output names are invalid.");
    await expect(run(root)).resolves.toMatchObject({ status: "passed" });

    expect(invalid.run).not.toHaveBeenCalled();
    expect(invalid.release).toHaveBeenCalledOnce();
    expect(valid.release).toHaveBeenCalledOnce();
    expect(ortMocks.create).toHaveBeenCalledTimes(2);
  });

  it("serializes concurrent inference sessions", async () => {
    const root = await modelRoot();
    let resolveFirst!: (value: { output_image: InstanceType<typeof ortMocks.Tensor> }) => void;
    const firstOutput = new Promise<{ output_image: InstanceType<typeof ortMocks.Tensor> }>((resolve) => {
      resolveFirst = resolve;
    });
    const first = session({ run: vi.fn(() => firstOutput) });
    const second = session();
    ortMocks.create.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const firstRun = run(root);
    const secondRun = run(root);
    await vi.waitFor(() => expect(first.run).toHaveBeenCalledOnce());
    expect(ortMocks.create).toHaveBeenCalledTimes(1);

    resolveFirst({ output_image: tensor() });
    await expect(firstRun).resolves.toMatchObject({ status: "passed" });
    await expect(secondRun).resolves.toMatchObject({ status: "passed" });
    expect(ortMocks.create).toHaveBeenCalledTimes(2);
    expect(first.release).toHaveBeenCalledOnce();
    expect(second.release).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing output", undefined, "Model inference returned no output image."],
    ["wrong tensor type", tensor(new Float32Array(pixelCount), "float64"), "Model output tensor is invalid."],
    ["wrong tensor size", tensor(new Float32Array(4), "float32", [1, 1, 2, 2]), "Model output tensor is invalid."],
    ["non-finite mask", tensor(new Float32Array(pixelCount).fill(Number.NaN)), "Model mask contains invalid values."],
  ])("rejects %s and still releases the session", async (_label, output, message) => {
    const root = await modelRoot();
    const fake = session({ run: vi.fn(async () => ({ output_image: output })) });
    ortMocks.create.mockResolvedValue(fake);

    await expect(run(root)).rejects.toThrow(message);
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("honors cancellation after inference and releases the session", async () => {
    const root = await modelRoot();
    const controller = new AbortController();
    const fake = session({
      run: vi.fn(async () => {
        controller.abort(new DOMException("Stopped after inference", "AbortError"));
        return { output_image: tensor() };
      }),
    });
    ortMocks.create.mockResolvedValue(fake);

    await expect(run(root, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
      message: "Stopped after inference",
    });
    expect(fake.release).toHaveBeenCalledOnce();
  });
});
