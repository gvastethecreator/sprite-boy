import { describe, expect, it } from "vitest";
import {
  createJobRunner,
  createQueuedJob,
  retryJob,
  transitionJob,
  type JobSnapshot,
  type QueuedJobSnapshot,
  type TerminalJobSnapshot,
} from "../../core/processing";
import {
  DEFAULT_JOB_RETENTION_POLICY,
  createJobCenterEntriesSelector,
  createJobCenterSummarySelector,
  createJobFamilySelector,
  createJobStore,
  normalizeJobRetentionPolicy,
  type JobStore,
} from "../../core/stores";

const time = (second: number): string =>
  `2026-07-15T14:00:${second.toString().padStart(2, "0")}.000Z`;

function queued(id: string, second: number): QueuedJobSnapshot {
  return createQueuedJob({
    id,
    requestId: `${id}-request`,
    kind: "test.retention",
    label: `Job ${id}`,
    createdAt: time(second),
    timeoutMs: null,
  });
}

function replace(store: JobStore, job: JobSnapshot): void {
  store.dispatch({ type: "job.replace", job });
}

function succeed(store: JobStore, job: QueuedJobSnapshot, start: number): TerminalJobSnapshot {
  replace(store, job);
  const running = transitionJob(job, {
    type: "job.start",
    requestId: job.requestId,
    at: time(start),
  }).job;
  replace(store, running);
  const succeeded = transitionJob(running, {
    type: "job.succeed",
    requestId: job.requestId,
    at: time(start + 1),
  }).job;
  replace(store, succeeded);
  if (succeeded.status !== "succeeded") throw new Error("Expected succeeded job.");
  return succeeded;
}

function failRetryable(
  store: JobStore,
  job: QueuedJobSnapshot,
  start: number,
): TerminalJobSnapshot {
  replace(store, job);
  const running = transitionJob(job, {
    type: "job.start",
    requestId: job.requestId,
    at: time(start),
  }).job;
  replace(store, running);
  const failed = transitionJob(running, {
    type: "job.fail",
    requestId: job.requestId,
    at: time(start + 1),
    error: { code: "worker-crash", message: "Worker stopped.", retryable: true },
  }).job;
  replace(store, failed);
  if (failed.status !== "failed") throw new Error("Expected failed job.");
  return failed;
}

describe("JobStore retention and Job Center selectors", () => {
  it("normalizes an immutable exact and bounded retention policy", () => {
    expect(normalizeJobRetentionPolicy(undefined)).toBe(DEFAULT_JOB_RETENTION_POLICY);
    const mutable = { maxTerminalFamilies: 3 };
    const normalized = normalizeJobRetentionPolicy(mutable);
    mutable.maxTerminalFamilies = 99;
    expect(normalized).toEqual({ maxTerminalFamilies: 3 });
    expect(Object.isFrozen(normalized)).toBe(true);

    for (const value of [0, 1.5, 1_001, Number.NaN]) {
      expect(() => normalizeJobRetentionPolicy({ maxTerminalFamilies: value })).toThrow(/integer/);
    }
    expect(() => normalizeJobRetentionPolicy({
      maxTerminalFamilies: 1,
      extra: true,
    } as never)).toThrow(/only/);
    const accessor = Object.defineProperty({}, "maxTerminalFamilies", {
      enumerable: true,
      get: () => 2,
    });
    expect(() => normalizeJobRetentionPolicy(accessor as never)).toThrow(/data field/);
  });

  it("atomically prunes the oldest complete terminal family and keeps tombstones", () => {
    const policy = { maxTerminalFamilies: 2 };
    const store = createJobStore({ retention: policy });
    const observedOrders: string[][] = [];
    store.subscribe(() => {
      const state = store.getSnapshot();
      observedOrders.push(state.order.map((jobId) => `${jobId}:${state.jobs[jobId]?.status}`));
    });
    const first = queued("job-first", 0);
    succeed(store, first, 1);
    succeed(store, queued("job-second", 3), 4);
    policy.maxTerminalFamilies = 99;
    succeed(store, queued("job-third", 6), 7);

    const state = store.getSnapshot();
    expect(state.order).toEqual(["job-second", "job-third"]);
    expect(state.jobs[first.id]).toBeUndefined();
    expect(state.retiredJobIds).toContain(first.id);
    expect(state.retiredRequestIds).toContain(first.requestId);
    expect(observedOrders.at(-1)).toEqual([
      "job-second:succeeded",
      "job-third:succeeded",
    ]);
    expect(observedOrders).not.toContainEqual([
      "job-first:succeeded",
      "job-second:succeeded",
      "job-third:succeeded",
    ]);
    expect(() => replace(store, first)).toThrow(/single-use/);
  });

  it("pins an active retry family and later prunes only a whole older family", () => {
    const store = createJobStore({ retention: { maxTerminalFamilies: 1 } });
    const root = failRetryable(store, queued("job-root", 0), 1);
    const retry = retryJob(root, {
      id: "job-retry",
      requestId: "job-retry-request",
      createdAt: time(3),
    }).retry!;
    replace(store, retry);
    const retryRunning = transitionJob(retry, {
      type: "job.start",
      requestId: retry.requestId,
      at: time(4),
    }).job;
    replace(store, retryRunning);
    succeed(store, queued("job-other", 5), 6);

    expect(store.getSnapshot().order).toEqual([root.id, retry.id, "job-other"]);
    const retryDone = transitionJob(retryRunning, {
      type: "job.succeed",
      requestId: retry.requestId,
      at: time(9),
    }).job;
    replace(store, retryDone);

    const state = store.getSnapshot();
    expect(state.order).toEqual([root.id, retry.id]);
    expect(state.jobs[root.id]).toEqual(root);
    expect(state.jobs[retry.id]?.status).toBe("succeeded");
    expect(state.jobs["job-other"]).toBeUndefined();
    expect(state.retiredJobIds).toContain("job-other");
    expect(state.consumedRetrySourceIds).toEqual([root.id]);
  });

  it("projects active-first entries, exact summaries and stable retry families", () => {
    const store = createJobStore();
    const old = succeed(store, queued("job-old", 0), 1);
    const failed = failRetryable(store, queued("job-failed", 3), 4);
    const active = queued("job-active", 8);
    replace(store, active);
    const selectEntries = createJobCenterEntriesSelector();
    const selectSummary = createJobCenterSummarySelector();
    const selectFamily = createJobFamilySelector(failed.rootJobId);
    const state = store.getSnapshot();

    const entries = selectEntries(state);
    expect(entries.map((job) => job.id)).toEqual([active.id, failed.id, old.id]);
    expect(selectEntries(state)).toBe(entries);
    expect(Object.isFrozen(entries)).toBe(true);
    expect(selectSummary(state)).toEqual({
      total: 3,
      active: 1,
      terminal: 2,
      retryable: 1,
      byStatus: {
        queued: 1,
        running: 0,
        succeeded: 1,
        failed: 1,
        cancelled: 0,
        "timed-out": 0,
      },
    });
    expect(selectSummary(state)).toBe(selectSummary(state));
    const family = selectFamily(state);
    expect(family).toEqual([failed]);
    expect(selectFamily(state)).toBe(family);
    expect(() => createJobFamilySelector("" as never)).toThrow(/EntityId/);
  });

  it("counts only retry sources that have no consumed child", () => {
    const store = createJobStore();
    const root = failRetryable(store, queued("job-summary-root", 0), 1);
    const retry = retryJob(root, {
      id: "job-summary-retry",
      requestId: "job-summary-retry-request",
      createdAt: time(3),
    }).retry!;
    const retryFailure = failRetryable(store, retry, 4);
    const selectSummary = createJobCenterSummarySelector();
    const state = store.getSnapshot();

    expect(state.consumedRetrySourceIds).toEqual([root.id]);
    expect(selectSummary(state)).toMatchObject({
      total: 2,
      retryable: 1,
      byStatus: { failed: 2 },
    });
    expect(state.jobs[retryFailure.id]?.error?.retryable).toBe(true);
  });

  it("keeps JobRunner results stable when a later terminal prunes visible history", async () => {
    const store = createJobStore({ retention: { maxTerminalFamilies: 1 } });
    const runner = createJobRunner({ store });
    const first = runner.run(queued("job-runner-first", 0), () => "first");
    await expect(first.result).resolves.toMatchObject({ status: "succeeded", value: "first" });
    const second = runner.run(queued("job-runner-second", 2), () => "second");
    await expect(second.result).resolves.toMatchObject({ status: "succeeded", value: "second" });

    expect(store.getSnapshot().jobs[first.jobId]).toBeUndefined();
    expect(store.getSnapshot().jobs[second.jobId]?.status).toBe("succeeded");
    expect(store.getSnapshot().retiredJobIds).toContain(first.jobId);
    expect(runner.getActiveCount()).toBe(0);
  });

  it("rejects hostile JobStore option shapes without invoking accessors", () => {
    let reads = 0;
    const options = Object.defineProperty({}, "retention", {
      enumerable: true,
      get: () => {
        reads += 1;
        return { maxTerminalFamilies: 2 };
      },
    });
    expect(() => createJobStore(options as never)).toThrow(/data field/);
    expect(reads).toBe(0);
    expect(() => createJobStore({
      retention: { maxTerminalFamilies: 2 },
      extra: true,
    } as never)).toThrow(/unsupported/);
  });
});
