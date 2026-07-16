import { describe, expect, it } from "vitest";

import {
  applyProjectCommand,
  applyProjectCommandInverse,
} from "../../core/project/applyCommand";
import {
  PROJECT_COMMAND_TYPES,
  type ProjectCommand,
  type ProjectCommandContext,
  type ProjectCommandResult,
} from "../../core/project/commands";
import { analyzeProjectCommandImpact } from "../../core/project/impact";
import type { Region } from "../../core/project/schema";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const NOW = "2026-07-16T15:00:00.000Z";
const context: ProjectCommandContext = { nextId: () => "unused", now: () => NOW };

function region(overrides: Partial<Region> = {}): Region {
  return {
    id: "region-manual",
    assetId: "asset-sheet",
    bounds: { x: 8, y: 6, width: 32, height: 24 },
    createdAt: "2026-07-16T14:59:00.000Z",
    updatedAt: "2026-07-16T14:59:00.000Z",
    ...overrides,
  };
}

function createCommand(value: unknown): ProjectCommand {
  return value as ProjectCommand;
}

function ok(result: ProjectCommandResult): Extract<ProjectCommandResult, { ok: true }> {
  if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join("; "));
  return result;
}

describe("region.create canonical command", () => {
  it("creates one source-owned Region at a bounded order index with exact inverse and impact", () => {
    expect(PROJECT_COMMAND_TYPES).toContain("region.create");
    const command: ProjectCommand = { type: "region.create", region: region(), atIndex: 0 };
    expect(analyzeProjectCommandImpact(studioProjectV1Fixture, command)).toEqual({
      direct: [{ collection: "regions", id: "region-manual" }],
      referencedBy: [],
      cascades: [],
      blockers: [],
    });

    const result = ok(applyProjectCommand(studioProjectV1Fixture, command, context));
    expect(result.project).not.toBe(studioProjectV1Fixture);
    expect(result.project.regions["region-manual"]).toEqual(region());
    expect(result.project.rootOrder.regionIds).toEqual(["region-manual", "region-hero"]);
    expect(result.changedIds).toEqual({
      regions: ["region-manual"],
      rootOrder: ["region-manual"],
    });
    expect(result.inverse).toMatchObject({
      type: "project.restoreSnapshot",
      semantic: { type: "region.remove", regionId: "region-manual", policy: "reject" },
    });

    const undone = ok(applyProjectCommandInverse(result.project, result.inverse, context));
    expect(undone.project).toEqual(studioProjectV1Fixture);
  });

  it("rejects duplicate identity, missing source, unsafe/out-of-source bounds and order without mutation", () => {
    const cases: ProjectCommand[] = [
      { type: "region.create", region: region({ id: "region-hero" }) },
      { type: "region.create", region: region({ assetId: "asset-missing" }) },
      { type: "region.create", region: region({ bounds: { x: 0.5, y: 0, width: 1, height: 1 } }) },
      { type: "region.create", region: region({ bounds: { x: 240, y: 0, width: 17, height: 1 } }) },
      { type: "region.create", region: region(), atIndex: 2 },
    ];
    for (const command of cases) {
      const result = applyProjectCommand(studioProjectV1Fixture, command, context);
      expect(result.ok).toBe(false);
      expect(result.project).toBe(studioProjectV1Fixture);
    }
    expect(analyzeProjectCommandImpact(studioProjectV1Fixture, cases[0])).toMatchObject({
      blockers: [{ code: "ENTITY_ALREADY_EXISTS" }],
    });
    expect(analyzeProjectCommandImpact(studioProjectV1Fixture, cases[1])).toMatchObject({
      blockers: [{ code: "ENTITY_NOT_FOUND" }],
    });
  });

  it("rejects accessor, extra-field and revoked-proxy Region payloads without executing or leaking", () => {
    let reads = 0;
    const accessor = region() as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, "id", {
      enumerable: true,
      get() {
        reads += 1;
        return "region-hostile";
      },
    });
    const accessorResult = applyProjectCommand(
      studioProjectV1Fixture,
      createCommand({ type: "region.create", region: accessor }),
      context,
    );
    expect(accessorResult).toMatchObject({ ok: false, diagnostics: [{ code: "INVALID_PATCH" }] });
    expect(accessorResult.project).toBe(studioProjectV1Fixture);
    expect(reads).toBe(0);

    const extraResult = applyProjectCommand(
      studioProjectV1Fixture,
      createCommand({ type: "region.create", region: { ...region(), recipeId: "invented" } }),
      context,
    );
    expect(extraResult).toMatchObject({ ok: false, diagnostics: [{ code: "INVALID_PATCH" }] });

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const revokedResult = applyProjectCommand(
      studioProjectV1Fixture,
      createCommand({ type: "region.create", region: revoked.proxy }),
      context,
    );
    expect(revokedResult).toMatchObject({
      ok: false,
      diagnostics: [{ message: "region.create requires an exact data-only Region record." }],
    });
    expect(JSON.stringify(revokedResult)).not.toContain("PRIVATE");
  });
});
