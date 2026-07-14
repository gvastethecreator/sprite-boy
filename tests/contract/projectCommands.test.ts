import { describe, expect, it } from "vitest";
import {
  PROJECT_COMMAND_TYPES,
  advanceProjectSnapshot,
  cloneStudioProject,
  createEmptyImpact,
  createProjectSnapshot,
  getProjectCommandFamily,
  getProjectEntity,
  hasProjectEntity,
  insertOrderedId,
  moveOrderedId,
  removeOrderedId,
  type ProjectCommand,
  type ProjectCommandEnvelope,
} from "../../core/project";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

describe("ProjectCommand contract", () => {
  it("publishes a unique, namespaced command registry", () => {
    expect(PROJECT_COMMAND_TYPES).toHaveLength(new Set(PROJECT_COMMAND_TYPES).size);
    expect(PROJECT_COMMAND_TYPES.every((type) => /^[a-z][A-Za-z]*\.[A-Za-z]+$/.test(type))).toBe(
      true,
    );
    expect(PROJECT_COMMAND_TYPES).toContain("project.rename");
    expect(PROJECT_COMMAND_TYPES).toContain("regions.commitRecipe");
    expect(PROJECT_COMMAND_TYPES).toContain("processingRecipe.remove");
    expect(PROJECT_COMMAND_TYPES).toContain("artifact.record");
    expect(PROJECT_COMMAND_TYPES).toContain("cel.replaceSource");
    expect(PROJECT_COMMAND_TYPES).toContain("workspace.update");
  });

  it("derives the family without accepting job-only operations", () => {
    const command: ProjectCommand = {
      type: "asset.rename",
      assetId: "asset-sheet",
      name: "renamed.png",
      updatedAt: "2026-01-01T00:02:00.000Z",
    };

    expect(getProjectCommandFamily(command)).toBe("asset");
    expect(PROJECT_COMMAND_TYPES.some((type) => type.startsWith("export."))).toBe(false);
    expect(PROJECT_COMMAND_TYPES.some((type) => type === "generation.cancel" as never)).toBe(false);
  });

  it("keeps dispatch metadata outside the durable command payload", () => {
    const envelope: ProjectCommandEnvelope = {
      command: {
        type: "project.rename",
        name: "Renamed project",
        updatedAt: "2026-01-01T00:02:00.000Z",
      },
      metadata: {
        commandId: "command-1",
        origin: "user",
        history: "coalesce",
        transactionId: "drag-1",
      },
    };

    expect(envelope.command).not.toHaveProperty("history");
    expect(envelope.metadata).toMatchObject({ origin: "user", history: "coalesce" });
  });

  it("creates independent empty impact values", () => {
    const first = createEmptyImpact();
    const second = createEmptyImpact();
    first.direct.push({ collection: "assets", id: "asset-sheet" });

    expect(second.direct).toEqual([]);
    expect(first.blockers).not.toBe(second.blockers);
  });
});

describe("canonical graph helpers", () => {
  it("looks up entities by collection without index semantics", () => {
    expect(hasProjectEntity(studioProjectV1Fixture, "regions", "region-hero")).toBe(true);
    expect(hasProjectEntity(studioProjectV1Fixture, "regions", "0")).toBe(false);
    expect(getProjectEntity(studioProjectV1Fixture, "assets", "asset-sheet")).toMatchObject({
      id: "asset-sheet",
      name: "hero-sheet.png",
    });
  });

  it("deep-clones the JSON-safe graph without mutating its source", () => {
    const cloned = cloneStudioProject(studioProjectV1Fixture);
    cloned.assets["asset-sheet"].name = "changed.png";
    cloned.rootOrder.assetIds.reverse();

    expect(studioProjectV1Fixture.assets["asset-sheet"].name).toBe("hero-sheet.png");
    expect(studioProjectV1Fixture.rootOrder.assetIds).toEqual(["asset-sheet", "asset-processed"]);
  });

  it("tracks revision outside the durable project", () => {
    const first = createProjectSnapshot(studioProjectV1Fixture);
    const cloned = cloneStudioProject(studioProjectV1Fixture);
    const second = advanceProjectSnapshot(first, cloned);

    expect(first).toMatchObject({ project: studioProjectV1Fixture, revision: 0 });
    expect(second).toMatchObject({ project: cloned, revision: 1 });
    expect(studioProjectV1Fixture).not.toHaveProperty("revision");
    expect(() => createProjectSnapshot(studioProjectV1Fixture, -1)).toThrow(RangeError);
  });

  it("inserts, removes and moves ordered IDs immutably", () => {
    const initial = ["a", "b", "c"];

    expect(insertOrderedId(initial, "x", 1)).toEqual(["a", "x", "b", "c"]);
    expect(removeOrderedId(initial, "b")).toEqual(["a", "c"]);
    expect(moveOrderedId(initial, "a", 2)).toEqual(["b", "c", "a"]);
    expect(initial).toEqual(["a", "b", "c"]);
  });

  it("rejects duplicate, missing and out-of-range order operations", () => {
    expect(() => insertOrderedId(["a"], "")).toThrow(TypeError);
    expect(() => insertOrderedId(["a"], "a")).toThrow();
    expect(() => insertOrderedId(["a"], "b", 2)).toThrow(RangeError);
    expect(() => removeOrderedId(["a"], "b")).toThrow();
    expect(() => moveOrderedId(["a"], "a", 1)).toThrow(RangeError);
  });
});
