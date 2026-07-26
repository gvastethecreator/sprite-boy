import { getLocalModelDefinition, type LocalModelId } from "../../../core/models";

export const RUNNABLE_BACKGROUND_REMOVAL_MODEL_IDS = Object.freeze([
  "birefnet-lite-512",
  "ben2-base",
] as const satisfies readonly LocalModelId[]);

export type RunnableBackgroundRemovalModelId = typeof RUNNABLE_BACKGROUND_REMOVAL_MODEL_IDS[number];

export type BackgroundRemovalBrowserBackend = "wasm" | "webgpu-wasm";

const BROWSER_BACKENDS: Readonly<Record<RunnableBackgroundRemovalModelId, BackgroundRemovalBrowserBackend>> = Object.freeze({
  "birefnet-lite-512": "wasm",
  "ben2-base": "webgpu-wasm",
});

export function isRunnableBackgroundRemovalModelId(value: unknown): value is RunnableBackgroundRemovalModelId {
  return typeof value === "string"
    && (RUNNABLE_BACKGROUND_REMOVAL_MODEL_IDS as readonly string[]).includes(value);
}

export function getBackgroundRemovalBrowserBackend(
  modelId: RunnableBackgroundRemovalModelId,
): BackgroundRemovalBrowserBackend {
  return BROWSER_BACKENDS[modelId];
}

export type BackgroundRemovalProgressPhase =
  | "decode"
  | "preprocess"
  | "load-model"
  | "inference"
  | "render";

export interface BackgroundRemovalWorkerRequest {
  readonly type: "run";
  readonly requestId: string;
  readonly modelId: RunnableBackgroundRemovalModelId;
  readonly backend: BackgroundRemovalBrowserBackend;
  readonly inputWidth: number;
  readonly inputHeight: number;
  readonly weights: ArrayBuffer;
  readonly source: Blob;
}

export interface BackgroundRemovalWorkerProgress {
  readonly type: "progress";
  readonly requestId: string;
  readonly phase: BackgroundRemovalProgressPhase;
  readonly ratio: number;
  readonly message: string;
}

export interface BackgroundRemovalWorkerSuccess {
  readonly type: "success";
  readonly requestId: string;
  readonly backend: BackgroundRemovalBrowserBackend;
  readonly width: number;
  readonly height: number;
  readonly mask: Blob;
  readonly output: Blob;
}

export interface BackgroundRemovalWorkerFailure {
  readonly type: "error";
  readonly requestId: string;
  readonly code: "decode-failed" | "model-failed" | "render-failed" | "runtime-failed";
  readonly message: string;
}

export type BackgroundRemovalWorkerResponse =
  | BackgroundRemovalWorkerProgress
  | BackgroundRemovalWorkerSuccess
  | BackgroundRemovalWorkerFailure;

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string") ||
      keys.some((key) => !ownKeys.includes(key))) return null;
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return null;
  }
}

function validRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer;
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob === "function"
    && value instanceof Blob;
}

export function readBackgroundRemovalRequestId(value: unknown): string | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, "requestId");
    return descriptor && "value" in descriptor && validRequestId(descriptor.value)
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

export function isBackgroundRemovalWorkerRequest(value: unknown): value is BackgroundRemovalWorkerRequest {
  const record = exactRecord(value, ["type", "requestId", "modelId", "backend", "inputWidth", "inputHeight", "weights", "source"]);
  const definition = isRunnableBackgroundRemovalModelId(record?.modelId)
    ? getLocalModelDefinition(record.modelId)
    : null;
  return record?.type === "run"
    && validRequestId(record.requestId)
    && definition !== null
    && record.backend === getBackgroundRemovalBrowserBackend(record.modelId as RunnableBackgroundRemovalModelId)
    && record.inputWidth === definition.runtime.inputWidth
    && record.inputHeight === definition.runtime.inputHeight
    && isArrayBuffer(record.weights)
    && record.weights.byteLength > 0
    && isBlob(record.source)
    && record.source.size > 0;
}

export function isBackgroundRemovalWorkerResponse(value: unknown): value is BackgroundRemovalWorkerResponse {
  let type: unknown;
  let requestId: unknown;
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const typeDescriptor = Object.getOwnPropertyDescriptor(value, "type");
    const requestIdDescriptor = Object.getOwnPropertyDescriptor(value, "requestId");
    if (!typeDescriptor || !("value" in typeDescriptor) || !requestIdDescriptor || !("value" in requestIdDescriptor)) {
      return false;
    }
    type = typeDescriptor.value;
    requestId = requestIdDescriptor.value;
  } catch {
    return false;
  }
  if (!validRequestId(requestId)) return false;
  if (type === "progress") {
    const record = exactRecord(value, ["type", "requestId", "phase", "ratio", "message"]);
    return Boolean(record)
      && ["decode", "preprocess", "load-model", "inference", "render"].includes(String(record?.phase))
      && typeof record?.ratio === "number"
      && Number.isFinite(record.ratio)
      && record.ratio >= 0
      && record.ratio <= 1
      && typeof record.message === "string";
  }
  if (type === "success") {
    const record = exactRecord(value, ["type", "requestId", "backend", "width", "height", "mask", "output"]);
    return Boolean(record)
      && (record?.backend === "wasm" || record?.backend === "webgpu-wasm")
      && Number.isSafeInteger(record?.width) && (record?.width as number) > 0
      && Number.isSafeInteger(record?.height) && (record?.height as number) > 0
      && isBlob(record?.mask) && record.mask.size > 0 && record.mask.type === "image/png"
      && isBlob(record?.output) && record.output.size > 0 && record.output.type === "image/png";
  }
  if (type === "error") {
    const record = exactRecord(value, ["type", "requestId", "code", "message"]);
    return Boolean(record)
      && ["decode-failed", "model-failed", "render-failed", "runtime-failed"].includes(String(record?.code))
      && typeof record?.message === "string"
      && record.message.length > 0;
  }
  return false;
}
