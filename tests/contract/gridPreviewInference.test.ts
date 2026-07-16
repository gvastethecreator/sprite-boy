import { describe, expect, it, vi } from "vitest";

import {
  createGridPreviewInference,
  GridPreviewInferenceError,
  parseGridPreviewInferenceResponse,
  type GridPreviewInferenceRequest,
  type GridPreviewWorkerPort,
} from "../../features/slice/grid/gridPreviewInference";
import { isGridPreviewInferenceRequest } from "../../features/slice/grid/gridPreviewInference.worker";

function validInference(rows = 2, cols = 4, width = 8, height = 4) {
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  return {
    origin: "detected",
    rows,
    cols,
    cells: Array.from({ length: rows * cols }, (_, index) => ({
      x: (index % cols) * cellWidth,
      y: Math.floor(index / cols) * cellHeight,
      width: cellWidth,
      height: cellHeight,
    })),
    warnings: [],
  };
}

function fallback(width = 8, height = 4) {
  return {
    origin: "fallback",
    rows: 1,
    cols: 1,
    cells: [{ x: 0, y: 0, width, height }],
    warnings: ["grid-detection-fallback"],
  };
}

function workerHarness(reply: (request: GridPreviewInferenceRequest) => unknown) {
  const listeners = new Map<string, (event: never) => void>();
  const postMessage = vi.fn((request: GridPreviewInferenceRequest, _transfer: Transferable[]) => {
    queueMicrotask(() => listeners.get("message")?.({ data: reply(request) } as never));
  });
  const worker: GridPreviewWorkerPort = {
    postMessage,
    addEventListener: (type, listener) => listeners.set(type, listener as (event: never) => void),
    removeEventListener: (type) => listeners.delete(type),
    terminate: vi.fn(),
  };
  return { worker, postMessage };
}

describe("grid preview off-main adapter (G2-03)", () => {
  it("clones an owned bitmap and transfers only the clone to the Worker", async () => {
    const owner = { close: vi.fn(), owned: true };
    const clone = { close: vi.fn(), cloned: true } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn(async (source: ImageBitmapSource) => {
      expect(source).toBe(owner);
      return clone;
    });
    const harness = workerHarness((request) => ({
      type: "success",
      requestId: request.requestId,
      inference: fallback(request.width, request.height),
    }));
    const infer = createGridPreviewInference({
      createImageBitmap,
      workerFactory: () => harness.worker,
    });

    const result = await infer({ width: 8, height: 4, image: owner, legacyUrl: null },
      new AbortController().signal);

    expect(harness.postMessage).toHaveBeenCalledOnce();
    const [request, transfer] = harness.postMessage.mock.calls[0];
    expect(request.source).toEqual({ kind: "bitmap", bitmap: clone });
    expect(transfer).toEqual([clone]);
    expect(owner.close).not.toHaveBeenCalled();
    expect(clone.close).not.toHaveBeenCalled();
    expect(result).toMatchObject({ origin: "fallback", rows: 1, cols: 1 });
  });

  it("sends a legacy URL to the Worker without main-thread fetch, decode, canvas, or RGBA", async () => {
    const createImageBitmap = vi.fn();
    const harness = workerHarness((request) => ({
      type: "success",
      requestId: request.requestId,
      inference: validInference(2, 4, request.width, request.height),
    }));
    const infer = createGridPreviewInference({
      createImageBitmap,
      workerFactory: () => harness.worker,
    });
    await expect(infer({
      width: 8,
      height: 4,
      image: null,
      legacyUrl: "data:image/png;base64,source",
    }, new AbortController().signal)).resolves.toMatchObject({ rows: 2, cols: 4 });

    const [request, transfer] = harness.postMessage.mock.calls[0];
    expect(request.source).toEqual({ kind: "url", url: "data:image/png;base64,source" });
    expect(transfer).toEqual([]);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("closes a late clone after cancellation and never starts a Worker", async () => {
    let resolveClone!: (bitmap: ImageBitmap) => void;
    const clonePromise = new Promise<ImageBitmap>((resolve) => { resolveClone = resolve; });
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const workerFactory = vi.fn();
    const controller = new AbortController();
    const inference = createGridPreviewInference({
      createImageBitmap: () => clonePromise,
      workerFactory,
    })({ width: 8, height: 4, image: {}, legacyUrl: null }, controller.signal);

    controller.abort();
    resolveClone(bitmap);
    await expect(inference).rejects.toMatchObject({ name: "AbortError" });
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("closes an untransferred clone when Worker startup or postMessage fails", async () => {
    const firstBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    await expect(createGridPreviewInference({
      createImageBitmap: async () => firstBitmap,
      workerFactory: () => { throw new Error("private startup"); },
    })({ width: 8, height: 4, image: {}, legacyUrl: null }, new AbortController().signal))
      .rejects.toBeInstanceOf(GridPreviewInferenceError);
    expect(firstBitmap.close).toHaveBeenCalledOnce();

    const secondBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const worker: GridPreviewWorkerPort = {
      postMessage: () => { throw new Error("private transfer"); },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      terminate: vi.fn(),
    };
    await expect(createGridPreviewInference({
      createImageBitmap: async () => secondBitmap,
      workerFactory: () => worker,
    })({ width: 8, height: 4, image: {}, legacyUrl: null }, new AbortController().signal))
      .rejects.toBeInstanceOf(GridPreviewInferenceError);
    expect(secondBitmap.close).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("contains hostile listener cleanup and still closes every main-owned resource", async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const terminate = vi.fn(() => { throw new Error("private terminate failure"); });
    const worker: GridPreviewWorkerPort = {
      postMessage: vi.fn(),
      addEventListener: (type) => {
        if (type === "error") throw new Error("private registration failure");
      },
      removeEventListener: () => { throw new Error("private removal failure"); },
      terminate,
    };
    await expect(createGridPreviewInference({
      createImageBitmap: async () => bitmap,
      workerFactory: () => worker,
    })({ width: 8, height: 4, image: {}, legacyUrl: null }, new AbortController().signal))
      .rejects.toMatchObject({ code: "worker" });
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(terminate).toHaveBeenCalledOnce();
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});

describe("grid preview hostile Worker response boundary", () => {
  const expectation = { requestId: "grid-preview-test", width: 8, height: 4 };
  const response = (inference: unknown) => ({
    type: "success",
    requestId: expectation.requestId,
    inference,
  });

  it("rebuilds and deeply freezes a canonical row-major result", () => {
    const parsed = parseGridPreviewInferenceResponse(response(validInference()), expectation)!;
    expect(parsed).toMatchObject({ origin: "detected", rows: 2, cols: 4 });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.cells)).toBe(true);
    expect(parsed.cells.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(parsed.warnings)).toBe(true);
  });

  it("rejects getters without evaluating them and never leaks private payloads", () => {
    const getter = vi.fn(() => validInference());
    const hostile = { type: "success", requestId: expectation.requestId } as Record<string, unknown>;
    Object.defineProperty(hostile, "inference", { enumerable: true, get: getter });
    expect(() => parseGridPreviewInferenceResponse(hostile, expectation)).toThrow(
      "Grid preview could not be analyzed.",
    );
    expect(getter).not.toHaveBeenCalled();

    expect(() => parseGridPreviewInferenceResponse({
      type: "error",
      requestId: expectation.requestId,
      private: "secret worker stack",
    }, expectation)).toThrow("Grid preview could not be analyzed.");
  });

  it.each([
    ["unknown warning", { ...validInference(), warnings: ["private-warning"] }],
    ["detected 1x1", { ...validInference(), rows: 1, cols: 1, cells: [{ x: 0, y: 0, width: 8, height: 4 }] }],
    ["overlap", { ...validInference(), cells: validInference().cells.map((cell, index) =>
      index === 1 ? { ...cell, x: 1 } : cell) }],
    ["out of bounds", { ...validInference(), cells: validInference().cells.map((cell, index) =>
      index === 7 ? { ...cell, x: 7, width: 2 } : cell) }],
    ["fallback wrong rect", { ...fallback(), cells: [{ x: 1, y: 0, width: 7, height: 4 }] }],
    ["fallback missing warning", { ...fallback(), warnings: [] }],
    ["extra inference key", { ...validInference(), private: "secret" }],
  ])("rejects %s", (_label, inference) => {
    expect(() => parseGridPreviewInferenceResponse(response(inference), expectation))
      .toThrow(GridPreviewInferenceError);
  });
});

describe("grid preview Worker request boundary", () => {
  const request = (width: number, height: number) => ({
    type: "infer",
    requestId: "grid-preview-test",
    width,
    height,
    source: { kind: "url", url: "data:image/png;base64,source" },
  });

  it("rejects oversized dimensions before OffscreenCanvas allocation", () => {
    expect(isGridPreviewInferenceRequest(request(16_384, 16_384))).toBe(false);
    expect(isGridPreviewInferenceRequest(request(16_384, 1))).toBe(true);
  });

  it("rejects accessors and unknown request keys without evaluating getters", () => {
    const getter = vi.fn(() => 8);
    const hostile = request(8, 4) as Record<string, unknown>;
    Object.defineProperty(hostile, "width", { enumerable: true, get: getter });
    expect(isGridPreviewInferenceRequest(hostile)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(isGridPreviewInferenceRequest({ ...request(8, 4), private: true })).toBe(false);
  });
});
