import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BackgroundRemovalRuntimeError,
  runBackgroundRemoval,
} from "../../features/slice/backgroundRemoval/runBackgroundRemoval";
import {
  isBackgroundRemovalWorkerRequest,
  isBackgroundRemovalWorkerResponse,
} from "../../features/slice/backgroundRemoval/backgroundRemovalProtocol";

class FakeWorker {
  readonly messages = new Set<(event: MessageEvent<unknown>) => void>();
  readonly errors = new Set<(event: ErrorEvent) => void>();
  posted: unknown = null;
  transfer: Transferable[] = [];
  terminated = 0;

  postMessage(message: unknown, transfer: Transferable[]) {
    this.posted = message;
    this.transfer = transfer;
  }

  addEventListener(type: "message" | "error", listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void)) {
    if (type === "message") this.messages.add(listener as (event: MessageEvent<unknown>) => void);
    else this.errors.add(listener as (event: ErrorEvent) => void);
  }

  removeEventListener(type: "message" | "error", listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void)) {
    if (type === "message") this.messages.delete(listener as (event: MessageEvent<unknown>) => void);
    else this.errors.delete(listener as (event: ErrorEvent) => void);
  }

  terminate() {
    this.terminated += 1;
  }

  emit(data: unknown) {
    for (const listener of this.messages) listener({ data } as MessageEvent<unknown>);
  }
}

afterEach(() => vi.useRealTimers());

describe("background removal worker boundary", () => {
  it("accepts the exact transferable request and result shapes", () => {
    const request = {
      type: "run",
      requestId: "request-1",
      modelId: "birefnet-lite-512",
      inputWidth: 512,
      inputHeight: 512,
      weights: new ArrayBuffer(8),
      source: new Blob(["image"], { type: "image/png" }),
    };
    expect(isBackgroundRemovalWorkerRequest(request)).toBe(true);
    expect(isBackgroundRemovalWorkerRequest({ ...request, extra: true })).toBe(false);
    expect(isBackgroundRemovalWorkerResponse({
      type: "success",
      requestId: "request-1",
      width: 2,
      height: 2,
      mask: new Blob(["mask"], { type: "image/png" }),
      output: new Blob(["output"], { type: "image/png" }),
    })).toBe(true);
  });

  it("returns progress and output, then terminates the isolated worker", async () => {
    const worker = new FakeWorker();
    const progress = vi.fn();
    const weights = new ArrayBuffer(16);
    const pending = runBackgroundRemoval({
      requestId: "request-2",
      source: new Blob(["image"], { type: "image/png" }),
      weights,
      onProgress: progress,
      workerFactory: () => worker,
    });
    expect(isBackgroundRemovalWorkerRequest(worker.posted)).toBe(true);
    expect(worker.transfer).toEqual([weights]);
    worker.emit({
      type: "progress",
      requestId: "request-2",
      phase: "inference",
      ratio: 0.6,
      message: "Running",
    });
    worker.emit({
      type: "success",
      requestId: "request-2",
      width: 4,
      height: 3,
      mask: new Blob(["mask"], { type: "image/png" }),
      output: new Blob(["output"], { type: "image/png" }),
    });

    await expect(pending).resolves.toMatchObject({ requestId: "request-2", width: 4, height: 3 });
    expect(progress).toHaveBeenCalledTimes(1);
    expect(worker.terminated).toBe(1);
    expect(worker.messages.size).toBe(0);
  });

  it("terminates real work when the caller cancels", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const pending = runBackgroundRemoval({
      requestId: "request-3",
      source: new Blob(["image"], { type: "image/png" }),
      weights: new ArrayBuffer(16),
      signal: controller.signal,
      workerFactory: () => worker,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      name: "BackgroundRemovalRuntimeError",
      code: "cancelled",
    } satisfies Partial<BackgroundRemovalRuntimeError>);
    expect(worker.terminated).toBe(1);
  });

  it("rejects hostile worker output and enforces a bounded timeout", async () => {
    const invalidWorker = new FakeWorker();
    const invalid = runBackgroundRemoval({
      requestId: "request-4",
      source: new Blob(["image"], { type: "image/png" }),
      weights: new ArrayBuffer(16),
      workerFactory: () => invalidWorker,
    });
    invalidWorker.emit({ type: "success", requestId: "request-4" });
    await expect(invalid).rejects.toMatchObject({ code: "invalid-response" });
    expect(invalidWorker.terminated).toBe(1);

    vi.useFakeTimers();
    const timeoutWorker = new FakeWorker();
    const timed = runBackgroundRemoval({
      requestId: "request-5",
      source: new Blob(["image"], { type: "image/png" }),
      weights: new ArrayBuffer(16),
      timeoutMs: 1_000,
      workerFactory: () => timeoutWorker,
    });
    const timedExpectation = expect(timed).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(1_000);
    await timedExpectation;
    expect(timeoutWorker.terminated).toBe(1);
  });
});
