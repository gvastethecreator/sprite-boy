import { describe, expect, it } from "vitest";
import { analyzeProjectCommandImpact } from "../../core/project/impact";
import { cloneStudioProject } from "../../core/project/graph";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

function keys(values: Array<{ collection: string; id: string }>): string[] {
  return values.map(({ collection, id }) => `${collection}/${id}`);
}

describe("analyzeProjectCommandImpact (F1-06)", () => {
  it("reports deterministic prospective orphans and reject blockers for asset removal", () => {
    const impact = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "asset.remove",
      assetId: "asset-sheet",
      policy: "reject",
    });

    expect(keys(impact.direct)).toEqual(["assets/asset-sheet"]);
    expect(keys(impact.referencedBy)).toEqual([
      "assets/asset-processed",
      "regions/region-hero",
      "layers/layer-variant-b",
      "processingRecipes/recipe-grid",
      "generatedArtifacts/artifact-processed",
    ]);
    expect(keys(impact.cascades)).toEqual([
      "assets/asset-processed",
      "regions/region-hero",
      "layers/layer-cel",
      "layers/layer-project",
      "layers/layer-variant-a",
      "layers/layer-variant-b",
      "collisionSets/collision-region",
      "processingRecipes/recipe-grid",
      "generatedArtifacts/artifact-processed",
    ]);
    expect(impact.blockers).toHaveLength(5);
    expect(impact.blockers.every(({ code }) => code === "REFERENCE_BLOCKED")).toBe(true);

    const cascade = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "asset.remove",
      assetId: "asset-sheet",
      policy: "cascade",
    });
    expect(cascade.cascades).toEqual(impact.cascades);
    expect(cascade.blockers).toEqual([]);
  });

  it("models regions removed by reslicing without persisting dangling references", () => {
    const impact = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "region.remove",
      regionId: "region-hero",
      policy: "reject",
    });

    expect(keys(impact.referencedBy)).toEqual([
      "layers/layer-project",
      "layers/layer-variant-a",
      "collisionSets/collision-region",
    ]);
    expect(keys(impact.cascades)).toEqual([
      "layers/layer-project",
      "layers/layer-variant-a",
      "collisionSets/collision-region",
    ]);
    expect(impact.blockers).toHaveLength(3);
  });

  it("walks owned sequence graphs transitively while preserving the sequence owner boundary", () => {
    const impact = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "sequence.remove",
      sequenceId: "sequence-main",
      policy: "cascade",
    });

    expect(keys(impact.cascades)).toEqual([
      "layers/layer-cel",
      "layers/layer-variant-a",
      "layers/layer-variant-b",
      "compositions/composition-cel",
      "compositions/composition-variant-a",
      "compositions/composition-variant-b",
      "variantSets/variant-set-main",
      "cels/cel-composition",
      "cels/cel-variants",
    ]);
    expect(impact.blockers).toEqual([]);
  });

  it("treats cel source replacement as relink and protects its surviving cel", () => {
    const reject = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "cel.replaceSource",
      celId: "cel-composition",
      source: { type: "region", regionId: "region-hero" },
      policy: "reject",
    });
    expect(keys(reject.direct)).toEqual(["cels/cel-composition"]);
    expect(keys(reject.cascades)).toEqual([
      "layers/layer-cel",
      "compositions/composition-cel",
    ]);
    expect(keys(reject.cascades)).not.toContain("cels/cel-composition");
    expect(reject.blockers.length).toBeGreaterThan(0);

    const cascade = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "cel.replaceSource",
      celId: "cel-composition",
      source: { type: "region", regionId: "region-hero" },
      policy: "cascade",
    });
    expect(cascade.cascades).toEqual(reject.cascades);
    expect(cascade.blockers).toEqual([]);
  });

  it("accepts a new owned composition in the atomic relink payload", () => {
    const impact = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "cel.replaceSource",
      celId: "cel-composition",
      source: { type: "composition", compositionId: "composition-new" },
      ownedComposition: {
        id: "composition-new",
        name: "New private composition",
        owner: { type: "cel", celId: "cel-composition" },
        layerIds: [],
        width: 128,
        height: 128,
        createdAt: "2026-01-01T00:02:00.000Z",
        updatedAt: "2026-01-01T00:02:00.000Z",
      },
      ownedLayers: [],
      policy: "cascade",
    });
    expect(impact.blockers).toEqual([]);
    expect(keys(impact.cascades)).toEqual([
      "layers/layer-cel",
      "compositions/composition-cel",
    ]);
  });

  it("blocks relink to an existing private graph owned by another entity", () => {
    const impact = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "cel.replaceSource",
      celId: "cel-composition",
      source: { type: "composition", compositionId: "composition-variant-a" },
      policy: "cascade",
    });
    expect(impact.blockers).toMatchObject([{ code: "PRECONDITION_FAILED" }]);
    expect(impact.cascades).toEqual([]);
  });

  it("requires an explicit active-variant transition before removal", () => {
    const active = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "variant.remove",
      variantSetId: "variant-set-main",
      variant: "A",
      policy: "cascade",
    });
    expect(active.blockers).toMatchObject([{ code: "PRECONDITION_FAILED" }]);

    const project = cloneStudioProject(studioProjectV1Fixture);
    project.variantSets["variant-set-main"].activeVariant = "B";
    const inactive = analyzeProjectCommandImpact(project, {
      type: "variant.remove",
      variantSetId: "variant-set-main",
      variant: "A",
      policy: "cascade",
    });
    expect(keys(inactive.cascades)).toEqual([
      "layers/layer-variant-a",
      "compositions/composition-variant-a",
    ]);
    expect(inactive.blockers).toEqual([]);

    const sameIdentity = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "variant.replace",
      variantSetId: "variant-set-main",
      variant: "A",
      composition: studioProjectV1Fixture.compositions["composition-variant-a"],
      layers: [studioProjectV1Fixture.layers["layer-variant-a"]],
      policy: "reject",
    });
    expect(sameIdentity.cascades).toEqual([]);
    expect(sameIdentity.blockers).toEqual([]);
  });

  it("returns stable missing-target diagnostics", () => {
    const impact = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "composition.remove",
      compositionId: "missing",
      policy: "cascade",
    });
    expect(keys(impact.direct)).toEqual(["compositions/missing"]);
    expect(impact.blockers).toMatchObject([
      { code: "ENTITY_NOT_FOUND", entity: { collection: "compositions", id: "missing" } },
    ]);
  });

  it("rejects hostile command descriptors without invoking accessors", () => {
    let reads = 0;
    const getterCommand = Object.defineProperty({}, "type", {
      enumerable: true,
      get() {
        reads += 1;
        return "asset.remove";
      },
    });
    const getterImpact = analyzeProjectCommandImpact(studioProjectV1Fixture, getterCommand);
    expect(reads).toBe(0);
    expect(getterImpact.blockers).toMatchObject([{ code: "INVALID_PATCH" }]);

    const extra = { type: "asset.remove", assetId: "asset-sheet", policy: "cascade" };
    Object.defineProperty(extra, "hidden", { value: true });
    expect(analyzeProjectCommandImpact(studioProjectV1Fixture, extra).blockers).toMatchObject([
      { code: "INVALID_PATCH" },
    ]);

    const nestedSource = { regionId: "region-hero" } as { type: string; regionId: string };
    Object.defineProperty(nestedSource, "type", {
      enumerable: true,
      get() {
        reads += 1;
        return "region";
      },
    });
    const nested = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "cel.replaceSource",
      celId: "cel-composition",
      source: nestedSource,
      policy: "cascade",
    });
    expect(reads).toBe(0);
    expect(nested.blockers).toMatchObject([{ code: "INVALID_PATCH" }]);

    const nestedComposition = {
      name: "hostile",
      owner: { type: "variantSet", variantSetId: "variant-set-main", variant: "A" },
      layerIds: [],
      width: 1,
      height: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as Record<string, unknown>;
    Object.defineProperty(nestedComposition, "id", {
      enumerable: true,
      get() {
        reads += 1;
        return "composition-variant-a";
      },
    });
    const nestedVariant = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "variant.replace",
      variantSetId: "variant-set-main",
      variant: "A",
      composition: nestedComposition,
      layers: [],
      policy: "cascade",
    });
    expect(reads).toBe(0);
    expect(nestedVariant.blockers).toMatchObject([{ code: "INVALID_PATCH" }]);

    const hiddenType = { regionId: "region-hero" } as { type: string; regionId: string };
    Object.defineProperty(hiddenType, "type", { value: "region", enumerable: false });
    expect(analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "cel.replaceSource",
      celId: "cel-composition",
      source: hiddenType,
      policy: "cascade",
    }).blockers).toMatchObject([{ code: "INVALID_PATCH" }]);
  });

  it("rejects unknown commands and merges an atomic reslice batch", () => {
    expect(analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "totally.unknown",
    }).blockers).toMatchObject([{ code: "COMMAND_UNSUPPORTED" }]);

    const batch = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "command.batch",
      commands: [
        { type: "region.remove", regionId: "region-hero", policy: "cascade" },
        {
          type: "regions.commitRecipe",
          recipe: studioProjectV1Fixture.processingRecipes["recipe-grid"],
          regions: [],
        },
      ],
    });
    expect(keys(batch.direct)).toEqual(["regions/region-hero"]);
    expect(keys(batch.cascades)).toEqual([
      "layers/layer-project",
      "layers/layer-variant-a",
      "collisionSets/collision-region",
    ]);
    expect(batch.blockers).toEqual([]);

    const explicitCleanup = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "command.batch",
      commands: [
        { type: "layer.remove", layerId: "layer-project" },
        { type: "composition.remove", compositionId: "composition-project", policy: "reject" },
      ],
    });
    expect(keys(explicitCleanup.direct)).toEqual([
      "layers/layer-project",
      "compositions/composition-project",
    ]);
    expect(explicitCleanup.cascades).toEqual([]);
    expect(explicitCleanup.blockers).toEqual([]);

    const noPrivateGraph = cloneStudioProject(studioProjectV1Fixture);
    noPrivateGraph.cels["cel-composition"].source = { type: "region", regionId: "region-hero" };
    delete noPrivateGraph.layers["layer-cel"];
    delete noPrivateGraph.compositions["composition-cel"];
    const unsafeNoOp = analyzeProjectCommandImpact(noPrivateGraph, {
      type: "command.batch",
      commands: [
        { type: "layer.remove", layerId: "layer-project" },
        { type: "layer.remove", layerId: "layer-variant-a" },
        { type: "collisionSet.remove", collisionSetId: "collision-region" },
        {
          type: "cel.replaceSource",
          celId: "cel-composition",
          source: { type: "region", regionId: "region-hero" },
          policy: "reject",
        },
        { type: "region.remove", regionId: "region-hero", policy: "reject" },
      ],
    });
    expect(keys(unsafeNoOp.cascades)).toEqual(["cels/cel-composition"]);
    expect(unsafeNoOp.blockers).toMatchObject([
      { code: "REFERENCE_BLOCKED", entity: { collection: "cels", id: "cel-composition" } },
    ]);

    const safelyRelinked = cloneStudioProject(noPrivateGraph);
    safelyRelinked.regions["region-replacement"] = {
      ...safelyRelinked.regions["region-hero"],
      id: "region-replacement",
      name: "Replacement",
    };
    safelyRelinked.rootOrder.regionIds.push("region-replacement");
    const safeBatch = analyzeProjectCommandImpact(safelyRelinked, {
      type: "command.batch",
      commands: [
        { type: "layer.remove", layerId: "layer-project" },
        { type: "layer.remove", layerId: "layer-variant-a" },
        { type: "collisionSet.remove", collisionSetId: "collision-region" },
        {
          type: "cel.replaceSource",
          celId: "cel-composition",
          source: { type: "region", regionId: "region-replacement" },
          policy: "reject",
        },
        { type: "region.remove", regionId: "region-hero", policy: "reject" },
      ],
    });
    expect(safeBatch.cascades).toEqual([]);
    expect(safeBatch.blockers).toEqual([]);

    const doubleRelink = analyzeProjectCommandImpact(safelyRelinked, {
      type: "command.batch",
      commands: [
        { type: "layer.remove", layerId: "layer-project" },
        { type: "layer.remove", layerId: "layer-variant-a" },
        { type: "collisionSet.remove", collisionSetId: "collision-region" },
        {
          type: "cel.replaceSource",
          celId: "cel-composition",
          source: { type: "region", regionId: "region-replacement" },
          policy: "reject",
        },
        {
          type: "cel.replaceSource",
          celId: "cel-composition",
          source: { type: "region", regionId: "region-hero" },
          policy: "reject",
        },
        { type: "region.remove", regionId: "region-hero", policy: "reject" },
      ],
    });
    expect(keys(doubleRelink.cascades)).toEqual(["cels/cel-composition"]);
    expect(doubleRelink.blockers).toMatchObject([
      { code: "REFERENCE_BLOCKED", entity: { collection: "cels", id: "cel-composition" } },
    ]);

    const relinkIntoRemovedTarget = analyzeProjectCommandImpact(safelyRelinked, {
      type: "command.batch",
      commands: [
        {
          type: "cel.replaceSource",
          celId: "cel-composition",
          source: { type: "region", regionId: "region-replacement" },
          policy: "reject",
        },
        { type: "region.remove", regionId: "region-replacement", policy: "reject" },
      ],
    });
    expect(keys(relinkIntoRemovedTarget.cascades)).toEqual(["cels/cel-composition"]);
    expect(relinkIntoRemovedTarget.blockers).toMatchObject([
      { code: "REFERENCE_BLOCKED", entity: { collection: "cels", id: "cel-composition" } },
    ]);

    const ownedRelinkBatch = analyzeProjectCommandImpact(noPrivateGraph, {
      type: "command.batch",
      commands: [
        { type: "layer.remove", layerId: "layer-project" },
        { type: "layer.remove", layerId: "layer-variant-a" },
        { type: "collisionSet.remove", collisionSetId: "collision-region" },
        {
          type: "cel.replaceSource",
          celId: "cel-composition",
          source: { type: "composition", compositionId: "composition-new" },
          ownedComposition: {
            id: "composition-new",
            name: "New",
            owner: { type: "cel", celId: "cel-composition" },
            layerIds: [],
            width: 128,
            height: 128,
            createdAt: "2026-01-01T00:02:00.000Z",
            updatedAt: "2026-01-01T00:02:00.000Z",
          },
          ownedLayers: [],
          policy: "reject",
        },
        { type: "region.remove", regionId: "region-hero", policy: "reject" },
      ],
    });
    expect(ownedRelinkBatch.cascades).toEqual([]);
    expect(ownedRelinkBatch.blockers).toEqual([]);
  });

  it("refuses to analyze an already-invalid graph", () => {
    const invalid = cloneStudioProject(studioProjectV1Fixture);
    delete invalid.assets["asset-sheet"];
    const impact = analyzeProjectCommandImpact(invalid, {
      type: "region.remove",
      regionId: "region-hero",
      policy: "cascade",
    });
    expect(impact.direct).toEqual([]);
    expect(impact.blockers.length).toBeGreaterThan(0);
    expect(impact.blockers.every(({ code }) => code === "INVARIANT_VIOLATION")).toBe(true);
  });
});
