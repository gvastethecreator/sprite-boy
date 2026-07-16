import { describe, expect, it } from "vitest";
import { cloneStudioProject } from "../../core/project/graph";
import { analyzeProjectCommandImpact } from "../../core/project/impact";
import type { StudioProjectV1 } from "../../core/project/schema";
import { validateStudioProject } from "../../core/project/validation";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

function expectBlocker(command: unknown, code: string, project = studioProjectV1Fixture): void {
  const impact = analyzeProjectCommandImpact(project, command);
  expect(impact.blockers.some((blocker) => blocker.code === code)).toBe(true);
}

function valid(project: StudioProjectV1): StudioProjectV1 {
  expect(validateStudioProject(project).valid).toBe(true);
  return project;
}

describe("project command impact hostile and branch matrix", () => {
  it("collects optional collision and artifact reference edges", () => {
    const project = cloneStudioProject(studioProjectV1Fixture);
    project.collisionSets["collision-composition"] = {
      id: "collision-composition",
      owner: { type: "composition", compositionId: "composition-project" },
      shapes: [],
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    project.collisionSets["collision-cel"] = {
      id: "collision-cel",
      owner: { type: "cel", celId: "cel-composition" },
      shapes: [],
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    project.generatedArtifacts["artifact-child"] = {
      id: "artifact-child",
      type: "export",
      provenance: { source: "export", parentArtifactId: "artifact-processed" },
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };

    const impact = analyzeProjectCommandImpact(valid(project), {
      type: "composition.remove",
      compositionId: "composition-project",
      policy: "cascade",
    });
    expect(impact.cascades).toEqual(
      expect.arrayContaining([
        { collection: "layers", id: "layer-project" },
        { collection: "collisionSets", id: "collision-composition" },
      ]),
    );
    const artifactImpact = analyzeProjectCommandImpact(project, {
      type: "artifact.remove",
      artifactId: "artifact-processed",
      policy: "cascade",
    });
    expect(artifactImpact.cascades).toContainEqual({
      collection: "generatedArtifacts",
      id: "artifact-child",
    });
  });

  it("rejects closed-shape, required-field and policy violations", () => {
    expectBlocker(null, "INVALID_PATCH");
    expectBlocker({ type: "asset.remove", assetId: "asset-sheet" }, "INVALID_PATCH");
    expectBlocker({ type: "asset.remove", assetId: "", policy: "cascade" }, "INVALID_PATCH");
    expectBlocker({ type: "asset.remove", assetId: "asset-sheet", policy: "later" }, "INVALID_PATCH");

    const symbolCommand = { type: "asset.remove", assetId: "asset-sheet", policy: "cascade" };
    Object.defineProperty(symbolCommand, Symbol("runtime"), { value: true, enumerable: true });
    expectBlocker(symbolCommand, "INVALID_PATCH");

    const accessorCommand = { type: "asset.remove", assetId: "asset-sheet", policy: "cascade" };
    Object.defineProperty(accessorCommand, "policy", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    expectBlocker(accessorCommand, "INVALID_PATCH");

    const noImpact = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "project.rename",
      name: "Renamed",
      updatedAt: "2026-01-01T00:02:00.000Z",
    });
    expect(noImpact).toEqual({ direct: [], referencedBy: [], cascades: [], blockers: [] });

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expectBlocker(revoked.proxy, "INVALID_PATCH");
  });

  it("analyzes every direct removal target and implicit destructive policy", () => {
    const commands = [
      { type: "processingRecipe.remove", recipeId: "recipe-grid", policy: "cascade" },
      { type: "artifact.remove", artifactId: "artifact-processed", policy: "cascade" },
      { type: "layer.remove", layerId: "layer-project" },
      { type: "cel.remove", celId: "cel-composition", policy: "cascade" },
      { type: "collisionSet.remove", collisionSetId: "collision-region" },
    ];
    for (const command of commands) {
      const impact = analyzeProjectCommandImpact(studioProjectV1Fixture, command);
      expect(impact.direct).toHaveLength(1);
      expect(impact.blockers).toEqual([]);
    }
  });

  it("validates every variant removal and replacement precondition", () => {
    expectBlocker(
      { type: "variant.remove", variantSetId: "", variant: "A", policy: "cascade" },
      "INVALID_PATCH",
    );
    expectBlocker(
      { type: "variant.remove", variantSetId: "variant-set-main", variant: "Z", policy: "cascade" },
      "INVALID_PATCH",
    );
    expectBlocker(
      { type: "variant.remove", variantSetId: "variant-set-main", variant: "B", policy: "later" },
      "INVALID_PATCH",
    );
    expectBlocker(
      { type: "variant.remove", variantSetId: "missing", variant: "A", policy: "cascade" },
      "ENTITY_NOT_FOUND",
    );
    expectBlocker(
      { type: "variant.remove", variantSetId: "variant-set-main", variant: "C", policy: "cascade" },
      "ENTITY_NOT_FOUND",
    );
    expectBlocker(
      {
        type: "variant.replace",
        variantSetId: "variant-set-main",
        variant: "A",
        composition: null,
        layers: [],
        policy: "cascade",
      },
      "INVALID_PATCH",
    );
    expectBlocker(
      {
        type: "variant.replace",
        variantSetId: "variant-set-main",
        variant: "A",
        composition: { id: "composition-variant-a", layerIds: null },
        layers: [],
        policy: "cascade",
      },
      "INVALID_PATCH",
    );

    const singleVariant = cloneStudioProject(studioProjectV1Fixture);
    delete singleVariant.layers["layer-variant-b"];
    delete singleVariant.compositions["composition-variant-b"];
    delete singleVariant.variantSets["variant-set-main"].variants.B;
    expectBlocker(
      { type: "variant.remove", variantSetId: "variant-set-main", variant: "A", policy: "cascade" },
      "PRECONDITION_FAILED",
      valid(singleVariant),
    );

    const inactive = cloneStudioProject(studioProjectV1Fixture);
    inactive.variantSets["variant-set-main"].activeVariant = "B";
    const pruned = analyzeProjectCommandImpact(inactive, {
      type: "variant.replace",
      variantSetId: "variant-set-main",
      variant: "A",
      composition: { ...inactive.compositions["composition-variant-a"], layerIds: [] },
      layers: [],
      policy: "cascade",
    });
    expect(pruned.cascades).toContainEqual({ collection: "layers", id: "layer-variant-a" });
  });

  it("validates cel relink sources, ownership and missing targets", () => {
    expectBlocker(
      { type: "cel.replaceSource", celId: "", source: {}, policy: "cascade" },
      "INVALID_PATCH",
    );
    expectBlocker(
      { type: "cel.replaceSource", celId: "cel-composition", source: {}, policy: "later" },
      "INVALID_PATCH",
    );
    expectBlocker(
      { type: "cel.replaceSource", celId: "missing", source: { type: "region", regionId: "region-hero" }, policy: "cascade" },
      "ENTITY_NOT_FOUND",
    );
    expectBlocker(
      { type: "cel.replaceSource", celId: "cel-composition", source: { type: "region", regionId: "region-hero", extra: true }, policy: "cascade" },
      "INVALID_PATCH",
    );
    expectBlocker(
      { type: "cel.replaceSource", celId: "cel-composition", source: { type: "variantSet", variantSetId: "variant-set-main" }, policy: "cascade" },
      "PRECONDITION_FAILED",
    );

    const sameVariant = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "cel.replaceSource",
      celId: "cel-variants",
      source: { type: "variantSet", variantSetId: "variant-set-main" },
      policy: "cascade",
    });
    expect(sameVariant.blockers).toEqual([]);
    expect(sameVariant.cascades).toEqual([]);

    const ownedVariant = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "cel.replaceSource",
      celId: "cel-composition",
      source: { type: "variantSet", variantSetId: "variant-new" },
      ownedVariantSet: { id: "variant-new", celId: "cel-composition" },
      ownedVariantCompositions: [],
      ownedLayers: [],
      policy: "cascade",
    });
    expect(ownedVariant.blockers).toEqual([]);
  });

  it("rejects non-dense batches and models data-only layer reference overrides", () => {
    for (const commands of [null, "commands"]) {
      expectBlocker({ type: "command.batch", commands }, "INVALID_PATCH");
    }

    const named = [{ type: "layer.remove", layerId: "layer-project" }];
    Object.defineProperty(named, "runtime", { value: true, enumerable: true });
    expectBlocker({ type: "command.batch", commands: named }, "INVALID_PATCH");

    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[0] = { type: "layer.remove", layerId: "layer-project" };
    expectBlocker({ type: "command.batch", commands: sparse }, "INVALID_PATCH");

    const accessor = [{ type: "layer.remove", layerId: "layer-project" }];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    expectBlocker({ type: "command.batch", commands: accessor }, "INVALID_PATCH");

    expectBlocker(
      { type: "command.batch", commands: [{ type: "command.batch", commands: [] }] },
      "INVALID_PATCH",
    );

    const layerOverride = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "command.batch",
      commands: [
        {
          type: "layer.update",
          layerId: "layer-project",
          patch: { source: { type: "asset", id: "asset-sheet" } },
        },
        { type: "region.remove", regionId: "region-hero", policy: "reject" },
      ],
    });
    expect(layerOverride.cascades).not.toContainEqual({ collection: "layers", id: "layer-project" });

    const regionOverride = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "command.batch",
      commands: [
        {
          type: "layer.update",
          layerId: "layer-cel",
          patch: { source: { type: "region", id: "region-hero" } },
        },
        { type: "region.remove", regionId: "region-hero", policy: "reject" },
      ],
    });
    expect(regionOverride.cascades).toContainEqual({ collection: "layers", id: "layer-cel" });
  });
});
