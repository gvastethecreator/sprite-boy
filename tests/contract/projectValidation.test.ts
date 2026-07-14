import { describe, expect, it } from "vitest";
import { createEmptyStudioProject } from "../../core/project/factory";
import { validateStudioProject } from "../../core/project";
import type { StudioProjectV1 } from "../../core/project/schema";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

function cloneFixture(): StudioProjectV1 {
  return JSON.parse(JSON.stringify(studioProjectV1Fixture)) as StudioProjectV1;
}

function diagnosticCodes(result: ReturnType<typeof validateStudioProject>): string[] {
  return result.diagnostics.map(({ code }) => code);
}

function expectDiagnostic(
  result: ReturnType<typeof validateStudioProject>,
  code: string,
  path?: string,
): void {
  expect(result.valid).toBe(false);
  expect(diagnosticCodes(result)).toContain(code);
  if (path) {
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === code && diagnostic.path === path)).toBe(true);
  }
}

describe("StudioProjectV1 validation contract", () => {
  it("accepts the deterministic empty project produced by the factory", () => {
    const project = createEmptyStudioProject({
      id: "empty-contract-project",
      name: "Empty contract project",
      now: "2026-01-01T00:00:00.000Z",
    });

    const result = validateStudioProject(project);

    expect(result).toMatchObject({ valid: true, diagnostics: [], project });
  });

  it("accepts a connected representative graph and keeps its artifact durable", () => {
    const result = validateStudioProject(studioProjectV1Fixture);
    const artifact = studioProjectV1Fixture.generatedArtifacts["artifact-processed"];

    expect(result).toMatchObject({ valid: true, diagnostics: [], project: studioProjectV1Fixture });
    expect(artifact).not.toHaveProperty("status");
    expect(artifact).not.toHaveProperty("progress");
    expect(artifact).not.toHaveProperty("jobId");
    expect(JSON.parse(JSON.stringify(studioProjectV1Fixture))).toEqual(studioProjectV1Fixture);
  });

  it.each([null, [], "not-a-project", 42, true])("rejects a non-object document: %p", (input) => {
    const result = validateStudioProject(input);

    expectDiagnostic(result, "INVALID_DOCUMENT", "$");
  });

  it("rejects a future schema version", () => {
    const project = { ...cloneFixture(), schemaVersion: 2 };

    const result = validateStudioProject(project);

    expectDiagnostic(result, "UNSUPPORTED_SCHEMA_VERSION", "$.schemaVersion");
  });

  it("rejects Blob values, object/data URLs, and other non-JSON values", () => {
    const blobProject = cloneFixture();
    blobProject.assets["asset-sheet"].blobKey = new Blob(["fixture"], { type: "image/png" }) as unknown as string;
    expectDiagnostic(validateStudioProject(blobProject), "NON_JSON_VALUE", "$.assets.asset-sheet.blobKey");

    const urlProject = cloneFixture();
    urlProject.assets["asset-sheet"].blobKey = "blob:runtime-lease";
    urlProject.assets["asset-sheet"].contentHash = "data:image/png;base64,AAAA";
    const urlResult = validateStudioProject(urlProject);
    expectDiagnostic(urlResult, "RUNTIME_URL", "$.assets.asset-sheet.blobKey");
    expect(urlResult.diagnostics.some(({ code, path }) => code === "RUNTIME_URL" && path === "$.assets.asset-sheet.contentHash")).toBe(true);

    const nonJsonProject = cloneFixture();
    const unsafeWorkspace = nonJsonProject.workspace as unknown as Record<string, unknown>;
    unsafeWorkspace.undefinedValue = undefined;
    unsafeWorkspace.functionValue = () => "runtime";
    unsafeWorkspace.symbolValue = Symbol("runtime");
    unsafeWorkspace.bigintValue = BigInt(1);
    unsafeWorkspace.dateValue = new Date("2026-01-01T00:00:00.000Z");
    expectDiagnostic(validateStudioProject(nonJsonProject), "NON_JSON_VALUE");
  });

  it("rejects a collection key whose record id differs", () => {
    const project = cloneFixture();
    project.assets["asset-sheet"].id = "asset-renamed-without-key";

    expectDiagnostic(validateStudioProject(project), "KEY_ID_MISMATCH", "$.assets.asset-sheet.id");
  });

  it("rejects missing and duplicate root-order entries", () => {
    const missing = cloneFixture();
    missing.rootOrder.assetIds = ["asset-sheet"];
    expectDiagnostic(validateStudioProject(missing), "ORDER_MISMATCH", "$.rootOrder.assetIds");

    const duplicate = cloneFixture();
    duplicate.rootOrder.assetIds = ["asset-sheet", "asset-processed", "asset-sheet"];
    expectDiagnostic(validateStudioProject(duplicate), "ORDER_MISMATCH", "$.rootOrder.assetIds");
  });

  it("rejects references to entities that are not present", () => {
    const project = cloneFixture();
    project.regions["region-hero"].assetId = "missing-asset";

    expectDiagnostic(validateStudioProject(project), "MISSING_REFERENCE", "$.regions.region-hero.assetId");
  });

  it("rejects composition layer IDs that do not resolve", () => {
    const project = cloneFixture();
    project.compositions["composition-project"].layerIds.push("missing-layer");

    expectDiagnostic(
      validateStudioProject(project),
      "MISSING_REFERENCE",
      "$.compositions.composition-project.layerIds[1]",
    );
  });

  it("rejects layer duplicate ownership and composition owner mismatches", () => {
    const duplicate = cloneFixture();
    duplicate.compositions["composition-cel"].layerIds.push("layer-project");
    const duplicateResult = validateStudioProject(duplicate);
    expectDiagnostic(duplicateResult, "DUPLICATE_OWNERSHIP", "$.layers.layer-project.compositionId");
    expectDiagnostic(duplicateResult, "OWNER_MISMATCH", "$.compositions.composition-cel.layerIds[1]");

    const mismatch = cloneFixture();
    mismatch.layers["layer-cel"].compositionId = "composition-project";
    expectDiagnostic(
      validateStudioProject(mismatch),
      "OWNER_MISMATCH",
      "$.layers.layer-cel.compositionId",
    );
  });

  it("rejects cel/sequence owner mismatches", () => {
    const missingOwner = cloneFixture();
    missingOwner.sequences["sequence-main"].celIds = ["cel-variants"];
    expectDiagnostic(
      validateStudioProject(missingOwner),
      "OWNER_MISMATCH",
      "$.cels.cel-composition.sequenceId",
    );

    const mismatchedSequence = cloneFixture();
    mismatchedSequence.cels["cel-composition"].sequenceId = "missing-sequence";
    const result = validateStudioProject(mismatchedSequence);
    expectDiagnostic(result, "MISSING_REFERENCE", "$.cels.cel-composition.sequenceId");
    expectDiagnostic(result, "OWNER_MISMATCH", "$.cels.cel-composition.sequenceId");
  });

  it("rejects variant ownership drift and an active variant key not in the set", () => {
    const ownership = cloneFixture();
    ownership.compositions["composition-variant-a"].owner = {
      type: "variantSet",
      variantSetId: "variant-set-main",
      variant: "B",
    };
    const ownershipResult = validateStudioProject(ownership);
    expectDiagnostic(
      ownershipResult,
      "OWNER_MISMATCH",
      "$.variantSets.variant-set-main.variants.A",
    );

    const activeVariant = cloneFixture();
    activeVariant.variantSets["variant-set-main"].activeVariant = "C";
    expectDiagnostic(
      validateStudioProject(activeVariant),
      "MISSING_REFERENCE",
      "$.variantSets.variant-set-main.activeVariant",
    );
  });

  it("rejects a cel that references a composition owned by another graph", () => {
    const project = cloneFixture();
    project.cels["cel-composition"].source = {
      type: "composition",
      compositionId: "composition-project",
    };

    expectDiagnostic(
      validateStudioProject(project),
      "OWNER_MISMATCH",
      "$.cels.cel-composition.source.compositionId",
    );
  });

  it("rejects a variant set that is not the source of its declared cel", () => {
    const project = cloneFixture();
    project.cels["cel-variants"].source = { type: "region", regionId: "region-hero" };

    expectDiagnostic(
      validateStudioProject(project),
      "OWNER_MISMATCH",
      "$.variantSets.variant-set-main.celId",
    );
  });

  it("rejects invalid cel overrides and layer opacity", () => {
    const project = cloneFixture();
    project.cels["cel-variants"].transform = {
      opacity: 2,
      rotation: Number.NaN,
      flipX: "yes" as unknown as boolean,
    };
    project.layers["layer-project"].transform.opacity = -0.1;
    const result = validateStudioProject(project);

    expectDiagnostic(result, "INVALID_NUMBER", "$.cels.cel-variants.transform.opacity");
    expectDiagnostic(result, "INVALID_NUMBER", "$.cels.cel-variants.transform.rotation");
    expectDiagnostic(result, "INVALID_DOCUMENT", "$.cels.cel-variants.transform.flipX");
    expectDiagnostic(result, "INVALID_NUMBER", "$.layers.layer-project.transform.opacity");
  });

  it("rejects more than one collision set for the same owner", () => {
    const project = cloneFixture();
    project.collisionSets["collision-region-copy"] = {
      ...project.collisionSets["collision-region"],
      id: "collision-region-copy",
    };

    expectDiagnostic(
      validateStudioProject(project),
      "DUPLICATE_OWNERSHIP",
      "$.collisionSets.collision-region-copy.owner",
    );
  });

  it("rejects invalid dimensions and timestamps", () => {
    const dimensions = cloneFixture();
    dimensions.assets["asset-sheet"].width = 0;
    expectDiagnostic(validateStudioProject(dimensions), "INVALID_DIMENSIONS", "$.assets.asset-sheet");

    const timestamp = cloneFixture();
    timestamp.createdAt = "2026-02-31T00:00:00.000Z";
    expectDiagnostic(validateStudioProject(timestamp), "INVALID_TIMESTAMP", "$.createdAt");
  });

  it("never throws on malformed collection arrays and rejects sparse arrays", () => {
    const malformed = cloneFixture() as unknown as Record<string, unknown>;
    (malformed.sequences as Record<string, Record<string, unknown>>)["sequence-main"].celIds = {};
    expect(() => validateStudioProject(malformed)).not.toThrow();
    expectDiagnostic(validateStudioProject(malformed), "INVALID_DOCUMENT", "$.sequences.sequence-main.celIds");

    const sparse = cloneFixture();
    const selected = sparse.workspace.selectedCelIds ?? [];
    selected.length = 3;
    delete selected[1];
    expectDiagnostic(validateStudioProject(sparse), "NON_JSON_VALUE", "$.workspace.selectedCelIds[1]");
  });

  it("validates provenance references as part of the canonical graph", () => {
    const project = cloneFixture();
    project.assets["asset-processed"].provenance.recipeId = "missing-recipe";
    project.generatedArtifacts["artifact-processed"].provenance = {
      source: "processing",
      parentArtifactId: "missing-artifact",
    };
    const result = validateStudioProject(project);

    expectDiagnostic(
      result,
      "MISSING_REFERENCE",
      "$.assets.asset-processed.provenance.recipeId",
    );
    expectDiagnostic(
      result,
      "MISSING_REFERENCE",
      "$.generatedArtifacts.artifact-processed.provenance.parentArtifactId",
    );
  });

  it("rejects root, workspace and artifact fields outside the closed V1 schema", () => {
    const project = cloneFixture();
    const root = project as unknown as Record<string, unknown>;
    const workspace = project.workspace as unknown as Record<string, unknown>;
    const artifact = project.generatedArtifacts["artifact-processed"] as unknown as Record<
      string,
      unknown
    >;
    root.playbackClock = 12;
    workspace.modal = { open: true };
    artifact.status = "pending";
    artifact.progress = 0.5;
    artifact.jobId = "job-runtime";
    const result = validateStudioProject(project);

    expectDiagnostic(result, "INVALID_DOCUMENT", "$.playbackClock");
    expectDiagnostic(result, "INVALID_DOCUMENT", "$.workspace.modal");
    expectDiagnostic(result, "INVALID_DOCUMENT", "$.generatedArtifacts.artifact-processed.status");
    expectDiagnostic(result, "INVALID_DOCUMENT", "$.generatedArtifacts.artifact-processed.progress");
    expectDiagnostic(result, "INVALID_DOCUMENT", "$.generatedArtifacts.artifact-processed.jobId");
  });

  it("rejects incomplete durable artifacts", () => {
    const project = cloneFixture();
    project.generatedArtifacts.incomplete = {
      id: "incomplete",
      type: "processed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as unknown as StudioProjectV1["generatedArtifacts"][string];
    const result = validateStudioProject(project);

    expectDiagnostic(
      result,
      "MISSING_REFERENCE",
      "$.generatedArtifacts.incomplete.outputAssetId",
    );
    expectDiagnostic(
      result,
      "INVALID_DOCUMENT",
      "$.generatedArtifacts.incomplete.provenance",
    );
  });

  it("validates optional typed fields instead of trusting the TypeScript cast", () => {
    const project = cloneFixture();
    const assetProvenance = project.assets["asset-sheet"].provenance as unknown as Record<
      string,
      unknown
    >;
    assetProvenance.importedAt = "yesterday";
    assetProvenance.note = { ephemeral: true };
    (project.regions["region-hero"] as unknown as Record<string, unknown>).name = 42;
    (project.compositions["composition-project"] as unknown as Record<string, unknown>).background = 42;
    (
      project.collisionSets["collision-region"].shapes[0] as unknown as Record<string, unknown>
    ).tag = 42;
    const artifact = project.generatedArtifacts["artifact-processed"] as unknown as Record<
      string,
      unknown
    >;
    artifact.mimeType = 42;
    const result = validateStudioProject(project);

    expectDiagnostic(result, "INVALID_TIMESTAMP", "$.assets.asset-sheet.provenance.importedAt");
    expectDiagnostic(result, "INVALID_DOCUMENT", "$.assets.asset-sheet.provenance.note");
    expectDiagnostic(result, "INVALID_DOCUMENT", "$.regions.region-hero.name");
    expectDiagnostic(result, "INVALID_DOCUMENT", "$.compositions.composition-project.background");
    expectDiagnostic(result, "INVALID_DOCUMENT", "$.collisionSets.collision-region.shapes[0].tag");
    expectDiagnostic(result, "INVALID_DOCUMENT", "$.generatedArtifacts.artifact-processed.mimeType");
  });

  it("does not invoke accessors and contains uninspectable Proxy failures", () => {
    const accessorProject = cloneFixture();
    Object.defineProperty(accessorProject.workspace, "boom", {
      enumerable: true,
      get() {
        throw new Error("getter must not run");
      },
    });
    const accessorResult = validateStudioProject(accessorProject);
    expectDiagnostic(accessorResult, "NON_JSON_VALUE", "$.workspace.boom");

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => validateStudioProject(revoked.proxy)).not.toThrow();
    expectDiagnostic(validateStudioProject(revoked.proxy), "INVALID_DOCUMENT", "$");
  });

  it("rejects symbols and named runtime properties attached to arrays", () => {
    const project = cloneFixture();
    const order = project.rootOrder.assetIds as unknown as Record<PropertyKey, unknown>;
    order.runtimeLease = () => "blob:runtime";
    order[Symbol("drag")] = true;
    const result = validateStudioProject(project);

    expectDiagnostic(result, "NON_JSON_VALUE", "$.rootOrder.assetIds.runtimeLease");
    expect(diagnosticCodes(result)).toContain("NON_JSON_VALUE");
  });

  it("rejects contradictory artifact and asset provenance backlinks", () => {
    const project = cloneFixture();
    project.generatedArtifacts["artifact-processed"].outputAssetId = "asset-sheet";
    project.generatedArtifacts["artifact-processed"].sourceAssetId = "asset-processed";
    const result = validateStudioProject(project);

    expectDiagnostic(
      result,
      "OWNER_MISMATCH",
      "$.assets.asset-processed.provenance.artifactId",
    );
    expectDiagnostic(
      result,
      "OWNER_MISMATCH",
      "$.generatedArtifacts.artifact-processed.outputAssetId",
    );
  });

  it("rejects empty provenance sources and self-parent provenance", () => {
    const project = cloneFixture();
    project.generatedArtifacts["artifact-processed"].provenance.source = "";
    project.generatedArtifacts["artifact-processed"].provenance.parentArtifactId =
      "artifact-processed";
    project.assets["asset-processed"].provenance.parentAssetId = "asset-processed";
    const result = validateStudioProject(project);

    expectDiagnostic(
      result,
      "INVALID_DOCUMENT",
      "$.generatedArtifacts.artifact-processed.provenance.source",
    );
    expectDiagnostic(
      result,
      "OWNER_MISMATCH",
      "$.generatedArtifacts.artifact-processed.provenance.parentArtifactId",
    );
    expectDiagnostic(
      result,
      "OWNER_MISMATCH",
      "$.assets.asset-processed.provenance.parentAssetId",
    );
  });

  it("keeps validation non-mutating and diagnostics deterministically ordered", () => {
    const project = cloneFixture();
    project.regions["region-hero"].assetId = "missing-asset";
    project.rootOrder.assetIds = ["asset-sheet"];
    const before = JSON.stringify(project);
    const result = validateStudioProject(project);
    const keys = result.diagnostics.map(
      ({ path, code, message }) => `${path}\u0000${code}\u0000${message}`,
    );

    expect(JSON.stringify(project)).toBe(before);
    expect(keys).toEqual([...keys].sort((left, right) => left.localeCompare(right)));
  });

  it("rejects invalid factory inputs instead of returning an invalid typed document", () => {
    expect(() => createEmptyStudioProject({ id: "" })).toThrow(TypeError);
    expect(() => createEmptyStudioProject({ id: "project", now: "not-iso" })).toThrow(TypeError);
    expect(() =>
      createEmptyStudioProject({ idFactory: () => " ", now: "2026-01-01T00:00:00.000Z" }),
    ).toThrow(TypeError);
  });
});
