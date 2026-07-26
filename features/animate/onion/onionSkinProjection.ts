import type { EntityId, StudioProject } from "../../../core/project";
import { createSceneProjection, type SceneProjection } from "../../../core/render";
import type {
  DeepReadonly,
  ProjectStoreState,
  WorkspaceState,
} from "../../../core/stores";

export interface OnionSkinNeighbors {
  readonly previous: EntityId | null;
  readonly next: EntityId | null;
}

export function resolveOnionSkinNeighbors(
  project: DeepReadonly<StudioProject>,
  sequenceId: EntityId,
  celId: EntityId,
): OnionSkinNeighbors {
  const sequence = project.sequences[sequenceId];
  if (!sequence) return Object.freeze({ previous: null, next: null });
  const index = sequence.celIds.indexOf(celId);
  if (index < 0) return Object.freeze({ previous: null, next: null });
  const previous = index > 0 && project.cels[sequence.celIds[index - 1]]
    ? sequence.celIds[index - 1]
    : null;
  const next = index + 1 < sequence.celIds.length && project.cels[sequence.celIds[index + 1]]
    ? sequence.celIds[index + 1]
    : null;
  return Object.freeze({ previous, next });
}

export function createOnionSkinProjection(
  state: DeepReadonly<ProjectStoreState>,
  workspace: DeepReadonly<WorkspaceState>,
  celId: EntityId,
): SceneProjection {
  const cel = state.project.cels[celId];
  const sequence = cel ? state.project.sequences[cel.sequenceId] : undefined;
  if (!cel || !sequence || !sequence.celIds.includes(celId)) {
    throw new TypeError("Onion skin cel is unavailable.");
  }
  const projectedProject: StudioProject = {
    ...state.project,
    workspace: {
      ...state.project.workspace,
      activeWorkspace: "animate",
      selectedSequenceId: cel.sequenceId,
      selectedCelIds: [celId],
    },
  } as StudioProject;
  return createSceneProjection({
    project: projectedProject,
    revision: state.revision,
  }, workspace);
}
