import { describe, expect, it } from "vitest";
import { createWorkspaceStore } from "../../core/stores";
import { createCollisionRegionProjection } from "../../features/collision/collisionProjection";
import { studioProjectV1Fixture } from "../contract/fixtures/studioProjectV1";

describe("createCollisionRegionProjection", () => {
  it("projects the selected region instead of the selected animation cel", () => {
    const project = structuredClone(studioProjectV1Fixture);
    project.workspace.activeWorkspace = "collision";
    const projection = createCollisionRegionProjection(
      { project, revision: 3 },
      createWorkspaceStore().getSnapshot(),
      "region-hero",
    );

    expect(projection.workspaceId).toBe("collision");
    expect(projection.root).toMatchObject({
      kind: "region",
      regionId: "region-hero",
      width: 128,
      height: 128,
      source: { sourceRect: { x: 0, y: 0, width: 128, height: 128 } },
    });
    expect(projection.canvas).toEqual({ width: 128, height: 128, background: null });
  });
});
