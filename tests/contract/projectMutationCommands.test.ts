import { describe, expect, it } from "vitest";
import { applyProjectCommand } from "../../core/project/applyCommand";
import { cloneStudioProject } from "../../core/project/graph";
import type {
  ProjectCommand,
  ProjectCommandContext,
  ProjectCommandResult,
} from "../../core/project/commands";
import type { AssetRecord, ProcessingRecipe, Region } from "../../core/project/schema";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const NOW = "2026-01-01T00:10:00.000Z";
const RENAMED_AT = "2026-01-01T00:11:00.000Z";

const context: ProjectCommandContext = {
  nextId: () => "unused-id",
  now: () => NOW,
};

function ok(result: ProjectCommandResult) {
  if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join("; "));
  return result;
}

function semanticInverse(result: Extract<ProjectCommandResult, { ok: true }>) {
  return result.inverse.type === "project.restoreSnapshot"
    ? result.inverse.semantic
    : result.inverse;
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
    provenance: { source: "derived", parentAssetId: "asset-sheet" },
  };
}

function recipe(id: string): ProcessingRecipe {
  const value = cloneStudioProject(studioProjectV1Fixture).processingRecipes["recipe-grid"];
  return { ...value, id, createdAt: NOW, updatedAt: NOW };
}

function region(id: string, assetId = "asset-sheet"): Region {
  const value = cloneStudioProject(studioProjectV1Fixture).regions["region-hero"];
  return { ...value, id, assetId, createdAt: NOW, updatedAt: NOW, provenance: { source: "recipe", sourceId: assetId } };
}

describe("applyProjectCommand (F1-03)", () => {
  it("renames the project with the command timestamp and returns a shaped inverse", () => {
    const project = studioProjectV1Fixture;
    const result = ok(
      applyProjectCommand(
        project,
        { type: "project.rename", name: "Renamed project", updatedAt: RENAMED_AT },
        context,
      ),
    );

    expect(result.project).not.toBe(project);
    expect(result.project.name).toBe("Renamed project");
    expect(result.project.updatedAt).toBe(RENAMED_AT);
    expect(result.changedIds).toEqual({});
    expect(semanticInverse(result)).toEqual({
      type: "project.rename",
      name: "Contract project",
      updatedAt: "2026-01-01T00:01:00.000Z",
    });
    expect(project.name).toBe("Contract project");
  });

  it("imports assets immutably and inserts the ID at the requested root index", () => {
    const imported = asset("asset-imported");
    const result = ok(
      applyProjectCommand(
        studioProjectV1Fixture,
        { type: "asset.import", asset: imported, atIndex: 1 },
        context,
      ),
    );

    expect(result.project.rootOrder.assetIds).toEqual([
      "asset-sheet",
      "asset-imported",
      "asset-processed",
    ]);
    expect(result.project.assets["asset-imported"]).toEqual(imported);
    expect(result.project.assets["asset-imported"]).not.toBe(imported);
    expect(result.project.updatedAt).toBe(NOW);
    expect(result.changedIds).toEqual({ assets: ["asset-imported"], rootOrder: ["asset-imported"] });
    expect(result.impact.direct).toEqual([{ collection: "assets", id: "asset-imported" }]);
    expect(semanticInverse(result)).toEqual({ type: "asset.remove", assetId: "asset-imported", policy: "reject" });
    expect(studioProjectV1Fixture.rootOrder.assetIds).toEqual(["asset-sheet", "asset-processed"]);
  });

  it("replaces and renames an existing asset while retaining typed inverse payloads", () => {
    const replacement = cloneStudioProject(studioProjectV1Fixture).assets["asset-sheet"];
    replacement.name = "replacement.png";
    replacement.updatedAt = NOW;
    const replaced = ok(
      applyProjectCommand(
        studioProjectV1Fixture,
        { type: "asset.replace", assetId: "asset-sheet", replacement },
        context,
      ),
    );
    expect(replaced.project.assets["asset-sheet"].name).toBe("replacement.png");
    expect(replaced.project.updatedAt).toBe(NOW);
    const replaceInverse = semanticInverse(replaced);
    expect(replaceInverse).toMatchObject({ type: "asset.replace", assetId: "asset-sheet" });
    if (replaceInverse?.type !== "asset.replace") throw new Error("Expected asset.replace inverse");
    expect(replaceInverse.replacement.name).toBe("hero-sheet.png");

    const renamed = ok(
      applyProjectCommand(
        studioProjectV1Fixture,
        {
          type: "asset.rename",
          assetId: "asset-sheet",
          name: "renamed.png",
          updatedAt: RENAMED_AT,
        },
        context,
      ),
    );
    expect(renamed.project.assets["asset-sheet"].name).toBe("renamed.png");
    expect(renamed.project.assets["asset-sheet"].updatedAt).toBe(RENAMED_AT);
    expect(renamed.project.updatedAt).toBe(RENAMED_AT);
  });

  it("deletes optional region fields on undefined and restores only touched fields", () => {
    const command: ProjectCommand = {
      type: "region.update",
      regionId: "region-hero",
      patch: { name: undefined, pivot: undefined, hidden: undefined, provenance: undefined },
    };
    const result = ok(applyProjectCommand(studioProjectV1Fixture, command, context));
    const updated = result.project.regions["region-hero"];

    expect(updated).not.toHaveProperty("name");
    expect(updated).not.toHaveProperty("pivot");
    expect(updated).not.toHaveProperty("hidden");
    expect(updated).not.toHaveProperty("provenance");
    expect(Object.values(updated)).not.toContain(undefined);
    expect(result.project.updatedAt).toBe(NOW);
    expect(result.changedIds).toEqual({ regions: ["region-hero"] });
    expect(semanticInverse(result)).toEqual({
      type: "region.update",
      regionId: "region-hero",
      patch: {
        name: "Hero frame",
        pivot: { x: 64, y: 112 },
        hidden: undefined,
        provenance: { source: "fixture", sourceId: "asset-sheet" },
        updatedAt: "2026-01-01T00:01:00.000Z",
      },
    });
  });

  it("reorders regions by stable ID and rejects invalid order indices atomically", () => {
    const result = ok(
      applyProjectCommand(
        studioProjectV1Fixture,
        { type: "region.reorder", regionId: "region-hero", toIndex: 0 },
        context,
      ),
    );
    expect(result.project.rootOrder.regionIds).toEqual(["region-hero"]);
    expect(result.project).toBe(studioProjectV1Fixture);
    expect(result.changedIds).toEqual({});
    expect(result.warnings[0].code).toBe("NO_CHANGES");
    expect(result.project.updatedAt).toBe("2026-01-01T00:01:00.000Z");

    const invalid = applyProjectCommand(
      studioProjectV1Fixture,
      { type: "region.reorder", regionId: "region-hero", toIndex: 2 },
      context,
    );
    expect(invalid.ok).toBe(false);
    if (invalid.ok) throw new Error("Expected invalid order failure");
    expect(invalid.diagnostics[0].code).toBe("INVALID_ORDER");
    expect(invalid.project).toBe(studioProjectV1Fixture);
  });

  it("commits recipe, derived assets, and regions atomically while preserving payload order", () => {
    const derivedAssets = [asset("asset-derived-a"), asset("asset-derived-b")];
    const regions = [region("region-a", "asset-derived-a"), region("region-b", "asset-derived-b")];
    const result = ok(
      applyProjectCommand(
        studioProjectV1Fixture,
        {
          type: "regions.commitRecipe",
          recipe: recipe("recipe-committed"),
          derivedAssets,
          regions,
          atIndex: 0,
        },
        context,
      ),
    );

    expect(result.project.rootOrder.assetIds).toEqual([
      "asset-sheet",
      "asset-processed",
      "asset-derived-a",
      "asset-derived-b",
    ]);
    expect(result.project.rootOrder.regionIds).toEqual(["region-a", "region-b", "region-hero"]);
    expect(Object.keys(result.project.processingRecipes)).toContain("recipe-committed");
    expect(Object.keys(result.project.regions).slice(-2)).toEqual(["region-a", "region-b"]);
    expect(result.project.updatedAt).toBe(NOW);
    expect(result.changedIds).toEqual({
      processingRecipes: ["recipe-committed"],
      assets: ["asset-derived-a", "asset-derived-b"],
      regions: ["region-a", "region-b"],
      rootOrder: ["asset-derived-a", "asset-derived-b", "region-a", "region-b"],
    });
    const batchInverse = semanticInverse(result);
    expect(batchInverse).toMatchObject({ type: "command.batch" });
    if (batchInverse?.type !== "command.batch") throw new Error("Expected batch inverse");
    expect(batchInverse.commands.map((command) => command.type)).toEqual([
      "region.remove",
      "region.remove",
      "asset.remove",
      "asset.remove",
      "processingRecipe.remove",
    ]);

    const invalid = applyProjectCommand(
      studioProjectV1Fixture,
      {
        type: "regions.commitRecipe",
        recipe: recipe("recipe-invalid"),
        derivedAssets: [asset("asset-atomic")],
        regions: [region("region-invalid", "asset-missing")],
      },
      context,
    );
    expect(invalid.ok).toBe(false);
    expect(invalid.project).toBe(studioProjectV1Fixture);
    expect(invalid.project.assets).not.toHaveProperty("asset-atomic");
    expect(invalid.project.regions).not.toHaveProperty("region-invalid");
    expect(invalid.project.processingRecipes).not.toHaveProperty("recipe-invalid");
  });

  it("maps candidate validation failures to INVARIANT_VIOLATION without publishing a partial project", () => {
    const bad = asset("asset-bad");
    bad.blobKey = "blob:runtime-url";
    const result = applyProjectCommand(
      studioProjectV1Fixture,
      { type: "asset.import", asset: bad },
      context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected candidate validation failure");
    expect(result.diagnostics.some(({ code }) => code === "INVARIANT_VIOLATION")).toBe(true);
    expect(result.project).toBe(studioProjectV1Fixture);
    expect(studioProjectV1Fixture.assets).not.toHaveProperty("asset-bad");
  });

  it("returns typed precondition failures and leaves the original identity untouched", () => {
    const duplicate = applyProjectCommand(
      studioProjectV1Fixture,
      { type: "asset.import", asset: asset("asset-sheet") },
      context,
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.diagnostics[0].code).toBe("ENTITY_ALREADY_EXISTS");
    expect(duplicate.project).toBe(studioProjectV1Fixture);

    const missing = applyProjectCommand(
      studioProjectV1Fixture,
      { type: "asset.rename", assetId: "asset-missing", name: "x", updatedAt: RENAMED_AT },
      context,
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.diagnostics[0].code).toBe("ENTITY_NOT_FOUND");
    expect(missing.project).toBe(studioProjectV1Fixture);

    const mismatched = applyProjectCommand(
      studioProjectV1Fixture,
      { type: "asset.replace", assetId: "asset-sheet", replacement: asset("asset-other") },
      context,
    );
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) expect(mismatched.diagnostics[0].code).toBe("PRECONDITION_FAILED");
    expect(mismatched.project).toBe(studioProjectV1Fixture);
  });

  it("routes destructive commands through impact policy without mutating on reject", () => {
    const rejected = applyProjectCommand(
      studioProjectV1Fixture,
      { type: "asset.remove", assetId: "asset-sheet", policy: "reject" },
      context,
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.diagnostics[0].code).toBe("REFERENCE_BLOCKED");
    expect(rejected.project).toBe(studioProjectV1Fixture);
  });

  it("contains unreadable or malformed runtime payloads as typed failures", () => {
    const getterAsset = Object.defineProperty({}, "id", {
      enumerable: true,
      get: () => {
        throw new Error("must not escape the command boundary");
      },
    });
    const commands = [
      null,
      { type: "asset.import", asset: getterAsset },
      {
        type: "regions.commitRecipe",
        recipe: recipe("recipe-malformed"),
        derivedAssets: [undefined],
        regions: [],
      },
    ] as unknown as ProjectCommand[];

    for (const command of commands) {
      const result = applyProjectCommand(studioProjectV1Fixture, command, context);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.diagnostics[0].code).toBe("INVALID_PATCH");
      expect(result.project).toBe(studioProjectV1Fixture);
    }
  });

  it("rejects extra top-level command fields without invoking them", () => {
    let invoked = false;
    const command = {
      type: "sequence.update",
      sequenceId: "sequence-main",
      patch: { name: "must-not-apply" },
      get unexpected() {
        invoked = true;
        return "accepted";
      },
    } as unknown as ProjectCommand;
    const result = applyProjectCommand(studioProjectV1Fixture, command, context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe("INVALID_PATCH");
    expect(result.project).toBe(studioProjectV1Fixture);
    expect(invoked).toBe(false);
  });

  it("imports valid __proto__ entity IDs as own record keys", () => {
    const result = ok(
      applyProjectCommand(
        studioProjectV1Fixture,
        { type: "asset.import", asset: asset("__proto__") },
        context,
      ),
    );
    expect(Object.prototype.hasOwnProperty.call(result.project.assets, "__proto__")).toBe(true);
    expect(result.project.assets["__proto__"].id).toBe("__proto__");
    expect(result.project.rootOrder.assetIds).toContain("__proto__");
  });

  it("does not let class instances bypass candidate validation through NO_CHANGES", () => {
    class Bounds {
      x = 0;
      y = 0;
      width = 128;
      height = 128;
    }
    const result = applyProjectCommand(
      studioProjectV1Fixture,
      {
        type: "region.update",
        regionId: "region-hero",
        patch: { bounds: new Bounds() },
      },
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe("INVARIANT_VIOLATION");
    expect(result.project).toBe(studioProjectV1Fixture);
  });
});
