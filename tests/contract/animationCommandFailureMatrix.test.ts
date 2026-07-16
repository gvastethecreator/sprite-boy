import { describe, expect, it } from "vitest";
import { applyAnimationFamilyCommand } from "../../core/project/applyAnimationCommands";
import type {
  ProjectCommand,
  ProjectCommandContext,
  ProjectCommandResult,
} from "../../core/project/commands";
import { cloneStudioProject } from "../../core/project/graph";
import type { Cel, CollisionSet, Sequence, StudioProjectV1 } from "../../core/project/schema";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const NOW = "2026-01-01T00:20:00.000Z";
const context: ProjectCommandContext = {
  nextId: () => "generated-id",
  now: () => NOW,
};

function asCommand(value: unknown): ProjectCommand {
  return value as ProjectCommand;
}

function failure(
  command: unknown,
  project: StudioProjectV1 = studioProjectV1Fixture,
  commandContext: ProjectCommandContext = context,
): Extract<ProjectCommandResult, { ok: false }> {
  const result = applyAnimationFamilyCommand(project, asCommand(command), commandContext);
  expect(result).toBeDefined();
  expect(result?.ok).toBe(false);
  return result as Extract<ProjectCommandResult, { ok: false }>;
}

function sequence(id: string): Sequence {
  return {
    id,
    name: id,
    celIds: [],
    fps: 12,
    loop: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function cel(id: string): Cel {
  return {
    id,
    sequenceId: "sequence-main",
    source: { type: "region", regionId: "region-hero" },
    durationMs: 100,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("animation command hostile and failure matrix", () => {
  it("rejects malformed sequence create and update payloads atomically", () => {
    for (const command of [
      { type: "sequence.create", sequence: null },
      { type: "sequence.create", sequence: { ...sequence(""), id: "" } },
      { type: "sequence.create", sequence: sequence("sequence-main") },
      { type: "sequence.create", sequence: { ...sequence("bad-order"), celIds: null } },
      { type: "sequence.create", sequence: { ...sequence("non-empty"), celIds: ["cel-composition"] } },
      { type: "sequence.create", sequence: sequence("bad-index"), atIndex: 99 },
      { type: "sequence.update", sequenceId: "", patch: {} },
      { type: "sequence.update", sequenceId: "missing", patch: {} },
      { type: "sequence.update", sequenceId: "sequence-main", patch: null },
      { type: "sequence.update", sequenceId: "sequence-main", patch: { name: undefined } },
    ]) {
      expect(failure(command).project).toBe(studioProjectV1Fixture);
    }

    const symbolPatch = { name: "ignored" };
    Reflect.defineProperty(symbolPatch, Symbol("runtime"), { enumerable: true, value: true });
    expect(
      failure({ type: "sequence.update", sequenceId: "sequence-main", patch: symbolPatch })
        .diagnostics[0].code,
    ).toBe("INVALID_PATCH");

    const invalidProject = cloneStudioProject(studioProjectV1Fixture);
    invalidProject.id = "";
    expect(failure(
      { type: "sequence.create", sequence: sequence("candidate-failure") },
      invalidProject,
    ).diagnostics[0].code).toBe("INVARIANT_VIOLATION");
  });

  it("rejects malformed cel additions and exercises all source discriminants", () => {
    for (const command of [
      { type: "cel.add", sequenceId: "", cel: cel("new") },
      { type: "cel.add", sequenceId: "missing", cel: cel("new") },
      { type: "cel.add", sequenceId: "sequence-main", cel: null },
      { type: "cel.add", sequenceId: "sequence-main", cel: { ...cel(""), id: "" } },
      { type: "cel.add", sequenceId: "sequence-main", cel: cel("cel-composition") },
      { type: "cel.add", sequenceId: "sequence-main", cel: cel("wrong"), atIndex: 99 },
      { type: "cel.add", sequenceId: "sequence-main", cel: { ...cel("wrong-sequence"), sequenceId: "missing" } },
      { type: "cel.add", sequenceId: "sequence-main", cel: { ...cel("no-source"), source: null } },
      { type: "cel.add", sequenceId: "sequence-main", cel: { ...cel("bad-source"), source: { type: "runtime" } } },
      { type: "cel.add", sequenceId: "sequence-main", cel: { ...cel("bad-source-id"), source: { type: "region", regionId: "" } } },
      { type: "cel.add", sequenceId: "sequence-main", cel: { ...cel("composition-source"), source: { type: "composition", compositionId: "composition-project" } } },
      { type: "cel.add", sequenceId: "sequence-main", cel: { ...cel("variant-source"), source: { type: "variantSet", variantSetId: "variant-set-main" } } },
    ]) {
      expect(failure(command).project).toBe(studioProjectV1Fixture);
    }

    for (const field of ["ownedComposition", "ownedVariantSet", "ownedVariantCompositions"] as const) {
      expect(failure({
        type: "cel.add",
        sequenceId: "sequence-main",
        cel: cel(`owned-${field}`),
        [field]: {},
      }).diagnostics[0].code).toBe("PRECONDITION_FAILED");
    }
  });

  it("rejects invalid cel update, reorder and duplicate preconditions", () => {
    for (const command of [
      { type: "cel.update", celId: "", patch: {} },
      { type: "cel.update", celId: "missing", patch: {} },
      { type: "cel.update", celId: "cel-composition", patch: null },
      { type: "cel.reorder", celId: "", toIndex: 0 },
      { type: "cel.reorder", celId: "missing", toIndex: 0 },
      { type: "cel.duplicate", celId: "" },
      { type: "cel.duplicate", celId: "missing" },
      { type: "cel.duplicate", celId: "cel-composition", atIndex: 99 },
    ]) {
      failure(command);
    }

    const noChange = applyAnimationFamilyCommand(
      studioProjectV1Fixture,
      { type: "cel.update", celId: "cel-composition", patch: { durationMs: 100 } },
      context,
    );
    expect(noChange?.ok).toBe(true);
    if (noChange?.ok) expect(noChange.project).toBe(studioProjectV1Fixture);

    const changed = applyAnimationFamilyCommand(
      studioProjectV1Fixture,
      { type: "cel.update", celId: "cel-composition", patch: { durationMs: 140 } },
      context,
    );
    expect(changed?.ok).toBe(true);
    if (changed?.ok) expect(changed.project.cels["cel-composition"].updatedAt).toBe(NOW);

    const missingSequence = cloneStudioProject(studioProjectV1Fixture);
    missingSequence.cels["cel-composition"].sequenceId = "missing";
    expect(failure(
      { type: "cel.reorder", celId: "cel-composition", toIndex: 0 },
      missingSequence,
    ).diagnostics[0].code).toBe("ENTITY_NOT_FOUND");
    expect(failure(
      { type: "cel.duplicate", celId: "cel-composition" },
      missingSequence,
    ).diagnostics[0].code).toBe("ENTITY_NOT_FOUND");

    const missingOrder = cloneStudioProject(studioProjectV1Fixture);
    missingOrder.sequences["sequence-main"].celIds = ["cel-variants"];
    expect(failure(
      { type: "cel.reorder", celId: "cel-composition", toIndex: 0 },
      missingOrder,
    ).diagnostics[0].code).toBe("INVARIANT_VIOLATION");
    expect(failure(
      { type: "cel.duplicate", celId: "cel-composition" },
      missingOrder,
    ).diagnostics[0].code).toBe("INVARIANT_VIOLATION");
  });

  it("rejects invalid generated IDs at each duplicate graph boundary", () => {
    const invalidId: ProjectCommandContext = { nextId: () => "", now: () => NOW };
    expect(failure(
      { type: "cel.duplicate", celId: "cel-composition" },
      studioProjectV1Fixture,
      invalidId,
    ).diagnostics[0].code).toBe("INVALID_PATCH");

    const duplicateId: ProjectCommandContext = {
      nextId: () => "cel-composition",
      now: () => NOW,
    };
    expect(failure(
      { type: "cel.duplicate", celId: "cel-composition" },
      studioProjectV1Fixture,
      duplicateId,
    ).diagnostics[0].code).toBe("ENTITY_ALREADY_EXISTS");

    for (const ids of [
      ["new-cel", ""],
      ["new-cel", "new-composition", ""],
      ["new-cel", "new-variant", ""],
    ]) {
      let index = 0;
      const queued: ProjectCommandContext = {
        nextId: () => ids[index++] ?? `unused-${index}`,
        now: () => NOW,
      };
      const celId = ids[1] === "new-variant" ? "cel-variants" : "cel-composition";
      expect(failure(
        { type: "cel.duplicate", celId },
        studioProjectV1Fixture,
        queued,
      ).diagnostics[0].code).toBe("INVALID_PATCH");
    }
  });

  it("rejects malformed collision set owners and shape operations", () => {
    const base: CollisionSet = {
      id: "collision-new",
      owner: { type: "region", regionId: "region-hero" },
      shapes: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
    const noRegionCollision = cloneStudioProject(studioProjectV1Fixture);
    delete noRegionCollision.collisionSets["collision-region"];
    const validRegion = applyAnimationFamilyCommand(
      noRegionCollision,
      { type: "collisionSet.create", collisionSet: base },
      context,
    );
    expect(validRegion?.ok).toBe(true);

    for (const collisionSet of [
      null,
      { ...base, id: "" },
      { ...base, id: "collision-region" },
      { ...base, id: "owner-null", owner: null },
      { ...base, id: "owner-type", owner: { type: "runtime" } },
      { ...base, id: "owner-id", owner: { type: "region", regionId: "" } },
      { ...base, id: "owner-missing", owner: { type: "composition", compositionId: "missing" } },
      { ...base, id: "shapes", shapes: null },
    ]) {
      failure({ type: "collisionSet.create", collisionSet });
    }

    for (const command of [
      { type: "collision.add", collisionSetId: "", shape: {} },
      { type: "collision.add", collisionSetId: "missing", shape: {} },
      { type: "collision.add", collisionSetId: "collision-region", shape: null },
      { type: "collision.add", collisionSetId: "collision-region", shape: { id: "" } },
      { type: "collision.add", collisionSetId: "collision-region", shape: studioProjectV1Fixture.collisionSets["collision-region"].shapes[0] },
      { type: "collision.add", collisionSetId: "collision-region", shape: { id: "new", type: "hitbox", bounds: { x: 0, y: 0, width: 1, height: 1 } }, atIndex: 99 },
      { type: "collision.update", collisionSetId: "missing", shapeId: "shape" , patch: {} },
      { type: "collision.update", collisionSetId: "collision-region", shapeId: "", patch: {} },
      { type: "collision.update", collisionSetId: "collision-region", shapeId: "missing", patch: {} },
      { type: "collision.update", collisionSetId: "collision-region", shapeId: "shape-hero-hurtbox", patch: null },
      { type: "collision.remove", collisionSetId: "missing", shapeId: "shape" },
      { type: "collision.remove", collisionSetId: "collision-region", shapeId: "" },
      { type: "collision.remove", collisionSetId: "collision-region", shapeId: "missing" },
    ]) {
      failure(command);
    }

    const noChange = applyAnimationFamilyCommand(
      studioProjectV1Fixture,
      {
        type: "collision.update",
        collisionSetId: "collision-region",
        shapeId: "shape-hero-hurtbox",
        patch: { type: "hurtbox" },
      },
      context,
    );
    expect(noChange?.ok).toBe(true);
    if (noChange?.ok) expect(noChange.project).toBe(studioProjectV1Fixture);
  });

  it("contains commands with missing or non-string discriminants", () => {
    for (const command of [{}, { type: 42 }]) {
      expect(failure(command).diagnostics[0].code).toBe("INVALID_PATCH");
    }
  });
});
