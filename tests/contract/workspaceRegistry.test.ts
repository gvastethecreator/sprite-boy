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
  parseStudioWorkspaceHref,
  resolveStudioWorkspaceId,
} from "../../core/studio";

describe("Studio workspace registry", () => {
  it("partitions every canonical context into five destinations plus Assets support", () => {
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

  it("publishes one immutable, ordered definition for every destination", () => {
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

  it("keeps labels, hrefs and navigation command IDs unique and derivable", () => {
    expect(new Set(STUDIO_WORKSPACES.map(({ label }) => label)).size).toBe(5);
    expect(new Set(STUDIO_WORKSPACES.map(({ href }) => href)).size).toBe(5);
    expect(new Set(STUDIO_WORKSPACES.map(({ commandId }) => commandId)).size).toBe(5);

    for (const workspace of STUDIO_WORKSPACES) {
      expect(workspace.href).toBe(`#/studio/${workspace.id}`);
      expect(workspace.commandId).toBe(`workspace.open.${workspace.id}`);
      expect(parseStudioWorkspaceHref(workspace.href)).toBe(workspace.id);
    }
  });

  it("rejects aliases and keeps support contexts out of primary routing", () => {
    expect(parseStudioWorkspaceHref("#/studio/assets")).toBeNull();
    expect(parseStudioWorkspaceHref("#/studio/slice/")).toBeNull();
    expect(parseStudioWorkspaceHref("#/studio/slice?panel=assets")).toBeNull();
    expect(parseStudioWorkspaceHref("slice")).toBeNull();
    expect(parseStudioWorkspaceHref(null)).toBeNull();
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
