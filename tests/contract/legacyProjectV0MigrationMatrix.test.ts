import { describe, expect, it } from "vitest";
import {
  isProjectMigrationError,
  migrateLegacyProjectV0,
} from "../../core/persistence";
import type { LegacyProjectV0MigrationContext } from "../../core/persistence";
import { legacyProjectV0Ambiguity, legacyProjectV0Fixture } from "./fixtures/legacyProjectV0";

const TIMESTAMP = "2026-07-14T00:00:00.000Z";
const SOURCE_HASH = "a".repeat(64);
const BUILDER_HASH = "b".repeat(64);

function baseContext(): LegacyProjectV0MigrationContext {
  return {
    projectId: "matrix-project",
    projectName: "Matrix migration",
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

function cloneLegacy(): Record<string, unknown> {
  return structuredClone(legacyProjectV0Fixture) as unknown as Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  return value as unknown[];
}

function project(document: Record<string, unknown>): Record<string, unknown> {
  return record(document.project);
}

function ui(document: Record<string, unknown>): Record<string, unknown> {
  return record(document.ui);
}

async function expectMigrationFailure(
  document: unknown,
  context = baseContext(),
): Promise<void> {
  try {
    await migrateLegacyProjectV0(document, context);
  } catch (error) {
    expect(isProjectMigrationError(error)).toBe(true);
    return;
  }
  throw new Error("Expected legacy migration to fail.");
}

describe("legacy V0 migration hostile matrix", () => {
  it("rejects malformed primitive, collection and scalar shapes", async () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    for (const input of [null, [], revoked.proxy]) {
      await expectMigrationFailure(input);
    }

    const cases: Array<(document: Record<string, unknown>) => void> = [
      (document) => { document.schemaVersion = 1; },
      (document) => { project(document).frames = null; },
      (document) => { record(project(document).imageMeta).src = ""; },
      (document) => { record(project(document).imageMeta).width = -0; },
      (document) => { record(project(document).imageMeta).fileSize = 1.5; },
      (document) => { record(ui(document).templateConfig).showIndices = "yes"; },
      (document) => {
        const frames = array(project(document).frames);
        frames.push(structuredClone(frames[0]));
      },
    ];
    for (const mutate of cases) {
      const document = cloneLegacy();
      mutate(document);
      await expectMigrationFailure(document);
    }
  });

  it("rejects invalid Builder constraints, references and duplicate identities", async () => {
    const cases: Array<(document: Record<string, unknown>) => void> = [
      (document) => { record(record(project(document).builderSlots)["0"]).gridIndex = 1; },
      (document) => { record(record(project(document).builderSlots)["0"]).assetId = "missing"; },
      (document) => { record(record(project(document).builderSlots)["0"]).fitMode = "tile"; },
      (document) => { record(record(project(document).builderSlots)["0"]).alignment = "baseline"; },
      (document) => { record(record(project(document).builderSlots)["0"]).opacity = 2; },
      (document) => { record(array(project(document).builderFreeObjects)[0]).assetId = "missing"; },
      (document) => { record(array(project(document).builderFreeObjects)[0]).opacity = 2; },
      (document) => {
        const objects = array(project(document).builderFreeObjects);
        objects.push(structuredClone(objects[0]));
      },
      (document) => { record(array(record(array(project(document).animations)[0]).keyframes)[0]).opacity = 2; },
      (document) => { record(ui(document).onionSkin).opacity = 2; },
      (document) => { ui(document).currentMode = "RUNTIME"; },
    ];
    for (const mutate of cases) {
      const document = cloneLegacy();
      mutate(document);
      await expectMigrationFailure(document);
    }
  });

  it("rejects contradictory relink metadata and cel-source choices", async () => {
    const blobMismatch = baseContext();
    blobMismatch.assetResolutions = {
      ...blobMismatch.assetResolutions,
      "fixture://builder-asset": {
        ...blobMismatch.assetResolutions["fixture://builder-asset"],
        blobKey: `sha256:${SOURCE_HASH}`,
      },
    };
    await expectMigrationFailure(cloneLegacy(), blobMismatch);

    const strayCel = baseContext();
    strayCel.celSourceResolutions = {
      ...strayCel.celSourceResolutions,
      "unknown-keyframe": { type: "frame", frameId: 0 },
    };
    await expectMigrationFailure(cloneLegacy(), strayCel);

    const builderOnly = cloneLegacy();
    project(builderOnly).frames = array(project(builderOnly).frames).slice(1);
    await expectMigrationFailure(builderOnly);

    const byteMismatch = baseContext();
    byteMismatch.assetResolutions = {
      ...byteMismatch.assetResolutions,
      "fixture://source-sheet": {
        ...byteMismatch.assetResolutions["fixture://source-sheet"],
        byteSize: 4095,
      },
    };
    await expectMigrationFailure(cloneLegacy(), byteMismatch);

    const duplicateCanonicalId = baseContext();
    duplicateCanonicalId.assetResolutions = {
      ...duplicateCanonicalId.assetResolutions,
      "fixture://builder-asset": {
        ...duplicateCanonicalId.assetResolutions["fixture://builder-asset"],
        assetId: "asset-source-sheet",
      },
    };
    await expectMigrationFailure(cloneLegacy(), duplicateCanonicalId);

    const contradictoryContent = baseContext();
    contradictoryContent.assetResolutions = {
      ...contradictoryContent.assetResolutions,
      "fixture://builder-asset": {
        ...contradictoryContent.assetResolutions["fixture://builder-asset"],
        contentHash: SOURCE_HASH,
        blobKey: `sha256:${SOURCE_HASH}`,
      },
    };
    await expectMigrationFailure(cloneLegacy(), contradictoryContent);
  });

  it("covers every workspace, collision and Builder geometry mapping", async () => {
    const variants = [
      { mode: "SLICER", fitMode: "fill", alignment: "top-left", collision: "HITBOX", workspace: "slice" },
      { mode: "BUILDER", fitMode: "stretch", alignment: "bottom-right", collision: "SOLID", workspace: "compose" },
      { mode: "COLLISION", fitMode: "original", alignment: "top-right", collision: "TRIGGER", workspace: "collision" },
      { mode: "ASSETS", fitMode: "fit", alignment: "bottom-left", collision: "HURTBOX", workspace: "assets" },
      { mode: "EXPORT", fitMode: "fill", alignment: "middle-right", collision: "HURTBOX", workspace: "export" },
    ];
    for (const variant of variants) {
      const document = cloneLegacy();
      ui(document).currentMode = variant.mode;
      const slot = record(record(project(document).builderSlots)["0"]);
      slot.fitMode = variant.fitMode;
      slot.alignment = variant.alignment;
      const shape = record(array(record(array(project(document).frames)[0]).hitboxes)[0]);
      shape.type = variant.collision;
      const result = await migrateLegacyProjectV0(document, baseContext());
      expect(record(result.document).workspace).toEqual(
        expect.objectContaining({ activeWorkspace: variant.workspace }),
      );
    }
  });

  it("rejects Builder content outside its grid or without a canvas and frames without a sheet", async () => {
    const outsideGrid = cloneLegacy();
    const slots = record(project(outsideGrid).builderSlots);
    slots["2"] = { ...record(slots["0"]), gridIndex: 2 };
    delete slots["0"];
    await expectMigrationFailure(outsideGrid);

    const withoutCanvas = cloneLegacy();
    project(withoutCanvas).builderCanvas = null;
    await expectMigrationFailure(withoutCanvas);

    const withoutSheet = cloneLegacy();
    project(withoutSheet).imageMeta = null;
    const context = baseContext();
    context.assetResolutions = {
      "fixture://builder-asset": context.assetResolutions["fixture://builder-asset"],
    };
    await expectMigrationFailure(withoutSheet, context);
  });
});
