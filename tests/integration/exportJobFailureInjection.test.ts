import { getEventListeners } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  createExportFormatRegistry,
  createExportPort,
  type ArtifactWriteReceipt,
  type ArtifactWriter,
  type ExportFormatDescriptor,
  type ExportFormatProvider,
  type ExportRequest,
  type ExportResult,
} from "../../core/export";
import {
  JobTaskError,
  createJobRunner,
  createQueuedJob,
  type JobRunner,
  type JobRunnerHost,
  type JobTaskContext,
} from "../../core/processing";
import { createJobStore, type JobStore } from "../../core/stores";

const CREATED_AT = "2026-07-15T19:00:00.000Z";
const RUNNING_AT = "2026-07-15T19:00:01.000Z";
const TERMINAL_AT = "2026-07-15T19:00:02.000Z";
const COMPLETED_AT = "2026-07-15T19:00:03.000Z";

const PNG_FORMAT: ExportFormatDescriptor = Object.freeze({
  id: "raster.png",
  label: "PNG image",
  category: "raster-image",
  fileExtension: "png",
  mimeType: "image/png",
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(turns = 8): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

function pngBlob(value = "png-payload"): Blob {
  return new Blob([value], { type: "image/png" });
}

function matchingReceipt(
  request: Parameters<ArtifactWriter["write"]>[0],
): ArtifactWriteReceipt {
  return {
    requestId: request.artifact.requestId,
    artifactId: request.artifact.artifactId,
    fileName: request.artifact.fileName,
    bytesWritten: request.artifact.byteSize,
  };
}

class ManualHost implements JobRunnerHost {
  current = RUNNING_AT;
  nextHandle = 1;
  readonly timers = new Map<number, { callback: () => void; delayMs: number }>();
  readonly cleared: number[] = [];
  readonly fired: number[] = [];

  readonly now = (): string => this.current;
  readonly setTimer = (callback: () => void, delayMs: number): unknown => {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.set(handle, { callback, delayMs });
    return handle;
  };
  readonly clearTimer = (handle: unknown): void => {
    const id = handle as number;
    this.cleared.push(id);
    this.timers.delete(id);
  };

  fire(handle = this.timers.keys().next().value as number): void {
    const timer = this.timers.get(handle);
    if (!timer) throw new Error(`Missing timer ${handle}.`);
    this.timers.delete(handle);
    this.fired.push(handle);
    this.current = TERMINAL_AT;
    timer.callback();
  }
}

function queuedJob(id: string, timeoutMs: number | null = 1_000) {
  return createQueuedJob({
    id,
    requestId: `${id}-request`,
    kind: "export.render",
    label: `Export ${id}`,
    createdAt: CREATED_AT,
    timeoutMs,
  });
}

function exportRequest(signal: AbortSignal, suffix: string): ExportRequest<string> {
  return {
    requestId: `export-request-${suffix}`,
    artifactId: `export-artifact-${suffix}`,
    projectId: "project-failure-injection",
    revision: 4,
    formatId: PNG_FORMAT.id,
    baseName: `failure-${suffix}`,
    source: "canonical-scene",
    signal,
  };
}

function makeStack({
  encode,
  writer,
  timeoutMs = 1_000,
}: {
  readonly encode: ExportFormatProvider["encode"];
  readonly writer: ArtifactWriter;
  readonly timeoutMs?: number | null;
}) {
  const provider: ExportFormatProvider = {
    format: PNG_FORMAT,
    encode: vi.fn(encode),
  };
  const port = createExportPort({
    registry: createExportFormatRegistry([provider]),
    writer,
    now: () => COMPLETED_AT,
  });
  const store = createJobStore();
  const host = new ManualHost();
  const runner = createJobRunner({ store, host });
  return { host, port, provider, runner, store, timeoutMs };
}

function runExport(
  runner: JobRunner,
  port: ReturnType<typeof createExportPort>,
  jobId: string,
  timeoutMs: number | null,
  capture?: (context: JobTaskContext) => void,
  capturePortRun?: (result: Promise<ExportResult>) => void,
) {
  return runner.run(queuedJob(jobId, timeoutMs), (context) => {
    capture?.(context);
    context.reportProgress({ ratio: 0.2, phase: "encode", message: "Encoding" });
    const result = port.run(exportRequest(context.signal, jobId));
    capturePortRun?.(result);
    return result;
  });
}

function expectClosed(
  runner: JobRunner,
  host: ManualHost,
  signal: AbortSignal,
): void {
  expect(runner.getActiveCount()).toBe(0);
  expect(host.timers.size).toBe(0);
  expect(getEventListeners(signal, "abort")).toHaveLength(0);
}

function expectStableSnapshot(
  store: JobStore,
  terminalSnapshot: ReturnType<JobStore["getSnapshot"]>,
): void {
  expect(store.getSnapshot()).toBe(terminalSnapshot);
}

function expectTimerLifecycle(
  host: ManualHost,
  expected: { readonly cleared: readonly number[]; readonly fired: readonly number[] },
): void {
  expect(host.cleared).toEqual(expected.cleared);
  expect(host.fired).toEqual(expected.fired);
}

describe("JobRunner + ExportPort failure injection", () => {
  it("contains a quota failure at the writer boundary without leaking private details", async () => {
    const writer = {
      id: "quota-writer",
      write: vi.fn(() => {
        throw new DOMException("private destination and capacity", "QuotaExceededError");
      }),
    } satisfies ArtifactWriter;
    const stack = makeStack({ encode: () => pngBlob(), writer });
    let signal!: AbortSignal;
    const handle = runExport(
      stack.runner,
      stack.port,
      "job-quota",
      stack.timeoutMs,
      (context) => { signal = context.signal; },
    );

    const result = await handle.result;
    expect(result).toMatchObject({
      status: "failed",
      job: {
        status: "failed",
        error: { code: "runtime-failure", message: "Job task failed." },
      },
    });
    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/destination|capacity|quota-writer/i);
    const terminalSnapshot = stack.store.getSnapshot();
    await flushMicrotasks();
    expectClosed(stack.runner, stack.host, signal);
    expectTimerLifecycle(stack.host, { cleared: [1], fired: [] });
    expectStableSnapshot(stack.store, terminalSnapshot);
  });

  it("contains provider and typed worker crashes without invoking a writer", async () => {
    const writer = {
      id: "memory-writer",
      write: vi.fn(matchingReceipt),
    } satisfies ArtifactWriter;
    const providerStack = makeStack({
      encode: async () => {
        throw new Error("private provider process dump");
      },
      writer,
      timeoutMs: null,
    });
    let providerSignal!: AbortSignal;
    const providerHandle = runExport(
      providerStack.runner,
      providerStack.port,
      "job-provider-crash",
      null,
      (context) => { providerSignal = context.signal; },
    );
    const providerResult = await providerHandle.result;

    expect(providerResult).toMatchObject({
      status: "failed",
      job: { error: { code: "runtime-failure", message: "Job task failed." } },
    });
    expect(writer.write).not.toHaveBeenCalled();
    expect(JSON.stringify(providerResult)).not.toContain("process dump");
    const providerTerminalSnapshot = providerStack.store.getSnapshot();
    await flushMicrotasks();
    expectClosed(providerStack.runner, providerStack.host, providerSignal);
    expectTimerLifecycle(providerStack.host, { cleared: [], fired: [] });
    expectStableSnapshot(providerStack.store, providerTerminalSnapshot);

    const workerStore = createJobStore();
    const workerHost = new ManualHost();
    const workerRunner = createJobRunner({ store: workerStore, host: workerHost });
    let workerSignal!: AbortSignal;
    const workerHandle = workerRunner.run(
      queuedJob("job-worker-crash", null),
      (context) => {
        workerSignal = context.signal;
        throw new JobTaskError("worker-crash", "Image worker stopped.", true);
      },
    );
    const workerResult = await workerHandle.result;

    expect(workerResult).toMatchObject({
      status: "failed",
      job: {
        error: {
          code: "worker-crash",
          message: "Image worker stopped.",
          retryable: true,
        },
      },
    });
    expect(workerSignal.aborted).toBe(true);
    const workerTerminalSnapshot = workerStore.getSnapshot();
    expectClosed(workerRunner, workerHost, workerSignal);
    expectTimerLifecycle(workerHost, { cleared: [], fired: [] });
    expectStableSnapshot(workerStore, workerTerminalSnapshot);
  });

  it("times out a pending provider and blocks every late writer call", async () => {
    const pendingProvider = deferred<Blob>();
    const writer = {
      id: "memory-writer",
      write: vi.fn(matchingReceipt),
    } satisfies ArtifactWriter;
    const stack = makeStack({
      encode: () => pendingProvider.promise,
      writer,
      timeoutMs: 250,
    });
    let context!: JobTaskContext;
    let portRun!: Promise<ExportResult>;
    const handle = runExport(
      stack.runner,
      stack.port,
      "job-provider-timeout",
      stack.timeoutMs,
      (value) => { context = value; },
      (value) => { portRun = value; },
    );
    await flushMicrotasks();
    expect(vi.mocked(stack.provider.encode)).toHaveBeenCalledTimes(1);
    expect(stack.host.timers.size).toBe(1);

    stack.host.fire();
    const result = await handle.result;
    expect(result).toMatchObject({
      status: "timed-out",
      job: { error: { code: "timeout", retryable: true } },
    });
    const terminal = result.job;
    const terminalSnapshot = stack.store.getSnapshot();
    expect(context.signal.aborted).toBe(true);
    expect(context.reportProgress({ ratio: 0.9, phase: "late" })).toBe(false);
    await expect(portRun).rejects.toMatchObject({ code: "EXPORT_ABORTED" });
    await flushMicrotasks();
    expectClosed(stack.runner, stack.host, context.signal);
    expectTimerLifecycle(stack.host, { cleared: [], fired: [1] });

    pendingProvider.resolve(pngBlob("late-provider-result"));
    await flushMicrotasks();
    expect(writer.write).not.toHaveBeenCalled();
    expect(stack.store.getSnapshot().jobs[handle.jobId]).toEqual(terminal);
    expectStableSnapshot(stack.store, terminalSnapshot);
  });

  it("cancels a cooperative pending writer with no completed receipt or listener leak", async () => {
    let completedReceipts = 0;
    let writerSignal!: AbortSignal;
    let finishWrite!: () => boolean;
    const writer = {
      id: "cooperative-writer",
      write: vi.fn((request) => new Promise<ArtifactWriteReceipt>((resolve, reject) => {
        const signal = request.signal;
        if (!signal) throw new Error("Expected runner-owned signal.");
        writerSignal = signal;
        let open = true;
        const cleanup = () => signal.removeEventListener("abort", onAbort);
        const onAbort = () => {
          if (!open) return;
          open = false;
          cleanup();
          reject(new DOMException("cancelled", "AbortError"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        finishWrite = () => {
          if (!open || signal.aborted) return false;
          open = false;
          cleanup();
          completedReceipts += 1;
          resolve(matchingReceipt(request));
          return true;
        };
      })),
    } satisfies ArtifactWriter;
    const stack = makeStack({ encode: () => pngBlob(), writer });
    let context!: JobTaskContext;
    let portRun!: Promise<ExportResult>;
    const handle = runExport(
      stack.runner,
      stack.port,
      "job-writer-cancel",
      stack.timeoutMs,
      (value) => { context = value; },
      (value) => { portRun = value; },
    );
    await flushMicrotasks();
    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(writerSignal).toBe(context.signal);
    expect(getEventListeners(context.signal, "abort")).toHaveLength(2);

    expect(handle.cancel("User cancelled export.")).toBe(true);
    const result = await handle.result;
    expect(result).toMatchObject({
      status: "cancelled",
      job: { error: { code: "cancelled", message: "User cancelled export." } },
    });
    const terminalSnapshot = stack.store.getSnapshot();
    await expect(portRun).rejects.toMatchObject({ code: "EXPORT_ABORTED" });
    await flushMicrotasks();
    expect(finishWrite()).toBe(false);
    expect(completedReceipts).toBe(0);
    expectClosed(stack.runner, stack.host, context.signal);
    expectTimerLifecycle(stack.host, { cleared: [1], fired: [] });
    expectStableSnapshot(stack.store, terminalSnapshot);
  });

  it("lets cancel beat an already-resolved writer continuation", async () => {
    const pendingReceipt = deferred<ArtifactWriteReceipt>();
    let writeRequest!: Parameters<ArtifactWriter["write"]>[0];
    const writer = {
      id: "racy-writer",
      write: vi.fn((request) => {
        writeRequest = request;
        return pendingReceipt.promise;
      }),
    } satisfies ArtifactWriter;
    const stack = makeStack({ encode: () => pngBlob(), writer });
    let context!: JobTaskContext;
    let portRun!: Promise<ExportResult>;
    let publishedResults = 0;
    const handle = runExport(
      stack.runner,
      stack.port,
      "job-cancel-race",
      stack.timeoutMs,
      (value) => { context = value; },
      (value) => {
        portRun = value;
        void value.then(
          () => { publishedResults += 1; },
          () => undefined,
        );
      },
    );
    await flushMicrotasks();
    expect(writer.write).toHaveBeenCalledTimes(1);

    pendingReceipt.resolve(matchingReceipt(writeRequest));
    expect(handle.cancel("Cancel wins the boundary race.")).toBe(true);
    const result = await handle.result;
    expect(result).toMatchObject({
      status: "cancelled",
      job: { error: { message: "Cancel wins the boundary race." } },
    });
    const terminalSnapshot = stack.store.getSnapshot();
    await expect(portRun).rejects.toMatchObject({ code: "EXPORT_ABORTED" });
    await flushMicrotasks();
    expect(publishedResults).toBe(0);
    expectClosed(stack.runner, stack.host, context.signal);
    expectTimerLifecycle(stack.host, { cleared: [1], fired: [] });
    expectStableSnapshot(stack.store, terminalSnapshot);
  });

  it("contains hostile late provider rejection after cancel without an unhandled mutation", async () => {
    const pendingProvider = deferred<Blob>();
    const writer = {
      id: "memory-writer",
      write: vi.fn(matchingReceipt),
    } satisfies ArtifactWriter;
    const stack = makeStack({ encode: () => pendingProvider.promise, writer });
    let context!: JobTaskContext;
    let portRun!: Promise<ExportResult>;
    const handle = runExport(
      stack.runner,
      stack.port,
      "job-provider-cancel",
      stack.timeoutMs,
      (value) => { context = value; },
      (value) => { portRun = value; },
    );
    await flushMicrotasks();

    expect(handle.cancel()).toBe(true);
    const result = await handle.result;
    const terminalSnapshot = stack.store.getSnapshot();
    await expect(portRun).rejects.toMatchObject({ code: "EXPORT_ABORTED" });
    pendingProvider.reject(new Error("private late provider dump"));
    await flushMicrotasks();

    expect(result.status).toBe("cancelled");
    expect(writer.write).not.toHaveBeenCalled();
    expect(JSON.stringify(stack.store.getSnapshot())).not.toContain("provider dump");
    expectClosed(stack.runner, stack.host, context.signal);
    expectTimerLifecycle(stack.host, { cleared: [1], fired: [] });
    expectStableSnapshot(stack.store, terminalSnapshot);
  });
});
