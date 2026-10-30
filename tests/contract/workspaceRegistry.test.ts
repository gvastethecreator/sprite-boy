import { describe, expect, it } from "vitest";
import { WORKSPACE_IDS } from "../../core/project";
import {
  STUDIO_SUPPORT_CONTEXT_IDS,
  STUDIO_WORKSPACE_IDS,
  STUDIO_WORKSPACE_PARTITION,
  STUDIO_WORKSPACE_REGISTRY,
  STUDIO_WORKSPACES,
  getStudioWorkspace,
  isStudioWorkspaceId,
  resolveStudioWorkspaceId,
} from "../../core/studio";

describe("Studio workspace registry", () => {
  it("partitions every canonical context into five mounted editors plus Assets support", () => {
    expect(STUDIO_WORKSPACE_IDS).toEqual([
      "slice",
      "compose",
      "animate",
      "collision",
      "export",
    ]);
    expect(STUDIO_SUPPORT_CONTEXT_IDS).toEqual(["assets"]);
    expect(new Set([
      ...STUDIO_WORKSPACE_PARTITION.primary,
      ...STUDIO_WORKSPACE_PARTITION.support,
    ])).toEqual(new Set(WORKSPACE_IDS));
    expect(STUDIO_WORKSPACE_IDS).not.toContain("assets");
  });

  it("publishes one immutable, ordered definition for every editor", () => {
    expect(Object.keys(STUDIO_WORKSPACE_REGISTRY)).toEqual(STUDIO_WORKSPACE_IDS);
    expect(STUDIO_WORKSPACES.map(({ id }) => id)).toEqual(STUDIO_WORKSPACE_IDS);
    expect(STUDIO_WORKSPACES.map(({ order }) => order)).toEqual([0, 1, 2, 3, 4]);

    expect(Object.isFrozen(STUDIO_WORKSPACE_REGISTRY)).toBe(true);
    expect(Object.isFrozen(STUDIO_WORKSPACES)).toBe(true);
    for (const workspace of STUDIO_WORKSPACES) {
      expect(Object.isFrozen(workspace)).toBe(true);
      expect(Object.isFrozen(workspace.capabilities)).toBe(true);
      expect(getStudioWorkspace(workspace.id)).toBe(workspace);
    }
  });

  it("keeps labels unique and gives editors no route of their own", () => {
    expect(new Set(STUDIO_WORKSPACES.map(({ label }) => label)).size).toBe(5);
    for (const workspace of STUDIO_WORKSPACES) {
      expect(workspace).not.toHaveProperty("href");
      expect(workspace).not.toHaveProperty("commandId");
    }
  });

  it("keeps support contexts out of the mounted editors", () => {
    expect(isStudioWorkspaceId("assets")).toBe(false);
    expect(isStudioWorkspaceId("collision")).toBe(true);
  });

  it("freezes the renderer and interaction capability matrix", () => {
    expect(STUDIO_WORKSPACES.map(({ id, capabilities }) => ({ id, ...capabilities }))).toEqual([
      { id: "slice", renderSource: "asset-or-region", interaction: "edit", timeline: "hidden" },
      { id: "compose", renderSource: "composition", interaction: "edit", timeline: "hidden" },
      { id: "animate", renderSource: "timeline", interaction: "edit", timeline: "editable" },
      { id: "collision", renderSource: "timeline", interaction: "edit", timeline: "hidden" },
      { id: "export", renderSource: "timeline", interaction: "preview", timeline: "read-only" },
    ]);
  });

  it("resolves absent and Assets project context to a visible fallback", () => {
    expect(resolveStudioWorkspaceId("compose")).toBe("compose");
    expect(resolveStudioWorkspaceId("assets")).toBe("slice");
    expect(resolveStudioWorkspaceId(undefined)).toBe("slice");
    expect(resolveStudioWorkspaceId("future-workspace", "collision")).toBe("collision");
  });
});
