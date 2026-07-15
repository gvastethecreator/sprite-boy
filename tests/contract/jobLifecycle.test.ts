import { describe, expect, it } from "vitest";
import {
  JOB_FAILURE_CODES,
  JOB_STATUSES,
  JOB_TRANSITION_OUTCOMES,
  assertJobReplacement,
  assertJobRetryLineage,
  assertJobSnapshot,
  createQueuedJob,
  isRetryableJob,
  isTerminalJob,
  retryJob,
  transitionJob,
  type JobEvent,
  type JobSnapshot,
} from "../../core/processing";

const T0 = "2026-07-14T12:00:00.000Z";
const T1 = "2026-07-14T12:00:01.000Z";
const T2 = "2026-07-14T12:00:02.000Z";
const T3 = "2026-07-14T12:00:03.000Z";
const T4 = "2026-07-14T12:00:04.000Z";

function queued(overrides: Partial<Parameters<typeof createQueuedJob>[0]> = {}) {
  return createQueuedJob({
    id: "job-export-1",
    requestId: "request-export-1",
    kind: "export.png",
    label: "Export PNG",
    createdAt: T0,
    timeoutMs: 30_000,
    ...overrides,
  });
}

function started(job = queued()) {
  const result = transitionJob(job, {
    type: "job.start",
    requestId: job.requestId,
    at: T1,
    phase: "render",
    message: "Rendering scene",
  });
  expect(result.outcome).toBe("applied");
  return result.job;
}

type EventWithoutRequest<TEvent extends JobEvent = JobEvent> = TEvent extends JobEvent
  ? Omit<TEvent, "requestId">
  : never;

function event(job: JobSnapshot, value: EventWithoutRequest): JobEvent {
  return { ...value, requestId: job.requestId } as JobEvent;
}

describe("typed job lifecycle", () => {
  it("publishes frozen exhaustive lifecycle vocabulary", () => {
    expect(JOB_STATUSES).toEqual([
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "timed-out",
    ]);
    expect(JOB_FAILURE_CODES).toEqual([
      "invalid-input",
      "unsupported",
      "worker-crash",
      "provider-failure",
      "export-failure",
      "storage-failure",
      "quota-exceeded",
      "runtime-failure",
    ]);
    expect(JOB_TRANSITION_OUTCOMES).toContain("ignored-terminal");
    expect([JOB_STATUSES, JOB_FAILURE_CODES, JOB_TRANSITION_OUTCOMES].every(Object.isFrozen)).toBe(
      true,
    );
  });

  it("creates an isolated frozen queued attempt with request identity", () => {
    const job = queued();

    expect(job).toMatchObject({
      id: "job-export-1",
      requestId: "request-export-1",
      status: "queued",
      attempt: 1,
      rootJobId: "job-export-1",
      previousJobId: null,
      createdAt: T0,
      updatedAt: T0,
      startedAt: null,
      finishedAt: null,
      timeoutMs: 30_000,
      progress: { ratio: 0, phase: "queued", message: null },
      error: null,
    });
    expect(Object.isFrozen(job)).toBe(true);
    expect(Object.isFrozen(job.progress)).toBe(true);
    expect(() => assertJobSnapshot(job)).not.toThrow();
  });

  it("runs through start, monotonic progress and success without mutating prior snapshots", () => {
    const initial = queued();
    const running = started(initial);
    const halfway = transitionJob(running, event(running, {
      type: "job.progress",
      at: T2,
      progress: { ratio: 0.5, phase: "encode", message: "Encoding frame 2/4" },
    }));
    const success = transitionJob(halfway.job, event(halfway.job, {
      type: "job.succeed",
      at: T3,
      message: "PNG ready",
    }));

    expect(initial.status).toBe("queued");
    expect(running).toMatchObject({ status: "running", startedAt: T1 });
    expect(halfway).toMatchObject({
      outcome: "applied",
      job: { status: "running", progress: { ratio: 0.5, phase: "encode" } },
    });
    expect(success).toMatchObject({
      outcome: "applied",
      job: {
        status: "succeeded",
        finishedAt: T3,
        progress: { ratio: 1, phase: "completed", message: "PNG ready" },
        error: null,
      },
    });
    expect(isTerminalJob(success.job)).toBe(true);
    expect(isRetryableJob(success.job)).toBe(false);
  });

  it.each([
    {
      name: "failure",
      terminalEvent: {
        type: "job.fail",
        at: T2,
        error: { code: "worker-crash", message: "Worker stopped", retryable: true },
      } as const,
      status: "failed",
      code: "worker-crash",
    },
    {
      name: "cancellation",
      terminalEvent: { type: "job.cancel", at: T2, message: "Stopped by user" } as const,
      status: "cancelled",
      code: "cancelled",
    },
    {
      name: "timeout",
      terminalEvent: { type: "job.timeout", at: T2 } as const,
      status: "timed-out",
      code: "timeout",
    },
  ])("creates a structured $name terminal", ({ terminalEvent, status, code }) => {
    const running = started();
    const result = transitionJob(running, event(running, terminalEvent));

    expect(result).toMatchObject({
      outcome: "applied",
      job: {
        status,
        finishedAt: T2,
        error: { code, retryable: true },
      },
    });
    expect(isRetryableJob(result.job)).toBe(true);
    expect(Object.isFrozen(result.job.error)).toBe(true);
  });

  it("cancels or times out a queued job without inventing a start timestamp", () => {
    const initial = queued();
    const cancelled = transitionJob(initial, event(initial, { type: "job.cancel", at: T1 }));
    const timedOut = transitionJob(
      queued({ id: "job-2", requestId: "request-2" }),
      { type: "job.timeout", requestId: "request-2", at: T1 },
    );

    expect(cancelled.job).toMatchObject({ status: "cancelled", startedAt: null });
    expect(timedOut.job).toMatchObject({ status: "timed-out", startedAt: null });
  });

  it("suppresses wrong-request, stale, illegal and regressing events", () => {
    const initial = queued();
    const wrongRequest = transitionJob(initial, {
      type: "job.start",
      requestId: "request-from-old-attempt",
      at: T1,
    });
    const running = started(initial);
    const halfway = transitionJob(running, event(running, {
      type: "job.progress",
      at: T3,
      progress: { ratio: 0.6, phase: "encode" },
    })).job;
    const stale = transitionJob(halfway, event(halfway, {
      type: "job.progress",
      at: T2,
      progress: { ratio: 0.8, phase: "encode" },
    }));
    const regression = transitionJob(halfway, event(halfway, {
      type: "job.progress",
      at: T4,
      progress: { ratio: 0.4, phase: "encode" },
    }));
    const earlySuccess = transitionJob(initial, event(initial, { type: "job.succeed", at: T1 }));

    expect(wrongRequest).toEqual({ outcome: "ignored-request", job: initial });
    expect(stale).toEqual({ outcome: "ignored-stale", job: halfway });
    expect(regression).toEqual({ outcome: "ignored-progress-regression", job: halfway });
    expect(earlySuccess).toEqual({ outcome: "ignored-state", job: initial });
    expect(stale.job).toBe(halfway);
    expect(regression.job.progress.ratio).toBe(0.6);
  });

  it("makes terminal completion idempotent against duplicate and conflicting late writes", () => {
    const running = started();
    const terminal = transitionJob(running, event(running, { type: "job.succeed", at: T2 })).job;
    const duplicate = transitionJob(terminal, event(terminal, { type: "job.succeed", at: T2 }));
    const lateFailure = transitionJob(terminal, event(terminal, {
      type: "job.fail",
      at: T4,
      error: { code: "runtime-failure", message: "Late failure", retryable: true },
    }));
    const lateProgress = transitionJob(terminal, event(terminal, {
      type: "job.progress",
      at: T4,
      progress: { ratio: 1, phase: "late" },
    }));

    for (const result of [duplicate, lateFailure, lateProgress]) {
      expect(result.outcome).toBe("ignored-terminal");
      expect(result.job).toBe(terminal);
      expect(result.job.status).toBe("succeeded");
    }
  });

  it("creates retry attempts with fresh request identity and unbroken lineage", () => {
    const first = started();
    const failure = transitionJob(first, event(first, {
      type: "job.fail",
      at: T2,
      error: { code: "provider-failure", message: "Provider unavailable", retryable: true },
    })).job;
    const secondResult = retryJob(failure, {
      id: "job-export-2",
      requestId: "request-export-2",
      createdAt: T3,
    });
    const second = secondResult.retry!;
    const oldResponse = transitionJob(second, {
      type: "job.start",
      requestId: failure.requestId,
      at: T4,
    });
    const secondRunning = transitionJob(second, event(second, { type: "job.start", at: T4 })).job;
    const secondTimeout = transitionJob(
      secondRunning,
      event(secondRunning, { type: "job.timeout", at: "2026-07-14T12:00:05.000Z" }),
    ).job;
    const third = retryJob(secondTimeout, {
      id: "job-export-3",
      requestId: "request-export-3",
      createdAt: "2026-07-14T12:00:06.000Z",
    }).retry!;

    expect(secondResult.outcome).toBe("created");
    expect(second).toMatchObject({
      status: "queued",
      attempt: 2,
      rootJobId: failure.rootJobId,
      previousJobId: failure.id,
      progress: { ratio: 0, phase: "queued" },
    });
    expect(failure.status).toBe("failed");
    expect(oldResponse).toEqual({ outcome: "ignored-request", job: second });
    expect(third).toMatchObject({
      attempt: 3,
      rootJobId: failure.rootJobId,
      previousJobId: second.id,
    });
  });

  it("rejects retry for active, successful, stale or non-retryable jobs", () => {
    const initial = queued();
    const active = retryJob(initial, { id: "job-2", requestId: "request-2", createdAt: T1 });
    const running = started(initial);
    const success = transitionJob(running, event(running, { type: "job.succeed", at: T2 })).job;
    const successful = retryJob(success, { id: "job-2", requestId: "request-2", createdAt: T3 });
    const failed = transitionJob(running, event(running, {
      type: "job.fail",
      at: T2,
      error: { code: "invalid-input", message: "Bad recipe", retryable: false },
    })).job;
    const nonRetryable = retryJob(failed, {
      id: "job-2",
      requestId: "request-2",
      createdAt: T3,
    });
    const timedOut = transitionJob(running, event(running, { type: "job.timeout", at: T2 })).job;
    const stale = retryJob(timedOut, {
      id: "job-2",
      requestId: "request-2",
      createdAt: T1,
    });

    expect(active.outcome).toBe("rejected-state");
    expect(successful.outcome).toBe("rejected-state");
    expect(nonRetryable.outcome).toBe("rejected-not-retryable");
    expect(stale.outcome).toBe("rejected-stale");
    expect(() => retryJob(timedOut, {
      id: timedOut.id,
      requestId: "request-2",
      createdAt: T3,
    })).toThrow(/fresh job and request identities/);
  });

  it("rejects malformed snapshots, non-canonical values and lifecycle bypasses", () => {
    const initial = queued();
    expect(() => createQueuedJob({
      id: "bad-job",
      requestId: "bad-request",
      kind: "export",
      label: "Bad timestamp",
      createdAt: "2026-07-14T12:00:00Z",
    })).toThrow(/canonical timestamp/);
    expect(() => transitionJob(initial, {
      type: "job.start",
      requestId: initial.requestId,
      at: T1,
      get phase(): string {
        throw new Error("must not execute");
      },
    })).toThrow(/data-only object/);
    expect(() => assertJobSnapshot({ ...initial, project: {} })).toThrow(/invalid shape/);
    expect(() => assertJobSnapshot({
      ...initial,
      progress: { ratio: Number.NaN, phase: "queued", message: null },
    })).toThrow(/ratio/);

    const queuedCancellation = transitionJob(initial, event(initial, {
      type: "job.cancel",
      at: T1,
    })).job;
    if (queuedCancellation.status !== "cancelled") {
      throw new Error("Expected cancelled fixture.");
    }
    const impossibleCancellation = {
      ...queuedCancellation,
      progress: { ...queuedCancellation.progress, ratio: 0.8 },
    };
    expect(() => assertJobSnapshot(impossibleCancellation)).toThrow(/Cancelled job snapshot/);
    expect(() => assertJobReplacement(initial, impossibleCancellation)).toThrow(
      /Cancelled job snapshot/,
    );

    const running = started(initial);
    const terminal = transitionJob(running, event(running, { type: "job.succeed", at: T2 })).job;
    if (terminal.status !== "succeeded") throw new Error("Expected succeeded fixture.");
    expect(() => assertJobReplacement(terminal, {
      ...terminal,
      progress: { ...terminal.progress, message: "Rewritten terminal" },
    })).toThrow(
      /Terminal jobs are immutable/,
    );
    expect(() => assertJobReplacement(initial, terminal)).toThrow(/legal transition/);
  });

  it("rejects forged retry ancestry even when each snapshot is locally well-shaped", () => {
    const running = started();
    const source = transitionJob(running, event(running, {
      type: "job.fail",
      at: T2,
      error: { code: "worker-crash", message: "Worker stopped", retryable: true },
    })).job;
    const retry = retryJob(source, {
      id: "job-export-2",
      requestId: "request-export-2",
      createdAt: T3,
    }).retry!;

    expect(() => assertJobRetryLineage(source, retry)).not.toThrow();
    expect(() => assertJobRetryLineage(source, { ...retry, attempt: 3 })).toThrow(
      /attempt must follow/,
    );
    expect(() => assertJobRetryLineage(source, {
      ...retry,
      rootJobId: "unrelated-root",
    })).toThrow(/identity or lineage/);
    expect(() => assertJobRetryLineage(source, {
      ...retry,
      kind: "different-kind",
    })).toThrow(/inherit kind/);
  });
});
