import type { GridAutoInference } from "../../../core/processing/gridProcessingDetection";
import {
  GRID_PROCESSING_LIMITS,
  type GridProcessingRectV1,
  type GridProcessingWarningCode,
} from "../../../core/processing/gridProcessingProtocol";

export interface GridPreviewSource {
  readonly width: number;
  readonly height: number;
  /** Session-owned decoded image. Main clones it; owner is never closed or transferred. */
  readonly image: unknown | null;
  /** Durable legacy URL decoded wholly inside the preview Worker. */
  readonly legacyUrl: string | null;
}

export type GridPreviewInference = (
  source: GridPreviewSource,
  signal: AbortSignal,
) => Promise<GridAutoInference>;

export type GridPreviewWorkerSource =
  | { readonly kind: "bitmap"; readonly bitmap: ImageBitmap }
  | { readonly kind: "url"; readonly url: string };

export interface GridPreviewInferenceRequest {
  readonly type: "infer";
  readonly requestId: string;
  readonly width: number;
  readonly height: number;
  readonly source: GridPreviewWorkerSource;
}

export type GridPreviewInferenceResponse =
  | { readonly type: "success"; readonly requestId: string; readonly inference: GridAutoInference }
  | { readonly type: "error"; readonly requestId: string };

interface GridPreviewWorkerEventMap {
  readonly message: MessageEvent<unknown>;
  readonly error: Event;
  readonly messageerror: Event;
}

export interface GridPreviewWorkerPort {
  postMessage(message: GridPreviewInferenceRequest, transfer: Transferable[]): void;
  addEventListener<K extends keyof GridPreviewWorkerEventMap>(
    type: K,
    listener: (event: GridPreviewWorkerEventMap[K]) => void,
  ): void;
  removeEventListener<K extends keyof GridPreviewWorkerEventMap>(
    type: K,
    listener: (event: GridPreviewWorkerEventMap[K]) => void,
  ): void;
  terminate(): void;
}

export interface CreateGridPreviewInferenceOptions {
  readonly workerFactory?: () => GridPreviewWorkerPort;
  readonly createImageBitmap?: (source: ImageBitmapSource) => Promise<ImageBitmap>;
}

export class GridPreviewInferenceError extends Error {
  readonly code: "unavailable" | "decode" | "worker" | "invalid-response";

  constructor(code: GridPreviewInferenceError["code"]) {
    super("Grid preview could not be analyzed.");
    this.name = "GridPreviewInferenceError";
    this.code = code;
  }
}

interface ResponseExpectation {
  readonly requestId: string;
  readonly width: number;
  readonly height: number;
}

type DataRecord = Readonly<Record<string, unknown>>;

function aborted(): DOMException {
  return new DOMException("Grid preview inference was cancelled.", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw aborted();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function closeBitmapNoThrow(bitmap: ImageBitmap | null): void {
  try {
    bitmap?.close();
  } catch {
    // Ownership is released as far as the host permits; public errors stay safe.
  }
}

function exactRecord(value: unknown, keys: readonly string[]): DataRecord | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
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

function exactArray(value: unknown, maxLength: number): readonly unknown[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maxLength) return null;
    const length = lengthDescriptor.value as number;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || !keys.includes("length")) return null;
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      if (!keys.includes(key)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      output.push(descriptor.value);
    }
    return output;
  } catch {
    return null;
  }
}

function canonicalInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && Number.isFinite(value) &&
    !Object.is(value, -0) && value >= minimum && value <= maximum;
}

function parseWarnings(value: unknown): readonly GridProcessingWarningCode[] | null {
  const values = exactArray(value, 1);
  if (!values || values.some((warning) => warning !== "grid-detection-fallback")) return null;
  return Object.freeze(values.slice() as GridProcessingWarningCode[]);
}

function parseCells(
  value: unknown,
  rows: number,
  cols: number,
  width: number,
  height: number,
): readonly GridProcessingRectV1[] | null {
  const values = exactArray(value, rows * cols);
  if (!values || values.length !== rows * cols) return null;
  const cells: GridProcessingRectV1[] = [];
  for (const valueCell of values) {
    const cell = exactRecord(valueCell, ["x", "y", "width", "height"]);
    if (!cell || !canonicalInteger(cell.x, 0, width - 1) ||
      !canonicalInteger(cell.y, 0, height - 1) ||
      !canonicalInteger(cell.width, 1, width) ||
      !canonicalInteger(cell.height, 1, height) ||
      cell.x + cell.width > width || cell.y + cell.height > height) return null;
    cells.push(Object.freeze({
      x: cell.x,
      y: cell.y,
      width: cell.width,
      height: cell.height,
    }));
  }

  for (let row = 0; row < rows; row += 1) {
    const rowStart = cells[row * cols];
    if (row > 0) {
      const previousRow = cells[(row - 1) * cols];
      if (rowStart.y < previousRow.y + previousRow.height) return null;
    }
    for (let col = 0; col < cols; col += 1) {
      const cell = cells[row * cols + col];
      const firstRowCell = cells[col];
      if (cell.y !== rowStart.y || cell.height !== rowStart.height ||
        cell.x !== firstRowCell.x || cell.width !== firstRowCell.width) return null;
      if (col > 0) {
        const previous = cells[row * cols + col - 1];
        if (cell.x < previous.x + previous.width) return null;
      }
    }
  }
  return Object.freeze(cells);
}

/** Hostile boundary: exact own-data schema in, rebuilt frozen inference out. */
export function parseGridPreviewInferenceResponse(
  value: unknown,
  expectation: ResponseExpectation,
): GridAutoInference | null {
  const response = exactRecord(value, ["type", "requestId", "inference"]);
  if (response?.type === "success" && response.requestId === expectation.requestId) {
    const inference = exactRecord(response.inference, ["origin", "rows", "cols", "cells", "warnings"]);
    if (!inference || (inference.origin !== "detected" && inference.origin !== "fallback") ||
      !canonicalInteger(inference.rows, 1, expectation.height) ||
      !canonicalInteger(inference.cols, 1, expectation.width) ||
      inference.rows * inference.cols > GRID_PROCESSING_LIMITS.maxResultCount) {
      throw new GridPreviewInferenceError("invalid-response");
    }
    const warnings = parseWarnings(inference.warnings);
    const cells = parseCells(
      inference.cells,
      inference.rows,
      inference.cols,
      expectation.width,
      expectation.height,
    );
    if (!warnings || !cells) throw new GridPreviewInferenceError("invalid-response");

    if (inference.origin === "fallback") {
      const cell = cells[0];
      if (inference.rows !== 1 || inference.cols !== 1 || warnings.length !== 1 ||
        cell.x !== 0 || cell.y !== 0 || cell.width !== expectation.width ||
        cell.height !== expectation.height) throw new GridPreviewInferenceError("invalid-response");
    } else if ((inference.rows === 1 && inference.cols === 1) || warnings.length !== 0) {
      throw new GridPreviewInferenceError("invalid-response");
    }
    return Object.freeze({
      origin: inference.origin,
      rows: inference.rows,
      cols: inference.cols,
      cells,
      warnings,
    });
  }

  const errorResponse = exactRecord(value, ["type", "requestId"]);
  if (errorResponse?.type === "error" && errorResponse.requestId === expectation.requestId) return null;
  throw new GridPreviewInferenceError("invalid-response");
}

let nextRequestId = 0;

function defaultWorkerFactory(): GridPreviewWorkerPort {
  if (typeof Worker !== "function") throw new GridPreviewInferenceError("unavailable");
  return new Worker(new URL("./gridPreviewInference.worker.ts", import.meta.url), {
    type: "module",
    name: "slice-grid-preview-inference",
  }) as GridPreviewWorkerPort;
}

function defaultCreateImageBitmap(source: ImageBitmapSource): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== "function") {
    return Promise.reject(new GridPreviewInferenceError("unavailable"));
  }
  return createImageBitmap(source);
}

function safeLegacyUrl(value: string): string | null {
  try {
    if (value.startsWith("data:image/") || value.startsWith("blob:")) return value;
    if (typeof location === "undefined") return null;
    const url = new URL(value, location.href);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === location.origin
      ? url.href
      : null;
  } catch {
    return null;
  }
}

async function cloneOwnedImage(
  source: unknown,
  signal: AbortSignal,
  clone: (source: ImageBitmapSource) => Promise<ImageBitmap>,
): Promise<ImageBitmap> {
  throwIfAborted(signal);
  let bitmap: ImageBitmap;
  try {
    bitmap = await clone(source as ImageBitmapSource);
  } catch (error) {
    if (isAbortError(error) || error instanceof GridPreviewInferenceError) throw error;
    throw new GridPreviewInferenceError("decode");
  }
  if (signal.aborted) {
    closeBitmapNoThrow(bitmap);
    throw aborted();
  }
  return bitmap;
}

function inferInWorker(
  request: GridPreviewInferenceRequest,
  transfer: Transferable[],
  signal: AbortSignal,
  workerFactory: () => GridPreviewWorkerPort,
  untransferredBitmap: ImageBitmap | null,
): Promise<GridAutoInference> {
  throwIfAborted(signal);
  let worker: GridPreviewWorkerPort;
  try {
    worker = workerFactory();
  } catch {
    closeBitmapNoThrow(untransferredBitmap);
    return Promise.reject(new GridPreviewInferenceError("unavailable"));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let bitmapOwnedByMain = untransferredBitmap !== null;
    const cleanup = (): void => {
      const operations = [
        () => worker.removeEventListener("message", onMessage),
        () => worker.removeEventListener("error", onFailure),
        () => worker.removeEventListener("messageerror", onFailure),
        () => signal.removeEventListener("abort", onAbort),
        () => worker.terminate(),
        () => { if (bitmapOwnedByMain) untransferredBitmap?.close(); },
      ];
      for (const operation of operations) {
        try {
          operation();
        } catch {
          // Cleanup is exhaustive: one hostile port operation cannot skip the rest.
        }
      }
    };
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = (): void => {
      if (settled) return;
      finish(() => reject(aborted()));
    };
    const onFailure = (): void => {
      if (settled) return;
      finish(() => reject(new GridPreviewInferenceError("worker")));
    };
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (settled) return;
      try {
        const inference = parseGridPreviewInferenceResponse(event.data, request);
        if (inference) finish(() => resolve(inference));
        else finish(() => reject(new GridPreviewInferenceError("worker")));
      } catch {
        finish(() => reject(new GridPreviewInferenceError("invalid-response")));
      }
    };

    try {
      worker.addEventListener("message", onMessage);
      if (settled) return;
      worker.addEventListener("error", onFailure);
      if (settled) return;
      worker.addEventListener("messageerror", onFailure);
      if (settled) return;
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    } catch {
      finish(() => reject(new GridPreviewInferenceError("worker")));
    }
    if (settled) return;
    try {
      worker.postMessage(request, transfer);
      bitmapOwnedByMain = false;
    } catch {
      finish(() => reject(new GridPreviewInferenceError("worker")));
    }
  });
}

export function createGridPreviewInference(
  options: CreateGridPreviewInferenceOptions = {},
): GridPreviewInference {
  const workerFactory = options.workerFactory ?? defaultWorkerFactory;
  const clone = options.createImageBitmap ?? defaultCreateImageBitmap;
  return async (source, signal) => {
    throwIfAborted(signal);
    const requestId = `grid-preview-${++nextRequestId}`;
    if (source.image !== null) {
      const bitmap = await cloneOwnedImage(source.image, signal, clone);
      const request: GridPreviewInferenceRequest = Object.freeze({
        type: "infer",
        requestId,
        width: source.width,
        height: source.height,
        source: Object.freeze({ kind: "bitmap" as const, bitmap }),
      });
      return inferInWorker(request, [bitmap], signal, workerFactory, bitmap);
    }
    if (source.legacyUrl) {
      const legacyUrl = safeLegacyUrl(source.legacyUrl);
      if (!legacyUrl) throw new GridPreviewInferenceError("unavailable");
      const request: GridPreviewInferenceRequest = Object.freeze({
        type: "infer",
        requestId,
        width: source.width,
        height: source.height,
        source: Object.freeze({ kind: "url" as const, url: legacyUrl }),
      });
      return inferInWorker(request, [], signal, workerFactory, null);
    }
    throw new GridPreviewInferenceError("unavailable");
  };
}

export const inferGridPreviewLayout = createGridPreviewInference();
