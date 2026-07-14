import {
  PROJECT_RECORD_COLLECTIONS,
  isEntityId,
  type EntityId,
  type ProjectRecordCollection,
  type StudioProjectV1,
  type WorkspaceId,
} from "../project";
import type {
  DeepReadonly,
  InteractionState,
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

export const selectPlaybackSequenceId = (
  state: DeepReadonly<PlaybackState>,
): EntityId | null => state.sequenceId;

export const selectIsPlaying = (state: DeepReadonly<PlaybackState>): boolean => state.playing;

export const selectPlaybackCursorMs = (state: DeepReadonly<PlaybackState>): number =>
  state.cursorMs;
