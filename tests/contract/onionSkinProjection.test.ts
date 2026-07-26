import { describe, expect, it } from "vitest";
import { createWorkspaceStore } from "../../core/stores";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";
import {
  createOnionSkinProjection,
  resolveOnionSkinNeighbors,
} from "../../features/animate/onion/onionSkinProjection";

describe("onion skin projection", () => {
  it("resolves adjacent cels without wrapping", () => {
    const project = structuredClone(studioProjectV1Fixture);
    project.sequences["sequence-main"].celIds = ["cel-composition", "cel-variants"];
    expect(resolveOnionSkinNeighbors(project, "sequence-main", "cel-composition")).toEqual({
      previous: null,
      next: "cel-variants",
    });
    expect(resolveOnionSkinNeighbors(project, "sequence-main", "cel-variants")).toEqual({
      previous: "cel-composition",
      next: null,
    });
  });

  it("projects a neighbor cel without mutating durable selection", () => {
    const project = structuredClone(studioProjectV1Fixture);
    project.workspace.activeWorkspace = "compose";
    project.workspace.selectedSequenceId = "sequence-main";
    project.workspace.selectedCelIds = ["cel-composition"];
    const before = structuredClone(project.workspace);
    const projection = createOnionSkinProjection(
      { project, revision: 8 },
      createWorkspaceStore().getSnapshot(),
      "cel-variants",
    );
    expect(projection.workspaceId).toBe("animate");
    expect(projection.root).toMatchObject({ kind: "cel", celId: "cel-variants" });
    expect(project.workspace).toEqual(before);
  });

  it("fails closed for a missing cel", () => {
    expect(() => createOnionSkinProjection(
      { project: studioProjectV1Fixture, revision: 0 },
      createWorkspaceStore().getSnapshot(),
      "missing",
    )).toThrow("Onion skin cel is unavailable");
  });
});
