import { describe, expect, it } from "vitest";

import { createQueuedJob } from "../../core/processing/jobLifecycle";
import {
  createGridProcessingJobTask,
} from "../../core/processing/gridProcessingJobTask";
import {
  createJobRunner,
  type JobRunnerHost,
} from "../../core/processing/jobRunner";
import {
  GRID_PROCESSING_PROTOCOL_VERSION,
  type GridProcessingProcessRequestV1,
  type GridProcessingResponseV1,
  type GridProcessingResultV1,
} from "../../core/processing/gridProcessingProtocol";
import { createJobStore } from "../../core/stores";
import {
  createGridProcessingClient,
  type GridProcessingWorkerPort,
} from "../../features/slice/processing/gridProcessingClient";

type WorkerEvent = MessageEvent<unknown> | Event;
type WorkerListener = (event: WorkerEvent) => void;

class ControlledWorker implements GridProcessingWorkerPort {
  readonly sent: unknown[] = [];
  readonly transferLists: readonly Transferable[][] = [];
  terminated = 0;
  throwOnAddType: "message" | "error" | "messageerror" | null = null;
  throwAfterRemove = false;
  terminalOnMessageRegistration: GridProcessingResponseV1 | null = null;
  private readonly listeners = new Map<string, Set<WorkerListener>>();

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    this.sent.push(structuredClone(message, { transfer }));
    (this.transferLists as Transferable[][]).push([...transfer]);
  }

  addEventListener(type: "message" | "error" | "messageerror", listener: WorkerListener): void {
    if (this.throwOnAddType === type) throw new Error(`hostile add ${type}`);
    const listeners = this.listeners.get(type) ?? new Set<WorkerListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    if (type === "message" && this.terminalOnMessageRegistration) {
      this.emitMessage(this.terminalOnMessageRegistration);
    }
  }

  removeEventListener(type: "message" | "error" | "messageerror", listener: WorkerListener): void {
    this.listeners.get(type)?.delete(listener);
    if (this.throwAfterRemove) throw new Error(`hostile remove ${type}`);
  }

  terminate(): void {
    this.terminated += 1;
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }

  emitMessage(response: GridProcessingResponseV1): void {
    this.emit("message", new MessageEvent("message", { data: response }));
  }

  emitFailure(type: "error" | "messageerror"): void {
    this.emit(type, new Event(type));
  }

  private emit(type: string, event: WorkerEvent): void {
    for (const listener of Array.from(this.listeners.get(type) ?? [])) listener(event);
  }
}

class ManualHost implements JobRunnerHost {
  private readonly timers = new Map<number, () => void>();
  private timerId = 0;
  private tick = 0;

  readonly now = (): string => new Date(Date.UTC(2026, 6, 16, 0, 0, 0, this.tick++)).toISOString();
  readonly setTimer = (callback: () => void): number => {
    const id = ++this.timerId;
    this.timers.set(id, callback);
    return id;
  };
  readonly clearTimer = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  fireAll(): void {
    const callbacks = [...this.timers.values()];
    this.timers.clear();
    for (const callback of callbacks) callback();
  }
}

function request(requestId: string, red: number): GridProcessingProcessRequestV1 {
  return {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "process",
    requestId,
    source: {
      width: 1,
      height: 1,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: new Uint8ClampedArray([red, 20, 30, 255]).buffer,
    },
    recipe: {
      kind: "grid-split",
      version: 1,
      sourceAssetId: `asset-${requestId}`,
      layout: { mode: "manual", rows: 1, cols: 1 },
      crop: { threshold: 0, padding: 0 },
      chroma: { enabled: false, color: "#00ff00", tolerance: 10, smoothness: 10, spill: 10 },
      pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
    },
  };
}

function successfulResponse(
  requestId: string,
  red: number,
): Extract<GridProcessingResponseV1, { readonly type: "result" }> {
  const result: GridProcessingResultV1 = {
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
        pixels: new Uint8ClampedArray([red, 20, 30, 255]).buffer,
      },
      cropReductionRatio: 0,
      operations: [],
      warnings: [],
    }],
    summary: { outputCount: 1, outputPixelCount: 1, cropReductionRatio: 0, warnings: [] },
  };
  return {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "result",
    requestId,
    result,
  };
}

describe("Grid processing hostile lifecycle", () => {
  it("isolates concurrent requests in independent workers while responses interleave", async () => {
    const workerA = new ControlledWorker();
    const workerB = new ControlledWorker();
    const availableWorkers = [workerA, workerB];
    const client = createGridProcessingClient({ workerFactory: () => availableWorkers.shift()! });
    const first = client.process({ request: request("concurrent-a", 10) });
    const second = client.process({ request: request("concurrent-b", 200) });

    workerB.emitMessage(successfulResponse("concurrent-b", 200));
    workerA.emitMessage(successfulResponse("concurrent-a", 10));

    const [resultA, resultB] = await Promise.all([first, second]);
    expect(new Uint8ClampedArray(resultA.outputs[0]!.surface.pixels)[0]).toBe(10);
    expect(new Uint8ClampedArray(resultB.outputs[0]!.surface.pixels)[0]).toBe(200);
    expect(workerA.sent[0]).toMatchObject({ requestId: "concurrent-a" });
    expect(workerB.sent[0]).toMatchObject({ requestId: "concurrent-b" });
    expect(workerA.terminated).toBe(1);
    expect(workerB.terminated).toBe(1);
    expect(workerA.listenerCount() + workerB.listenerCount()).toBe(0);
  });

  it("makes cancellation terminal and ignores a conflicting late result", async () => {
    const worker = new ControlledWorker();
    const controller = new AbortController();
    const client = createGridProcessingClient({ workerFactory: () => worker });
    const completion = client.process({
      request: request("cancel-late", 50),
      signal: controller.signal,
    });

    controller.abort();
    await expect(completion).rejects.toMatchObject({ code: "cancelled" });
    expect(worker.sent[1]).toEqual({
      version: GRID_PROCESSING_PROTOCOL_VERSION,
      type: "cancel",
      requestId: "cancel-late",
    });
    worker.emitMessage(successfulResponse("cancel-late", 99));
    await Promise.resolve();
    expect(worker.terminated).toBe(1);
    expect(worker.listenerCount()).toBe(0);
  });

  it("short-circuits an already-aborted request without creating or transferring to a worker", async () => {
    const controller = new AbortController();
    controller.abort();
    const processingRequest = request("cancel-before-start", 55);
    let workerCreations = 0;
    const client = createGridProcessingClient({
      workerFactory: () => {
        workerCreations += 1;
        return new ControlledWorker();
      },
    });

    await expect(client.process({ request: processingRequest, signal: controller.signal }))
      .rejects.toMatchObject({ code: "cancelled" });
    expect(workerCreations).toBe(0);
    expect(processingRequest.source.pixels.byteLength).toBe(4);
  });

  it("ignores cancellation after success without sending a second terminal", async () => {
    const worker = new ControlledWorker();
    const controller = new AbortController();
    const client = createGridProcessingClient({ workerFactory: () => worker });
    const completion = client.process({
      request: request("cancel-after-success", 58),
      signal: controller.signal,
    });
    worker.emitMessage(successfulResponse("cancel-after-success", 58));

    await expect(completion).resolves.toMatchObject({ summary: { outputCount: 1 } });
    controller.abort();
    await Promise.resolve();
    expect(worker.sent).toHaveLength(1);
    expect(worker.terminated).toBe(1);
  });

  it.each(["error", "messageerror"] as const)(
    "maps a native %s event to one closed crash terminal",
    async (eventType) => {
      const worker = new ControlledWorker();
      const client = createGridProcessingClient({ workerFactory: () => worker });
      const completion = client.process({ request: request(`crash-${eventType}`, 60) });

      worker.emitFailure(eventType);

      await expect(completion).rejects.toMatchObject({ code: "worker-crash", retryable: true });
      expect(worker.terminated).toBe(1);
      expect(worker.listenerCount()).toBe(0);
    },
  );

  it("lets JobRunner timeout own the terminal, abort the worker and suppress late output", async () => {
    const worker = new ControlledWorker();
    const client = createGridProcessingClient({ workerFactory: () => worker });
    const processingRequest = request("timeout-request", 70);
    const task = createGridProcessingJobTask({
      client,
      source: processingRequest.source,
      recipe: processingRequest.recipe,
    });
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });
    const job = createQueuedJob({
      id: "timeout-job",
      requestId: "timeout-request",
      kind: "grid.process",
      label: "Process hostile grid",
      createdAt: "2026-07-16T00:00:00.000Z",
      timeoutMs: 25,
    });
    const handle = runner.run(job, task);

    host.fireAll();
    const completion = await handle.result;

    expect(completion.status).toBe("timed-out");
    expect(store.getSnapshot().jobs["timeout-job"]?.status).toBe("timed-out");
    expect(worker.sent[1]).toEqual({
      version: GRID_PROCESSING_PROTOCOL_VERSION,
      type: "cancel",
      requestId: "timeout-request",
    });
    worker.emitMessage(successfulResponse("timeout-request", 99));
    await Promise.resolve();
    expect(store.getSnapshot().jobs["timeout-job"]?.status).toBe("timed-out");
    expect(worker.terminated).toBe(1);
    expect(worker.listenerCount()).toBe(0);
  });

  it("settles despite hostile listener removal and cleans a partial registration failure", async () => {
    const hostileCleanupWorker = new ControlledWorker();
    hostileCleanupWorker.throwAfterRemove = true;
    const client = createGridProcessingClient({ workerFactory: () => hostileCleanupWorker });
    const completion = client.process({ request: request("hostile-cleanup", 80) });
    hostileCleanupWorker.emitMessage(successfulResponse("hostile-cleanup", 80));

    await expect(completion).resolves.toMatchObject({ summary: { outputCount: 1 } });
    expect(hostileCleanupWorker.terminated).toBe(1);
    expect(hostileCleanupWorker.listenerCount()).toBe(0);

    const partialWorker = new ControlledWorker();
    partialWorker.throwOnAddType = "messageerror";
    const partialClient = createGridProcessingClient({ workerFactory: () => partialWorker });

    await expect(partialClient.process({ request: request("partial-registration", 90) }))
      .rejects.toMatchObject({ code: "worker-crash" });
    expect(partialWorker.terminated).toBe(1);
    expect(partialWorker.listenerCount()).toBe(0);
  });

  it("stops registration immediately when a hostile port emits a terminal reentrantly", async () => {
    const worker = new ControlledWorker();
    worker.terminalOnMessageRegistration = successfulResponse("reentrant-registration", 95);
    const client = createGridProcessingClient({ workerFactory: () => worker });

    await expect(client.process({ request: request("reentrant-registration", 95) }))
      .resolves.toMatchObject({ summary: { outputCount: 1 } });
    expect(worker.sent).toHaveLength(0);
    expect(worker.terminated).toBe(1);
    expect(worker.listenerCount()).toBe(0);
  });
});
