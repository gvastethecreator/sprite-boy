import {
  PROJECT_RECORD_COLLECTIONS,
  isEntityId,
  type EntityId,
  type ProjectRecordCollection,
  type StudioProjectV1,
  type WorkspaceId,
} from "../project";
import { JOB_STATUSES, isTerminalJob, type JobStatus } from "../processing";
import type {
  DeepReadonly,
  InteractionState,
  JobStoreEntry,
  JobStoreState,
  PlaybackState,
  ProjectStoreState,
  WorkspacePreferenceValue,
  WorkspaceState,
  WorkspaceViewport,
} from "./contracts";

function requireKey(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function hasOwn(record: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export const selectProjectDocument = (
  state: DeepReadonly<ProjectStoreState>,
): DeepReadonly<StudioProjectV1> => state.project;

export const selectProjectRevision = (state: DeepReadonly<ProjectStoreState>): number =>
  state.revision;

export const selectProjectWorkspace = (state: DeepReadonly<ProjectStoreState>) =>
  state.project.workspace;

export const selectActiveWorkspace = (
  state: DeepReadonly<ProjectStoreState>,
): WorkspaceId | undefined => state.project.workspace.activeWorkspace;

type ProjectEntityFor<TCollection extends ProjectRecordCollection> =
  StudioProjectV1[TCollection] extends Record<EntityId, infer TEntity> ? TEntity : never;

export function createProjectEntitySelector<TCollection extends ProjectRecordCollection>(
  collection: TCollection,
  entityId: EntityId,
): (
  state: DeepReadonly<ProjectStoreState>,
) => DeepReadonly<ProjectEntityFor<TCollection>> | undefined {
  if (!PROJECT_RECORD_COLLECTIONS.includes(collection) || !isEntityId(entityId)) {
    throw new TypeError("Project entity selectors require a valid collection and EntityId.");
  }
  return (state) => {
    const records = state.project[collection] as Readonly<
      Record<EntityId, DeepReadonly<ProjectEntityFor<TCollection>>>
    >;
    return hasOwn(records, entityId) ? records[entityId] : undefined;
  };
}

export function createWorkspacePanelSizeSelector(
  panelId: string,
  fallback: number,
): (state: DeepReadonly<WorkspaceState>) => number {
  const key = requireKey(panelId, "panelId");
  if (!Number.isFinite(fallback) || Object.is(fallback, -0) || fallback < 0) {
    throw new TypeError("Workspace panel fallback must be a non-negative canonical number.");
  }
  return (state) => state.panelSizes[key] ?? fallback;
}

export function createWorkspaceViewportSelector(
  workspaceId: WorkspaceId,
): (state: DeepReadonly<WorkspaceState>) => DeepReadonly<WorkspaceViewport> | undefined {
  return (state) => state.viewports[workspaceId];
}

export function createWorkspacePreferenceSelector(
  preferenceKey: string,
): (
  state: DeepReadonly<WorkspaceState>,
) => DeepReadonly<WorkspacePreferenceValue> | undefined {
  const key = requireKey(preferenceKey, "preferenceKey");
  return (state) => state.preferences[key];
}

export const selectHoveredTarget = (state: DeepReadonly<InteractionState>) =>
  state.hoveredTarget;

export const selectDragSession = (state: DeepReadonly<InteractionState>) =>
  state.dragSession;

export const selectTransientSelection = (state: DeepReadonly<InteractionState>) =>
  state.transientSelection;

export const selectActiveModalId = (state: DeepReadonly<InteractionState>): string | null =>
  state.activeModalId;

export function createJobSelector(jobId: EntityId) {
  if (!isEntityId(jobId)) throw new TypeError("Job selectors require an EntityId.");
  return (state: DeepReadonly<JobStoreState>) =>
    hasOwn(state.jobs, jobId) ? state.jobs[jobId] : undefined;
}

export const selectJobOrder = (state: DeepReadonly<JobStoreState>) => state.order;

export type JobCenterEntry = DeepReadonly<JobStoreEntry>;

export interface JobCenterSummary {
  readonly total: number;
  readonly active: number;
  readonly terminal: number;
  readonly retryable: number;
  readonly byStatus: Readonly<Record<JobStatus, number>>;
}

function collectJobCenterEntries(
  state: DeepReadonly<JobStoreState>,
): readonly JobCenterEntry[] {
  const orderIndex = new Map(state.order.map((jobId, index) => [jobId, index]));
  const entries = state.order
    .map((jobId) => state.jobs[jobId])
    .filter((job): job is JobCenterEntry => job !== undefined);
  entries.sort((left, right) => {
    const leftTerminal = isTerminalJob(left);
    const rightTerminal = isTerminalJob(right);
    if (leftTerminal !== rightTerminal) return leftTerminal ? 1 : -1;
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
      (orderIndex.get(right.id) ?? 0) - (orderIndex.get(left.id) ?? 0) ||
      right.id.localeCompare(left.id);
  });
  return Object.freeze(entries);
}

export function createJobCenterEntriesSelector(): (
  state: DeepReadonly<JobStoreState>,
) => readonly JobCenterEntry[] {
  let previousJobs: DeepReadonly<JobStoreState>["jobs"] | null = null;
  let previousOrder: DeepReadonly<JobStoreState>["order"] | null = null;
  let previousResult: readonly JobCenterEntry[] = Object.freeze([]);
  return (state) => {
    if (state.jobs === previousJobs && state.order === previousOrder) return previousResult;
    previousJobs = state.jobs;
    previousOrder = state.order;
    previousResult = collectJobCenterEntries(state);
    return previousResult;
  };
}

export function createJobFamilySelector(rootJobId: EntityId): (
  state: DeepReadonly<JobStoreState>,
) => readonly JobCenterEntry[] {
  if (!isEntityId(rootJobId)) throw new TypeError("Job family selectors require an EntityId.");
  let previousJobs: DeepReadonly<JobStoreState>["jobs"] | null = null;
  let previousOrder: DeepReadonly<JobStoreState>["order"] | null = null;
  let previousResult: readonly JobCenterEntry[] = Object.freeze([]);
  return (state) => {
    if (state.jobs === previousJobs && state.order === previousOrder) return previousResult;
    previousJobs = state.jobs;
    previousOrder = state.order;
    previousResult = Object.freeze(state.order.flatMap((jobId) => {
      const job = state.jobs[jobId];
      return job?.rootJobId === rootJobId ? [job] : [];
    }));
    return previousResult;
  };
}

export function createJobCenterSummarySelector(): (
  state: DeepReadonly<JobStoreState>,
) => JobCenterSummary {
  let previousJobs: DeepReadonly<JobStoreState>["jobs"] | null = null;
  let previousOrder: DeepReadonly<JobStoreState>["order"] | null = null;
  let previousConsumedRetrySources: DeepReadonly<
    JobStoreState
  >["consumedRetrySourceIds"] | null = null;
  let previousResult: JobCenterSummary | null = null;
  return (state) => {
    if (
      previousResult && state.jobs === previousJobs && state.order === previousOrder &&
      state.consumedRetrySourceIds === previousConsumedRetrySources
    ) return previousResult;
    const byStatus = Object.fromEntries(JOB_STATUSES.map((status) => [status, 0])) as Record<
      JobStatus,
      number
    >;
    let active = 0;
    let retryable = 0;
    for (const jobId of state.order) {
      const job = state.jobs[jobId];
      if (!job) continue;
      byStatus[job.status] += 1;
      if (isTerminalJob(job)) {
        if (
          job.error?.retryable && !state.consumedRetrySourceIds.includes(job.id)
        ) retryable += 1;
      } else {
        active += 1;
      }
    }
    previousJobs = state.jobs;
    previousOrder = state.order;
    previousConsumedRetrySources = state.consumedRetrySourceIds;
    previousResult = Object.freeze({
      total: state.order.length,
      active,
      terminal: state.order.length - active,
      retryable,
      byStatus: Object.freeze(byStatus),
    });
    return previousResult;
  };
}

export const selectPlaybackSequenceId = (
  state: DeepReadonly<PlaybackState>,
): EntityId | null => state.sequenceId;

export const selectIsPlaying = (state: DeepReadonly<PlaybackState>): boolean => state.playing;

export const selectPlaybackCursorMs = (state: DeepReadonly<PlaybackState>): number =>
  state.cursorMs;
