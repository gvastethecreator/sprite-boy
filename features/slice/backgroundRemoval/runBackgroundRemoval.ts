import {
  isBackgroundRemovalWorkerResponse,
  getBackgroundRemovalBrowserBackend,
  isRunnableBackgroundRemovalModelId,
  type BackgroundRemovalWorkerProgress,
  type BackgroundRemovalWorkerRequest,
  type BackgroundRemovalWorkerSuccess,
  type RunnableBackgroundRemovalModelId,
} from "./backgroundRemovalProtocol";
import { getLocalModelDefinition } from "../../../core/models";

interface BackgroundRemovalWorkerPort {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

export interface RunBackgroundRemovalOptions {
  readonly requestId?: string;
  readonly modelId?: RunnableBackgroundRemovalModelId;
  readonly source: Blob;
  readonly weights: ArrayBuffer;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly onProgress?: (progress: BackgroundRemovalWorkerProgress) => void;
  readonly workerFactory?: () => BackgroundRemovalWorkerPort;
}

export interface BackgroundRemovalResult {
  readonly requestId: string;
  readonly backend: "wasm" | "webgpu-wasm";
  readonly width: number;
  readonly height: number;
  readonly mask: Blob;
  readonly output: Blob;
}

export class BackgroundRemovalRuntimeError extends Error {
  readonly code:
    | "cancelled"
    | "invalid-input"
    | "timeout"
    | "worker-failed"
    | "invalid-response"
    | "decode-failed"
    | "model-failed"
    | "render-failed"
    | "runtime-failed";

  constructor(code: BackgroundRemovalRuntimeError["code"], message: string) {
    super(message);
    this.name = "BackgroundRemovalRuntimeError";
    this.code = code;
  }
}

function createWorker(): BackgroundRemovalWorkerPort {
  return new Worker(new URL("./backgroundRemoval.worker.ts", import.meta.url), {
    type: "module",
    name: "spriteboy-background-removal",
  });
}

function nextRequestId(): string {
  return `background-removal-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export function runBackgroundRemoval(options: RunBackgroundRemovalOptions): Promise<BackgroundRemovalResult> {
  if (typeof Blob !== "function" || !(options.source instanceof Blob) || options.source.size < 1) {
    return Promise.reject(new BackgroundRemovalRuntimeError("invalid-input", "A non-empty source image is required."));
  }
  if (!(options.weights instanceof ArrayBuffer) || options.weights.byteLength < 1) {
    return Promise.reject(new BackgroundRemovalRuntimeError("invalid-input", "Verified model weights are required."));
  }
  const modelId = options.modelId ?? "birefnet-lite-512";
  if (!isRunnableBackgroundRemovalModelId(modelId)) {
    return Promise.reject(new BackgroundRemovalRuntimeError("invalid-input", "The local model cannot run background removal."));
  }
  const model = getLocalModelDefinition(modelId);
  const backend = getBackgroundRemovalBrowserBackend(modelId);
  if (options.signal?.aborted) {
    return Promise.reject(new BackgroundRemovalRuntimeError("cancelled", "Background removal was cancelled."));
  }
  const requestId = options.requestId ?? nextRequestId();
  if (typeof requestId !== "string" || requestId.length < 1 || requestId.length > 160) {
    return Promise.reject(new BackgroundRemovalRuntimeError("invalid-input", "Background removal request ID is invalid."));
  }
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 15 * 60_000) {
    return Promise.reject(new BackgroundRemovalRuntimeError("invalid-input", "Background removal timeout is invalid."));
  }

  return new Promise<BackgroundRemovalResult>((resolve, reject) => {
    let worker: BackgroundRemovalWorkerPort;
    try {
      worker = (options.workerFactory ?? createWorker)();
    } catch {
      reject(new BackgroundRemovalRuntimeError("worker-failed", "The background removal worker could not start."));
      return;
    }
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.terminate();
    };
    const fail = (error: BackgroundRemovalRuntimeError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const succeed = (response: BackgroundRemovalWorkerSuccess) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Object.freeze({
        requestId,
        backend: response.backend,
        width: response.width,
        height: response.height,
        mask: response.mask,
        output: response.output,
      }));
    };
    const onAbort = () => fail(new BackgroundRemovalRuntimeError("cancelled", "Background removal was cancelled."));
    const onError = () => fail(new BackgroundRemovalRuntimeError("worker-failed", "The background removal worker stopped."));
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isBackgroundRemovalWorkerResponse(event.data)) {
        fail(new BackgroundRemovalRuntimeError("invalid-response", "The background removal worker returned invalid data."));
        return;
      }
      if (event.data.requestId !== requestId) return;
      if (event.data.type === "progress") {
        options.onProgress?.(event.data);
        return;
      }
      if (event.data.type === "error") {
        fail(new BackgroundRemovalRuntimeError(event.data.code, event.data.message));
        return;
      }
      if (event.data.backend !== backend) {
        fail(new BackgroundRemovalRuntimeError("invalid-response", "The background removal worker returned the wrong backend."));
        return;
      }
      succeed(event.data);
    };
    const timer = setTimeout(
      () => fail(new BackgroundRemovalRuntimeError("timeout", "Background removal timed out.")),
      timeoutMs,
    );
    options.signal?.addEventListener("abort", onAbort, { once: true });
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);

    const request: BackgroundRemovalWorkerRequest = {
      type: "run",
      requestId,
      modelId,
      backend,
      inputWidth: model.runtime.inputWidth,
      inputHeight: model.runtime.inputHeight,
      weights: options.weights,
      source: options.source,
    };
    try {
      worker.postMessage(request, [options.weights]);
    } catch {
      fail(new BackgroundRemovalRuntimeError("worker-failed", "Background removal could not send work to the worker."));
    }
  });
}
