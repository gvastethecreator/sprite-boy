import { describe, expect, it } from "vitest";
import { GRID_PROCESSING_LIMITS } from "../../core/processing/gridProcessingLimits";
import { validateStudioProject } from "../../core/project";
import type { StudioProjectV1 } from "../../core/project/schema";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

type ExpectedDiagnostic = readonly [code: string, path: string];

function cloneFixture(): StudioProjectV1 {
  return JSON.parse(JSON.stringify(studioProjectV1Fixture)) as StudioProjectV1;
}

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function expectDiagnostics(input: unknown, expected: readonly ExpectedDiagnostic[]): void {
  const result = validateStudioProject(input);
  expect(result.valid).toBe(false);
  for (const [code, path] of expected) {
    expect(result.diagnostics, `${code} at ${path}`).toContainEqual(
      expect.objectContaining({ code, path }),
    );
  }
}

describe("StudioProjectV1 hostile validation matrix", () => {
  it("contains every non-canonical JSON shape without evaluating accessors", () => {
    const negativeZero = cloneFixture();
    record(negativeZero.workspace).runtimeOffset = -0;
    expectDiagnostics(negativeZero, [["INVALID_NUMBER", "$.workspace.runtimeOffset"]]);

    const cyclic = cloneFixture();
    record(cyclic.workspace).cycle = cyclic.workspace;
    expectDiagnostics(cyclic, [["NON_JSON_VALUE", "$.workspace.cycle"]]);

    const accessorArray = cloneFixture();
    let invoked = false;
    Object.defineProperty(accessorArray.workspace.selectedCelIds, "0", {
      configurable: true,
      enumerable: true,
      get() {
        invoked = true;
        return "cel-composition";
      },
    });
    expectDiagnostics(accessorArray, [["NON_JSON_VALUE", "$.workspace.selectedCelIds[0]"]]);
    expect(invoked).toBe(false);

    const symbolObject = cloneFixture();
    Reflect.defineProperty(symbolObject.workspace, Symbol("selection"), {
      enumerable: true,
      value: true,
    });
    const result = validateStudioProject(symbolObject);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some(({ code }) => code === "NON_JSON_VALUE")).toBe(true);
  });

  it("rejects malformed roots, collections, records and order values", () => {
    const root = cloneFixture();
    delete record(root).schemaVersion;
    record(root).rootOrder = null;
    record(root).workspace = null;
    expectDiagnostics(root, [
      ["INVALID_DOCUMENT", "$.schemaVersion"],
      ["INVALID_DOCUMENT", "$.rootOrder"],
      ["INVALID_DOCUMENT", "$.workspace"],
    ]);

    const collections = cloneFixture();
    record(collections).assets = null;
    record(collections.layers)["layer-project"] = "not-an-entity";
    record(collections.rootOrder).regionIds = [42, "region-hero", "missing-region"];
    expectDiagnostics(collections, [
      ["INVALID_DOCUMENT", "$.assets"],
      ["INVALID_DOCUMENT", "$.layers.layer-project"],
      ["INVALID_ID", "$.rootOrder.regionIds[0]"],
      ["ORDER_MISMATCH", "$.rootOrder.regionIds"],
    ]);

    const invalidEntityId = cloneFixture();
    record(invalidEntityId.assets).invalid = {
      ...invalidEntityId.assets["asset-sheet"],
      id: "",
    };
    expectDiagnostics(invalidEntityId, [["INVALID_ID", "$.assets.invalid.id"]]);
  });

  it("validates malformed assets, regions, layers and compositions", () => {
    const project = cloneFixture();
    record(project.assets["asset-sheet"]).byteSize = -1;
    record(project.assets["asset-sheet"]).provenance = null;
    record(project.regions["region-hero"]).bounds = null;
    record(project.regions["region-hero"]).pivot = null;
    record(project.regions["region-hero"]).hidden = "yes";
    record(project.regions["region-hero"]).provenance = null;
    record(project.layers["layer-project"]).name = 42;
    record(project.layers["layer-project"]).source = null;
    record(project.layers["layer-project"]).transform = null;
    record(project.layers["layer-project"]).visible = "yes";
    record(project.layers["layer-project"]).locked = "yes";
    record(project.compositions["composition-project"]).layerIds = null;

    expectDiagnostics(project, [
      ["INVALID_NUMBER", "$.assets.asset-sheet.byteSize"],
      ["INVALID_DOCUMENT", "$.assets.asset-sheet.provenance"],
      ["INVALID_DIMENSIONS", "$.regions.region-hero.bounds"],
      ["INVALID_DOCUMENT", "$.regions.region-hero.pivot"],
      ["INVALID_DOCUMENT", "$.regions.region-hero.hidden"],
      ["INVALID_DOCUMENT", "$.regions.region-hero.provenance"],
      ["INVALID_DOCUMENT", "$.layers.layer-project.source"],
      ["INVALID_DOCUMENT", "$.layers.layer-project.transform"],
      ["INVALID_DOCUMENT", "$.compositions.composition-project.layerIds"],
    ]);

    const missingOwner = cloneFixture();
    record(missingOwner.compositions["composition-project"]).owner = null;
    expectDiagnostics(missingOwner, [
      ["INVALID_DOCUMENT", "$.compositions.composition-project.owner"],
    ]);

    const sourceKinds = cloneFixture();
    record(sourceKinds.layers["layer-project"]).source = {
      type: "composition",
      id: "composition-cel",
    };
    record(sourceKinds.layers["layer-cel"]).source = { type: "runtime", id: "asset-sheet" };
    expectDiagnostics(sourceKinds, [
      ["NESTED_COMPOSITION_FORBIDDEN", "$.layers.layer-project.source"],
      ["INVALID_DOCUMENT", "$.layers.layer-cel.source"],
    ]);

    const owners = cloneFixture();
    record(owners.compositions["composition-project"]).owner = { type: "runtime" };
    record(record(owners.compositions["composition-variant-a"]).owner).variant = "Z";
    expectDiagnostics(owners, [
      ["INVALID_DOCUMENT", "$.compositions.composition-project.owner"],
      ["INVALID_DOCUMENT", "$.compositions.composition-variant-a.owner.variant"],
    ]);
  });

  it("validates every variant, cel and sequence failure branch", () => {
    const variants = cloneFixture();
    record(variants.variantSets["variant-set-main"]).variants = null;
    record(variants.variantSets["variant-set-main"]).activeVariant = "Z";
    expectDiagnostics(variants, [
      ["INVALID_DOCUMENT", "$.variantSets.variant-set-main.variants"],
      ["INVALID_DOCUMENT", "$.variantSets.variant-set-main.activeVariant"],
    ]);

    const variantKeys = cloneFixture();
    record(variantKeys.variantSets["variant-set-main"]).variants = {
      A: "composition-variant-a",
      E: "composition-variant-b",
      C: "missing-composition",
      D: "composition-project",
      B: "composition-variant-b",
    };
    expectDiagnostics(variantKeys, [
      ["ORDER_MISMATCH", "$.variantSets.variant-set-main.variants"],
      ["MISSING_REFERENCE", "$.variantSets.variant-set-main.variants.C"],
      ["INVALID_DOCUMENT", "$.variantSets.variant-set-main.variants.E"],
    ]);

    const cel = cloneFixture();
    record(cel.cels["cel-composition"]).durationMs = 0;
    record(cel.cels["cel-composition"]).source = null;
    record(cel.cels["cel-composition"]).pivot = null;
    record(cel.cels["cel-composition"]).locked = "yes";
    record(cel.cels["cel-composition"]).prompt = 42;
    record(cel.cels["cel-composition"]).transform = null;
    expectDiagnostics(cel, [
      ["INVALID_NUMBER", "$.cels.cel-composition.durationMs"],
      ["INVALID_DOCUMENT", "$.cels.cel-composition.source"],
    ]);

    const regionCel = cloneFixture();
    record(regionCel.cels["cel-composition"]).source = {
      type: "region",
      regionId: "missing-region",
    };
    record(regionCel.cels["cel-variants"]).source = { type: "runtime" };
    expectDiagnostics(regionCel, [
      ["MISSING_REFERENCE", "$.cels.cel-composition.source.regionId"],
      ["INVALID_DOCUMENT", "$.cels.cel-variants.source"],
    ]);

    const sequence = cloneFixture();
    record(sequence.sequences["sequence-main"]).celIds = [42, "missing-cel"];
    record(sequence.sequences["sequence-main"]).fps = 0;
    record(sequence.sequences["sequence-main"]).defaultDurationMs = 0;
    record(sequence.sequences["sequence-main"]).loop = "yes";
    expectDiagnostics(sequence, [
      ["INVALID_ID", "$.sequences.sequence-main.celIds[0]"],
      ["MISSING_REFERENCE", "$.sequences.sequence-main.celIds[1]"],
      ["INVALID_NUMBER", "$.sequences.sequence-main.fps"],
      ["INVALID_NUMBER", "$.sequences.sequence-main.defaultDurationMs"],
      ["INVALID_DOCUMENT", "$.sequences.sequence-main.loop"],
    ]);
  });

  it("validates collision owner and shape alternatives", () => {
    for (const owner of [
      { type: "composition", compositionId: "composition-project" },
      { type: "cel", celId: "cel-composition" },
    ]) {
      const validOwner = cloneFixture();
      record(validOwner.collisionSets["collision-region"]).owner = owner;
      expect(validateStudioProject(validOwner).valid).toBe(true);
    }

    const invalidOwner = cloneFixture();
    record(invalidOwner.collisionSets["collision-region"]).owner = null;
    expectDiagnostics(invalidOwner, [["INVALID_DOCUMENT", "$.collisionSets.collision-region.owner"]]);

    const unsupportedOwner = cloneFixture();
    record(unsupportedOwner.collisionSets["collision-region"]).owner = { type: "project" };
    expectDiagnostics(unsupportedOwner, [["INVALID_DOCUMENT", "$.collisionSets.collision-region.owner"]]);

    const invalidShapes = cloneFixture();
    record(invalidShapes.collisionSets["collision-region"]).shapes = [
      null,
      { id: "", type: "circle", bounds: null, tag: 42 },
      { id: "duplicate", type: "hitbox", bounds: { x: 0, y: 0, width: 1, height: 1 } },
      { id: "duplicate", type: "solid", bounds: { x: 0, y: 0, width: 1, height: 1 } },
    ];
    expectDiagnostics(invalidShapes, [
      ["INVALID_DOCUMENT", "$.collisionSets.collision-region.shapes[0]"],
      ["INVALID_ID", "$.collisionSets.collision-region.shapes[1].id"],
      ["INVALID_DOCUMENT", "$.collisionSets.collision-region.shapes[1].type"],
      ["INVALID_DIMENSIONS", "$.collisionSets.collision-region.shapes[1].bounds"],
      ["DUPLICATE_OWNERSHIP", "$.collisionSets.collision-region.shapes[3].id"],
    ]);

    const noShapes = cloneFixture();
    record(noShapes.collisionSets["collision-region"]).shapes = null;
    expectDiagnostics(noShapes, [["INVALID_DOCUMENT", "$.collisionSets.collision-region.shapes"]]);
  });

  it("validates processing recipes across manual, auto and malformed modes", () => {
    const required = cloneFixture();
    const recipe = record(required.processingRecipes["recipe-grid"]);
    recipe.name = 42;
    recipe.kind = "runtime";
    recipe.version = 2;
    recipe.sourceAssetId = "";
    recipe.layout = null;
    recipe.crop = null;
    recipe.chroma = null;
    recipe.pixel = null;
    expectDiagnostics(required, [
      ["INVALID_DOCUMENT", "$.processingRecipes.recipe-grid.kind"],
      ["UNSUPPORTED_SCHEMA_VERSION", "$.processingRecipes.recipe-grid.version"],
      ["INVALID_ID", "$.processingRecipes.recipe-grid.sourceAssetId"],
      ["INVALID_DOCUMENT", "$.processingRecipes.recipe-grid.layout"],
      ["INVALID_DOCUMENT", "$.processingRecipes.recipe-grid.crop"],
      ["INVALID_DOCUMENT", "$.processingRecipes.recipe-grid.chroma"],
      ["INVALID_DOCUMENT", "$.processingRecipes.recipe-grid.pixel"],
    ]);

    const auto = cloneFixture();
    record(auto.processingRecipes["recipe-grid"]).layout = { mode: "auto" };
    expect(validateStudioProject(auto).valid).toBe(true);

    const malformed = cloneFixture();
    const malformedRecipe = record(malformed.processingRecipes["recipe-grid"]);
    malformedRecipe.layout = { mode: "runtime" };
    malformedRecipe.crop = { threshold: "low", padding: null };
    malformedRecipe.chroma = {
      enabled: "yes",
      color: 42,
      tolerance: null,
      smoothness: null,
      spill: null,
    };
    malformedRecipe.pixel = {
      enabled: "yes",
      size: 0,
      quantize: "yes",
      colors: 0,
      palette: "#fff",
    };
    expectDiagnostics(malformed, [
      ["INVALID_DOCUMENT", "$.processingRecipes.recipe-grid.layout"],
      ["INVALID_NUMBER", "$.processingRecipes.recipe-grid.crop.threshold"],
      ["INVALID_DOCUMENT", "$.processingRecipes.recipe-grid.pixel.palette"],
    ]);

    const workerIncompatible = cloneFixture();
    record(workerIncompatible.processingRecipes["recipe-grid"]).layout = {
      mode: "manual",
      rows: 65,
      cols: 64,
    };
    expectDiagnostics(workerIncompatible, [[
      "INVALID_NUMBER",
      "$.processingRecipes.recipe-grid.layout",
    ]]);

    const excessiveAxis = cloneFixture();
    record(excessiveAxis.processingRecipes["recipe-grid"]).layout = {
      mode: "manual",
      rows: 4_097,
      cols: 1,
    };
    expectDiagnostics(excessiveAxis, [[
      "INVALID_NUMBER",
      "$.processingRecipes.recipe-grid.layout.rows",
    ]]);

    for (const [key, value] of [
      ["threshold", -1],
      ["threshold", 100.01],
      ["padding", -1],
      ["padding", 1.5],
      ["padding", GRID_PROCESSING_LIMITS.maxDimension + 1],
    ] as const) {
      const hostileCrop = cloneFixture();
      record(record(hostileCrop.processingRecipes["recipe-grid"]).crop)[key] = value;
      expectDiagnostics(hostileCrop, [[
        "INVALID_NUMBER",
        `$.processingRecipes.recipe-grid.crop.${key}`,
      ]]);
    }

    for (const [key, value, code] of [
      ["color", "00ff00", "INVALID_DOCUMENT"],
      ["color", "#0f0", "INVALID_DOCUMENT"],
      ["tolerance", -1, "INVALID_NUMBER"],
      ["tolerance", 100.01, "INVALID_NUMBER"],
      ["smoothness", -1, "INVALID_NUMBER"],
      ["smoothness", 101, "INVALID_NUMBER"],
      ["spill", -1, "INVALID_NUMBER"],
      ["spill", 101, "INVALID_NUMBER"],
    ] as const) {
      const hostileChroma = cloneFixture();
      record(record(hostileChroma.processingRecipes["recipe-grid"]).chroma)[key] = value;
      expectDiagnostics(hostileChroma, [[
        code,
        `$.processingRecipes.recipe-grid.chroma.${key}`,
      ]]);
    }
  });

  it("validates artifact economics, references and provenance consistency", () => {
    const malformed = cloneFixture();
    const artifact = record(malformed.generatedArtifacts["artifact-processed"]);
    artifact.type = "runtime";
    artifact.outputAssetId = "";
    artifact.name = 42;
    artifact.cost = null;
    artifact.byteSize = -1;
    expectDiagnostics(malformed, [
      ["INVALID_DOCUMENT", "$.generatedArtifacts.artifact-processed.type"],
      ["INVALID_ID", "$.generatedArtifacts.artifact-processed.outputAssetId"],
      ["INVALID_DOCUMENT", "$.generatedArtifacts.artifact-processed.cost"],
      ["INVALID_NUMBER", "$.generatedArtifacts.artifact-processed.byteSize"],
    ]);

    const economics = cloneFixture();
    record(economics.generatedArtifacts["artifact-processed"]).cost = {
      amount: -1,
      currency: 42,
    };
    expectDiagnostics(economics, [
      ["INVALID_NUMBER", "$.generatedArtifacts.artifact-processed.cost.amount"],
      ["INVALID_DOCUMENT", "$.generatedArtifacts.artifact-processed.cost.currency"],
    ]);

    const provenance = cloneFixture();
    provenance.processingRecipes["recipe-alt"] = {
      ...provenance.processingRecipes["recipe-grid"],
      id: "recipe-alt",
    };
    provenance.generatedArtifacts["artifact-processed"].recipeId = "recipe-alt";
    provenance.generatedArtifacts["artifact-processed"].sourceAssetId = "asset-processed";
    const result = validateStudioProject(provenance);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "OWNER_MISMATCH",
          path: "$.generatedArtifacts.artifact-processed.recipeId",
        }),
        expect.objectContaining({
          code: "OWNER_MISMATCH",
          path: "$.generatedArtifacts.artifact-processed.sourceAssetId",
        }),
        expect.objectContaining({
          code: "OWNER_MISMATCH",
          path: "$.generatedArtifacts.artifact-processed.provenance.recipeId",
        }),
      ]),
    );
  });

  it("validates workspace references and graph ownership edge cases", () => {
    const workspace = cloneFixture();
    record(workspace.workspace).activeWorkspace = "runtime";
    record(workspace.workspace).selectedAssetId = "missing-asset";
    record(workspace.workspace).selectedRegionId = 42;
    record(workspace.workspace).selectedCelIds = "cel-composition";
    expectDiagnostics(workspace, [
      ["INVALID_DOCUMENT", "$.workspace.activeWorkspace"],
      ["MISSING_REFERENCE", "$.workspace.selectedAssetId"],
      ["INVALID_ID", "$.workspace.selectedRegionId"],
      ["INVALID_DOCUMENT", "$.workspace.selectedCelIds"],
    ]);

    const sharedVariant = cloneFixture();
    sharedVariant.cels["cel-shared"] = {
      ...sharedVariant.cels["cel-variants"],
      id: "cel-shared",
    };
    sharedVariant.sequences["sequence-main"].celIds.push("cel-shared");
    expectDiagnostics(sharedVariant, [
      ["DUPLICATE_OWNERSHIP", "$.variantSets.variant-set-main.celId"],
    ]);

    const mismatchedVariantOwner = cloneFixture();
    mismatchedVariantOwner.variantSets["variant-set-main"].celId = "cel-composition";
    expectDiagnostics(mismatchedVariantOwner, [
      ["OWNER_MISMATCH", "$.variantSets.variant-set-main.celId"],
    ]);

    const duplicatedVariantComposition = cloneFixture();
    duplicatedVariantComposition.variantSets["variant-set-main"].variants.B =
      "composition-variant-a";
    expectDiagnostics(duplicatedVariantComposition, [
      ["DUPLICATE_OWNERSHIP", "$.compositions.composition-variant-a.owner"],
    ]);
  });
});
