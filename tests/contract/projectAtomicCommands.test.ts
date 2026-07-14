import { describe, expect, it } from "vitest";
import {
  applyProjectCommand,
  applyProjectCommandBatch,
  applyProjectCommandInverse,
} from "../../core/project/applyCommand";
import { cloneStudioProject } from "../../core/project/graph";
import type {
  ProjectCommand,
  ProjectCommandContext,
  ProjectCommandResult,
} from "../../core/project/commands";
import type { Composition, Layer } from "../../core/project/schema";
import { validateStudioProject } from "../../core/project/validation";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const NOW = "2026-01-01T00:10:00.000Z";
const context: ProjectCommandContext = {
  nextId: () => "unused-id",
  now: () => NOW,
};

function ok(result: ProjectCommandResult): Extract<ProjectCommandResult, { ok: true }> {
  if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join("; "));
  return result;
}

function expectRoundTrip(
  original: typeof studioProjectV1Fixture,
  result: ProjectCommandResult,
): void {
  const changed = ok(result);
  expect(validateStudioProject(changed.project).valid).toBe(true);
  const restored = ok(applyProjectCommandInverse(changed.project, changed.inverse, context));
  expect(restored.project).toEqual(original);
  expect(validateStudioProject(restored.project).valid).toBe(true);
}

function replacementComposition(): { composition: Composition; layers: Layer[] } {
  const composition: Composition = {
    id: "composition-variant-new",
    name: "Replacement variant",
    owner: { type: "variantSet", variantSetId: "variant-set-main", variant: "A" },
    layerIds: ["layer-variant-new"],
    width: 128,
    height: 128,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const layer: Layer = {
    id: "layer-variant-new",
    compositionId: composition.id,
    source: { type: "asset", id: "asset-sheet" },
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
      flipX: false,
      flipY: false,
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
  return { composition, layers: [layer] };
}

describe("atomic command execution and structured inverses (F1-07)", () => {
  it("rejects referenced deletes without mutation and executes a cascade round-trip", () => {
    const rejected = applyProjectCommand(
      studioProjectV1Fixture,
      { type: "asset.remove", assetId: "asset-sheet", policy: "reject" },
      context,
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.project).toBe(studioProjectV1Fixture);
    if (rejected.ok) throw new Error("Expected reject policy failure");
    expect(rejected.impact?.blockers.length).toBeGreaterThan(0);

    const cascaded = applyProjectCommand(
      studioProjectV1Fixture,
      { type: "sequence.remove", sequenceId: "sequence-main", policy: "cascade" },
      context,
    );
    const changed = ok(cascaded);
    expect(changed.project.sequences).not.toHaveProperty("sequence-main");
    expect(changed.project.cels).toEqual({});
    expect(changed.project.variantSets).toEqual({});
    expect(changed.project.workspace.selectedSequenceId).toBeUndefined();
    expect(changed.project.workspace.selectedCelIds).toEqual([]);
    expect(changed.inverse.type).toBe("project.restoreSnapshot");
    expectRoundTrip(studioProjectV1Fixture, cascaded);
  });

  it("removes and replaces variants while restoring private graphs exactly", () => {
    const inactive = cloneStudioProject(studioProjectV1Fixture);
    inactive.variantSets["variant-set-main"].activeVariant = "B";
    const removed = applyProjectCommand(
      inactive,
      {
        type: "variant.remove",
        variantSetId: "variant-set-main",
        variant: "A",
        policy: "cascade",
      },
      context,
    );
    const removedProject = ok(removed).project;
    expect(removedProject.variantSets["variant-set-main"].variants).toEqual({ B: "composition-variant-b" });
    expect(removedProject.compositions).not.toHaveProperty("composition-variant-a");
    expectRoundTrip(inactive, removed);

    const replacement = replacementComposition();
    const replaced = applyProjectCommand(
      studioProjectV1Fixture,
      {
        type: "variant.replace",
        variantSetId: "variant-set-main",
        variant: "A",
        ...replacement,
        policy: "cascade",
      },
      context,
    );
    const replacedProject = ok(replaced).project;
    expect(replacedProject.variantSets["variant-set-main"].variants.A).toBe("composition-variant-new");
    expect(replacedProject.compositions).not.toHaveProperty("composition-variant-a");
    expectRoundTrip(studioProjectV1Fixture, replaced);

    const sameIdentity = applyProjectCommand(
      studioProjectV1Fixture,
      {
        type: "variant.replace",
        variantSetId: "variant-set-main",
        variant: "A",
        composition: studioProjectV1Fixture.compositions["composition-variant-a"],
        layers: [studioProjectV1Fixture.layers["layer-variant-a"]],
        policy: "reject",
      },
      context,
    );
    expect(ok(sameIdentity).project.compositions).toHaveProperty("composition-variant-a");
    expectRoundTrip(studioProjectV1Fixture, sameIdentity);
  });

  it("relinks a cel to a same-command owned graph and restores its previous graph", () => {
    const composition: Composition = {
      id: "composition-cel-new",
      name: "New cel source",
      owner: { type: "cel", celId: "cel-composition" },
      layerIds: ["layer-cel-new"],
      width: 128,
      height: 128,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const layer: Layer = {
      ...replacementComposition().layers[0],
      id: "layer-cel-new",
      compositionId: composition.id,
    };
    const result = applyProjectCommand(
      studioProjectV1Fixture,
      {
        type: "cel.replaceSource",
        celId: "cel-composition",
        source: { type: "composition", compositionId: composition.id },
        ownedComposition: composition,
        ownedLayers: [layer],
        policy: "cascade",
      },
      context,
    );
    const project = ok(result).project;
    expect(project.cels["cel-composition"].source).toEqual({
      type: "composition",
      compositionId: composition.id,
    });
    expect(project.compositions).not.toHaveProperty("composition-cel");
    expect(project.layers).not.toHaveProperty("layer-cel");
    expectRoundTrip(studioProjectV1Fixture, result);

    const ignoredOwnedPayload = applyProjectCommand(
      studioProjectV1Fixture,
      {
        type: "cel.replaceSource",
        celId: "cel-composition",
        source: studioProjectV1Fixture.cels["cel-composition"].source,
        ownedComposition: composition,
        ownedLayers: [layer],
        policy: "cascade",
      },
      context,
    );
    expect(ignoredOwnedPayload.ok).toBe(false);
    if (!ignoredOwnedPayload.ok) {
      expect(ignoredOwnedPayload.diagnostics[0].code).toBe("PRECONDITION_FAILED");
    }
    expect(ignoredOwnedPayload.project).toBe(studioProjectV1Fixture);
  });

  it("applies explicit cleanup batches regardless of remove order and rolls back failures", () => {
    const commands: ProjectCommand[] = [
      { type: "region.remove", regionId: "region-hero", policy: "reject" },
      { type: "layer.remove", layerId: "layer-project" },
      { type: "layer.remove", layerId: "layer-variant-a" },
      { type: "collisionSet.remove", collisionSetId: "collision-region" },
    ];
    const result = applyProjectCommandBatch(
      studioProjectV1Fixture,
      { type: "command.batch", commands },
      context,
    );
    const project = ok(result).project;
    expect(project.regions).not.toHaveProperty("region-hero");
    expect(project.layers).not.toHaveProperty("layer-project");
    expect(project.collisionSets).not.toHaveProperty("collision-region");
    expectRoundTrip(studioProjectV1Fixture, result);

    const failed = applyProjectCommandBatch(
      studioProjectV1Fixture,
      {
        type: "command.batch",
        commands: [{ type: "project.rename", name: "Changed", updatedAt: "not-a-timestamp" }],
      },
      context,
    );
    expect(failed.ok).toBe(false);
    expect(failed.project).toBe(studioProjectV1Fixture);

    const activateThenRemove = applyProjectCommandBatch(
      studioProjectV1Fixture,
      {
        type: "command.batch",
        commands: [
          {
            type: "variant.activate",
            variantSetId: "variant-set-main",
            variant: "B",
            updatedAt: NOW,
          },
          {
            type: "variant.remove",
            variantSetId: "variant-set-main",
            variant: "A",
            policy: "cascade",
          },
        ],
      },
      context,
    );
    expect(ok(activateThenRemove).project.variantSets["variant-set-main"].variants).toEqual({
      B: "composition-variant-b",
    });
    expectRoundTrip(studioProjectV1Fixture, activateThenRemove);
  });

  it("executes the inverse emitted by an existing non-destructive family exactly", () => {
    const layer: Layer = {
      ...replacementComposition().layers[0],
      id: "layer-roundtrip",
      compositionId: "composition-project",
    };
    const result = applyProjectCommand(
      studioProjectV1Fixture,
      { type: "layer.add", compositionId: "composition-project", layer },
      context,
    );
    expectRoundTrip(studioProjectV1Fixture, result);
  });

  it("deletes explicit reference cycles as one candidate and contains hostile inverse envelopes", () => {
    const cycle = applyProjectCommandBatch(
      studioProjectV1Fixture,
      {
        type: "command.batch",
        commands: [
          { type: "artifact.remove", artifactId: "artifact-processed", policy: "reject" },
          { type: "asset.remove", assetId: "asset-processed", policy: "reject" },
          { type: "layer.remove", layerId: "layer-cel" },
        ],
      },
      context,
    );
    const cycleProject = ok(cycle).project;
    expect(cycleProject.generatedArtifacts).not.toHaveProperty("artifact-processed");
    expect(cycleProject.assets).not.toHaveProperty("asset-processed");
    expect(cycleProject.layers).not.toHaveProperty("layer-cel");
    expectRoundTrip(studioProjectV1Fixture, cycle);

    let reads = 0;
    const hostile = { type: "project.restoreSnapshot" } as Record<string, unknown>;
    Object.defineProperty(hostile, "project", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not execute");
      },
    });
    const rejected = applyProjectCommandInverse(
      studioProjectV1Fixture,
      hostile as unknown as Extract<ReturnType<typeof ok>["inverse"], { type: "project.restoreSnapshot" }>,
      context,
    );
    expect(reads).toBe(0);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.diagnostics[0].code).toBe("INVALID_PATCH");
    expect(rejected.project).toBe(studioProjectV1Fixture);
  });

  it("rejects hostile command accessors without executing them", () => {
    let typeReads = 0;
    const hostileType = {} as Record<string, unknown>;
    Object.defineProperty(hostileType, "type", {
      enumerable: true,
      get() {
        typeReads += 1;
        return "asset.remove";
      },
    });
    const rejectedType = applyProjectCommand(
      studioProjectV1Fixture,
      hostileType as unknown as ProjectCommand,
      context,
    );
    expect(typeReads).toBe(0);
    expect(rejectedType.ok).toBe(false);
    if (!rejectedType.ok) expect(rejectedType.diagnostics[0].code).toBe("INVALID_PATCH");
    expect(rejectedType.project).toBe(studioProjectV1Fixture);

    let idReads = 0;
    const hostileField = {
      type: "asset.remove",
      policy: "reject",
    } as Record<string, unknown>;
    Object.defineProperty(hostileField, "assetId", {
      enumerable: true,
      get() {
        idReads += 1;
        return "asset-main";
      },
    });
    const rejectedField = applyProjectCommand(
      studioProjectV1Fixture,
      hostileField as unknown as ProjectCommand,
      context,
    );
    expect(idReads).toBe(0);
    expect(rejectedField.ok).toBe(false);
    if (!rejectedField.ok) expect(rejectedField.diagnostics[0].code).toBe("INVALID_PATCH");
    expect(rejectedField.project).toBe(studioProjectV1Fixture);
  });
});
