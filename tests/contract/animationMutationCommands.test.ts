import { describe, expect, it } from "vitest";
import { applyAnimationFamilyCommand } from "../../core/project/applyAnimationCommands";
import { applyProjectCommand } from "../../core/project/applyCommand";
import type {
  ProjectCommand,
  ProjectCommandContext,
  ProjectCommandResult,
} from "../../core/project/commands";
import { cloneStudioProject } from "../../core/project/graph";
import type { Cel, CollisionSet, CollisionShape, Sequence } from "../../core/project/schema";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const NOW = "2026-01-01T00:10:00.000Z";
const UPDATED_AT = "2026-01-01T00:11:00.000Z";
const context: ProjectCommandContext = {
  nextId: () => "unused-id",
  now: () => NOW,
};

function ok(result: ProjectCommandResult | undefined) {
  if (!result || !result.ok) {
    throw new Error(result?.diagnostics.map(({ message }) => message).join("; ") ?? "Unhandled command");
  }
  return result;
}

function semanticInverse(result: Extract<ProjectCommandResult, { ok: true }>) {
  return result.inverse.type === "project.restoreSnapshot"
    ? result.inverse.semantic
    : result.inverse;
}

function sequence(id: string): Sequence {
  return {
    id,
    name: `${id} sequence`,
    celIds: [],
    fps: 12,
    defaultDurationMs: 100,
    loop: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function cel(id: string, sequenceId = "sequence-main"): Cel {
  return {
    id,
    sequenceId,
    source: { type: "region", regionId: "region-hero" },
    durationMs: 100,
    pivot: { x: 64, y: 112 },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function shape(id: string): CollisionShape {
  return {
    id,
    type: "hitbox",
    bounds: { x: 2, y: 3, width: 10, height: 12 },
    tag: "attack",
  };
}

describe("applyAnimationFamilyCommand (F1-05)", () => {
  it("creates and patches an empty sequence with stable root order and inverse shapes", () => {
    const created = ok(
      applyAnimationFamilyCommand(
        studioProjectV1Fixture,
        { type: "sequence.create", sequence: sequence("sequence-new"), atIndex: 0 },
        context,
      ),
    );
    expect(created.project.rootOrder.sequenceIds).toEqual(["sequence-new", "sequence-main"]);
    expect(created.changedIds).toEqual({ sequences: ["sequence-new"], rootOrder: ["sequence-new"] });
    expect(semanticInverse(created)).toEqual({ type: "sequence.remove", sequenceId: "sequence-new", policy: "reject" });
    expect(studioProjectV1Fixture.sequences).not.toHaveProperty("sequence-new");

    const updated = ok(
      applyAnimationFamilyCommand(
        created.project,
        {
          type: "sequence.update",
          sequenceId: "sequence-new",
          patch: { name: "Updated", defaultDurationMs: undefined, updatedAt: UPDATED_AT },
        },
        context,
      ),
    );
    expect(updated.project.sequences["sequence-new"].name).toBe("Updated");
    expect(updated.project.sequences["sequence-new"]).not.toHaveProperty("defaultDurationMs");
    expect(semanticInverse(updated)).toEqual({
      type: "sequence.update",
      sequenceId: "sequence-new",
      patch: { name: "sequence-new sequence", defaultDurationMs: 100, updatedAt: NOW },
    });
  });

  it("adds, patches and reorders cels inside their owning sequence without mutating input", () => {
    const project = cloneStudioProject(studioProjectV1Fixture);
    const addedCel = cel("cel-new");
    const added = ok(
      applyAnimationFamilyCommand(
        project,
        { type: "cel.add", sequenceId: "sequence-main", cel: addedCel, atIndex: 1 },
        context,
      ),
    );
    expect(added.project.sequences["sequence-main"].celIds).toEqual([
      "cel-composition",
      "cel-new",
      "cel-variants",
    ]);
    expect(added.changedIds).toEqual({ cels: ["cel-new"], sequences: ["sequence-main"] });
    expect(semanticInverse(added)).toEqual({ type: "cel.remove", celId: "cel-new", policy: "reject" });
    expect(project.sequences["sequence-main"].celIds).toEqual(["cel-composition", "cel-variants"]);

    const updated = ok(
      applyAnimationFamilyCommand(
        added.project,
        { type: "cel.update", celId: "cel-new", patch: { pivot: undefined, prompt: "walk", updatedAt: UPDATED_AT } },
        context,
      ),
    );
    expect(updated.project.cels["cel-new"]).not.toHaveProperty("pivot");
    expect(updated.project.cels["cel-new"].prompt).toBe("walk");

    const reordered = ok(
      applyAnimationFamilyCommand(
        updated.project,
        { type: "cel.reorder", celId: "cel-new", toIndex: 2 },
        context,
      ),
    );
    expect(reordered.project.sequences["sequence-main"].celIds).toEqual([
      "cel-composition",
      "cel-variants",
      "cel-new",
    ]);
    expect(semanticInverse(reordered)).toEqual({ type: "cel.reorder", celId: "cel-new", toIndex: 1 });
  });

  it("rejects owned cel graphs, missing sources and invalid order before mutation", () => {
    const owned = applyAnimationFamilyCommand(
      studioProjectV1Fixture,
      {
        type: "cel.add",
        sequenceId: "sequence-main",
        cel: cel("cel-owned"),
        ownedLayers: [],
      },
      context,
    );
    expect(owned?.ok).toBe(false);
    if (owned && !owned.ok) expect(owned.diagnostics[0].code).toBe("PRECONDITION_FAILED");
    expect(owned?.project).toBe(studioProjectV1Fixture);

    const missingSource = cel("cel-missing");
    missingSource.source = { type: "region", regionId: "region-missing" };
    const missing = applyAnimationFamilyCommand(
      studioProjectV1Fixture,
      { type: "cel.add", sequenceId: "sequence-main", cel: missingSource },
      context,
    );
    expect(missing?.ok).toBe(false);
    if (missing && !missing.ok) expect(missing.diagnostics[0].code).toBe("ENTITY_NOT_FOUND");

    const invalidOrder = applyAnimationFamilyCommand(
      studioProjectV1Fixture,
      { type: "cel.reorder", celId: "cel-composition", toIndex: 3 },
      context,
    );
    expect(invalidOrder?.ok).toBe(false);
    if (invalidOrder && !invalidOrder.ok) expect(invalidOrder.diagnostics[0].code).toBe("INVALID_ORDER");

    const sourceBypass = applyAnimationFamilyCommand(
      studioProjectV1Fixture,
      {
        type: "cel.update",
        celId: "cel-composition",
        patch: { source: { type: "region", regionId: "region-hero" } },
      } as unknown as ProjectCommand,
      context,
    );
    expect(sourceBypass?.ok).toBe(false);
    if (sourceBypass && !sourceBypass.ok) expect(sourceBypass.diagnostics[0].code).toBe("INVALID_PATCH");
    expect(sourceBypass?.project).toBe(studioProjectV1Fixture);
  });

  it("creates collision sets only for existing owners", () => {
    const collisionSet: CollisionSet = {
      id: "collision-composition",
      owner: { type: "composition", compositionId: "composition-project" },
      shapes: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
    const result = ok(
      applyAnimationFamilyCommand(
        studioProjectV1Fixture,
        { type: "collisionSet.create", collisionSet },
        context,
      ),
    );
    expect(result.project.collisionSets[collisionSet.id]).toEqual(collisionSet);
    expect(result.changedIds).toEqual({ collisionSets: [collisionSet.id] });
    expect(semanticInverse(result)).toEqual({ type: "collisionSet.remove", collisionSetId: collisionSet.id });

    const invalid = { ...collisionSet, id: "collision-missing", owner: { type: "cel", celId: "cel-missing" } } as CollisionSet;
    const missing = applyAnimationFamilyCommand(
      studioProjectV1Fixture,
      { type: "collisionSet.create", collisionSet: invalid },
      context,
    );
    expect(missing?.ok).toBe(false);
    if (missing && !missing.ok) expect(missing.diagnostics[0].code).toBe("ENTITY_NOT_FOUND");
  });

  it("adds, updates and removes collision shapes while preserving order in inverses", () => {
    const added = ok(
      applyAnimationFamilyCommand(
        studioProjectV1Fixture,
        { type: "collision.add", collisionSetId: "collision-region", shape: shape("shape-attack"), atIndex: 0 },
        context,
      ),
    );
    expect(added.project.collisionSets["collision-region"].shapes.map(({ id }) => id)).toEqual([
      "shape-attack",
      "shape-hero-hurtbox",
    ]);
    expect(semanticInverse(added)).toEqual({
      type: "collision.remove",
      collisionSetId: "collision-region",
      shapeId: "shape-attack",
    });

    const updated = ok(
      applyAnimationFamilyCommand(
        added.project,
        {
          type: "collision.update",
          collisionSetId: "collision-region",
          shapeId: "shape-attack",
          patch: { type: "solid", tag: undefined },
        },
        context,
      ),
    );
    expect(updated.project.collisionSets["collision-region"].shapes[0].type).toBe("solid");
    expect(updated.project.collisionSets["collision-region"].shapes[0]).not.toHaveProperty("tag");

    const removed = ok(
      applyAnimationFamilyCommand(
        updated.project,
        { type: "collision.remove", collisionSetId: "collision-region", shapeId: "shape-attack" },
        context,
      ),
    );
    expect(removed.project.collisionSets["collision-region"].shapes.map(({ id }) => id)).toEqual([
      "shape-hero-hurtbox",
    ]);
    expect(semanticInverse(removed)).toMatchObject({
      type: "collision.add",
      collisionSetId: "collision-region",
      atIndex: 0,
    });
  });

  it("maps candidate invariant failures to diagnostics and preserves original identity", () => {
    const invalidCel = cel("cel-invalid");
    invalidCel.durationMs = -1;
    const result = applyAnimationFamilyCommand(
      studioProjectV1Fixture,
      { type: "cel.add", sequenceId: "sequence-main", cel: invalidCel },
      context,
    );
    expect(result?.ok).toBe(false);
    if (result && !result.ok) expect(result.diagnostics.some(({ code }) => code === "INVARIANT_VIOLATION")).toBe(true);
    expect(result?.project).toBe(studioProjectV1Fixture);
  });

  it("contains malformed/getter payloads and leaves other command families unhandled", () => {
    const getter = {
      type: "sequence.create",
      get sequence(): never {
        throw new Error("hostile getter");
      },
    };
    for (const command of [null, getter]) {
      const result = applyAnimationFamilyCommand(
        studioProjectV1Fixture,
        command as ProjectCommand,
        context,
      );
      expect(result?.ok).toBe(false);
      if (result && !result.ok) expect(result.diagnostics[0].code).toBe("INVALID_PATCH");
      expect(result?.project).toBe(studioProjectV1Fixture);
    }
    expect(
      applyAnimationFamilyCommand(
        studioProjectV1Fixture,
        { type: "project.rename", name: "other", updatedAt: UPDATED_AT },
        context,
      ),
    ).toBeUndefined();
  });

  it("is reachable through the public ProjectEngine dispatcher", () => {
    const result = applyProjectCommand(
      studioProjectV1Fixture,
      { type: "sequence.create", sequence: sequence("sequence-dispatched") },
      context,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.sequences).toHaveProperty("sequence-dispatched");
  });

  it("does not publish revisions for empty updates or same-index reorder", () => {
    const emptyUpdate = ok(
      applyProjectCommand(
        studioProjectV1Fixture,
        { type: "sequence.update", sequenceId: "sequence-main", patch: {} },
        context,
      ),
    );
    expect(emptyUpdate.project).toBe(studioProjectV1Fixture);
    expect(emptyUpdate.changedIds).toEqual({});
    expect(emptyUpdate.warnings[0].code).toBe("NO_CHANGES");

    const changed = ok(
      applyProjectCommand(
        studioProjectV1Fixture,
        { type: "sequence.update", sequenceId: "sequence-main", patch: { name: "Changed" } },
        context,
      ),
    );
    expect(changed.project.sequences["sequence-main"].updatedAt).toBe(NOW);
    expect(semanticInverse(changed)).toMatchObject({
      type: "sequence.update",
      patch: { name: "Main sequence", updatedAt: "2026-01-01T00:01:00.000Z" },
    });

    const sameIndex = ok(
      applyProjectCommand(
        studioProjectV1Fixture,
        { type: "cel.reorder", celId: "cel-composition", toIndex: 0 },
        context,
      ),
    );
    expect(sameIndex.project).toBe(studioProjectV1Fixture);
    expect(sameIndex.changedIds).toEqual({});
    expect(sameIndex.warnings[0].code).toBe("NO_CHANGES");
  });

  it("rejects non-enumerable unknown fields inside nested patches", () => {
    const patch = { name: "must-not-apply" };
    Object.defineProperty(patch, "unexpected", {
      configurable: true,
      enumerable: false,
      value: "hidden",
    });
    const result = applyProjectCommand(
      studioProjectV1Fixture,
      { type: "sequence.update", sequenceId: "sequence-main", patch },
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe("INVALID_PATCH");
    expect(result.project).toBe(studioProjectV1Fixture);
  });
});
