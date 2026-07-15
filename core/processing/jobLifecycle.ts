import { isEntityId, type EntityId } from "../project";

export const JOB_STATUSES = Object.freeze([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed-out",
] as const);

export type JobStatus = (typeof JOB_STATUSES)[number];
export type ActiveJobStatus = Extract<JobStatus, "queued" | "running">;
export type TerminalJobStatus = Exclude<JobStatus, ActiveJobStatus>;

export const JOB_FAILURE_CODES = Object.freeze([
  "invalid-input",
  "unsupported",
  "worker-crash",
  "provider-failure",
  "export-failure",
  "storage-failure",
  "quota-exceeded",
  "runtime-failure",
] as const);

export type JobFailureCode = (typeof JOB_FAILURE_CODES)[number];
export type JobErrorCode = JobFailureCode | "cancelled" | "timeout";

export interface JobProgress {
  /** Global progress for the complete job, never a phase-local percentage. */
  readonly ratio: number;
  readonly phase: string;
  readonly message: string | null;
}

export interface JobError {
  readonly code: JobErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

interface JobSnapshotBase<TStatus extends JobStatus> {
  readonly id: EntityId;
  /** Attempt-specific protocol identity; worker/provider messages carry this value. */
  readonly requestId: EntityId;
  readonly kind: string;
  readonly label: string;
  readonly status: TStatus;
  readonly attempt: number;
  readonly rootJobId: EntityId;
  readonly previousJobId: EntityId | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly timeoutMs: number | null;
  readonly progress: JobProgress;
  readonly error: JobError | null;
}

export type QueuedJobSnapshot = JobSnapshotBase<"queued"> & {
  readonly startedAt: null;
  readonly finishedAt: null;
  readonly error: null;
};

export type RunningJobSnapshot = JobSnapshotBase<"running"> & {
  readonly startedAt: string;
  readonly finishedAt: null;
  readonly error: null;
};

export type SucceededJobSnapshot = JobSnapshotBase<"succeeded"> & {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly progress: JobProgress & { readonly ratio: 1 };
  readonly error: null;
};

export type FailedJobSnapshot = JobSnapshotBase<"failed"> & {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly error: JobError & { readonly code: JobFailureCode };
};

export type CancelledJobSnapshot = JobSnapshotBase<"cancelled"> & {
  readonly finishedAt: string;
  readonly error: JobError & { readonly code: "cancelled"; readonly retryable: true };
};

export type TimedOutJobSnapshot = JobSnapshotBase<"timed-out"> & {
  readonly finishedAt: string;
  readonly error: JobError & { readonly code: "timeout"; readonly retryable: true };
};

export type ActiveJobSnapshot = QueuedJobSnapshot | RunningJobSnapshot;
export type TerminalJobSnapshot =
  | SucceededJobSnapshot
  | FailedJobSnapshot
  | CancelledJobSnapshot
  | TimedOutJobSnapshot;
export type JobSnapshot = ActiveJobSnapshot | TerminalJobSnapshot;

export interface CreateQueuedJobInput {
  readonly id: EntityId;
  readonly requestId: EntityId;
  readonly kind: string;
  readonly label: string;
  readonly createdAt: string;
  readonly timeoutMs?: number | null;
}

export interface JobStartEvent {
  readonly type: "job.start";
  readonly requestId: EntityId;
  readonly at: string;
  readonly phase?: string;
  readonly message?: string;
}

export interface JobProgressEvent {
  readonly type: "job.progress";
  readonly requestId: EntityId;
  readonly at: string;
  readonly progress: {
    readonly ratio: number;
    readonly phase: string;
    readonly message?: string | null;
  };
}

export interface JobSucceedEvent {
  readonly type: "job.succeed";
  readonly requestId: EntityId;
  readonly at: string;
  readonly message?: string;
}

export interface JobFailEvent {
  readonly type: "job.fail";
  readonly requestId: EntityId;
  readonly at: string;
  readonly error: {
    readonly code: JobFailureCode;
    readonly message: string;
    readonly retryable: boolean;
  };
}

export interface JobCancelEvent {
  readonly type: "job.cancel";
  readonly requestId: EntityId;
  readonly at: string;
  readonly message?: string;
}

export interface JobTimeoutEvent {
  readonly type: "job.timeout";
  readonly requestId: EntityId;
  readonly at: string;
  readonly message?: string;
}

export type JobEvent =
  | JobStartEvent
  | JobProgressEvent
  | JobSucceedEvent
  | JobFailEvent
  | JobCancelEvent
  | JobTimeoutEvent;

export const JOB_TRANSITION_OUTCOMES = Object.freeze([
  "applied",
  "ignored-request",
  "ignored-stale",
  "ignored-state",
  "ignored-terminal",
  "ignored-progress-regression",
] as const);

export type JobTransitionOutcome = (typeof JOB_TRANSITION_OUTCOMES)[number];

export interface JobTransitionResult {
  readonly outcome: JobTransitionOutcome;
  readonly job: JobSnapshot;
}

export interface RetryJobInput {
  readonly id: EntityId;
  readonly requestId: EntityId;
  readonly createdAt: string;
}

export type JobRetryOutcome =
  | "created"
  | "rejected-state"
  | "rejected-not-retryable"
  | "rejected-stale";

export interface JobRetryResult {
  readonly outcome: JobRetryOutcome;
  readonly source: JobSnapshot;
  readonly retry: QueuedJobSnapshot | null;
}

type DataRecord = Record<string, unknown>;

const JOB_KEYS = Object.freeze([
  "id",
  "requestId",
  "kind",
  "label",
  "status",
  "attempt",
  "rootJobId",
  "previousJobId",
  "createdAt",
  "updatedAt",
  "startedAt",
  "finishedAt",
  "timeoutMs",
  "progress",
  "error",
] as const);

function readDataRecord(value: unknown, label: string): DataRecord {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
    const output = Object.create(null) as DataRecord;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError();
      Object.defineProperty(output, key, { enumerable: true, value: descriptor.value });
    }
    return output;
  } catch {
    throw new TypeError(`${label} must be a data-only object.`);
  }
}

function requireExactKeys(
  record: DataRecord,
  required: readonly string[],
  optional: readonly string[] = [],
  label = "Object",
): void {
  const keys = Object.keys(record);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(record, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    throw new TypeError(`${label} has an invalid shape.`);
  }
}

function requireEntityId(value: unknown, label: string): EntityId {
  if (!isEntityId(value)) throw new TypeError(`${label} must be an EntityId.`);
  return value;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireOptionalMessage(value: unknown, present: boolean, label: string): string | null {
  if (!present || value === null) return null;
  return requireText(value, label);
}

function requireCanonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a canonical timestamp.`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical timestamp.`);
  }
  return value;
}

function timestamp(value: string): number {
  return Date.parse(value);
}

function requireTimeout(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${label} must be a positive safe integer or null.`);
  }
  return value as number;
}

function requireAttempt(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError("job.attempt must be a positive safe integer.");
  }
  return value as number;
}

function requireRatio(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Object.is(value, -0) ||
    value < 0 ||
    value > 1
  ) {
    throw new TypeError("job.progress.ratio must be a canonical number from 0 to 1.");
  }
  return value;
}

function freezeProgress(ratio: number, phase: string, message: string | null): JobProgress {
  return Object.freeze({ ratio, phase, message });
}

function freezeCompletedProgress(message: string | null): JobProgress & { readonly ratio: 1 } {
  return Object.freeze({ ratio: 1 as const, phase: "completed", message });
}

function normalizeProgress(value: unknown): JobProgress {
  const progress = readDataRecord(value, "job.progress");
  requireExactKeys(progress, ["ratio", "phase"], ["message"], "job.progress");
  return freezeProgress(
    requireRatio(progress.ratio),
    requireText(progress.phase, "job.progress.phase"),
    requireOptionalMessage(
      progress.message,
      Object.prototype.hasOwnProperty.call(progress, "message"),
      "job.progress.message",
    ),
  );
}

function normalizeError(value: unknown, allowTerminalCodes: boolean): JobError {
  const error = readDataRecord(value, "job.error");
  requireExactKeys(error, ["code", "message", "retryable"], [], "job.error");
  const code = error.code;
  const validCode = JOB_FAILURE_CODES.includes(code as JobFailureCode) ||
    (allowTerminalCodes && (code === "cancelled" || code === "timeout"));
  if (!validCode) throw new TypeError("job.error.code is invalid.");
  if (typeof error.retryable !== "boolean") {
    throw new TypeError("job.error.retryable must be a boolean.");
  }
  return Object.freeze({
    code: code as JobErrorCode,
    message: requireText(error.message, "job.error.message"),
    retryable: error.retryable,
  });
}

function freezeError(code: JobErrorCode, message: string, retryable: boolean): JobError {
  return Object.freeze({ code, message, retryable });
}

function freezeJob<TJob extends JobSnapshot>(job: TJob): TJob {
  return Object.freeze(job);
}

function ignored(job: JobSnapshot, outcome: Exclude<JobTransitionOutcome, "applied">): JobTransitionResult {
  return Object.freeze({ outcome, job });
}

function applied(job: JobSnapshot): JobTransitionResult {
  return Object.freeze({ outcome: "applied", job });
}

function assertChronology(job: DataRecord): void {
  const createdAt = requireCanonicalTimestamp(job.createdAt, "job.createdAt");
  const updatedAt = requireCanonicalTimestamp(job.updatedAt, "job.updatedAt");
  if (timestamp(updatedAt) < timestamp(createdAt)) {
    throw new TypeError("job.updatedAt cannot precede job.createdAt.");
  }
  if (job.startedAt !== null) {
    const startedAt = requireCanonicalTimestamp(job.startedAt, "job.startedAt");
    if (timestamp(startedAt) < timestamp(createdAt) || timestamp(startedAt) > timestamp(updatedAt)) {
      throw new TypeError("job.startedAt is outside the job chronology.");
    }
  }
  if (job.finishedAt !== null) {
    const finishedAt = requireCanonicalTimestamp(job.finishedAt, "job.finishedAt");
    if (timestamp(finishedAt) !== timestamp(updatedAt)) {
      throw new TypeError("Terminal jobs must finish at their last update.");
    }
    if (job.startedAt !== null && timestamp(finishedAt) < timestamp(job.startedAt as string)) {
      throw new TypeError("job.finishedAt cannot precede job.startedAt.");
    }
  }
}

/** Runtime assertion used by store and adapter boundaries. */
export function assertJobSnapshot(value: unknown): asserts value is JobSnapshot {
  const job = readDataRecord(value, "Job snapshot");
  requireExactKeys(job, JOB_KEYS, [], "Job snapshot");
  const id = requireEntityId(job.id, "job.id");
  requireEntityId(job.requestId, "job.requestId");
  requireText(job.kind, "job.kind");
  requireText(job.label, "job.label");
  if (!JOB_STATUSES.includes(job.status as JobStatus)) throw new TypeError("job.status is invalid.");
  const attempt = requireAttempt(job.attempt);
  const rootJobId = requireEntityId(job.rootJobId, "job.rootJobId");
  const previousJobId = job.previousJobId === null
    ? null
    : requireEntityId(job.previousJobId, "job.previousJobId");
  if (attempt === 1 && (rootJobId !== id || previousJobId !== null)) {
    throw new TypeError("A first attempt must own its root identity and have no previous job.");
  }
  if (attempt > 1 && (rootJobId === id || previousJobId === null || previousJobId === id)) {
    throw new TypeError("A retry must preserve distinct root and previous job identities.");
  }
  requireTimeout(job.timeoutMs, "job.timeoutMs");
  const progress = normalizeProgress(job.progress);
  assertChronology(job);

  const status = job.status as JobStatus;
  const error = job.error === null ? null : normalizeError(job.error, true);
  if (status === "queued") {
    if (
      job.startedAt !== null || job.finishedAt !== null || error !== null ||
      progress.ratio !== 0 || progress.phase !== "queued" || progress.message !== null ||
      job.updatedAt !== job.createdAt
    ) {
      throw new TypeError("Queued job snapshot is inconsistent.");
    }
    return;
  }
  if (status === "running") {
    if (job.startedAt === null || job.finishedAt !== null || error !== null) {
      throw new TypeError("Running job snapshot is inconsistent.");
    }
    return;
  }
  if (job.finishedAt === null) throw new TypeError("Terminal job requires finishedAt.");
  if (status === "succeeded") {
    if (
      job.startedAt === null || error !== null || progress.ratio !== 1 ||
      progress.phase !== "completed"
    ) {
      throw new TypeError("Succeeded job snapshot is inconsistent.");
    }
    return;
  }
  if (error === null) throw new TypeError("Unsuccessful terminal job requires a structured error.");
  if (status === "failed") {
    if (
      job.startedAt === null || !JOB_FAILURE_CODES.includes(error.code as JobFailureCode) ||
      progress.phase !== "failed" || progress.message !== error.message
    ) {
      throw new TypeError("Failed job snapshot is inconsistent.");
    }
    return;
  }
  if (
    status === "cancelled" &&
    (
      error.code !== "cancelled" || !error.retryable || progress.phase !== "cancelled" ||
      progress.message !== error.message || (job.startedAt === null && progress.ratio !== 0)
    )
  ) {
    throw new TypeError("Cancelled job snapshot is inconsistent.");
  }
  if (
    status === "timed-out" &&
    (
      error.code !== "timeout" || !error.retryable || progress.phase !== "timed-out" ||
      progress.message !== error.message || (job.startedAt === null && progress.ratio !== 0)
    )
  ) {
    throw new TypeError("Timed-out job snapshot is inconsistent.");
  }
}

export function createQueuedJob(input: CreateQueuedJobInput): QueuedJobSnapshot {
  const data = readDataRecord(input, "Job creation input");
  requireExactKeys(
    data,
    ["id", "requestId", "kind", "label", "createdAt"],
    ["timeoutMs"],
    "Job creation input",
  );
  const id = requireEntityId(data.id, "job.id");
  const createdAt = requireCanonicalTimestamp(data.createdAt, "job.createdAt");
  return freezeJob({
    id,
    requestId: requireEntityId(data.requestId, "job.requestId"),
    kind: requireText(data.kind, "job.kind"),
    label: requireText(data.label, "job.label"),
    status: "queued",
    attempt: 1,
    rootJobId: id,
    previousJobId: null,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    finishedAt: null,
    timeoutMs: requireTimeout(data.timeoutMs, "job.timeoutMs"),
    progress: freezeProgress(0, "queued", null),
    error: null,
  });
}

function commonEvent(
  value: unknown,
  type: JobEvent["type"],
  required: readonly string[],
  optional: readonly string[] = [],
): { readonly event: DataRecord; readonly requestId: EntityId; readonly at: string } {
  const event = readDataRecord(value, "Job event");
  requireExactKeys(event, ["type", "requestId", "at", ...required], optional, "Job event");
  if (event.type !== type) throw new TypeError("Job event type is invalid.");
  return {
    event,
    requestId: requireEntityId(event.requestId, "event.requestId"),
    at: requireCanonicalTimestamp(event.at, "event.at"),
  };
}

export function transitionJob(job: JobSnapshot, value: JobEvent): JobTransitionResult {
  assertJobSnapshot(job);
  const eventType = readDataRecord(value, "Job event").type;
  if (typeof eventType !== "string") throw new TypeError("Job event type is invalid.");

  let event: DataRecord;
  let requestId: EntityId;
  let at: string;
  let progress: JobProgress | undefined;
  let message: string | null | undefined;
  let failure: JobError | undefined;

  switch (eventType) {
    case "job.start": {
      ({ event, requestId, at } = commonEvent(value, "job.start", [], ["phase", "message"]));
      const phasePresent = Object.prototype.hasOwnProperty.call(event, "phase");
      const messagePresent = Object.prototype.hasOwnProperty.call(event, "message");
      progress = freezeProgress(
        job.progress.ratio,
        phasePresent ? requireText(event.phase, "event.phase") : "running",
        requireOptionalMessage(event.message, messagePresent, "event.message"),
      );
      break;
    }
    case "job.progress":
      ({ event, requestId, at } = commonEvent(value, "job.progress", ["progress"]));
      progress = normalizeProgress(event.progress);
      break;
    case "job.succeed":
      ({ event, requestId, at } = commonEvent(value, "job.succeed", [], ["message"]));
      message = requireOptionalMessage(
        event.message,
        Object.prototype.hasOwnProperty.call(event, "message"),
        "event.message",
      );
      break;
    case "job.fail":
      ({ event, requestId, at } = commonEvent(value, "job.fail", ["error"]));
      failure = normalizeError(event.error, false);
      break;
    case "job.cancel":
      ({ event, requestId, at } = commonEvent(value, "job.cancel", [], ["message"]));
      message = requireOptionalMessage(
        event.message,
        Object.prototype.hasOwnProperty.call(event, "message"),
        "event.message",
      );
      break;
    case "job.timeout":
      ({ event, requestId, at } = commonEvent(value, "job.timeout", [], ["message"]));
      message = requireOptionalMessage(
        event.message,
        Object.prototype.hasOwnProperty.call(event, "message"),
        "event.message",
      );
      break;
    default:
      throw new TypeError("Unsupported job event.");
  }

  if (requestId !== job.requestId) return ignored(job, "ignored-request");
  if (isTerminalJob(job)) return ignored(job, "ignored-terminal");
  if (timestamp(at) < timestamp(job.updatedAt)) return ignored(job, "ignored-stale");

  switch (eventType) {
    case "job.start":
      if (job.status !== "queued") return ignored(job, "ignored-state");
      return applied(freezeJob({
        ...job,
        status: "running",
        updatedAt: at,
        startedAt: at,
        progress: progress as JobProgress,
      }));
    case "job.progress":
      if (job.status !== "running") return ignored(job, "ignored-state");
      if ((progress as JobProgress).ratio < job.progress.ratio) {
        return ignored(job, "ignored-progress-regression");
      }
      return applied(freezeJob({
        ...job,
        updatedAt: at,
        progress: progress as JobProgress,
      }));
    case "job.succeed":
      if (job.status !== "running") return ignored(job, "ignored-state");
      return applied(freezeJob({
        ...job,
        status: "succeeded",
        updatedAt: at,
        finishedAt: at,
        progress: freezeCompletedProgress(message as string | null),
        error: null,
      }) as SucceededJobSnapshot);
    case "job.fail":
      if (job.status !== "running") return ignored(job, "ignored-state");
      return applied(freezeJob({
        ...job,
        status: "failed",
        updatedAt: at,
        finishedAt: at,
        progress: freezeProgress(job.progress.ratio, "failed", (failure as JobError).message),
        error: failure as JobError & { readonly code: JobFailureCode },
      }) as FailedJobSnapshot);
    case "job.cancel": {
      const cancellation = freezeError("cancelled", message ?? "Job cancelled.", true);
      return applied(freezeJob({
        ...job,
        status: "cancelled",
        updatedAt: at,
        finishedAt: at,
        progress: freezeProgress(job.progress.ratio, "cancelled", cancellation.message),
        error: cancellation as JobError & { readonly code: "cancelled"; readonly retryable: true },
      }) as CancelledJobSnapshot);
    }
    case "job.timeout": {
      const timeoutError = freezeError("timeout", message ?? "Job timed out.", true);
      return applied(freezeJob({
        ...job,
        status: "timed-out",
        updatedAt: at,
        finishedAt: at,
        progress: freezeProgress(job.progress.ratio, "timed-out", timeoutError.message),
        error: timeoutError as JobError & { readonly code: "timeout"; readonly retryable: true },
      }) as TimedOutJobSnapshot);
    }
  }
}

export function isTerminalJob(job: JobSnapshot): job is TerminalJobSnapshot {
  return job.status !== "queued" && job.status !== "running";
}

export function isRetryableJob(job: JobSnapshot): job is Exclude<TerminalJobSnapshot, SucceededJobSnapshot> {
  return isTerminalJob(job) && job.status !== "succeeded" && job.error.retryable;
}

export function retryJob(source: JobSnapshot, input: RetryJobInput): JobRetryResult {
  assertJobSnapshot(source);
  const data = readDataRecord(input, "Job retry input");
  requireExactKeys(data, ["id", "requestId", "createdAt"], [], "Job retry input");
  const id = requireEntityId(data.id, "retry.id");
  const requestId = requireEntityId(data.requestId, "retry.requestId");
  const createdAt = requireCanonicalTimestamp(data.createdAt, "retry.createdAt");
  if (id === source.id || id === source.rootJobId || requestId === source.requestId) {
    throw new TypeError("A retry requires fresh job and request identities.");
  }
  if (!isTerminalJob(source) || source.status === "succeeded") {
    return Object.freeze({ outcome: "rejected-state", source, retry: null });
  }
  if (!source.error.retryable) {
    return Object.freeze({ outcome: "rejected-not-retryable", source, retry: null });
  }
  if (timestamp(createdAt) < timestamp(source.updatedAt)) {
    return Object.freeze({ outcome: "rejected-stale", source, retry: null });
  }
  if (!Number.isSafeInteger(source.attempt + 1)) throw new TypeError("Job retry attempt overflow.");
  const retry = freezeJob({
    id,
    requestId,
    kind: source.kind,
    label: source.label,
    status: "queued",
    attempt: source.attempt + 1,
    rootJobId: source.rootJobId,
    previousJobId: source.id,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    finishedAt: null,
    timeoutMs: source.timeoutMs,
    progress: freezeProgress(0, "queued", null),
    error: null,
  } satisfies QueuedJobSnapshot);
  assertJobRetryLineage(source, retry);
  return Object.freeze({ outcome: "created", source, retry });
}

/** Validates a queued retry against the terminal attempt it follows. */
export function assertJobRetryLineage(
  source: JobSnapshot,
  retry: JobSnapshot,
): asserts retry is QueuedJobSnapshot {
  assertJobSnapshot(source);
  assertJobSnapshot(retry);
  if (!isRetryableJob(source)) {
    throw new TypeError("Job retry source must be terminal and retryable.");
  }
  if (retry.status !== "queued") throw new TypeError("A retry must begin in queued state.");
  if (!Number.isSafeInteger(source.attempt + 1) || retry.attempt !== source.attempt + 1) {
    throw new TypeError("Job retry attempt must follow its source exactly.");
  }
  if (
    retry.previousJobId !== source.id || retry.rootJobId !== source.rootJobId ||
    retry.id === source.id || retry.id === source.rootJobId || retry.requestId === source.requestId
  ) {
    throw new TypeError("Job retry identity or lineage is inconsistent.");
  }
  if (
    retry.kind !== source.kind || retry.label !== source.label || retry.timeoutMs !== source.timeoutMs
  ) {
    throw new TypeError("Job retry must inherit kind, label and timeout policy.");
  }
  if (timestamp(retry.createdAt) < timestamp(source.updatedAt)) {
    throw new TypeError("Job retry cannot precede its source terminal.");
  }
}

function sameIdentity(previous: JobSnapshot, next: JobSnapshot): boolean {
  return previous.id === next.id &&
    previous.requestId === next.requestId &&
    previous.kind === next.kind &&
    previous.label === next.label &&
    previous.attempt === next.attempt &&
    previous.rootJobId === next.rootJobId &&
    previous.previousJobId === next.previousJobId &&
    previous.createdAt === next.createdAt &&
    previous.timeoutMs === next.timeoutMs;
}

/** Protects `job.replace` from bypassing the state-machine invariants. */
export function assertJobReplacement(previous: JobSnapshot, next: JobSnapshot): void {
  assertJobSnapshot(previous);
  assertJobSnapshot(next);
  if (!sameIdentity(previous, next)) throw new TypeError("Job identity is immutable.");
  if (timestamp(next.updatedAt) < timestamp(previous.updatedAt)) {
    throw new TypeError("Job replacement cannot move time backwards.");
  }
  if (next.progress.ratio < previous.progress.ratio) {
    throw new TypeError("Job replacement cannot regress progress.");
  }
  if (isTerminalJob(previous)) throw new TypeError("Terminal jobs are immutable.");
  if (previous.status === "queued") {
    if (
      next.status !== "running" && next.status !== "cancelled" && next.status !== "timed-out"
    ) {
      throw new TypeError("Queued job replacement is not a legal transition.");
    }
    return;
  }
  if (next.status === "queued") throw new TypeError("Running jobs cannot return to queued.");
  if (next.startedAt !== previous.startedAt) {
    throw new TypeError("Job start identity is immutable after running.");
  }
}
