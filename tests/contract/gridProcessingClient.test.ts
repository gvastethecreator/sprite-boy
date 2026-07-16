import { describe, expect, it } from "vitest";
import {
  createGridProcessingClient,
  type GridProcessingWorkerPort,
} from "../../features/slice/processing/gridProcessingClient";
import {
  GRID_PROCESSING_PROTOCOL_VERSION,
  type GridProcessingProcessRequestV1,
  type GridProcessingResponseV1,
} from "../../core/processing/gridProcessingProtocol";

type WorkerListener = (event: MessageEvent<unknown> | Event) => void;

class TestWorker implements GridProcessingWorkerPort {
  readonly sent: unknown[] = [];
  readonly transferLists: readonly Transferable[][] = [];
  terminated = 0;
  private readonly listeners = new Map<string, Set<WorkerListener>>();

  constructor(private readonly autoReply = true) {}

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    this.sent.push(structuredClone(message, { transfer }));
    (this.transferLists as Transferable[][]).push([...transfer]);
    if (!this.autoReply) return;
    const request = this.sent[0] as GridProcessingProcessRequestV1;
    queueMicrotask(() => {
      this.emitMessage({
        version: GRID_PROCESSING_PROTOCOL_VERSION,
        type: "progress",
        requestId: request.requestId,
        stage: "decode",
        completed: 1,
        total: 1,
      });
      const pixels = new Uint8ClampedArray([10, 20, 30, 255]).buffer;
      this.emitMessage({
        version: GRID_PROCESSING_PROTOCOL_VERSION,
        type: "result",
        requestId: request.requestId,
        result: {
          source: { width: 1, height: 1 },
          layout: { origin: "manual", rows: 1, cols: 1 },
          outputs: [{
            index: 0,
            row: 0,
            column: 0,
            cellBounds: { x: 0, y: 0, width: 1, height: 1 },
            contentBounds: { x: 0, y: 0, width: 1, height: 1 },
            surface: {
              width: 1,
              height: 1,
              format: "rgba8",
              colorSpace: "srgb",
              pixels,
            },
            cropReductionRatio: 0,
            operations: [],
            warnings: [],
          }],
          summary: {
            outputCount: 1,
            outputPixelCount: 1,
            cropReductionRatio: 0,
            warnings: [],
          },
        },
      } satisfies GridProcessingResponseV1);
    });
  }

  addEventListener(type: string, listener: WorkerListener): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: WorkerListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  terminate(): void {
    this.terminated += 1;
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }

  emitMessage(data: unknown): void {
    const event = new MessageEvent("message", { data });
    for (const listener of this.listeners.get("message") ?? []) listener(event);
  }
}

function request(): GridProcessingProcessRequestV1 {
  return {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "process",
    requestId: "grid-client-happy",
    source: {
      width: 1,
      height: 1,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: new Uint8ClampedArray([10, 20, 30, 255]).buffer,
    },
    recipe: {
      kind: "grid-split",
      version: 1,
      sourceAssetId: "asset-client-happy",
      layout: { mode: "manual", rows: 1, cols: 1 },
      crop: { threshold: 0, padding: 0 },
      chroma: { enabled: false, color: "#00ff00", tolerance: 10, smoothness: 10, spill: 10 },
      pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
    },
  };
}

describe("GridProcessingClient", () => {
  it("transfers source ownership, validates the terminal result and cleans up its worker", async () => {
    const worker = new TestWorker();
    const client = createGridProcessingClient({ workerFactory: () => worker });
    const processRequest = request();
    const progress: number[] = [];

    const resultPromise = client.process({
      request: processRequest,
      onProgress: (event) => progress.push(event.ratio),
    });

    expect(processRequest.source.pixels.byteLength).toBe(0);
    const result = await resultPromise;
    expect(new Uint8ClampedArray(result.outputs[0]!.surface.pixels)).toEqual(
      new Uint8ClampedArray([10, 20, 30, 255]),
    );
    expect(progress).toEqual([1 / 7]);
    expect(worker.sent).toHaveLength(1);
    expect(worker.terminated).toBe(1);
    expect(worker.listenerCount()).toBe(0);
  });

  it("maps a closed worker error response and cleans up without exposing worker-controlled text", async () => {
    const worker = new TestWorker(false);
    const client = createGridProcessingClient({ workerFactory: () => worker });
    const result = client.process({ request: request() });
    worker.emitMessage({
      version: GRID_PROCESSING_PROTOCOL_VERSION,
      type: "error",
      requestId: "grid-client-happy",
      error: { code: "memory", stage: "crop" },
    });

    await expect(result).rejects.toMatchObject({
      name: "GridProcessingClientError",
      code: "memory",
      stage: "crop",
      retryable: true,
      message: "Grid processing failed.",
    });
    expect(worker.terminated).toBe(1);
    expect(worker.listenerCount()).toBe(0);
  });

  it("posts protocol cancel before deterministic termination when its signal aborts", async () => {
    const worker = new TestWorker(false);
    const client = createGridProcessingClient({ workerFactory: () => worker });
    const controller = new AbortController();
    const result = client.process({ request: request(), signal: controller.signal });

    controller.abort("User cancelled grid processing.");

    await expect(result).rejects.toMatchObject({
      name: "GridProcessingClientError",
      code: "cancelled",
    });
    expect(worker.sent).toHaveLength(2);
    expect(worker.sent[1]).toEqual({
      version: GRID_PROCESSING_PROTOCOL_VERSION,
      type: "cancel",
      requestId: "grid-client-happy",
    });
    expect(worker.transferLists[1]).toEqual([]);
    expect(worker.terminated).toBe(1);
    expect(worker.listenerCount()).toBe(0);
  });

  it("rejects regressing worker progress before a terminal result", async () => {
    const worker = new TestWorker(false);
    const client = createGridProcessingClient({ workerFactory: () => worker });
    const result = client.process({ request: request() });
    worker.emitMessage({
      version: GRID_PROCESSING_PROTOCOL_VERSION,
      type: "progress",
      requestId: "grid-client-happy",
      stage: "crop",
      completed: 1,
      total: 2,
    });
    worker.emitMessage({
      version: GRID_PROCESSING_PROTOCOL_VERSION,
      type: "progress",
      requestId: "grid-client-happy",
      stage: "detect",
      completed: 1,
      total: 1,
    });

    await expect(result).rejects.toMatchObject({ code: "invalid-response" });
    expect(worker.terminated).toBe(1);
    expect(worker.listenerCount()).toBe(0);
  });
});
