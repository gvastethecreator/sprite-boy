import { describe, expect, it } from "vitest";
import {
  resolveStudioWorkspaceState,
  STUDIO_WORKSPACE_IDS,
  type ResolveStudioWorkspaceStateInput,
  type StudioWorkspaceAvailability,
  type StudioWorkspaceId,
} from "../../core/studio";

const emptyAvailability: StudioWorkspaceAvailability = {
  sourceAvailable: false,
  compositionAvailable: false,
  frameCount: 0,
  animationCount: 0,
};

function resolve(
  workspaceId: StudioWorkspaceId,
  availability: Partial<StudioWorkspaceAvailability> = {},
  overrides: Partial<ResolveStudioWorkspaceStateInput> = {},
) {
  return resolveStudioWorkspaceState({
    workspaceId,
    availability: { ...emptyAvailability, ...availability },
    ...overrides,
  });
}

describe("resolveStudioWorkspaceState", () => {
  it("returns distinct actionable empty states for every primary workspace", () => {
    const states = STUDIO_WORKSPACE_IDS.map((workspaceId) => resolve(workspaceId));

    expect(states.map((state) => [state.workspaceId, state.kind, state.kind === "empty" ? state.title : null])).toEqual([
      ["slice", "empty", "Bring in a spritesheet"],
      ["compose", "empty", "Start a composition"],
      ["animate", "empty", "Add artwork before animating"],
      ["collision", "empty", "Create frames before hitboxes"],
      ["export", "empty", "Build something to export"],
    ]);
    for (const state of states) {
      expect(state.kind).toBe("empty");
      if (state.kind !== "empty") continue;
      expect(state.primaryAction.commandId).toMatch(/^(asset\.import|workspace\.open\.slice)$/);
      expect(Object.isFrozen(state)).toBe(true);
      expect(Object.isFrozen(state.primaryAction)).toBe(true);
    }
  });

  it.each([
    ["slice", { sourceAvailable: true }],
    ["compose", { compositionAvailable: true }],
    ["animate", { sourceAvailable: true }],
    ["animate", { compositionAvailable: true, animationCount: 0 }],
    ["collision", { frameCount: 1 }],
    ["export", { sourceAvailable: true }],
    ["export", { compositionAvailable: true }],
  ] as const)("marks %s ready only from its required input", (workspaceId, availability) => {
    expect(resolve(workspaceId, availability)).toMatchObject({ kind: "ready", workspaceId });
  });

  it("does not treat the wrong source or hostile counts as Collision readiness", () => {
    expect(resolve("collision", { compositionAvailable: true, frameCount: -1 })).toMatchObject({ kind: "empty" });
    expect(resolve("collision", { frameCount: 1.5 })).toMatchObject({ kind: "empty" });
    expect(resolve("collision", { frameCount: Number.POSITIVE_INFINITY })).toMatchObject({ kind: "empty" });
  });

  it("gives active loading precedence and normalizes its message", () => {
    const state = resolve("export", { sourceAvailable: true }, {
      loading: true,
      loadingMessage: "  Encoding preview  ",
      failure: { message: "stale failure", retryCommandId: "project.save" },
    });
    expect(state).toEqual({
      kind: "loading",
      workspaceId: "export",
      workspaceLabel: "Export",
      title: "Preparing Export",
      description: "Encoding preview",
    });
    expect(Object.isFrozen(state)).toBe(true);
  });

  it("returns a stable retryable error ahead of empty or ready presentation", () => {
    const state = resolve("compose", { compositionAvailable: true }, {
      failure: { message: "  Writer unavailable  ", retryCommandId: "project.save" },
    });
    expect(state).toEqual({
      kind: "error",
      workspaceId: "compose",
      workspaceLabel: "Compose",
      title: "Compose could not finish",
      description: "Writer unavailable",
      retryCommandId: "project.save",
    });
    expect(Object.isFrozen(state)).toBe(true);
  });
});
