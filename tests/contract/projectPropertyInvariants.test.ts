import { describe, expect, it } from "vitest";
import {
  applyProjectCommand,
  applyProjectCommandInverse,
} from "../../core/project/applyCommand";
import type {
  ProjectCommand,
  ProjectCommandContext,
  ProjectCommandInverse,
  ProjectCommandResult,
} from "../../core/project/commands";
import { cloneStudioProject } from "../../core/project/graph";
import { validateStudioProject } from "../../core/project/validation";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const NOW = "2026-01-01T00:20:00.000Z";

function ok(result: ProjectCommandResult): Extract<ProjectCommandResult, { ok: true }> {
  if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join("; "));
  return result;
}

function queuedContext(ids: string[]): ProjectCommandContext {
  let index = 0;
  return {
    nextId: () => ids[index++] ?? `unexpected-${index}`,
    now: () => NOW,
  };
}

function expectExactRoundTrip(
  original: typeof studioProjectV1Fixture,
  result: ProjectCommandResult,
  context: ProjectCommandContext,
): void {
  const changed = ok(result);
  expect(validateStudioProject(changed.project).valid).toBe(true);
  expect(ok(applyProjectCommandInverse(changed.project, changed.inverse, context)).project).toEqual(original);
}

function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

describe("F1-08 seeded graph properties", () => {
  it("duplicates a layer beside its source with independent identity and exact undo", () => {
    const context = queuedContext(["layer-copy"]);
    const result = applyProjectCommand(
      studioProjectV1Fixture,
      { type: "layer.duplicate", layerId: "layer-project" },
      context,
    );
    const changed = ok(result);
    expect(changed.project.compositions["composition-project"].layerIds).toEqual([
      "layer-project",
      "layer-copy",
    ]);
    expect(changed.project.layers["layer-copy"]).toMatchObject({
      id: "layer-copy",
      compositionId: "composition-project",
      source: studioProjectV1Fixture.layers["layer-project"].source,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(changed.project.layers["layer-copy"].transform).toEqual(
      studioProjectV1Fixture.layers["layer-project"].transform,
    );
    expect(changed.project.layers["layer-copy"].transform).not.toBe(
      studioProjectV1Fixture.layers["layer-project"].transform,
    );
    expect(changed.changedIds.layers).toEqual(["layer-copy"]);
    expectExactRoundTrip(studioProjectV1Fixture, result, context);
  });

  it("deep-copies cel-owned composition, variant and collision graphs while sharing assets", () => {
    const withCollision = cloneStudioProject(studioProjectV1Fixture);
    withCollision.collisionSets["collision-cel"] = {
      id: "collision-cel",
      owner: { type: "cel", celId: "cel-composition" },
      shapes: [{ id: "shape-cel", type: "hitbox", bounds: { x: 1, y: 2, width: 3, height: 4 } }],
      createdAt: withCollision.createdAt,
      updatedAt: withCollision.updatedAt,
    };
    withCollision.collisionSets["collision-composition"] = {
      id: "collision-composition",
      owner: { type: "composition", compositionId: "composition-cel" },
      shapes: [{ id: "shape-composition", type: "solid", bounds: { x: 5, y: 6, width: 7, height: 8 } }],
      createdAt: withCollision.createdAt,
      updatedAt: withCollision.updatedAt,
    };
    expect(validateStudioProject(withCollision).valid).toBe(true);

    const compositionContext = queuedContext([
      "cel-composition-copy",
      "composition-cel-copy",
      "layer-cel-copy",
      "collision-composition-copy",
      "collision-cel-copy",
    ]);
    const compositionResult = applyProjectCommand(
      withCollision,
      { type: "cel.duplicate", celId: "cel-composition" },
      compositionContext,
    );
    const compositionProject = ok(compositionResult).project;
    expect(compositionProject.sequences["sequence-main"].celIds).toEqual([
      "cel-composition",
      "cel-composition-copy",
      "cel-variants",
    ]);
    expect(compositionProject.cels["cel-composition-copy"].source).toEqual({
      type: "composition",
      compositionId: "composition-cel-copy",
    });
    expect(compositionProject.compositions["composition-cel-copy"]).toMatchObject({
      owner: { type: "cel", celId: "cel-composition-copy" },
      layerIds: ["layer-cel-copy"],
    });
    expect(compositionProject.layers["layer-cel-copy"]).toMatchObject({
      compositionId: "composition-cel-copy",
      source: withCollision.layers["layer-cel"].source,
    });
    expect(compositionProject.collisionSets["collision-cel-copy"]).toMatchObject({
      owner: { type: "cel", celId: "cel-composition-copy" },
      shapes: withCollision.collisionSets["collision-cel"].shapes,
    });
    expect(compositionProject.collisionSets["collision-composition-copy"]).toMatchObject({
      owner: { type: "composition", compositionId: "composition-cel-copy" },
      shapes: withCollision.collisionSets["collision-composition"].shapes,
    });
    expectExactRoundTrip(withCollision, compositionResult, compositionContext);

    const variantContext = queuedContext([
      "cel-variant-copy",
      "variant-set-copy",
      "composition-a-copy",
      "layer-a-copy",
      "composition-b-copy",
      "layer-b-copy",
    ]);
    const variantResult = applyProjectCommand(
      studioProjectV1Fixture,
      { type: "cel.duplicate", celId: "cel-variants", atIndex: 0 },
      variantContext,
    );
    const variantProject = ok(variantResult).project;
    expect(variantProject.cels["cel-variant-copy"].source).toEqual({
      type: "variantSet",
      variantSetId: "variant-set-copy",
    });
    expect(variantProject.variantSets["variant-set-copy"]).toMatchObject({
      celId: "cel-variant-copy",
      variants: { A: "composition-a-copy", B: "composition-b-copy" },
      activeVariant: "A",
    });
    expect(variantProject.compositions["composition-a-copy"].owner).toEqual({
      type: "variantSet",
      variantSetId: "variant-set-copy",
      variant: "A",
    });
    expect(variantProject.layers["layer-a-copy"].source).toEqual(
      studioProjectV1Fixture.layers["layer-variant-a"].source,
    );
    expectExactRoundTrip(studioProjectV1Fixture, variantResult, variantContext);
  });

  it("rejects invalid generated identities atomically", () => {
    const invalid = applyProjectCommand(
      studioProjectV1Fixture,
      { type: "layer.duplicate", layerId: "layer-project" },
      queuedContext(["layer-project"]),
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.diagnostics[0].code).toBe("ENTITY_ALREADY_EXISTS");
    expect(invalid.project).toBe(studioProjectV1Fixture);

    const repeated = applyProjectCommand(
      studioProjectV1Fixture,
      { type: "cel.duplicate", celId: "cel-variants" },
      queuedContext(["new-cel", "new-variant-set", "same-id", "new-layer", "same-id"]),
    );
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) expect(repeated.diagnostics[0].code).toBe("ENTITY_ALREADY_EXISTS");
    expect(repeated.project).toBe(studioProjectV1Fixture);

    const adversarialOrder = ok(applyProjectCommand(
      studioProjectV1Fixture,
      { type: "cel.duplicate", celId: "cel-variants" },
      queuedContext(["z-cel", "z-variant", "z-comp-a", "z-layer-a", "a-comp-b", "a-layer-b"]),
    ));
    expect(adversarialOrder.changedIds.compositions).toEqual(["a-comp-b", "z-comp-a"]);
    expect(adversarialOrder.changedIds.layers).toEqual(["a-layer-b", "z-layer-a"]);
    expect(adversarialOrder.impact.direct.filter(({ collection }) => collection === "compositions")).toEqual([
      { collection: "compositions", id: "a-comp-b" },
      { collection: "compositions", id: "z-comp-a" },
    ]);
  });

  it("preserves graph invariants through 100 seeded delete/reorder/duplicate operations and undo/redo", () => {
    const random = xorshift32(0x5f3759df);
    let generated = 0;
    const context: ProjectCommandContext = {
      nextId: () => `seeded-${++generated}`,
      now: () => NOW,
    };
    let project = cloneStudioProject(studioProjectV1Fixture);
    const inverses: ProjectCommandInverse[] = [];
    const snapshots: typeof studioProjectV1Fixture[] = [cloneStudioProject(project)];

    for (let step = 0; step < 100; step += 1) {
      const commands: ProjectCommand[] = [];
      const layerIds = Object.keys(project.layers).sort();
      if (layerIds.length > 0) {
        const layerId = layerIds[random() % layerIds.length];
        const composition = project.compositions[project.layers[layerId].compositionId];
        if (layerIds.length < 24) {
          commands.push({
            type: "layer.duplicate",
            layerId,
            atIndex: random() % (composition.layerIds.length + 1),
          });
        }
        commands.push({
          type: "layer.reorder",
          layerId,
          toIndex: random() % composition.layerIds.length,
        });
        commands.push({ type: "layer.remove", layerId });
      }

      const sequence = project.sequences["sequence-main"];
      const celIds = sequence.celIds;
      if (celIds.length > 0) {
        const celId = celIds[random() % celIds.length];
        if (celIds.length < 12) {
          commands.push({
            type: "cel.duplicate",
            celId,
            atIndex: random() % (celIds.length + 1),
          });
        }
        commands.push({ type: "cel.reorder", celId, toIndex: random() % celIds.length });
        if (celIds.length > 1) commands.push({ type: "cel.remove", celId, policy: "cascade" });
      }

      expect(commands.length).toBeGreaterThan(0);
      const command = commands[random() % commands.length];
      const result = applyProjectCommand(project, command, context);
      const changed = ok(result);
      expect(validateStudioProject(changed.project).valid).toBe(true);
      for (const ids of Object.values(changed.changedIds)) {
        expect(ids).toEqual([...new Set(ids)].sort());
      }
      const restored = ok(applyProjectCommandInverse(changed.project, changed.inverse, context));
      expect(restored.project).toEqual(project);
      inverses.push(changed.inverse);
      project = changed.project;
      snapshots.push(cloneStudioProject(project));
    }

    const redos: ProjectCommandInverse[] = [];
    for (let index = inverses.length - 1; index >= 0; index -= 1) {
      const undone = ok(applyProjectCommandInverse(project, inverses[index], context));
      project = undone.project;
      redos.push(undone.inverse);
      expect(project).toEqual(snapshots[index]);
      expect(validateStudioProject(project).valid).toBe(true);
    }
    expect(project).toEqual(studioProjectV1Fixture);

    for (let index = redos.length - 1; index >= 0; index -= 1) {
      project = ok(applyProjectCommandInverse(project, redos[index], context)).project;
      expect(project).toEqual(snapshots[redos.length - index]);
      expect(validateStudioProject(project).valid).toBe(true);
    }
    expect(project).toEqual(snapshots.at(-1));
  });
});
