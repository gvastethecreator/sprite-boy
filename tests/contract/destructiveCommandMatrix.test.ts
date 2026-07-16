import { describe, expect, it } from "vitest";
import {
  applyCombinedRemoveCommands,
  applyDestructiveFamilyCommand,
} from "../../core/project/applyDestructiveCommands";
import type {
  ProjectCommand,
  ProjectCommandContext,
  ProjectCommandResult,
} from "../../core/project/commands";
import { cloneStudioProject } from "../../core/project/graph";
import type { Composition, Layer, StudioProjectV1 } from "../../core/project/schema";
import { validateStudioProject } from "../../core/project/validation";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const NOW = "2026-01-01T00:20:00.000Z";
const context: ProjectCommandContext = { nextId: () => "unused", now: () => NOW };

function replacement(id = "composition-replacement"): { composition: Composition; layers: Layer[] } {
  const composition: Composition = {
    id,
    name: id,
    owner: { type: "variantSet", variantSetId: "variant-set-main", variant: "A" },
    layerIds: [`${id}-layer`],
    width: 128,
    height: 128,
    createdAt: NOW,
    updatedAt: NOW,
  };
  return {
    composition,
    layers: [{
      id: `${id}-layer`,
      compositionId: id,
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
    }],
  };
}

function failure(
  command: ProjectCommand,
  project: StudioProjectV1 = studioProjectV1Fixture,
): Extract<ProjectCommandResult, { ok: false }> {
  const result = applyDestructiveFamilyCommand(project, command, context);
  expect(result?.ok).toBe(false);
  return result as Extract<ProjectCommandResult, { ok: false }>;
}

describe("destructive command execution matrix", () => {
  it("rejects malformed and conflicting variant replacement payloads", () => {
    const next = replacement();
    failure({
      type: "variant.replace",
      variantSetId: "variant-set-main",
      variant: "A",
      composition: next.composition,
      layers: null as unknown as Layer[],
      policy: "cascade",
    });

    const namedLayers = [...next.layers];
    Object.defineProperty(namedLayers, "runtime", { value: true, enumerable: true });
    failure({
      type: "variant.replace",
      variantSetId: "variant-set-main",
      variant: "A",
      composition: next.composition,
      layers: namedLayers,
      policy: "cascade",
    });

    failure({
      type: "variant.replace",
      variantSetId: "variant-set-main",
      variant: "A",
      composition: next.composition,
      layers: [next.layers[0], next.layers[0]],
      policy: "cascade",
    });

    failure({
      type: "variant.replace",
      variantSetId: "variant-set-main",
      variant: "A",
      composition: studioProjectV1Fixture.compositions["composition-project"],
      layers: [studioProjectV1Fixture.layers["layer-project"]],
      policy: "cascade",
    });

    const existingLayer = replacement("composition-another");
    existingLayer.layers[0] = {
      ...existingLayer.layers[0],
      id: "layer-project",
    };
    existingLayer.composition.layerIds = ["layer-project"];
    failure({
      type: "variant.replace",
      variantSetId: "variant-set-main",
      variant: "A",
      composition: existingLayer.composition,
      layers: existingLayer.layers,
      policy: "cascade",
    });
  });

  it("returns a no-op for an identical cel source and rejects attached owned payloads", () => {
    const noChange = applyDestructiveFamilyCommand(
      studioProjectV1Fixture,
      {
        type: "cel.replaceSource",
        celId: "cel-composition",
        source: studioProjectV1Fixture.cels["cel-composition"].source,
        policy: "cascade",
      },
      context,
    );
    expect(noChange?.ok).toBe(true);
    if (noChange?.ok) expect(noChange.project).toBe(studioProjectV1Fixture);

    expect(failure({
      type: "cel.replaceSource",
      celId: "cel-composition",
      source: studioProjectV1Fixture.cels["cel-composition"].source,
      ownedLayers: [],
      policy: "cascade",
    }).diagnostics[0].code).toBe("PRECONDITION_FAILED");
  });

  it("installs a complete owned variant graph in one relink", () => {
    const compositionId = "composition-owned-variant";
    const layerId = "layer-owned-variant";
    const variantSetId = "variant-owned";
    const composition: Composition = {
      id: compositionId,
      name: "Owned variant",
      owner: { type: "variantSet", variantSetId, variant: "A" },
      layerIds: [layerId],
      width: 128,
      height: 128,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const layer: Layer = {
      ...replacement(compositionId).layers[0],
      id: layerId,
      compositionId,
    };
    const result = applyDestructiveFamilyCommand(
      studioProjectV1Fixture,
      {
        type: "cel.replaceSource",
        celId: "cel-composition",
        source: { type: "variantSet", variantSetId },
        ownedVariantSet: {
          id: variantSetId,
          celId: "cel-composition",
          variants: { A: compositionId },
          activeVariant: "A",
          createdAt: NOW,
          updatedAt: NOW,
        },
        ownedVariantCompositions: [composition],
        ownedLayers: [layer],
        policy: "cascade",
      },
      context,
    );
    expect(result?.ok).toBe(true);
    if (!result?.ok) throw new Error("Expected owned variant relink to succeed.");
    expect(result.project.variantSets[variantSetId].celId).toBe("cel-composition");
    expect(result.project.compositions[compositionId].layerIds).toEqual([layerId]);
    expect(validateStudioProject(result.project).valid).toBe(true);
  });

  it("rejects incomplete or conflicting owned cel graphs", () => {
    const source = { type: "composition" as const, compositionId: "composition-new" };
    failure({
      type: "cel.replaceSource",
      celId: "cel-composition",
      source,
      ownedLayers: null as unknown as Layer[],
      policy: "cascade",
    });
    failure({
      type: "cel.replaceSource",
      celId: "cel-composition",
      source,
      ownedLayers: [],
      policy: "cascade",
    });

    const owned = replacement("composition-new");
    owned.composition.owner = { type: "cel", celId: "cel-composition" };
    owned.layers[0] = { ...owned.layers[0], id: "layer-project" };
    owned.composition.layerIds = ["layer-project"];
    failure({
      type: "cel.replaceSource",
      celId: "cel-composition",
      source,
      ownedComposition: owned.composition,
      ownedLayers: owned.layers,
      policy: "cascade",
    });

    failure({
      type: "cel.replaceSource",
      celId: "cel-composition",
      source: { type: "variantSet", variantSetId: "variant-new" },
      ownedVariantSet: {
        id: "variant-new",
        celId: "cel-composition",
        variants: {},
        activeVariant: "A",
        createdAt: NOW,
        updatedAt: NOW,
      },
      ownedVariantCompositions: null as unknown as Composition[],
      ownedLayers: [],
      policy: "cascade",
    });
  });

  it("executes every direct combined-remove target and rejects invalid batches", () => {
    const commands: ProjectCommand[] = [
      { type: "artifact.remove", artifactId: "artifact-processed", policy: "cascade" },
      { type: "layer.remove", layerId: "layer-project" },
      { type: "cel.remove", celId: "cel-composition", policy: "cascade" },
      { type: "collisionSet.remove", collisionSetId: "collision-region" },
    ];
    const removed = applyCombinedRemoveCommands(studioProjectV1Fixture, commands, context);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(validateStudioProject(removed.project).valid).toBe(true);

    const invalid = applyCombinedRemoveCommands(
      studioProjectV1Fixture,
      [{ type: "project.rename", name: "No", updatedAt: NOW }],
      context,
    );
    expect(invalid.ok).toBe(false);

    const blocked = applyCombinedRemoveCommands(
      studioProjectV1Fixture,
      [{ type: "asset.remove", assetId: "asset-sheet", policy: "reject" }],
      context,
    );
    expect(blocked.ok).toBe(false);

    const invalidProject = cloneStudioProject(studioProjectV1Fixture);
    invalidProject.id = "";
    const invalidCandidate = applyCombinedRemoveCommands(
      invalidProject,
      [{ type: "collisionSet.remove", collisionSetId: "collision-region" }],
      context,
    );
    expect(invalidCandidate.ok).toBe(false);

    const inactive = cloneStudioProject(studioProjectV1Fixture);
    inactive.variantSets["variant-set-main"].activeVariant = "B";
    const variantRemoved = applyCombinedRemoveCommands(
      inactive,
      [{
        type: "variant.remove",
        variantSetId: "variant-set-main",
        variant: "A",
        policy: "cascade",
      }],
      context,
    );
    expect(variantRemoved.ok).toBe(true);
  });
});
