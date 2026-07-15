import { describe, expect, it, vi } from "vitest";
import {
  JobTaskError,
  createJobRunner,
  createQueuedJob,
  retryJob,
  type JobRunnerHost,
  type JobTaskContext,
} from "../../core/processing";
import { createJobStore } from "../../core/stores";

const T0 = "2026-07-15T12:00:00.000Z";
const T1 = "2026-07-15T12:00:01.000Z";
const T2 = "2026-07-15T12:00:02.000Z";
const T3 = "2026-07-15T12:00:03.000Z";
const T4 = "2026-07-15T12:00:04.000Z";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

class ManualHost implements JobRunnerHost {
  current = T1;
  nextHandle = 1;
  readonly timers = new Map<number, { callback: () => void; delayMs: number }>();
  readonly cleared: number[] = [];

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

  setTime(value: string): void {
    this.current = value;
  }

  fire(handle = this.timers.keys().next().value as number): void {
    const timer = this.timers.get(handle);
    if (!timer) throw new Error(`Missing timer ${handle}.`);
    this.timers.delete(handle);
    timer.callback();
  }
}

function queuedJob(id: string, timeoutMs: number | null = 1_000) {
  return createQueuedJob({
    id,
    requestId: `${id}-request`,
    kind: "worker.test",
    label: `Run ${id}`,
    createdAt: T0,
    timeoutMs,
  });
}

describe("JobRunner", () => {
  it("commits start, monotonic progress and success through JobStore", async () => {
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });
    const output = deferred<string>();

    const handle = runner.run(queuedJob("job-success"), async ({ reportProgress }) => {
      expect(reportProgress({ ratio: 0.4, phase: "render", message: "Rendering" })).toBe(true);
      return output.promise;
    });

    expect(store.getSnapshot().jobs[handle.jobId]).toMatchObject({
      status: "running",
      progress: { ratio: 0.4, phase: "render" },
    });
    expect(runner.getActiveCount()).toBe(1);
    expect([...host.timers.values()][0]?.delayMs).toBe(1_000);

    host.setTime(T2);
    output.resolve("artifact-1");
    await expect(handle.result).resolves.toMatchObject({
      status: "succeeded",
      value: "artifact-1",
      job: { status: "succeeded", finishedAt: T2, progress: { ratio: 1 } },
    });
    expect(runner.getActiveCount()).toBe(0);
    expect(host.timers.size).toBe(0);
    expect(host.cleared).toEqual([1]);
  });

  it("routes concurrent progress and reverse-order results without cross-talk", async () => {
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });
    const first = deferred<string>();
    const second = deferred<string>();

    const firstHandle = runner.run(queuedJob("job-a", null), ({ reportProgress }) => {
      reportProgress({ ratio: 0.25, phase: "decode" });
      return first.promise;
    });
    const secondHandle = runner.run(queuedJob("job-b", null), ({ reportProgress }) => {
      reportProgress({ ratio: 0.75, phase: "encode" });
      return second.promise;
    });

    expect(store.getSnapshot().jobs["job-a"]?.progress.ratio).toBe(0.25);
    expect(store.getSnapshot().jobs["job-b"]?.progress.ratio).toBe(0.75);
    second.resolve("b");
    await expect(secondHandle.result).resolves.toMatchObject({ status: "succeeded", value: "b" });
    expect(store.getSnapshot().jobs["job-a"]?.status).toBe("running");
    first.resolve("a");
    await expect(firstHandle.result).resolves.toMatchObject({ status: "succeeded", value: "a" });
    expect(runner.getActiveCount()).toBe(0);
  });

  it("honors a caller signal aborted before start without invoking task", async () => {
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });
    const controller = new AbortController();
    controller.abort("cancel before start");
    const task = vi.fn(() => "never");

    const handle = runner.run(queuedJob("job-pre-abort"), task, {
      signal: controller.signal,
    });

    await expect(handle.result).resolves.toMatchObject({
      status: "cancelled",
      job: { status: "cancelled", startedAt: null, progress: { ratio: 0 } },
    });
    expect(task).not.toHaveBeenCalled();
    expect(host.timers.size).toBe(0);
  });

  it("balances caller abort listeners and suppresses non-cooperative late writes", async () => {
    const addListener = vi.spyOn(AbortSignal.prototype, "addEventListener");
    const removeListener = vi.spyOn(AbortSignal.prototype, "removeEventListener");
    try {
      const store = createJobStore();
      const host = new ManualHost();
      const runner = createJobRunner({ store, host });
      const controller = new AbortController();
      const output = deferred<string>();
      let context!: JobTaskContext;
      const handle = runner.run(queuedJob("job-caller-abort"), (taskContext) => {
        context = taskContext;
        return output.promise;
      }, { signal: controller.signal });

      controller.abort("caller stopped");
      const result = await handle.result;
      expect(result.status).toBe("cancelled");
      expect(context.signal.aborted).toBe(true);
      expect(context.reportProgress({ ratio: 0.8, phase: "late" })).toBe(false);
      output.resolve("late-result");
      await flushMicrotasks();

      expect(store.getSnapshot().jobs[handle.jobId]).toEqual(result.job);
      expect(addListener.mock.calls.filter(([type]) => type === "abort")).toHaveLength(1);
      expect(removeListener.mock.calls.filter(([type]) => type === "abort")).toHaveLength(1);
      expect(runner.getActiveCount()).toBe(0);
    } finally {
      addListener.mockRestore();
      removeListener.mockRestore();
    }
  });

  it("cancels non-cooperative work and suppresses late progress/result", async () => {
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });
    const output = deferred<string>();
    let context!: JobTaskContext;
    const handle = runner.run(queuedJob("job-cancel"), (taskContext) => {
      context = taskContext;
      return output.promise;
    });

    host.setTime(T2);
    expect(handle.cancel("Stopped by user")).toBe(true);
    const result = await handle.result;
    expect(result).toMatchObject({
      status: "cancelled",
      job: { error: { code: "cancelled", message: "Stopped by user" } },
    });
    expect(context.signal.aborted).toBe(true);
    expect(context.reportProgress({ ratio: 0.9, phase: "late" })).toBe(false);
    output.resolve("late-output");
    await flushMicrotasks();
    expect(store.getSnapshot().jobs[handle.jobId]).toEqual(result.job);
    expect(handle.cancel()).toBe(false);
    expect(runner.getActiveCount()).toBe(0);
  });

  it("times out once, aborts work and ignores its later completion", async () => {
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });
    const output = deferred<string>();
    let context!: JobTaskContext;
    const handle = runner.run(queuedJob("job-timeout", 250), (taskContext) => {
      context = taskContext;
      return output.promise;
    });

    host.setTime(T3);
    host.fire();
    const result = await handle.result;
    expect(result).toMatchObject({
      status: "timed-out",
      job: { error: { code: "timeout", message: "Job timed out after 250ms." } },
    });
    expect(context.signal.aborted).toBe(true);
    output.resolve("late");
    await flushMicrotasks();
    expect(store.getSnapshot().jobs[handle.jobId]).toEqual(result.job);
    expect(host.timers.size).toBe(0);
  });

  it("chunks timeouts above the native timer ceiling without expiring early", async () => {
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });
    const output = deferred<string>();
    const timeoutMs = 2_147_483_648;
    const handle = runner.run(queuedJob("job-long-timeout", timeoutMs), () => output.promise);

    expect(Array.from(host.timers.values())[0]?.delayMs).toBe(2_147_483_647);
    host.fire();
    expect(store.getSnapshot().jobs[handle.jobId]?.status).toBe("running");
    expect(Array.from(host.timers.values())[0]?.delayMs).toBe(1);
    host.fire();

    await expect(handle.result).resolves.toMatchObject({
      status: "timed-out",
      job: { error: { message: `Job timed out after ${timeoutMs}ms.` } },
    });
    output.resolve("late");
    await flushMicrotasks();
  });

  it("maps typed crashes and redacts unknown thrown details", async () => {
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });

    const crash = runner.run(queuedJob("job-crash", null), () => {
      throw new JobTaskError("worker-crash", "Image worker stopped.", true);
    });
    const unknown = runner.run(queuedJob("job-unknown", null), () => {
      throw new Error("private provider secret");
    });

    await expect(crash.result).resolves.toMatchObject({
      status: "failed",
      job: { error: { code: "worker-crash", message: "Image worker stopped.", retryable: true } },
    });
    const unknownResult = await unknown.result;
    expect(unknownResult).toMatchObject({
      status: "failed",
      job: { error: { code: "runtime-failure", message: "Job task failed." } },
    });
    expect(JSON.stringify(unknownResult)).not.toContain("private provider secret");
  });

  it("downgrades a mutated JobTaskError to a safe terminal failure", async () => {
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });
    const corrupted = new JobTaskError("worker-crash", "Original safe message.", true);
    Reflect.set(corrupted, "code", "forged-secret-code");

    const handle = runner.run(queuedJob("job-corrupted-error", null), () => {
      throw corrupted;
    });

    await expect(handle.result).resolves.toMatchObject({
      status: "failed",
      job: { error: { code: "runtime-failure", message: "Job task failed.", retryable: true } },
    });
    expect(store.getSnapshot().jobs[handle.jobId]?.status).toBe("failed");
    expect(runner.getActiveCount()).toBe(0);
  });

  it("turns malformed progress into a non-retryable typed failure", async () => {
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });

    const handle = runner.run(queuedJob("job-bad-progress", null), ({ reportProgress }) => {
      expect(reportProgress({ ratio: 2, phase: "invalid" })).toBe(false);
      return "ignored-success";
    });

    await expect(handle.result).resolves.toMatchObject({
      status: "failed",
      job: {
        error: {
          code: "invalid-input",
          message: "Job task reported invalid progress.",
          retryable: false,
        },
      },
    });
  });

  it("dispose cancels every active run, cleans resources and rejects new work", async () => {
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });
    const first = deferred<string>();
    const second = deferred<string>();
    let firstSignal!: AbortSignal;
    let secondSignal!: AbortSignal;
    const firstHandle = runner.run(queuedJob("job-dispose-a"), ({ signal }) => {
      firstSignal = signal;
      return first.promise;
    });
    const secondHandle = runner.run(queuedJob("job-dispose-b"), ({ signal }) => {
      secondSignal = signal;
      return second.promise;
    });

    runner.dispose();
    runner.dispose();
    await expect(firstHandle.result).resolves.toMatchObject({ status: "cancelled" });
    await expect(secondHandle.result).resolves.toMatchObject({ status: "cancelled" });
    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(true);
    expect(runner.getActiveCount()).toBe(0);
    expect(host.timers.size).toBe(0);
    expect(() => runner.run(queuedJob("job-after-dispose"), () => "no")).toThrow(/disposed/);
    first.resolve("late-a");
    second.reject(new Error("late-b"));
    await flushMicrotasks();
  });

  it("cleans a timer handle returned after a reentrant timeout", async () => {
    const store = createJobStore();
    const cleared: unknown[] = [];
    const host: JobRunnerHost = {
      now: () => T1,
      setTimer: (callback) => {
        callback();
        return "reentrant-handle";
      },
      clearTimer: (handle) => {
        cleared.push(handle);
      },
    };
    const runner = createJobRunner({ store, host });
    const task = vi.fn(() => "never");

    const handle = runner.run(queuedJob("job-reentrant-timeout", 10), task);
    await expect(handle.result).resolves.toMatchObject({ status: "timed-out" });
    expect(task).not.toHaveBeenCalled();
    expect(cleared).toEqual(["reentrant-handle"]);
  });

  it("queues reentrant cancellation requested by a JobStore subscriber", async () => {
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });
    const task = vi.fn(() => "never");
    store.subscribe(() => {
      if (store.getSnapshot().jobs["job-reentrant-cancel"]?.status === "running") {
        runner.cancel("job-reentrant-cancel", "Subscriber cancel");
      }
    });

    const handle = runner.run(queuedJob("job-reentrant-cancel"), task);
    await expect(handle.result).resolves.toMatchObject({
      status: "cancelled",
      job: { error: { message: "Subscriber cancel" } },
    });
    expect(task).not.toHaveBeenCalled();
  });

  it("defers cross-job cancellation until the current JobStore publish completes", async () => {
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });
    const pending = deferred<string>();
    let firstContext!: JobTaskContext;
    const first = runner.run(queuedJob("job-cross-first", null), (context) => {
      firstContext = context;
      return pending.promise;
    });
    let requested = false;
    let cancelResult: boolean | null = null;
    store.subscribe(() => {
      if (!requested && store.getSnapshot().jobs["job-cross-second"]?.status === "queued") {
        requested = true;
        cancelResult = first.cancel("Cross-job subscriber cancel");
      }
    });

    const second = runner.run(queuedJob("job-cross-second", null), () => "second");
    expect(cancelResult).toBe(true);
    expect(first.cancel("Must not replace first reason")).toBe(false);
    expect(firstContext.signal.aborted).toBe(true);
    await expect(first.result).resolves.toMatchObject({
      status: "cancelled",
      job: { error: { message: "Cross-job subscriber cancel" } },
    });
    await expect(second.result).resolves.toMatchObject({ status: "succeeded", value: "second" });
    expect(store.getSnapshot().jobs[first.jobId]?.status).toBe("cancelled");
    expect(runner.getActiveCount()).toBe(0);
    pending.resolve("late");
    await flushMicrotasks();
  });

  it("lets a deferred cancel beat an already-queued task completion", async () => {
    const store = createJobStore();
    const runner = createJobRunner({ store });
    const first = runner.run(queuedJob("job-cross-resolved", null), () =>
      Promise.resolve("must-not-win")
    );
    let requested = false;
    store.subscribe(() => {
      if (!requested && store.getSnapshot().jobs["job-cross-trigger"]?.status === "queued") {
        requested = true;
        first.cancel("Cancel wins");
      }
    });

    const trigger = runner.run(queuedJob("job-cross-trigger", null), () => "trigger");
    await expect(first.result).resolves.toMatchObject({ status: "cancelled" });
    await expect(trigger.result).resolves.toMatchObject({ status: "succeeded" });
    expect(store.getSnapshot().jobs[first.jobId]?.status).toBe("cancelled");
  });

  it("rejects cross-job progress during notify without orphaning its run", async () => {
    const store = createJobStore();
    const runner = createJobRunner({ store });
    const output = deferred<string>();
    let context!: JobTaskContext;
    const first = runner.run(queuedJob("job-cross-progress", null), (taskContext) => {
      context = taskContext;
      return output.promise;
    });
    let progressResult: boolean | null = null;
    store.subscribe(() => {
      if (store.getSnapshot().jobs["job-progress-trigger"]?.status === "queued") {
        progressResult = context.reportProgress({ ratio: 0.5, phase: "cross-notify" });
      }
    });

    const trigger = runner.run(queuedJob("job-progress-trigger", null), () => "trigger");
    expect(progressResult).toBe(false);
    expect(store.getSnapshot().jobs[first.jobId]).toMatchObject({
      status: "running",
      progress: { ratio: 0 },
    });
    output.resolve("done");
    await expect(first.result).resolves.toMatchObject({ status: "succeeded", value: "done" });
    await expect(trigger.result).resolves.toMatchObject({ status: "succeeded" });
    expect(runner.getActiveCount()).toBe(0);
  });

  it("cancels a reserved run when a queued-state subscriber disposes the runner", async () => {
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });
    const task = vi.fn(() => "never");
    store.subscribe(() => {
      if (store.getSnapshot().jobs["job-dispose-on-queued"]?.status === "queued") {
        runner.dispose();
      }
    });

    const handle = runner.run(queuedJob("job-dispose-on-queued"), task);
    await expect(handle.result).resolves.toMatchObject({
      status: "cancelled",
      job: { status: "cancelled", startedAt: null },
    });
    expect(task).not.toHaveBeenCalled();
    expect(runner.getActiveCount()).toBe(0);
    expect(() => runner.run(queuedJob("job-after-reentrant-dispose"), task)).toThrow(/disposed/);
  });

  it("continues from JobStore canonical data when a subscriber mutates caller input", async () => {
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });
    const mutableJob = { ...queuedJob("job-mutable-input", null) };
    const originalJobId = mutableJob.id;
    const originalRequestId = mutableJob.requestId;
    store.subscribe(() => {
      if (store.getSnapshot().jobs[originalJobId]?.status === "queued") {
        Reflect.set(mutableJob, "kind", "");
        Reflect.set(mutableJob, "id", "job-mutated-after-publish");
        Reflect.set(mutableJob, "requestId", "request-mutated-after-publish");
        Reflect.set(mutableJob, "timeoutMs", 1);
      }
    });

    const handle = runner.run(mutableJob, () => "canonical");
    await expect(handle.result).resolves.toMatchObject({
      status: "succeeded",
      value: "canonical",
      job: { kind: "worker.test" },
    });
    expect(handle.jobId).toBe(originalJobId);
    expect(handle.requestId).toBe(originalRequestId);
    expect(store.getSnapshot().jobs[handle.jobId]?.kind).toBe("worker.test");
    expect(host.timers.size).toBe(0);
  });

  it("rejects reentrant cancellation once a terminal commit has won", async () => {
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });
    const taskSignals: AbortSignal[] = [];
    let cancelResult: boolean | null = null;
    store.subscribe(() => {
      if (store.getSnapshot().jobs["job-terminal-wins"]?.status === "succeeded") {
        cancelResult = runner.cancel("job-terminal-wins", "Too late");
      }
    });

    const handle = runner.run(queuedJob("job-terminal-wins"), ({ signal }) => {
      taskSignals.push(signal);
      return "done";
    });

    await expect(handle.result).resolves.toMatchObject({ status: "succeeded", value: "done" });
    expect(cancelResult).toBe(false);
    expect(taskSignals[0]?.aborted).toBe(false);
  });

  it("runs a valid retry without reopening or overwriting its terminal source", async () => {
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });
    const first = queuedJob("job-root", null);
    const firstHandle = runner.run(first, () => {
      throw new JobTaskError("worker-crash", "Worker stopped.", true);
    });
    const firstResult = await firstHandle.result;
    if (firstResult.status !== "failed") throw new Error("Expected failed first attempt.");
    const retry = retryJob(firstResult.job, {
      id: "job-retry",
      requestId: "job-retry-request",
      createdAt: T3,
    }).retry!;
    host.setTime(T4);

    const retryHandle = runner.run(retry, () => "recovered");
    await expect(retryHandle.result).resolves.toMatchObject({
      status: "succeeded",
      value: "recovered",
      job: { attempt: 2, previousJobId: first.id },
    });
    expect(store.getSnapshot().jobs[first.id]).toEqual(firstResult.job);
    expect(store.getSnapshot().consumedRetrySourceIds).toEqual([first.id]);
  });

  it("rejects and releases a reserved run when JobStore refuses its identity", async () => {
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });
    const original = queuedJob("job-retired", null);
    const originalResult = await runner.run(original, () => "done").result;
    expect(originalResult.status).toBe("succeeded");
    store.dispatch({ type: "job.remove", jobId: original.id });
    const reusedTask = vi.fn(() => "must-not-run");

    const rejected = runner.run(original, reusedTask);
    await expect(rejected.result).rejects.toThrow(/single-use/);
    expect(reusedTask).not.toHaveBeenCalled();
    expect(runner.getActiveCount()).toBe(0);

    const fresh = runner.run(queuedJob("job-fresh-after-reject", null), () => "fresh");
    await expect(fresh.result).resolves.toMatchObject({ status: "succeeded", value: "fresh" });
  });

  it("rejects invalid starts, duplicate active IDs and fake signals", () => {
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });
    const pending = deferred<string>();
    const job = queuedJob("job-guard", null);
    runner.run(job, () => pending.promise);

    expect(() => runner.run(job, () => "duplicate")).toThrow(/already active/);
    expect(() => runner.run(
      queuedJob("job-fake-signal", null),
      () => "no",
      { signal: { aborted: false } as AbortSignal },
    )).toThrow(/native AbortSignal/);
    expect(() => runner.cancel("" as never)).toThrow(/EntityId/);

    runner.dispose();
    pending.resolve("ignored");
  });
});
