/// <reference lib="webworker" />

import * as ort from "onnxruntime-web/wasm";
import { GRID_PROCESSING_LIMITS } from "../../../core/processing/gridProcessingLimits";
import {
  isBackgroundRemovalWorkerRequest,
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

function preprocess(bitmap: ImageBitmap, width: number, height: number): ort.Tensor {
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
      tensor[channel * planeSize + pixel] = (
        pixels[rgba + channel]! / 255 - MEAN[channel]!
      ) / STANDARD_DEVIATION[channel]!;
    }
  }
  return new ort.Tensor("float32", tensor, [1, 3, height, width]);
}

function sigmoid(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

async function renderResults(
  bitmap: ImageBitmap,
  tensor: ort.Tensor,
  modelWidth: number,
  modelHeight: number,
): Promise<{ mask: Blob; output: Blob }> {
  if (tensor.type !== "float32" || !(tensor.data instanceof Float32Array) || tensor.size !== modelWidth * modelHeight) {
    throw new TypeError("Model output tensor is invalid.");
  }
  const lowCanvas = new OffscreenCanvas(modelWidth, modelHeight);
  const lowContext = lowCanvas.getContext("2d");
  if (!lowContext) throw new TypeError("Mask rendering is unavailable.");
  const lowMask = lowContext.createImageData(modelWidth, modelHeight);
  for (let index = 0; index < tensor.data.length; index += 1) {
    const value = sigmoid(tensor.data[index]!);
    if (!Number.isFinite(value)) throw new TypeError("Model mask contains invalid values.");
    const byte = Math.round(value * 255);
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
  let session: ort.InferenceSession | null = null;
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

    progress(request.requestId, "preprocess", 0.15, "Preparing model input");
    const input = preprocess(bitmap, request.inputWidth, request.inputHeight);
    progress(request.requestId, "load-model", 0.3, "Loading verified local model");
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    try {
      session = await ort.InferenceSession.create(request.weights, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
        logSeverityLevel: 3,
      });
      if (
        session.inputNames.length !== 1 || session.inputNames[0] !== "input_image"
        || session.outputNames.length !== 1 || session.outputNames[0] !== "output_image"
      ) throw new TypeError("Model input or output names are invalid.");
      progress(request.requestId, "inference", 0.6, "Removing background");
      const outputs = await session.run({ input_image: input });
      const output = outputs.output_image;
      if (!output) throw new TypeError("Model inference returned no output image.");
      progress(request.requestId, "render", 0.9, "Rendering mask and alpha");
      const rendered = await renderResults(bitmap, output, request.inputWidth, request.inputHeight);
      workerScope.postMessage({
        type: "success",
        requestId: request.requestId,
        width: bitmap.width,
        height: bitmap.height,
        mask: rendered.mask,
        output: rendered.output,
      });
    } catch {
      workerScope.postMessage(failure(request.requestId, "model-failed", "The local model could not complete background removal."));
    }
  } catch {
    workerScope.postMessage(failure(request.requestId, "runtime-failed", "Background removal failed."));
  } finally {
    bitmap?.close();
    await session?.release();
  }
}

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isBackgroundRemovalWorkerRequest(event.data)) return;
  void run(event.data);
});

