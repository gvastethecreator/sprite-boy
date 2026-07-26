/// <reference lib="webworker" />

import type * as Ort from "onnxruntime-web";
import {
  getLocalModelDefinition,
  normalizeModelMaskTensor,
  type LocalModelDefinition,
} from "../../../core/models";
import { GRID_PROCESSING_LIMITS } from "../../../core/processing/gridProcessingLimits";
import {
  isBackgroundRemovalWorkerRequest,
  readBackgroundRemovalRequestId,
  type BackgroundRemovalProgressPhase,
  type BackgroundRemovalWorkerFailure,
  type BackgroundRemovalWorkerRequest,
} from "./backgroundRemovalProtocol";

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
const MEAN = [0.485, 0.456, 0.406] as const;
const STANDARD_DEVIATION = [0.229, 0.224, 0.225] as const;

function progress(
  requestId: string,
  phase: BackgroundRemovalProgressPhase,
  ratio: number,
  message: string,
): void {
  workerScope.postMessage({ type: "progress", requestId, phase, ratio, message });
}

function failure(requestId: string, code: BackgroundRemovalWorkerFailure["code"], message: string): BackgroundRemovalWorkerFailure {
  return { type: "error", requestId, code, message };
}

function preprocess(
  ort: typeof Ort,
  bitmap: ImageBitmap,
  width: number,
  height: number,
  normalization: LocalModelDefinition["runtime"]["inputNormalization"],
): Ort.Tensor {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new TypeError("Image preprocessing is unavailable.");
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const planeSize = width * height;
  const tensor = new Float32Array(planeSize * 3);
  for (let pixel = 0; pixel < planeSize; pixel += 1) {
    const rgba = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = pixels[rgba + channel]! / 255;
      tensor[channel * planeSize + pixel] = normalization === "imagenet"
        ? (value - MEAN[channel]!) / STANDARD_DEVIATION[channel]!
        : value;
    }
  }
  return new ort.Tensor("float32", tensor, [1, 3, height, width]);
}

async function renderResults(
  bitmap: ImageBitmap,
  tensor: Ort.Tensor,
  modelWidth: number,
  modelHeight: number,
  outputType: LocalModelDefinition["runtime"]["outputType"],
  normalization: LocalModelDefinition["runtime"]["outputNormalization"],
): Promise<{ mask: Blob; output: Blob }> {
  const maskBytes = normalizeModelMaskTensor(
    tensor,
    modelWidth * modelHeight,
    outputType,
    normalization,
  );
  const lowCanvas = new OffscreenCanvas(modelWidth, modelHeight);
  const lowContext = lowCanvas.getContext("2d");
  if (!lowContext) throw new TypeError("Mask rendering is unavailable.");
  const lowMask = lowContext.createImageData(modelWidth, modelHeight);
  for (let index = 0; index < maskBytes.length; index += 1) {
    const byte = maskBytes[index]!;
    const offset = index * 4;
    lowMask.data[offset] = byte;
    lowMask.data[offset + 1] = byte;
    lowMask.data[offset + 2] = byte;
    lowMask.data[offset + 3] = 255;
  }
  lowContext.putImageData(lowMask, 0, 0);

  const width = bitmap.width;
  const height = bitmap.height;
  const maskCanvas = new OffscreenCanvas(width, height);
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!maskContext) throw new TypeError("Mask scaling is unavailable.");
  maskContext.imageSmoothingEnabled = true;
  maskContext.imageSmoothingQuality = "high";
  maskContext.drawImage(lowCanvas, 0, 0, width, height);
  const maskPixels = maskContext.getImageData(0, 0, width, height);

  const outputCanvas = new OffscreenCanvas(width, height);
  const outputContext = outputCanvas.getContext("2d", { willReadFrequently: true });
  if (!outputContext) throw new TypeError("Output rendering is unavailable.");
  outputContext.clearRect(0, 0, width, height);
  outputContext.drawImage(bitmap, 0, 0, width, height);
  const outputPixels = outputContext.getImageData(0, 0, width, height);
  for (let offset = 0; offset < outputPixels.data.length; offset += 4) {
    outputPixels.data[offset + 3] = Math.round(
      outputPixels.data[offset + 3]! * (maskPixels.data[offset]! / 255),
    );
  }
  outputContext.putImageData(outputPixels, 0, 0);
  const [mask, output] = await Promise.all([
    maskCanvas.convertToBlob({ type: "image/png" }),
    outputCanvas.convertToBlob({ type: "image/png" }),
  ]);
  if (mask.size < 1 || output.size < 1) throw new TypeError("Background removal produced an empty image.");
  return { mask, output };
}

async function run(request: BackgroundRemovalWorkerRequest): Promise<void> {
  let bitmap: ImageBitmap | null = null;
  let session: Ort.InferenceSession | null = null;
  try {
    progress(request.requestId, "decode", 0.05, "Decoding source image");
    try {
      bitmap = await createImageBitmap(request.source);
    } catch {
      workerScope.postMessage(failure(request.requestId, "decode-failed", "The source image could not be decoded."));
      return;
    }
    if (
      bitmap.width < 1 || bitmap.height < 1
      || bitmap.width > GRID_PROCESSING_LIMITS.maxDimension
      || bitmap.height > GRID_PROCESSING_LIMITS.maxDimension
      || bitmap.width * bitmap.height > GRID_PROCESSING_LIMITS.maxSourcePixels
    ) {
      workerScope.postMessage(failure(request.requestId, "decode-failed", "The source image dimensions are outside the safe limit."));
      return;
    }

    progress(request.requestId, "preprocess", 0.15, "Preparing model runtime");
    const definition = getLocalModelDefinition(request.modelId);
    const ort: typeof Ort = request.backend === "webgpu-wasm"
      ? await import("onnxruntime-web/all")
      : await import("onnxruntime-web/wasm");
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const input = preprocess(
      ort,
      bitmap,
      request.inputWidth,
      request.inputHeight,
      definition.runtime.inputNormalization,
    );
    progress(request.requestId, "load-model", 0.3, "Loading verified local model");
    let output: Ort.Tensor | null = null;
    try {
      session = await ort.InferenceSession.create(request.weights, {
        executionProviders: request.backend === "webgpu-wasm" ? ["webgpu", "wasm"] : ["wasm"],
        graphOptimizationLevel: request.backend === "webgpu-wasm" ? "disabled" : "all",
        logSeverityLevel: 3,
      });
      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];
      if (
        session.inputNames.length !== 1 || !inputName
        || session.outputNames.length !== 1 || !outputName
        || (definition.runtime.inputName !== null && inputName !== definition.runtime.inputName)
        || (definition.runtime.outputName !== null && outputName !== definition.runtime.outputName)
      ) throw new TypeError("Model input or output names are invalid.");
      progress(request.requestId, "inference", 0.6, "Removing background");
      const outputs = await session.run({ [inputName]: input });
      output = outputs[outputName] ?? null;
      if (!output) throw new TypeError("Model inference returned no output image.");
    } catch {
      workerScope.postMessage(failure(request.requestId, "model-failed", "The local model could not complete background removal."));
      return;
    }
    progress(request.requestId, "render", 0.9, "Rendering mask and alpha");
    try {
      const rendered = await renderResults(
        bitmap,
        output,
        request.inputWidth,
        request.inputHeight,
        definition.runtime.outputType,
        definition.runtime.outputNormalization,
      );
      workerScope.postMessage({
        type: "success",
        requestId: request.requestId,
        backend: request.backend,
        width: bitmap.width,
        height: bitmap.height,
        mask: rendered.mask,
        output: rendered.output,
      });
    } catch {
      workerScope.postMessage(failure(request.requestId, "render-failed", "The mask or alpha image could not be rendered."));
    }
  } catch {
    workerScope.postMessage(failure(request.requestId, "runtime-failed", "Background removal failed."));
  } finally {
    bitmap?.close();
    await session?.release();
  }
}

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isBackgroundRemovalWorkerRequest(event.data)) {
    const requestId = readBackgroundRemovalRequestId(event.data);
    if (requestId) {
      workerScope.postMessage(failure(requestId, "runtime-failed", "Background removal request was invalid."));
    }
    return;
  }
  void run(event.data);
});
