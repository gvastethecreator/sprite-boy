import { describe, expect, it } from "vitest";
import {
  applyProjectCommand,
  applyProjectCommandBatch,
  applyProjectCommandInverse,
} from "../../core/project/applyCommand";
import type {
  ProjectCommand,
  ProjectCommandBatch,
  ProjectCommandContext,
  ProjectCommandInverse,
} from "../../core/project/commands";
import { cloneStudioProject } from "../../core/project/graph";
import type { AssetRecord, ProcessingRecipe, Region } from "../../core/project/schema";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const NOW = "2026-01-01T00:20:00.000Z";
const context: ProjectCommandContext = { nextId: () => "unused", now: () => NOW };

function command(value: unknown): ProjectCommand {
  return value as ProjectCommand;
}

function batch(value: unknown): ProjectCommandBatch {
  return value as ProjectCommandBatch;
}

function inverse(value: unknown): ProjectCommandInverse {
  return value as ProjectCommandInverse;
}

function expectFailure(value: unknown): void {
  const result = applyProjectCommand(studioProjectV1Fixture, command(value), context);
  expect(result.ok).toBe(false);
  expect(result.project).toBe(studioProjectV1Fixture);
}

function asset(id: string): AssetRecord {
  const value = cloneStudioProject(studioProjectV1Fixture).assets["asset-sheet"];
  return {
    ...value,
    id,
    name: `${id}.png`,
    blobKey: `asset/${id}`,
    contentHash: `sha256:${id}`,
    createdAt: NOW,
    updatedAt: NOW,
    provenance: { source: "boundary" },
  };
}

function recipe(id: string): ProcessingRecipe {
  return {
    ...cloneStudioProject(studioProjectV1Fixture).processingRecipes["recipe-grid"],
    id,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function region(id: string, assetId = "asset-sheet"): Region {
  return {
    ...cloneStudioProject(studioProjectV1Fixture).regions["region-hero"],
    id,
    assetId,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("ProjectEngine boundary and inverse matrix", () => {
  it("rejects malformed envelopes, missing fields and hostile descriptors", () => {
    for (const value of [[], new Date(), {}, { type: 42 }, { type: "project.rename" }]) {
      expectFailure(value);
    }

    const hiddenType = { name: "hidden", updatedAt: NOW };
    Object.defineProperty(hiddenType, "type", { value: "project.rename", enumerable: false });
    expectFailure(hiddenType);

    const symbol = { type: "project.rename", name: "symbol", updatedAt: NOW };
    Object.defineProperty(symbol, Symbol("runtime"), { value: true, enumerable: true });
    expectFailure(symbol);

    const noChange = applyProjectCommand(
      studioProjectV1Fixture,
      {
        type: "project.rename",
        name: studioProjectV1Fixture.name,
        updatedAt: studioProjectV1Fixture.updatedAt,
      },
      context,
    );
    expect(noChange.ok).toBe(true);
    if (noChange.ok) expect(noChange.project).toBe(studioProjectV1Fixture);
  });

  it("rejects every workspace patch boundary before candidate publication", () => {
    for (const patch of [
      null,
      { activeWorkspace: "runtime" },
      { selectedAssetId: 42 },
      { selectedCelIds: null },
    ]) {
      expectFailure({ type: "workspace.update", patch });
    }

    const symbolPatch = { selectedAssetId: "asset-sheet" };
    Object.defineProperty(symbolPatch, Symbol("runtime"), { value: true, enumerable: true });
    expectFailure({ type: "workspace.update", patch: symbolPatch });
  });

  it("covers asset import, replace and rename no-op and failure branches", () => {
    for (const value of [null, []]) {
      expectFailure({ type: "asset.import", asset: value });
    }
    expectFailure({ type: "asset.import", asset: asset("invalid-index"), atIndex: 99 });
    expectFailure({ type: "asset.replace", assetId: "missing", replacement: asset("missing") });
    expectFailure({ type: "asset.replace", assetId: "asset-sheet", replacement: null });

    const noReplace = applyProjectCommand(
      studioProjectV1Fixture,
      {
        type: "asset.replace",
        assetId: "asset-sheet",
        replacement: cloneStudioProject(studioProjectV1Fixture).assets["asset-sheet"],
      },
      context,
    );
    expect(noReplace.ok).toBe(true);
    if (noReplace.ok) expect(noReplace.project).toBe(studioProjectV1Fixture);

    const noRename = applyProjectCommand(
      studioProjectV1Fixture,
      {
        type: "asset.rename",
        assetId: "asset-sheet",
        name: "hero-sheet.png",
        updatedAt: studioProjectV1Fixture.assets["asset-sheet"].updatedAt,
      },
      context,
    );
    expect(noRename.ok).toBe(true);
    if (noRename.ok) expect(noRename.project).toBe(studioProjectV1Fixture);

    const invalidProject = cloneStudioProject(studioProjectV1Fixture);
    invalidProject.id = "";
    const invalidCandidate = applyProjectCommand(
      invalidProject,
      { type: "asset.import", asset: asset("candidate") },
      context,
    );
    expect(invalidCandidate.ok).toBe(false);
  });

  it("rejects malformed atomic region recipe payloads", () => {
    const base = {
      type: "regions.commitRecipe",
      recipe: recipe("recipe-new"),
      regions: [region("region-new")],
      derivedAssets: [asset("asset-new")],
    };
    for (const value of [
      { ...base, regions: null },
      { ...base, derivedAssets: null },
      { ...base, recipe: null },
      { ...base, recipe: recipe("recipe-grid") },
      { ...base, derivedAssets: [asset("dup"), asset("dup")] },
      { ...base, regions: [region("dup"), region("dup")] },
      { ...base, derivedAssets: [asset("asset-sheet")] },
      { ...base, regions: [region("region-hero")] },
      { ...base, atIndex: 99 },
    ]) {
      expectFailure(value);
    }
  });

  it("rejects malformed region patches and missing order ownership", () => {
    for (const value of [
      { type: "region.update", regionId: "missing", patch: {} },
      { type: "region.update", regionId: "region-hero", patch: null },
      { type: "region.update", regionId: "region-hero", patch: { assetId: "asset-sheet" } },
      { type: "region.update", regionId: "region-hero", patch: { bounds: undefined } },
      { type: "region.reorder", regionId: "missing", toIndex: 0 },
    ]) expectFailure(value);

    const symbolPatch = { name: "ignored" };
    Object.defineProperty(symbolPatch, Symbol("runtime"), { value: true, enumerable: true });
    expectFailure({ type: "region.update", regionId: "region-hero", patch: symbolPatch });

    const noChange = applyProjectCommand(
      studioProjectV1Fixture,
      { type: "region.update", regionId: "region-hero", patch: { name: "Hero frame" } },
      context,
    );
    expect(noChange.ok).toBe(true);
    if (noChange.ok) expect(noChange.project).toBe(studioProjectV1Fixture);

    const missingOrder = cloneStudioProject(studioProjectV1Fixture);
    missingOrder.rootOrder.regionIds = [];
    const reordered = applyProjectCommand(
      missingOrder,
      { type: "region.reorder", regionId: "region-hero", toIndex: 0 },
      context,
    );
    expect(reordered.ok).toBe(false);
  });

  it("contains malformed batches and rolls back non-removal and removal failures", () => {
    for (const value of [
      null,
      {},
      { type: "command.batch", commands: [], extra: true },
      { type: "command.batch", commands: null },
    ]) {
      expect(applyProjectCommandBatch(studioProjectV1Fixture, batch(value), context).ok).toBe(false);
    }

    const named: ProjectCommand[] = [];
    Object.defineProperty(named, "runtime", { value: true, enumerable: true });
    expect(applyProjectCommandBatch(
      studioProjectV1Fixture,
      batch({ type: "command.batch", commands: named }),
      context,
    ).ok).toBe(false);

    const sparse: ProjectCommand[] = [];
    sparse.length = 1;
    expect(applyProjectCommandBatch(
      studioProjectV1Fixture,
      batch({ type: "command.batch", commands: sparse }),
      context,
    ).ok).toBe(false);

    const failedNonRemoval = applyProjectCommandBatch(
      studioProjectV1Fixture,
      {
        type: "command.batch",
        commands: [{ type: "project.rename", name: "Bad", updatedAt: "bad" }],
      },
      context,
    );
    expect(failedNonRemoval.ok).toBe(false);

    const failedRemoval = applyProjectCommandBatch(
      studioProjectV1Fixture,
      {
        type: "command.batch",
        commands: [{ type: "asset.remove", assetId: "asset-sheet", policy: "reject" }],
      },
      context,
    );
    expect(failedRemoval.ok).toBe(false);
  });

  it("contains malformed snapshot inverses and rejects invalid snapshots", () => {
    for (const value of [null, {}, { type: "project.restoreSnapshot" }]) {
      const result = applyProjectCommandInverse(
        studioProjectV1Fixture,
        inverse(value),
        context,
      );
      expect(result.ok).toBe(false);
    }

    const invalidSnapshot = cloneStudioProject(studioProjectV1Fixture);
    invalidSnapshot.id = "";
    const invalid = applyProjectCommandInverse(
      studioProjectV1Fixture,
      { type: "project.restoreSnapshot", project: invalidSnapshot },
      context,
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.diagnostics[0].code).toBe("INVARIANT_VIOLATION");

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const hostile = applyProjectCommandInverse(
      studioProjectV1Fixture,
      inverse(revoked.proxy),
      context,
    );
    expect(hostile.ok).toBe(false);
  });
});
