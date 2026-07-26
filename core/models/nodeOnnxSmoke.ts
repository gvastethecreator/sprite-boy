import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import * as ort from "onnxruntime-web";

import { modelCatalogFingerprint } from "./modelCatalog";
import type { NodeModelSmokeRunner } from "./nodeModelSetup";
import type { ModelSmokeEvidence } from "./modelReadiness";

let smokeQueue: Promise<void> = Promise.resolve();

async function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const previous = smokeQueue;
  let release!: () => void;
  smokeQueue = new Promise<void>((resolvePromise) => { release = resolvePromise; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function fixtureTensor(width: number, height: number): ort.Tensor {
  const pixels = width * height;
  const data = new Float32Array(pixels * 3);
  const mean = [0.485, 0.456, 0.406] as const;
  const standardDeviation = [0.229, 0.224, 0.225] as const;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const foreground = x > width / 4 && x < width * 3 / 4 && y > height / 4 && y < height * 3 / 4;
      const colors = foreground ? [245, 74, 38] : [16, 24, 32];
      const pixel = y * width + x;
      for (let channel = 0; channel < 3; channel += 1) {
        data[channel * pixels + pixel] = (colors[channel]! / 255 - mean[channel]!) / standardDeviation[channel]!;
      }
    }
  }
  return new ort.Tensor("float32", data, [1, 3, height, width]);
}

function hashMask(tensor: ort.Tensor, expectedSize: number): string {
  if (tensor.type !== "float32" || tensor.size !== expectedSize || !(tensor.data instanceof Float32Array)) {
    throw new TypeError("Model output tensor is invalid.");
  }
  const bytes = new Uint8Array(expectedSize);
  for (let index = 0; index < tensor.data.length; index += 1) {
    const value = 1 / (1 + Math.exp(-tensor.data[index]!));
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeError("Model mask contains invalid values.");
    bytes[index] = Math.round(value * 255);
  }
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function createNodeOnnxSmokeRunner(): NodeModelSmokeRunner {
  return Object.freeze({
    run: ({ model, modelsRoot, signal }: Parameters<NodeModelSmokeRunner["run"]>[0]): Promise<ModelSmokeEvidence> => serialized(async () => {
      if (model.id !== "birefnet-lite-512" || !model.runtime.preferredBackends.includes("wasm")) {
        throw new TypeError(`No WASM smoke is defined for ${model.id}.`);
      }
      if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const onnxFile = model.files.find((file) => file.path.endsWith(".onnx"));
      if (!onnxFile) throw new TypeError("Model catalog has no ONNX file.");
      ort.env.wasm.numThreads = 1;
      const modelBytes = await readFile(join(modelsRoot, model.id, onnxFile.path));
      let peakMemoryBytes = process.memoryUsage().rss;
      const sampleMemory = () => {
        peakMemoryBytes = Math.max(peakMemoryBytes, process.memoryUsage().rss);
      };
      const memorySampler = setInterval(sampleMemory, 25);
      let session: ort.InferenceSession | null = null;
      try {
        session = await ort.InferenceSession.create(modelBytes, {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all",
          logSeverityLevel: 3,
        });
        if (
          session.inputNames.length !== 1 || session.inputNames[0] !== "input_image"
          || session.outputNames.length !== 1 || session.outputNames[0] !== "output_image"
        ) throw new TypeError("Model input or output names are invalid.");
        if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
        const input = fixtureTensor(model.runtime.inputWidth, model.runtime.inputHeight);
        const outputs = await session.run({ input_image: input });
        sampleMemory();
        if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
        const output = outputs.output_image;
        if (!output) throw new TypeError("Model inference returned no output image.");
        const outputSha256 = hashMask(output, model.runtime.inputWidth * model.runtime.inputHeight);
        return Object.freeze({
          status: "passed" as const,
          catalogFingerprint: modelCatalogFingerprint(model),
          backend: "wasm" as const,
          completedAt: new Date().toISOString(),
          outputSha256,
          peakMemoryBytes,
        });
      } finally {
        clearInterval(memorySampler);
        await session?.release();
      }
    }),
  });
}
