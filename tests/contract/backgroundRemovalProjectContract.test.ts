import { describe, expect, it } from "vitest";
import {
  applyProjectCommand,
  applyProjectCommandBatch,
  applyProjectCommandInverse,
  createEmptyStudioProject,
  validateStudioProject,
  type AssetRecord,
  type BackgroundRemovalRecipeV1,
  type GeneratedArtifact,
  type ProcessingRecipe,
  type ProjectCommandContext,
  type StudioProject,
} from "../../core/project";

const NOW = "2026-07-26T03:00:00.000Z";
const context: ProjectCommandContext = { now: () => NOW, nextId: () => "unused" };

function asset(id: string, provenance: AssetRecord["provenance"] = { source: "fixture" }): AssetRecord {
  return {
    id,
    name: `${id}.png`,
    blobKey: `blob-${id}`,
    contentHash: `sha256:${id}`,
    mimeType: "image/png",
    width: 32,
    height: 24,
    byteSize: 256,
    createdAt: NOW,
    updatedAt: NOW,
    provenance,
    media: { type: "image" },
  };
}

function baseProject(): StudioProject {
  const project = createEmptyStudioProject({ id: "background-project", name: "Background project", now: NOW });
  const source = asset("source");
  project.assets[source.id] = source;
  project.rootOrder.assetIds.push(source.id);
  return project;
}

function recipe(overrides: Partial<BackgroundRemovalRecipeV1> = {}): ProcessingRecipe & BackgroundRemovalRecipeV1 {
  return {
    id: "recipe-background",
    kind: "background-removal",
    version: 1,
    sourceAssetId: "source",
    model: {
      id: "birefnet-lite-512",
      revision: "4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7",
      backend: "wasm",
      inputWidth: 512,
      inputHeight: 512,
    },
    output: { mimeType: "image/png", alpha: "soft-mask" },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as ProcessingRecipe & BackgroundRemovalRecipeV1;
}

function artifact(): GeneratedArtifact {
  return {
    id: "artifact-background",
    name: "Removed background",
    type: "processed",
    outputAssetId: "output",
    sourceAssetId: "source",
    recipeId: "recipe-background",
    mimeType: "image/png",
    byteSize: 256,
    model: "studioludens/birefnet-lite-512@4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7",
    provenance: {
      source: "local-background-removal",
      recipeId: "recipe-background",
      model: "studioludens/birefnet-lite-512@4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7",
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function outputAsset(): AssetRecord {
  return asset("output", {
    source: "derived",
    parentAssetId: "source",
    recipeId: "recipe-background",
    artifactId: "artifact-background",
  });
}

describe("background-removal durable project contract", () => {
  it("accepts the pinned model, backend and soft-mask output", () => {
    const project = baseProject();
    project.processingRecipes["recipe-background"] = recipe();
    project.assets.output = outputAsset();
    project.rootOrder.assetIds.push("output");
    project.generatedArtifacts["artifact-background"] = artifact();

    expect(validateStudioProject(project)).toMatchObject({ valid: true, diagnostics: [] });
  });

  it.each([
    ["source media", { sourceAssetId: "missing" }, "$.processingRecipes.recipe-background.sourceAssetId"],
    ["backend", { model: { ...recipe().model, backend: "cuda" } }, "$.processingRecipes.recipe-background.model.backend"],
    ["model dimensions", { model: { ...recipe().model, inputWidth: 0 } }, "$.processingRecipes.recipe-background.model.inputWidth"],
    ["alpha policy", { output: { mimeType: "image/png", alpha: "binary" } }, "$.processingRecipes.recipe-background.output.alpha"],
  ])("rejects an invalid %s", (_label, overrides, path) => {
    const project = baseProject();
    project.processingRecipes["recipe-background"] = recipe(overrides as Partial<BackgroundRemovalRecipeV1>);
    const result = validateStudioProject(project);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((item) => item.path === path)).toBe(true);
  });

  it("records recipe, output asset and artifact in one command and restores the exact snapshot", () => {
    const project = baseProject();
    const result = applyProjectCommand(project, {
      type: "artifact.record",
      recipe: recipe(),
      outputAsset: outputAsset(),
      artifact: artifact(),
      atIndex: 1,
    }, context);
    if (!result.ok) throw new Error(result.diagnostics.map((item) => item.message).join("; "));

    expect(result.project.rootOrder.assetIds).toEqual(["source", "output"]);
    expect(result.project.processingRecipes["recipe-background"]).toBeDefined();
    expect(result.project.assets.output.provenance.artifactId).toBe("artifact-background");
    expect(result.project.generatedArtifacts["artifact-background"].outputAssetId).toBe("output");
    expect(result.changedIds).toEqual({
      assets: ["output"],
      generatedArtifacts: ["artifact-background"],
      processingRecipes: ["recipe-background"],
      rootOrder: ["output"],
    });
    expect(validateStudioProject(result.project).valid).toBe(true);
    expect(project.assets.output).toBeUndefined();

    const restored = applyProjectCommandInverse(result.project, result.inverse, context);
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.project).toEqual(project);
  });

  it("rejects mismatched links and preserves the original reference", () => {
    const project = baseProject();
    const badArtifact = { ...artifact(), outputAssetId: "wrong-output" };
    const result = applyProjectCommand(project, {
      type: "artifact.record",
      recipe: recipe(),
      outputAsset: outputAsset(),
      artifact: badArtifact,
    }, context);

    expect(result.ok).toBe(false);
    expect(result.project).toBe(project);
    if (!result.ok) expect(result.diagnostics[0]).toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejects an artifact whose recipe names another source", () => {
    const project = baseProject();
    const result = applyProjectCommand(project, {
      type: "artifact.record",
      recipe: recipe({ sourceAssetId: "other-source" }),
      outputAsset: outputAsset(),
      artifact: artifact(),
    }, context);

    expect(result.ok).toBe(false);
    expect(result.project).toBe(project);
    if (!result.ok) expect(result.diagnostics[0]).toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("reports created entities in batch impact", () => {
    const result = applyProjectCommandBatch(baseProject(), {
      type: "command.batch",
      commands: [{
        type: "artifact.record",
        recipe: recipe(),
        outputAsset: outputAsset(),
        artifact: artifact(),
      }],
    }, context);
    if (!result.ok) throw new Error(result.diagnostics.map((item) => item.message).join("; "));
    expect(result.impact.direct).toEqual([
      { collection: "assets", id: "output" },
      { collection: "processingRecipes", id: "recipe-background" },
      { collection: "generatedArtifacts", id: "artifact-background" },
    ]);
  });

  it("rejects nested getters without executing them", () => {
    let reads = 0;
    const hostileArtifact = artifact() as GeneratedArtifact & { provenance: GeneratedArtifact["provenance"] };
    Object.defineProperty(hostileArtifact.provenance, "model", {
      enumerable: true,
      get() {
        reads += 1;
        return "hostile";
      },
    });
    const project = baseProject();
    const result = applyProjectCommand(project, {
      type: "artifact.record",
      recipe: recipe(),
      outputAsset: outputAsset(),
      artifact: hostileArtifact,
    }, context);
    expect(result.ok).toBe(false);
    expect(result.project).toBe(project);
    expect(reads).toBe(0);
  });
});
