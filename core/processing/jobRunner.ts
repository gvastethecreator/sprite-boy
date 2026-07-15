import { isEntityId, type EntityId } from "../project";
import type { JobStore } from "../stores/contracts";
import {
  JOB_FAILURE_CODES,
  assertJobSnapshot,
  transitionJob,
  type CancelledJobSnapshot,
  type FailedJobSnapshot,
  type JobFailureCode,
  type JobProgressEvent,
  type JobSnapshot,
  type QueuedJobSnapshot,
  type SucceededJobSnapshot,
  type TimedOutJobSnapshot,
} from "./jobLifecycle";

export interface JobRunnerHost {
  readonly now: () => string;
  readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

export type JobTaskProgress = JobProgressEvent["progress"];

export interface JobTaskContext {
  readonly requestId: EntityId;
  readonly signal: AbortSignal;
  /** Returns false once the run is closed or when monotonicity rejects the update. */
  readonly reportProgress: (progress: JobTaskProgress) => boolean;
}

export type JobTask<TResult> = (
  context: JobTaskContext,
) => TResult | PromiseLike<TResult>;

export class JobTaskError extends Error {
  readonly code: JobFailureCode;
  readonly retryable: boolean;

  constructor(code: JobFailureCode, message: string, retryable: boolean) {
    if (!JOB_FAILURE_CODES.includes(code)) throw new TypeError("Job task error code is invalid.");
    if (typeof message !== "string" || message.trim().length === 0) {
      throw new TypeError("Job task error message must be non-empty.");
    }
    if (typeof retryable !== "boolean") {
      throw new TypeError("Job task retryable policy must be boolean.");
    }
    super(message);
    this.name = "JobTaskError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type JobRunResult<TResult> =
  | {
      readonly status: "succeeded";
      readonly job: SucceededJobSnapshot;
      readonly value: TResult;
    }
  | {
      readonly status: "failed";
      readonly job: FailedJobSnapshot;
    }
  | {
      readonly status: "cancelled";
      readonly job: CancelledJobSnapshot;
    }
  | {
      readonly status: "timed-out";
      readonly job: TimedOutJobSnapshot;
    };

export interface JobRunHandle<TResult> {
  readonly jobId: EntityId;
  readonly requestId: EntityId;
  readonly result: Promise<JobRunResult<TResult>>;
  cancel(message?: string): boolean;
}

export interface JobRunOptions {
  readonly signal?: AbortSignal;
}

export interface JobRunner {
  run<TResult>(
    job: QueuedJobSnapshot,
    task: JobTask<TResult>,
    options?: JobRunOptions,
  ): JobRunHandle<TResult>;
  cancel(jobId: EntityId, message?: string): boolean;
  getActiveCount(): number;
  dispose(): void;
}

export interface CreateJobRunnerOptions {
  readonly store: JobStore;
  readonly host?: JobRunnerHost;
}

type RunPhase = "open" | "settling-nonterminal" | "settling-terminal" | "settled";
type PendingTerminal =
  | { readonly type: "cancel"; readonly message: string }
  | { readonly type: "timeout"; readonly message: string };

const NO_TIMER = Symbol("no-job-runner-timer");
const MAX_TIMER_DELAY_MS = 2_147_483_647;

interface ActiveRun<TResult> {
  readonly jobId: EntityId;
  readonly requestId: EntityId;
  readonly controller: AbortController;
  readonly resolve: (result: JobRunResult<TResult>) => void;
  readonly reject: (error: unknown) => void;
  job: JobSnapshot;
  phase: RunPhase;
  pendingTerminal: PendingTerminal | null;
  timeoutHandle: unknown | typeof NO_TIMER;
  callerSignal: AbortSignal | null;
  callerAbortListener: (() => void) | null;
}

const DEFAULT_JOB_RUNNER_HOST: JobRunnerHost = Object.freeze({
  now: () => new Date().toISOString(),
  setTimer: (callback: () => void, delayMs: number): unknown => setTimeout(callback, delayMs),
  clearTimer: (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

function requireOwnFunction(
  record: object,
  key: PropertyKey,
  label: string,
): (...args: unknown[]) => unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    throw new TypeError(`${label} must be an own data function.`);
  }
  return descriptor.value as (...args: unknown[]) => unknown;
}

function normalizeHost(host: JobRunnerHost | undefined): JobRunnerHost {
  if (host === undefined) return DEFAULT_JOB_RUNNER_HOST;
  if (host === null || typeof host !== "object" || Array.isArray(host)) {
    throw new TypeError("JobRunner host must be an object.");
  }
  const now = requireOwnFunction(host, "now", "JobRunner host.now");
  const setTimer = requireOwnFunction(host, "setTimer", "JobRunner host.setTimer");
  const clearTimer = requireOwnFunction(host, "clearTimer", "JobRunner host.clearTimer");
  return Object.freeze({
    now: () => Reflect.apply(now, host, []) as string,
    setTimer: (callback: () => void, delayMs: number) =>
      Reflect.apply(setTimer, host, [callback, delayMs]),
    clearTimer: (handle: unknown) => {
      Reflect.apply(clearTimer, host, [handle]);
    },
  });
}

function requireStore(store: JobStore): JobStore {
  if (
    store === null || typeof store !== "object" || store.kind !== "job" ||
    typeof store.dispatch !== "function" || typeof store.getSnapshot !== "function"
  ) {
    throw new TypeError("JobRunner requires a JobStore.");
  }
  return store;
}

function canonicalTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
    ? value
    : null;
}

function nativeSignalAborted(signal: AbortSignal): boolean {
  const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
  if (!getter) throw new TypeError("AbortSignal.aborted is unavailable.");
  return Reflect.apply(getter, signal, []) as boolean;
}

function addAbortListener(signal: AbortSignal, listener: () => void): void {
  Reflect.apply(AbortSignal.prototype.addEventListener, signal, ["abort", listener, { once: true }]);
}

function removeAbortListener(signal: AbortSignal, listener: () => void): void {
  Reflect.apply(AbortSignal.prototype.removeEventListener, signal, ["abort", listener]);
}

function readCallerSignal(options: JobRunOptions | undefined): AbortSignal | null {
  if (options === undefined) return null;
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Job run options must be a data object.");
  }
  const keys = Reflect.ownKeys(options);
  if (keys.some((key) => key !== "signal")) {
    throw new TypeError("Job run options contain an unsupported field.");
  }
  const descriptor = Object.getOwnPropertyDescriptor(options, "signal");
  if (!descriptor) return null;
  if (!("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError("Job run signal must be an enumerable data property.");
  }
  if (descriptor.value === undefined) return null;
  const signal = descriptor.value as AbortSignal;
  try {
    nativeSignalAborted(signal);
  } catch {
    throw new TypeError("Job run signal must be a native AbortSignal.");
  }
  return signal;
}

function normalizeTerminalMessage(value: string | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Job terminal message must be non-empty.");
  }
  return value;
}

function normalizeTaskFailure(error: unknown): JobTaskError {
  if (error instanceof JobTaskError) {
    const code = Object.getOwnPropertyDescriptor(error, "code");
    const message = Object.getOwnPropertyDescriptor(error, "message");
    const retryable = Object.getOwnPropertyDescriptor(error, "retryable");
    if (
      code && "value" in code && message && "value" in message &&
      retryable && "value" in retryable
    ) {
      try {
        return new JobTaskError(code.value as JobFailureCode, message.value as string, retryable.value as boolean);
      } catch {
        // A mutated or subclassed task error is treated as an untrusted runtime failure.
      }
    }
  }
  return new JobTaskError("runtime-failure", "Job task failed.", true);
}

class DefaultJobRunner implements JobRunner {
  private readonly store: JobStore;
  private readonly host: JobRunnerHost;
  private readonly active = new Map<EntityId, ActiveRun<unknown>>();
  private disposed = false;

  constructor(options: CreateJobRunnerOptions) {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("JobRunner options must be an object.");
    }
    this.store = requireStore(options.store);
    this.host = normalizeHost(options.host);
  }

  run<TResult>(
    job: QueuedJobSnapshot,
    task: JobTask<TResult>,
    options?: JobRunOptions,
  ): JobRunHandle<TResult> {
    if (this.disposed) throw new TypeError("JobRunner is disposed.");
    assertJobSnapshot(job);
    if (job.status !== "queued") throw new TypeError("JobRunner requires a queued job.");
    if (typeof task !== "function") throw new TypeError("JobRunner task must be a function.");
    if (this.active.has(job.id)) throw new TypeError(`Job ${job.id} is already active.`);
    const callerSignal = readCallerSignal(options);

    let resolve!: (result: JobRunResult<TResult>) => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<JobRunResult<TResult>>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const entry: ActiveRun<TResult> = {
      jobId: job.id,
      requestId: job.requestId,
      controller: new AbortController(),
      resolve,
      reject,
      job,
      phase: "settling-nonterminal",
      pendingTerminal: null,
      timeoutHandle: NO_TIMER,
      callerSignal,
      callerAbortListener: null,
    };
    this.active.set(entry.jobId, entry as ActiveRun<unknown>);

    const handle = Object.freeze({
      jobId: entry.jobId,
      requestId: entry.requestId,
      result,
      cancel: (message?: string) => this.cancel(entry.jobId, message),
    });

    try {
      this.store.dispatch({ type: "job.replace", job });
      const committedJob = this.store.getSnapshot().jobs[entry.jobId];
      assertJobSnapshot(committedJob);
      if (
        committedJob.status !== "queued" || committedJob.id !== entry.jobId ||
        committedJob.requestId !== entry.requestId
      ) {
        throw new TypeError("JobStore did not commit the reserved queued job.");
      }
      entry.job = committedJob;
      entry.phase = "open";
      this.flushPending(entry);
    } catch (error) {
      this.closeWithFault(entry, error);
      return handle;
    }

    if (entry.phase !== "open") return handle;

    if (callerSignal) {
      const listener = () => {
        this.requestTerminal(entry, {
          type: "cancel",
          message: "Job cancelled by caller.",
        });
      };
      entry.callerAbortListener = listener;
      try {
        addAbortListener(callerSignal, listener);
      } catch (error) {
        this.closeWithFault(entry, error);
        return handle;
      }
      if (nativeSignalAborted(callerSignal)) {
        this.requestTerminal(entry, {
          type: "cancel",
          message: "Job cancelled by caller.",
        });
      }
    }

    if (entry.phase === "open") {
      this.commitNonTerminal(entry, {
        type: "job.start",
        requestId: entry.requestId,
        at: this.eventTime(entry),
      }, false);
    }
    if (entry.phase === "open" && entry.job.timeoutMs !== null) {
      this.scheduleTimeout(entry, entry.job.timeoutMs);
    }
    if (entry.phase === "open") {
      const context = Object.freeze({
        requestId: entry.requestId,
        signal: entry.controller.signal,
        reportProgress: (progress: JobTaskProgress) => this.reportProgress(entry, progress),
      });
      void this.invokeTask(entry, task, context);
    }
    return handle;
  }

  cancel(jobId: EntityId, message?: string): boolean {
    if (!isEntityId(jobId)) throw new TypeError("JobRunner cancel requires an EntityId.");
    const entry = this.active.get(jobId);
    if (!entry) return false;
    return this.requestTerminal(entry, {
      type: "cancel",
      message: normalizeTerminalMessage(message, "Job cancelled."),
    });
  }

  getActiveCount(): number {
    return this.active.size;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of Array.from(this.active.values())) {
      this.requestTerminal(entry, {
        type: "cancel",
        message: "Job runner disposed.",
      });
    }
  }

  private eventTime<TResult>(entry: ActiveRun<TResult>): string {
    try {
      const candidate = canonicalTimestamp(this.host.now());
      if (!candidate) return entry.job.updatedAt;
      return Date.parse(candidate) < Date.parse(entry.job.updatedAt)
        ? entry.job.updatedAt
        : candidate;
    } catch {
      return entry.job.updatedAt;
    }
  }

  private async invokeTask<TResult>(
    entry: ActiveRun<TResult>,
    task: JobTask<TResult>,
    context: JobTaskContext,
  ): Promise<void> {
    if (entry.phase !== "open") return;
    try {
      const value = await Reflect.apply(task, undefined, [context]) as TResult;
      if (entry.phase === "open") this.settleSuccess(entry, value);
    } catch (error) {
      if (entry.phase === "open") this.settleFailure(entry, normalizeTaskFailure(error));
    }
  }

  private reportProgress<TResult>(entry: ActiveRun<TResult>, progress: JobTaskProgress): boolean {
    if (entry.phase !== "open") return false;
    const transition = this.commitNonTerminal(entry, {
      type: "job.progress",
      requestId: entry.requestId,
      at: this.eventTime(entry),
      progress,
    }, true);
    return transition !== null && transition.outcome === "applied" && entry.phase === "open";
  }

  private commitNonTerminal<TResult>(
    entry: ActiveRun<TResult>,
    event: Parameters<typeof transitionJob>[1],
    taskOwned: boolean,
  ): ReturnType<typeof transitionJob> | null {
    if (entry.phase !== "open") return null;
    entry.phase = "settling-nonterminal";
    try {
      const transition = transitionJob(entry.job, event);
      if (transition.outcome === "applied") {
        this.store.dispatch({ type: "job.replace", job: transition.job });
        entry.job = transition.job;
      }
      entry.phase = "open";
      this.flushPending(entry);
      return transition;
    } catch (error) {
      entry.phase = "open";
      if (taskOwned) {
        this.settleFailure(
          entry,
          new JobTaskError("invalid-input", "Job task reported invalid progress.", false),
        );
      } else {
        this.closeWithFault(entry, error);
      }
      return null;
    }
  }

  private requestTerminal<TResult>(
    entry: ActiveRun<TResult>,
    terminal: PendingTerminal,
  ): boolean {
    if (entry.phase === "settled") return false;
    if (entry.phase === "settling-terminal") return false;
    if (entry.phase === "settling-nonterminal") {
      if (!entry.pendingTerminal) entry.pendingTerminal = terminal;
      this.abort(entry, terminal.message);
      return true;
    }
    if (terminal.type === "timeout") this.settleTimeout(entry, terminal.message);
    else this.settleCancelled(entry, terminal.message);
    return true;
  }

  private flushPending<TResult>(entry: ActiveRun<TResult>): void {
    if (entry.phase !== "open" || !entry.pendingTerminal) return;
    const pending = entry.pendingTerminal;
    entry.pendingTerminal = null;
    this.requestTerminal(entry, pending);
  }

  private settleSuccess<TResult>(entry: ActiveRun<TResult>, value: TResult): void {
    if (entry.phase !== "open") return;
    entry.phase = "settling-terminal";
    try {
      const transition = transitionJob(entry.job, {
        type: "job.succeed",
        requestId: entry.requestId,
        at: this.eventTime(entry),
      });
      if (transition.outcome !== "applied" || transition.job.status !== "succeeded") {
        throw new TypeError("JobRunner could not commit success.");
      }
      this.store.dispatch({ type: "job.replace", job: transition.job });
      entry.job = transition.job;
      entry.phase = "settled";
      this.cleanup(entry);
      entry.resolve(Object.freeze({ status: "succeeded", job: transition.job, value }));
    } catch (error) {
      this.closeWithFault(entry, error);
    }
  }

  private settleFailure<TResult>(entry: ActiveRun<TResult>, failure: JobTaskError): void {
    if (entry.phase !== "open") return;
    entry.phase = "settling-terminal";
    try {
      const transition = transitionJob(entry.job, {
        type: "job.fail",
        requestId: entry.requestId,
        at: this.eventTime(entry),
        error: {
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
        },
      });
      if (transition.outcome !== "applied" || transition.job.status !== "failed") {
        throw new TypeError("JobRunner could not commit failure.");
      }
      this.store.dispatch({ type: "job.replace", job: transition.job });
      entry.job = transition.job;
      entry.phase = "settled";
      this.abort(entry, failure.message);
      this.cleanup(entry);
      entry.resolve(Object.freeze({ status: "failed", job: transition.job }));
    } catch (error) {
      this.closeWithFault(entry, error);
    }
  }

  private settleCancelled<TResult>(entry: ActiveRun<TResult>, message: string): void {
    if (entry.phase !== "open") return;
    entry.phase = "settling-terminal";
    try {
      const transition = transitionJob(entry.job, {
        type: "job.cancel",
        requestId: entry.requestId,
        at: this.eventTime(entry),
        message,
      });
      if (transition.outcome !== "applied" || transition.job.status !== "cancelled") {
        throw new TypeError("JobRunner could not commit cancellation.");
      }
      this.store.dispatch({ type: "job.replace", job: transition.job });
      entry.job = transition.job;
      entry.phase = "settled";
      this.abort(entry, message);
      this.cleanup(entry);
      entry.resolve(Object.freeze({ status: "cancelled", job: transition.job }));
    } catch (error) {
      this.closeWithFault(entry, error);
    }
  }

  private settleTimeout<TResult>(entry: ActiveRun<TResult>, message: string): void {
    if (entry.phase !== "open") return;
    entry.phase = "settling-terminal";
    try {
      const transition = transitionJob(entry.job, {
        type: "job.timeout",
        requestId: entry.requestId,
        at: this.eventTime(entry),
        message,
      });
      if (transition.outcome !== "applied" || transition.job.status !== "timed-out") {
        throw new TypeError("JobRunner could not commit timeout.");
      }
      this.store.dispatch({ type: "job.replace", job: transition.job });
      entry.job = transition.job;
      entry.phase = "settled";
      this.abort(entry, message);
      this.cleanup(entry);
      entry.resolve(Object.freeze({ status: "timed-out", job: transition.job }));
    } catch (error) {
      this.closeWithFault(entry, error);
    }
  }

  private scheduleTimeout<TResult>(
    entry: ActiveRun<TResult>,
    remainingMs: number,
    totalMs = remainingMs,
  ): void {
    let remaining = remainingMs;
    while (entry.phase === "open") {
      const delayMs = Math.min(remaining, MAX_TIMER_DELAY_MS);
      const nextRemaining = remaining - delayMs;
      let scheduling = true;
      let fired = false;
      let handle: unknown = NO_TIMER;
      const callback = () => {
        if (fired) return;
        fired = true;
        if (scheduling) return;
        if (entry.timeoutHandle === handle) entry.timeoutHandle = NO_TIMER;
        this.continueTimeout(entry, nextRemaining, totalMs);
      };
      try {
        handle = this.host.setTimer(callback, delayMs);
      } catch {
        scheduling = false;
        if (fired) {
          this.continueTimeout(entry, nextRemaining, totalMs);
        } else {
          this.settleFailure(
            entry,
            new JobTaskError("runtime-failure", "Job runner could not schedule timeout.", true),
          );
        }
        return;
      }
      scheduling = false;
      if (fired) {
        this.safeClearTimer(handle);
        if (nextRemaining === 0) {
          this.commitTimeout(entry, totalMs);
          return;
        }
        remaining = nextRemaining;
        continue;
      }
      if (entry.phase === "open") entry.timeoutHandle = handle;
      else this.safeClearTimer(handle);
      return;
    }
  }

  private continueTimeout<TResult>(
    entry: ActiveRun<TResult>,
    remainingMs: number,
    totalMs: number,
  ): void {
    if (entry.phase !== "open") return;
    if (remainingMs > 0) {
      this.scheduleTimeout(entry, remainingMs, totalMs);
      return;
    }
    this.commitTimeout(entry, totalMs);
  }

  private commitTimeout<TResult>(entry: ActiveRun<TResult>, totalMs: number): void {
    this.requestTerminal(entry, {
      type: "timeout",
      message: `Job timed out after ${totalMs}ms.`,
    });
  }

  private cleanup<TResult>(entry: ActiveRun<TResult>): void {
    if (entry.timeoutHandle !== NO_TIMER) {
      const handle = entry.timeoutHandle;
      entry.timeoutHandle = NO_TIMER;
      this.safeClearTimer(handle);
    }
    if (entry.callerSignal && entry.callerAbortListener) {
      try {
        removeAbortListener(entry.callerSignal, entry.callerAbortListener);
      } catch {
        // Cleanup diagnostics are deferred to F7-07 and cannot change a terminal.
      }
      entry.callerAbortListener = null;
      entry.callerSignal = null;
    }
    if (this.active.get(entry.jobId) === entry) this.active.delete(entry.jobId);
  }

  private safeClearTimer(handle: unknown): void {
    try {
      this.host.clearTimer(handle);
    } catch {
      // Cleanup diagnostics are deferred to F7-07 and cannot change a terminal.
    }
  }

  private abort<TResult>(entry: ActiveRun<TResult>, reason: string): void {
    if (entry.controller.signal.aborted) return;
    try {
      entry.controller.abort(reason);
    } catch {
      // Native AbortController should not throw; terminal state remains authoritative.
    }
  }

  private closeWithFault<TResult>(entry: ActiveRun<TResult>, error: unknown): void {
    if (entry.phase === "settled") return;
    entry.phase = "settled";
    this.abort(entry, "Job runner structural failure.");
    this.cleanup(entry);
    entry.reject(error instanceof Error ? error : new Error("Job runner structural failure."));
  }
}

export function createJobRunner(options: CreateJobRunnerOptions): JobRunner {
  return new DefaultJobRunner(options);
}
