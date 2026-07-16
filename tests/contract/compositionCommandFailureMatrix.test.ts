import { describe, expect, it } from "vitest";
import { applyCompositionFamilyCommand } from "../../core/project/applyCompositionCommands";
import type {
  ProjectCommand,
  ProjectCommandContext,
  ProjectCommandResult,
} from "../../core/project/commands";
import { cloneStudioProject } from "../../core/project/graph";
import type { Composition, Layer, StudioProjectV1 } from "../../core/project/schema";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const NOW = "2026-01-01T00:20:00.000Z";
const context: ProjectCommandContext = { nextId: () => "generated", now: () => NOW };

function asCommand(value: unknown): ProjectCommand {
  return value as ProjectCommand;
}

function failure(
  command: unknown,
  project: StudioProjectV1 = studioProjectV1Fixture,
  commandContext = context,
): Extract<ProjectCommandResult, { ok: false }> {
  const result = applyCompositionFamilyCommand(project, asCommand(command), commandContext);
  expect(result?.ok).toBe(false);
  return result as Extract<ProjectCommandResult, { ok: false }>;
}

function composition(id: string, layerIds: string[] = []): Composition {
  return {
    id,
    name: id,
    owner: { type: "project" },
    layerIds,
    width: 128,
    height: 128,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function layer(id: string, compositionId: string): Layer {
  return {
    id,
    compositionId,
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
}

describe("composition command hostile and failure matrix", () => {
  it("rejects malformed composition graphs before mutation", () => {
    const baseComposition = composition("composition-new", ["layer-new"]);
    const baseLayer = layer("layer-new", "composition-new");
    const cases = [
      { type: "composition.create", composition: null, layers: [] },
      { type: "composition.create", composition: baseComposition, layers: null },
      { type: "composition.create", composition: composition(""), layers: [] },
      { type: "composition.create", composition: studioProjectV1Fixture.compositions["composition-project"], layers: [] },
      { type: "composition.create", composition: { ...composition("owner-null"), owner: null }, layers: [] },
      { type: "composition.create", composition: { ...composition("owner-cel"), owner: { type: "cel", celId: "cel-composition" } }, layers: [] },
      { type: "composition.create", composition: { ...composition("layer-ids-null"), layerIds: null }, layers: [] },
      { type: "composition.create", composition: composition("duplicate-layers", ["dup", "dup"]), layers: [layer("dup", "duplicate-layers"), layer("dup", "duplicate-layers")] },
      { type: "composition.create", composition: composition("length", ["layer-new"]), layers: [] },
      { type: "composition.create", composition: { ...composition("invalid-order"), layerIds: [42] }, layers: [layer("layer-new", "invalid-order")] },
      { type: "composition.create", composition: composition("wrong-order", ["other"]), layers: [layer("layer-new", "wrong-order")] },
      { type: "composition.create", composition: composition("existing-layer", ["layer-project"]), layers: [layer("layer-project", "existing-layer")] },
      { type: "composition.create", composition: composition("blank-owner", ["layer-new"]), layers: [{ ...baseLayer, compositionId: "" }] },
      { type: "composition.create", composition: composition("wrong-owner", ["layer-new"]), layers: [layer("layer-new", "other")] },
      { type: "composition.create", composition: baseComposition, layers: [{ ...baseLayer, source: null }] },
      { type: "composition.create", composition: baseComposition, layers: [{ ...baseLayer, source: { type: "runtime" } }] },
      { type: "composition.create", composition: baseComposition, layers: [{ ...baseLayer, source: { type: "asset", id: "" } }] },
      { type: "composition.create", composition: baseComposition, layers: [{ ...baseLayer, source: { type: "region", id: "missing" } }] },
      { type: "composition.create", composition: baseComposition, layers: [baseLayer], atIndex: 99 },
    ];
    for (const command of cases) {
      expect(failure(command).project).toBe(studioProjectV1Fixture);
    }
  });

  it("rejects malformed layer additions and updates", () => {
    const added = layer("layer-new", "composition-project");
    const cases = [
      { type: "layer.add", compositionId: "", layer: added },
      { type: "layer.add", compositionId: "missing", layer: added },
      { type: "layer.add", compositionId: "composition-project", layer: null },
      { type: "layer.add", compositionId: "composition-project", layer: { ...added, id: "" } },
      { type: "layer.add", compositionId: "composition-project", layer: { ...added, id: "layer-project" } },
      { type: "layer.add", compositionId: "composition-project", layer: { ...added, compositionId: "" } },
      { type: "layer.add", compositionId: "composition-project", layer: { ...added, compositionId: "composition-cel" } },
      { type: "layer.add", compositionId: "composition-project", layer: { ...added, source: { type: "runtime" } } },
      { type: "layer.add", compositionId: "composition-project", layer: added, atIndex: 99 },
      { type: "layer.update", layerId: "", patch: {} },
      { type: "layer.update", layerId: "missing", patch: {} },
      { type: "layer.update", layerId: "layer-project", patch: null },
      { type: "layer.update", layerId: "layer-project", patch: { compositionId: "composition-cel" } },
      { type: "layer.update", layerId: "layer-project", patch: { source: undefined } },
      { type: "layer.update", layerId: "layer-project", patch: { source: { type: "asset", id: "missing" } } },
    ];
    for (const command of cases) failure(command);

    const symbolPatch = { name: "ignored" };
    Object.defineProperty(symbolPatch, Symbol("runtime"), { value: true, enumerable: true });
    failure({ type: "layer.update", layerId: "layer-project", patch: symbolPatch });

    const noChange = applyCompositionFamilyCommand(
      studioProjectV1Fixture,
      { type: "layer.update", layerId: "layer-project", patch: { name: "Project layer" } },
      context,
    );
    expect(noChange?.ok).toBe(true);
    if (noChange?.ok) expect(noChange.project).toBe(studioProjectV1Fixture);

    const invalidProject = cloneStudioProject(studioProjectV1Fixture);
    invalidProject.id = "";
    expect(failure(
      { type: "layer.update", layerId: "layer-project", patch: { name: "Changed" } },
      invalidProject,
    ).diagnostics[0].code).toBe("INVARIANT_VIOLATION");
  });

  it("rejects reorder and duplicate ownership failures", () => {
    for (const command of [
      { type: "layer.reorder", layerId: "", toIndex: 0 },
      { type: "layer.reorder", layerId: "missing", toIndex: 0 },
      { type: "layer.duplicate", layerId: "" },
      { type: "layer.duplicate", layerId: "missing" },
      { type: "layer.duplicate", layerId: "layer-project", atIndex: 99 },
    ]) failure(command);

    const missingComposition = cloneStudioProject(studioProjectV1Fixture);
    missingComposition.layers["layer-project"].compositionId = "missing";
    failure({ type: "layer.reorder", layerId: "layer-project", toIndex: 0 }, missingComposition);

    const missingOrder = cloneStudioProject(studioProjectV1Fixture);
    missingOrder.compositions["composition-project"].layerIds = [];
    failure({ type: "layer.reorder", layerId: "layer-project", toIndex: 0 }, missingOrder);
    failure({ type: "layer.duplicate", layerId: "layer-project" }, missingOrder);

    const sameIndex = applyCompositionFamilyCommand(
      studioProjectV1Fixture,
      { type: "layer.reorder", layerId: "layer-project", toIndex: 0 },
      context,
    );
    expect(sameIndex?.ok).toBe(true);
    if (sameIndex?.ok) expect(sameIndex.project).toBe(studioProjectV1Fixture);

    const invalidGenerated: ProjectCommandContext = { nextId: () => "", now: () => NOW };
    failure({ type: "layer.duplicate", layerId: "layer-project" }, studioProjectV1Fixture, invalidGenerated);
    const duplicateGenerated: ProjectCommandContext = {
      nextId: () => "layer-project",
      now: () => NOW,
    };
    failure({ type: "layer.duplicate", layerId: "layer-project" }, studioProjectV1Fixture, duplicateGenerated);
  });

  it("rejects malformed variant activation and preserves exact no-op identity", () => {
    for (const command of [
      { type: "variant.activate", variantSetId: "", variant: "A", updatedAt: NOW },
      { type: "variant.activate", variantSetId: "missing", variant: "A", updatedAt: NOW },
      { type: "variant.activate", variantSetId: "variant-set-main", variant: "Z", updatedAt: NOW },
      { type: "variant.activate", variantSetId: "variant-set-main", variant: "A" },
      { type: "variant.activate", variantSetId: "variant-set-main", variant: "C", updatedAt: NOW },
    ]) failure(command);

    const invalidCompositionId = cloneStudioProject(studioProjectV1Fixture);
    Object.defineProperty(invalidCompositionId.variantSets["variant-set-main"].variants, "C", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: "",
    });
    failure(
      { type: "variant.activate", variantSetId: "variant-set-main", variant: "C", updatedAt: NOW },
      invalidCompositionId,
    );

    const missingComposition = cloneStudioProject(studioProjectV1Fixture);
    missingComposition.variantSets["variant-set-main"].variants.C = "missing";
    failure(
      { type: "variant.activate", variantSetId: "variant-set-main", variant: "C", updatedAt: NOW },
      missingComposition,
    );

    const noChange = applyCompositionFamilyCommand(
      studioProjectV1Fixture,
      {
        type: "variant.activate",
        variantSetId: "variant-set-main",
        variant: "A",
        updatedAt: studioProjectV1Fixture.variantSets["variant-set-main"].updatedAt,
      },
      context,
    );
    expect(noChange?.ok).toBe(true);
    if (noChange?.ok) expect(noChange.project).toBe(studioProjectV1Fixture);
  });
});
