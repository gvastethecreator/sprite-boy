import type { LocalModelId } from "../../../core/models";

export type BackgroundRemovalProgressPhase =
  | "decode"
  | "preprocess"
  | "load-model"
  | "inference"
  | "render";

export interface BackgroundRemovalWorkerRequest {
  readonly type: "run";
  readonly requestId: string;
  readonly modelId: Extract<LocalModelId, "birefnet-lite-512">;
  readonly inputWidth: 512;
  readonly inputHeight: 512;
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

export function isBackgroundRemovalWorkerRequest(value: unknown): value is BackgroundRemovalWorkerRequest {
  const record = exactRecord(value, ["type", "requestId", "modelId", "inputWidth", "inputHeight", "weights", "source"]);
  return record?.type === "run"
    && validRequestId(record.requestId)
    && record.modelId === "birefnet-lite-512"
    && record.inputWidth === 512
    && record.inputHeight === 512
    && record.weights instanceof ArrayBuffer
    && record.weights.byteLength > 0
    && typeof Blob === "function"
    && record.source instanceof Blob
    && record.source.size > 0;
}

export function isBackgroundRemovalWorkerResponse(value: unknown): value is BackgroundRemovalWorkerResponse {
  const base = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!base || !validRequestId(base.requestId)) return false;
  if (base.type === "progress") {
    const record = exactRecord(value, ["type", "requestId", "phase", "ratio", "message"]);
    return Boolean(record)
      && ["decode", "preprocess", "load-model", "inference", "render"].includes(String(record?.phase))
      && typeof record?.ratio === "number"
      && Number.isFinite(record.ratio)
      && record.ratio >= 0
      && record.ratio <= 1
      && typeof record.message === "string";
  }
  if (base.type === "success") {
    const record = exactRecord(value, ["type", "requestId", "width", "height", "mask", "output"]);
    return Boolean(record)
      && Number.isSafeInteger(record?.width) && (record?.width as number) > 0
      && Number.isSafeInteger(record?.height) && (record?.height as number) > 0
      && typeof Blob === "function"
      && record?.mask instanceof Blob && record.mask.size > 0 && record.mask.type === "image/png"
      && record?.output instanceof Blob && record.output.size > 0 && record.output.type === "image/png";
  }
  if (base.type === "error") {
    const record = exactRecord(value, ["type", "requestId", "code", "message"]);
    return Boolean(record)
      && ["decode-failed", "model-failed", "render-failed", "runtime-failed"].includes(String(record?.code))
      && typeof record?.message === "string"
      && record.message.length > 0;
  }
  return false;
}

