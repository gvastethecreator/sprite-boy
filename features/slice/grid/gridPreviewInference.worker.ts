/// <reference lib="webworker" />

import { inferAutoGridLayout } from "../../../core/processing/gridProcessingDetection";
import { GRID_PROCESSING_LIMITS } from "../../../core/processing/gridProcessingLimits";
import type {
  GridPreviewInferenceRequest,
  GridPreviewInferenceResponse,
} from "./gridPreviewInference";

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string") ||
      keys.some((key) => !ownKeys.includes(key))) return null;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      Object.defineProperty(output, key, { enumerable: true, value: descriptor.value });
    }
    return output;
  } catch {
    return null;
  }
}

export function isGridPreviewInferenceRequest(value: unknown): value is GridPreviewInferenceRequest {
  const request = exactRecord(value, ["type", "requestId", "width", "height", "source"]);
  if (!request || request.type !== "infer" || typeof request.requestId !== "string" ||
    request.requestId.length < 1 || request.requestId.length > 128 ||
    !Number.isSafeInteger(request.width) || !Number.isSafeInteger(request.height) ||
    (request.width as number) < 1 || (request.height as number) < 1 ||
    (request.width as number) > GRID_PROCESSING_LIMITS.maxDimension ||
    (request.height as number) > GRID_PROCESSING_LIMITS.maxDimension ||
    (request.width as number) * (request.height as number) > GRID_PROCESSING_LIMITS.maxSourcePixels) {
    return false;
  }
  const kindRecord = exactRecord(request.source, ["kind", "bitmap"]);
  if (kindRecord?.kind === "bitmap") {
    return typeof ImageBitmap === "function" && kindRecord.bitmap instanceof ImageBitmap;
  }
  const urlRecord = exactRecord(request.source, ["kind", "url"]);
  return urlRecord?.kind === "url" && typeof urlRecord.url === "string" &&
    urlRecord.url.length > 0;
}

async function decodeSource(request: GridPreviewInferenceRequest): Promise<ImageBitmap> {
  if (request.source.kind === "bitmap") return request.source.bitmap;
  if (typeof fetch !== "function" || typeof createImageBitmap !== "function") {
    throw new TypeError("Preview decoding is unavailable.");
  }
  const response = await fetch(request.source.url, { credentials: "same-origin" });
  if (!response.ok) throw new TypeError("Preview source could not be fetched.");
  return createImageBitmap(await response.blob());
}

export async function runGridPreviewInferenceRequest(
  request: GridPreviewInferenceRequest,
): Promise<GridPreviewInferenceResponse> {
  let bitmap: ImageBitmap | null = null;
  try {
    if (typeof OffscreenCanvas !== "function") throw new TypeError("OffscreenCanvas is unavailable.");
    bitmap = await decodeSource(request);
    if (bitmap.width !== request.width || bitmap.height !== request.height) {
      throw new TypeError("Preview dimensions do not match the committed source.");
    }
    const canvas = new OffscreenCanvas(request.width, request.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new TypeError("Offscreen 2D context is unavailable.");
    context.clearRect(0, 0, request.width, request.height);
    context.drawImage(bitmap, 0, 0, request.width, request.height);
    const pixels = context.getImageData(0, 0, request.width, request.height).data;
    return Object.freeze({
      type: "success" as const,
      requestId: request.requestId,
      inference: inferAutoGridLayout(pixels, request.width, request.height),
    });
  } catch {
    return Object.freeze({ type: "error" as const, requestId: request.requestId });
  } finally {
    bitmap?.close();
  }
}

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isGridPreviewInferenceRequest(event.data)) return;
  void runGridPreviewInferenceRequest(event.data).then((response) => {
    workerScope.postMessage(response);
  });
});
