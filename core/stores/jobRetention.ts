import { isTerminalJob } from "../processing";
import type { EntityId } from "../project";
import type { DeepReadonly, JobStoreEntry, JobStoreState } from "./contracts";

export interface JobRetentionPolicy {
  /** Fully-terminal retry families kept visible in Job Center history. */
  readonly maxTerminalFamilies: number;
}

export const MIN_TERMINAL_JOB_FAMILIES = 1;
export const MAX_TERMINAL_JOB_FAMILIES = 1_000;

export const DEFAULT_JOB_RETENTION_POLICY: JobRetentionPolicy = Object.freeze({
  maxTerminalFamilies: 50,
});

interface TerminalFamily {
  readonly rootJobId: EntityId;
  readonly jobIds: readonly EntityId[];
  readonly latestUpdateMs: number;
  readonly latestOrderIndex: number;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizeJobRetentionPolicy(
  value: JobRetentionPolicy | undefined,
): JobRetentionPolicy {
  if (value === undefined) return DEFAULT_JOB_RETENTION_POLICY;
  if (!isPlainRecord(value) || Reflect.ownKeys(value).some((key) => key !== "maxTerminalFamilies")) {
    throw new TypeError("Job retention policy must contain only maxTerminalFamilies.");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "maxTerminalFamilies");
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError("Job retention maxTerminalFamilies must be an enumerable data field.");
  }
  const maximum = descriptor.value;
  if (
    !Number.isSafeInteger(maximum) || maximum < MIN_TERMINAL_JOB_FAMILIES ||
    maximum > MAX_TERMINAL_JOB_FAMILIES
  ) {
    throw new TypeError(
      `Job retention maxTerminalFamilies must be an integer from ${MIN_TERMINAL_JOB_FAMILIES} to ${MAX_TERMINAL_JOB_FAMILIES}.`,
    );
  }
  return Object.freeze({ maxTerminalFamilies: maximum });
}

function appendUnique(
  current: readonly EntityId[],
  additions: readonly EntityId[],
): readonly EntityId[] {
  const seen = new Set(current);
  const next = [...current];
  for (const id of additions) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return Object.freeze(next);
}

function collectTerminalFamilies(
  state: DeepReadonly<JobStoreState>,
): readonly TerminalFamily[] {
  const familyJobs = new Map<EntityId, EntityId[]>();
  const familyLatestUpdate = new Map<EntityId, number>();
  const familyLatestOrder = new Map<EntityId, number>();
  const activeFamilies = new Set<EntityId>();

  state.order.forEach((jobId, index) => {
    const job = state.jobs[jobId];
    if (!job) return;
    const family = familyJobs.get(job.rootJobId) ?? [];
    family.push(job.id);
    familyJobs.set(job.rootJobId, family);
    familyLatestUpdate.set(
      job.rootJobId,
      Math.max(familyLatestUpdate.get(job.rootJobId) ?? 0, Date.parse(job.updatedAt)),
    );
    familyLatestOrder.set(job.rootJobId, index);
    if (!isTerminalJob(job)) activeFamilies.add(job.rootJobId);
  });

  const terminalFamilies: TerminalFamily[] = [];
  for (const [rootJobId, jobIds] of familyJobs) {
    if (activeFamilies.has(rootJobId)) continue;
    terminalFamilies.push(Object.freeze({
      rootJobId,
      jobIds: Object.freeze(jobIds),
      latestUpdateMs: familyLatestUpdate.get(rootJobId) ?? 0,
      latestOrderIndex: familyLatestOrder.get(rootJobId) ?? 0,
    }));
  }
  return terminalFamilies;
}

/**
 * Removes only complete terminal retry families. Tombstones intentionally stay
 * unbounded for the JobStore session so a hidden job/request can never be reused.
 */
export function applyJobRetention(
  state: DeepReadonly<JobStoreState>,
  policy: JobRetentionPolicy,
): DeepReadonly<JobStoreState> {
  const terminalFamilies = [...collectTerminalFamilies(state)];
  const pruneCount = terminalFamilies.length - policy.maxTerminalFamilies;
  if (pruneCount <= 0) return state;

  terminalFamilies.sort((left, right) =>
    left.latestUpdateMs - right.latestUpdateMs ||
    left.latestOrderIndex - right.latestOrderIndex ||
    left.rootJobId.localeCompare(right.rootJobId)
  );
  const prunedIds = terminalFamilies
    .slice(0, pruneCount)
    .flatMap((family) => family.jobIds);
  const prunedSet = new Set(prunedIds);
  const prunedRequestIds: EntityId[] = [];
  const jobs = Object.create(null) as Record<EntityId, DeepReadonly<JobStoreEntry>>;
  for (const jobId of state.order) {
    const job = state.jobs[jobId];
    if (!job) continue;
    if (prunedSet.has(jobId)) {
      prunedRequestIds.push(job.requestId);
      continue;
    }
    jobs[jobId] = job;
  }

  return Object.freeze({
    ...state,
    jobs: Object.freeze(jobs),
    order: Object.freeze(state.order.filter((jobId) => !prunedSet.has(jobId))),
    retiredRequestIds: appendUnique(state.retiredRequestIds, prunedRequestIds),
    retiredJobIds: appendUnique(state.retiredJobIds, prunedIds),
  });
}
