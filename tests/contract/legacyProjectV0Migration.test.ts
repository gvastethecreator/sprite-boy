import { describe, expect, it } from "vitest";
import {
  ProjectMigrationError,
  isProjectMigrationError,
  migrateLegacyProjectV0,
  projectCodec,
} from "../../core/persistence";
import { validateStudioProject } from "../../core/project";
import type {
  LegacyProjectV0MigrationContext,
} from "../../core/persistence";
import type { StudioProjectV1 } from "../../core/project";
import {
  legacyProjectV0Ambiguity,
  legacyProjectV0Fixture,
} from "./fixtures/legacyProjectV0";

const TIMESTAMP = "2026-07-14T00:00:00.000Z";
const SOURCE_HASH = "a".repeat(64);
const BUILDER_HASH = "b".repeat(64);

function baseContext(): LegacyProjectV0MigrationContext {
  return {
    projectId: "migrated-project",
    projectName: "Migrated legacy project",
    timestamp: TIMESTAMP,
    assetResolutions: {
      "fixture://source-sheet": {
        assetId: "asset-source-sheet",
        contentHash: SOURCE_HASH,
        blobKey: `sha256:${SOURCE_HASH}`,
        mimeType: "image/png",
        byteSize: 4096,
      },
      "fixture://builder-asset": {
        assetId: "asset-builder-piece",
        contentHash: BUILDER_HASH,
        blobKey: `sha256:${BUILDER_HASH}`,
        mimeType: "image/png",
        byteSize: 2048,
      },
    },
    celSourceResolutions: {
      [legacyProjectV0Ambiguity.keyframeUid]: { type: "frame", frameId: 0 },
    },
  };
}

function cloneLegacy(): unknown {
  return structuredClone(legacyProjectV0Fixture);
}

async function captureError(work: () => unknown): Promise<ProjectMigrationError> {
  try {
    await work();
  } catch (error) {
    expect(isProjectMigrationError(error)).toBe(true);
    return error as ProjectMigrationError;
  }
  throw new Error("Expected ProjectMigrationError.");
}

describe("legacy SpriteBoy V0 → canonical V1 migration (F3-03)", () => {
  it("previews every unresolved binary and ambiguous cel without applying the step", async () => {
    const input = cloneLegacy();
    const result = await migrateLegacyProjectV0(input, {
      projectId: "preview-project",
      projectName: "Preview",
      timestamp: TIMESTAMP,
      assetResolutions: {},
    });

    expect(result.document).toEqual(input);
    expect(result.document).not.toBe(input);
    expect(result.report).toMatchObject({
      status: "needs-input",
      sourceVersion: 0,
      targetVersion: 1,
      reachedVersion: 0,
      appliedSteps: [],
      pendingStep: {
        id: "legacy-project-v0-to-v1",
        fromVersion: 0,
        toVersion: 1,
      },
    });
    expect(result.report.issues.map(({ code }) => code)).toEqual([
      "LEGACY_ASSET_NEEDS_RELINK",
      "LEGACY_ASSET_NEEDS_RELINK",
      "AMBIGUOUS_LEGACY_CEL_SOURCE",
    ]);
    expect(result.report.issues.filter(({ blocking }) => blocking)).toHaveLength(3);
    expect(result.report.issues).toContainEqual(expect.objectContaining({
      code: "AMBIGUOUS_LEGACY_CEL_SOURCE",
      entityId: legacyProjectV0Ambiguity.keyframeUid,
      choices: [
        { id: "frame:0", label: "Frame 0" },
        { id: "builder-slot:0", label: "Builder slot 0" },
      ],
    }));
  });

  it("keeps ambiguity blocking after both binaries have durable identities", async () => {
    const context = baseContext();
    const result = await migrateLegacyProjectV0(cloneLegacy(), {
      ...context,
      celSourceResolutions: undefined,
    });

    expect(result.report.status).toBe("needs-input");
    expect(result.report.issues).toHaveLength(1);
    expect(result.report.issues[0]).toMatchObject({
      code: "AMBIGUOUS_LEGACY_CEL_SOURCE",
      category: "ambiguity",
      blocking: true,
    });
  });

  it("migrates the real fixture to a valid connected V1 graph with explicit loss notes", async () => {
    const result = await migrateLegacyProjectV0(cloneLegacy(), baseContext());
    const project = result.document as StudioProjectV1;

    expect(result.report).toMatchObject({
      status: "migrated",
      sourceVersion: 0,
      targetVersion: 1,
      reachedVersion: 1,
      appliedSteps: [{ id: "legacy-project-v0-to-v1", fromVersion: 0, toVersion: 1 }],
    });
    expect(result.report.issues.map(({ code }) => code)).toEqual([
      "LEGACY_PROJECT_NORMALIZED",
      "LEGACY_BUILDER_SLOT_CONSTRAINTS_FLATTENED",
      "LEGACY_ASPECT_RATIO_NOT_STORED",
      "LEGACY_VIEW_PREFERENCES_NOT_PROJECT_DATA",
    ]);
    expect(result.report.issues.some(({ blocking }) => blocking)).toBe(false);
    expect(validateStudioProject(project)).toMatchObject({ valid: true, diagnostics: [] });

    expect(project).toMatchObject({
      schemaVersion: 1,
      id: "migrated-project",
      name: "Migrated legacy project",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      workspace: {
        activeWorkspace: "animate",
        selectedAssetId: "asset-source-sheet",
        selectedRegionId: "legacy:region:0",
        selectedCompositionId: "legacy:composition:builder",
        selectedSequenceId: "legacy:sequence:legacy-walk",
      },
    });
    expect(project.rootOrder).toEqual({
      assetIds: ["asset-source-sheet", "asset-builder-piece"],
      regionIds: ["legacy:region:0", "legacy:region:1", "legacy:region:2"],
      compositionIds: ["legacy:composition:builder"],
      sequenceIds: ["legacy:sequence:legacy-walk"],
    });
    expect(project.assets["asset-source-sheet"]).toMatchObject({
      blobKey: `sha256:${SOURCE_HASH}`,
      contentHash: SOURCE_HASH,
      byteSize: 4096,
      provenance: { source: "legacy", sourceId: "fixture://source-sheet" },
    });
    expect(project.regions["legacy:region:2"].hidden).toBe(true);
    expect(project.collisionSets["legacy:collision:region:0"]).toMatchObject({
      owner: { type: "region", regionId: "legacy:region:0" },
      shapes: [{
        id: "legacy-hurtbox",
        type: "hurtbox",
        bounds: { x: 8, y: 8, width: 48, height: 52 },
        tag: "body",
      }],
    });

    const builder = project.compositions["legacy:composition:builder"];
    expect(builder).toMatchObject({ width: 128, height: 64, background: "#09090b" });
    expect(builder.layerIds).toEqual([
      "legacy:layer:builder-slot:0",
      "legacy:layer:builder-free:legacy-free-object",
    ]);
    expect(project.layers["legacy:layer:builder-slot:0"].transform).toEqual({
      x: 32,
      y: 32,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
      flipX: false,
      flipY: false,
    });
    expect(project.layers["legacy:layer:builder-free:legacy-free-object"].transform).toEqual({
      x: 96,
      y: 32,
      scaleX: 0.75,
      scaleY: 0.75,
      rotation: 15,
      opacity: 0.8,
      flipX: false,
      flipY: true,
    });

    expect(project.sequences["legacy:sequence:legacy-walk"]).toMatchObject({
      fps: 12,
      defaultDurationMs: 1000 / 12,
      loop: true,
      celIds: ["legacy:cel:legacy-cel-ambiguous", "legacy:cel:legacy-cel-frame-only"],
    });
    expect(project.cels["legacy:cel:legacy-cel-ambiguous"]).toMatchObject({
      source: { type: "region", regionId: "legacy:region:0" },
      durationMs: 1000 / 12,
      pivot: { x: 32, y: 64 },
    });
    expect(project.cels["legacy:cel:legacy-cel-frame-only"]).toMatchObject({
      source: { type: "region", regionId: "legacy:region:1" },
      pivot: { x: 32, y: 64 },
      transform: { rotation: 5, scaleX: 1.1, scaleY: 1.1, opacity: 0.9 },
    });
    expect(project.processingRecipes["legacy:recipe:slicer-grid"]).toMatchObject({
      sourceAssetId: "asset-source-sheet",
      layout: { mode: "manual", rows: 1, cols: 3 },
    });
    expect(projectCodec.decode(projectCodec.encode(project))).toEqual(project);
  });

  it("preserves an explicit Builder-slot cel choice through an owned composition", async () => {
    const legacy = cloneLegacy() as {
      project: { animations: Array<{ keyframes: Array<{ pivotX: number; pivotY: number }> }> };
    };
    legacy.project.animations[0].keyframes[0].pivotX = -0.25;
    legacy.project.animations[0].keyframes[0].pivotY = -0.5;
    const context = baseContext();
    context.celSourceResolutions = {
      [legacyProjectV0Ambiguity.keyframeUid]: { type: "builder-slot", gridIndex: 0 },
    };
    const result = await migrateLegacyProjectV0(legacy, context);
    const project = result.document as StudioProjectV1;
    const cel = project.cels["legacy:cel:legacy-cel-ambiguous"];

    expect(cel.source).toEqual({
      type: "composition",
      compositionId: "legacy:composition:cel:legacy-cel-ambiguous",
    });
    expect(project.compositions["legacy:composition:cel:legacy-cel-ambiguous"]).toMatchObject({
      owner: { type: "cel", celId: cel.id },
      layerIds: ["legacy:layer:cel:legacy-cel-ambiguous"],
      width: 64,
      height: 64,
    });
    expect(project.layers["legacy:layer:cel:legacy-cel-ambiguous"]).toMatchObject({
      source: { type: "asset", id: "asset-builder-piece" },
      transform: { x: 32, y: 32, flipX: false, flipY: false },
    });
    expect(cel.pivot).toEqual({ x: -16, y: -32 });
    expect(validateStudioProject(project).valid).toBe(true);
  });

  it("is byte-deterministic across repeated runs and resolution insertion order", async () => {
    const context = baseContext();
    const reversed = {
      ...context,
      assetResolutions: Object.fromEntries(Object.entries(context.assetResolutions).reverse()),
    };
    const first = await migrateLegacyProjectV0(cloneLegacy(), context);
    const second = await migrateLegacyProjectV0(cloneLegacy(), reversed);

    expect(projectCodec.encode(first.document as StudioProjectV1))
      .toBe(projectCodec.encode(second.document as StudioProjectV1));
    expect(first.report).toEqual(second.report);
  });

  it("does not confuse a Builder asset ID with the synthetic source-sheet role", async () => {
    const legacy = cloneLegacy() as {
      project: {
        builderAssets: Array<{ id: string }>;
        builderSlots: Record<string, { assetId: string }>;
        builderFreeObjects: Array<{ assetId: string }>;
      };
    };
    legacy.project.builderAssets[0].id = "source-sheet";
    legacy.project.builderSlots["0"].assetId = "source-sheet";
    legacy.project.builderFreeObjects[0].assetId = "source-sheet";
    const result = await migrateLegacyProjectV0(legacy, baseContext());
    const project = result.document as StudioProjectV1;

    expect(project.regions["legacy:region:0"].assetId).toBe("asset-source-sheet");
    expect(project.layers["legacy:layer:builder-slot:0"].source).toEqual({
      type: "asset",
      id: "asset-builder-piece",
    });
    expect(validateStudioProject(project).valid).toBe(true);
  });

  it("deduplicates equal content hashes while preserving every legacy source mapping", async () => {
    const legacy = cloneLegacy() as {
      project: { builderAssets: Array<{ width: number; height: number }> };
    };
    legacy.project.builderAssets[0].width = 192;
    legacy.project.builderAssets[0].height = 64;
    const context = baseContext();
    context.assetResolutions = {
      ...context.assetResolutions,
      "fixture://builder-asset": {
        assetId: "asset-builder-alias",
        contentHash: SOURCE_HASH,
        blobKey: `sha256:${SOURCE_HASH}`,
        mimeType: "image/png",
        byteSize: 4096,
      },
    };
    const result = await migrateLegacyProjectV0(legacy, context);
    const project = result.document as StudioProjectV1;

    expect(project.rootOrder.assetIds).toEqual(["asset-source-sheet"]);
    expect(Object.keys(project.assets)).toEqual(["asset-source-sheet"]);
    expect(project.layers["legacy:layer:builder-slot:0"].source).toEqual({
      type: "asset",
      id: "asset-source-sheet",
    });
    expect(result.report.issues).toContainEqual(expect.objectContaining({
      code: "LEGACY_ASSET_CONTENT_DEDUPLICATED",
      category: "change",
      blocking: false,
    }));
    expect(validateStudioProject(project).valid).toBe(true);
  });

  it("relinks expired runtime URLs without persisting them in provenance", async () => {
    const legacy = cloneLegacy() as {
      project: {
        imageMeta: { src: string };
        builderAssets: Array<{ src: string }>;
      };
    };
    const sourceRef = "blob:https://expired.invalid/source";
    const builderRef = "blob:https://expired.invalid/builder";
    legacy.project.imageMeta.src = sourceRef;
    legacy.project.builderAssets[0].src = builderRef;
    const context = baseContext();
    context.assetResolutions = {
      [sourceRef]: context.assetResolutions["fixture://source-sheet"],
      [builderRef]: context.assetResolutions["fixture://builder-asset"],
    };

    const result = await migrateLegacyProjectV0(legacy, context);
    const project = result.document as StudioProjectV1;

    expect(result.report.status).toBe("migrated");
    expect(project.assets["asset-source-sheet"].provenance.sourceId).toBe("source-sheet");
    expect(project.assets["asset-builder-piece"].provenance.sourceId).toBe(
      "builder:legacy-builder-asset",
    );
    expect(projectCodec.encode(project)).not.toContain("blob:");
    expect(validateStudioProject(project)).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("reports an unmatched legacy sourceIndex as needs-relink", async () => {
    const legacy = cloneLegacy() as {
      project: { animations: Array<{ keyframes: Array<{ uid: string; sourceIndex: number }> }> };
    };
    legacy.project.animations[0].keyframes[0].sourceIndex = 99;
    const result = await migrateLegacyProjectV0(legacy, {
      ...baseContext(),
      celSourceResolutions: undefined,
    });

    expect(result.report.status).toBe("needs-input");
    expect(result.report.issues).toEqual([expect.objectContaining({
      code: "LEGACY_CEL_SOURCE_NEEDS_RELINK",
      category: "needs-relink",
      sourceRef: "legacy-source-index:99",
      entityId: "legacy-cel-ambiguous",
    })]);
  });

  it("surfaces spacing loss only when legacy slicer margin/gaps are nonzero", async () => {
    const legacy = cloneLegacy() as {
      ui: { slicerGrid: { marginX: number; paddingY: number } };
    };
    legacy.ui.slicerGrid.marginX = 2;
    legacy.ui.slicerGrid.paddingY = 1;
    const result = await migrateLegacyProjectV0(legacy, baseContext());

    expect(result.report.issues).toContainEqual(expect.objectContaining({
      code: "LEGACY_SLICER_GRID_SPACING_NOT_REPRESENTED",
      category: "loss",
      blocking: false,
    }));
  });

  it("fails typed on unknown legacy fields, contradictory choices and invalid binary identity", async () => {
    const unknown = cloneLegacy() as { project: Record<string, unknown> };
    unknown.project.unmodeledDurableState = { secret: true };
    const unknownError = await captureError(() => migrateLegacyProjectV0(unknown, baseContext()));
    expect(unknownError).toMatchObject({
      code: "PROJECT_MIGRATION_STEP_FAILED",
      stepId: "legacy-project-v0-to-v1",
      reachedVersion: 0,
    });

    const contradictory = baseContext();
    contradictory.celSourceResolutions = {
      [legacyProjectV0Ambiguity.keyframeUid]: { type: "frame", frameId: 0 },
      "legacy-cel-frame-only": { type: "builder-slot", gridIndex: 1 },
    };
    await expect(captureError(() => migrateLegacyProjectV0(cloneLegacy(), contradictory)))
      .resolves.toMatchObject({ code: "PROJECT_MIGRATION_STEP_FAILED" });

    const invalidIdentity = baseContext();
    invalidIdentity.assetResolutions = {
      ...invalidIdentity.assetResolutions,
      "fixture://builder-asset": {
        ...invalidIdentity.assetResolutions["fixture://builder-asset"],
        contentHash: "INVALID",
      },
    };
    await expect(captureError(() => migrateLegacyProjectV0(cloneLegacy(), invalidIdentity)))
      .resolves.toMatchObject({ code: "PROJECT_MIGRATION_STEP_FAILED" });
  });

  it("rejects context and resolution accessors without executing them", async () => {
    const hostileContext = baseContext() as LegacyProjectV0MigrationContext & {
      projectId: string;
    };
    let projectIdReads = 0;
    Object.defineProperty(hostileContext, "projectId", {
      enumerable: true,
      get() {
        projectIdReads += 1;
        return "hostile";
      },
    });
    await expect(captureError(() => migrateLegacyProjectV0(cloneLegacy(), hostileContext)))
      .resolves.toMatchObject({ code: "PROJECT_MIGRATION_STEP_FAILED" });
    expect(projectIdReads).toBe(0);

    const hostileResolution = baseContext();
    let hashReads = 0;
    const builderResolution = {
      ...hostileResolution.assetResolutions["fixture://builder-asset"],
    };
    Object.defineProperty(builderResolution, "contentHash", {
      enumerable: true,
      get() {
        hashReads += 1;
        return BUILDER_HASH;
      },
    });
    hostileResolution.assetResolutions = {
      ...hostileResolution.assetResolutions,
      "fixture://builder-asset": builderResolution,
    };
    await expect(captureError(() => migrateLegacyProjectV0(cloneLegacy(), hostileResolution)))
      .resolves.toMatchObject({ code: "PROJECT_MIGRATION_STEP_FAILED" });
    expect(hashReads).toBe(0);
  });
});
