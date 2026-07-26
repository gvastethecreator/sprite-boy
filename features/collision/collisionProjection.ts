import type { EntityId } from "../../core/project";
import { createSceneProjection, type SceneProjection } from "../../core/render";
import type {
  DeepReadonly,
  ProjectStoreState,
  WorkspaceState,
  WorkspaceViewport,
} from "../../core/stores";

const DEFAULT_VIEWPORT: WorkspaceViewport = Object.freeze({
  scale: 1,
  offset: Object.freeze({ x: 0, y: 0 }),
});

/** Projects the selected region even when Collision also has a selected timeline cel. */
export function createCollisionRegionProjection(
  state: DeepReadonly<ProjectStoreState>,
  workspace: DeepReadonly<WorkspaceState>,
  regionId: EntityId,
): SceneProjection {
  const viewport = workspace.viewports.collision ?? DEFAULT_VIEWPORT;
  const regionState = {
    revision: state.revision,
    project: {
      ...state.project,
      workspace: {
        ...state.project.workspace,
        activeWorkspace: "slice",
        selectedRegionId: regionId,
      },
    },
  } as unknown as ProjectStoreState;
  const regionWorkspace = {
    ...workspace,
    viewports: { ...workspace.viewports, slice: viewport },
  } as WorkspaceState;
  const projection = createSceneProjection(regionState, regionWorkspace);
  return Object.freeze({
    ...projection,
    workspaceId: "collision",
    viewport: Object.freeze({
      scale: viewport.scale,
      offset: Object.freeze({ x: viewport.offset.x, y: viewport.offset.y }),
    }),
  });
}
