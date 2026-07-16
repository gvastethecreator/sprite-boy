import { describe, expect, it } from "vitest";

import {
  applyProjectCommand,
  type AssetRecord,
  type ProjectCommand,
  type ProjectCommandContext,
  type ProjectCommandEnvelope,
  type Region,
  type StudioProjectV1,
} from "../../core/project";
import { projectCodec } from "../../core/persistence/projectCodec";
import { createProjectStoreWithHistory } from "../../core/stores";
import {
  adaptManualRegionIntentToProjectCommand,
  MAX_MANUAL_REGIONS,
  type ManualRegionIntent,
} from "../../features/slice/irregular";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const NOW = "2026-07-16T15:30:00.000Z";
const context: ProjectCommandContext = { nextId: () => "unused", now: () => NOW };
const createIntent: ManualRegionIntent = {
  type: "create",
  regionId: "region-manual",
  sourceAssetId: "asset-sheet",
  bounds: { x: 10, y: 12, width: 20, height: 18 },
  timestamp: "2026-07-16T15:29:00.000Z",
  atIndex: 0,
};

function requiredCommand(command: ProjectCommand | null): ProjectCommand {
  if (command === null) throw new Error("Expected one ProjectCommand.");
  return command;
}

function envelope(command: ProjectCommand, commandId: string): ProjectCommandEnvelope {
  return {
    command,
    metadata: { commandId, origin: "user", history: "record" },
  };
}

function projectWithManualRegion(): StudioProjectV1 {
  const command = requiredCommand(adaptManualRegionIntentToProjectCommand(studioProjectV1Fixture, createIntent));
  const result = applyProjectCommand(studioProjectV1Fixture, command, context);
  if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join("; "));
  return {
    ...result.project,
    workspace: { ...result.project.workspace, selectedRegionId: "region-manual" },
  };
}

function defineOwn<T>(record: Record<string, T>, id: string, value: T): void {
  Object.defineProperty(record, id, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

const prototypeLikeIds = ["toString", "constructor", "__proto__"] as const;

function projectWithOwnPrototypeLikeRecords(): StudioProjectV1 {
  const project = structuredClone(studioProjectV1Fixture);
  for (const id of prototypeLikeIds) {
    const asset: AssetRecord = {
      ...structuredClone(studioProjectV1Fixture.assets["asset-sheet"]),
      id,
      blobKey: `asset/${id}`,
      contentHash: `sha256:${id}`,
    };
    const region: Region = {
      id,
      assetId: id,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      createdAt: NOW,
      updatedAt: NOW,
    };
    defineOwn(project.assets, id, asset);
    defineOwn(project.regions, id, region);
    project.rootOrder.assetIds.push(id);
    project.rootOrder.regionIds.push(id);
  }
  return project;
}

describe("S1-03 manual Region commands", () => {
  it("builds deterministic create/update/remove commands without recipe or identity replacement", () => {
    const first = requiredCommand(adaptManualRegionIntentToProjectCommand(studioProjectV1Fixture, createIntent));
    const second = requiredCommand(adaptManualRegionIntentToProjectCommand(studioProjectV1Fixture, createIntent));
    expect(first).toEqual(second);
    expect(first).toEqual({
      type: "region.create",
      region: {
        id: "region-manual",
        assetId: "asset-sheet",
        bounds: { x: 10, y: 12, width: 20, height: 18 },
        createdAt: "2026-07-16T15:29:00.000Z",
        updatedAt: "2026-07-16T15:29:00.000Z",
      },
      atIndex: 0,
    });
    expect(JSON.stringify(first)).not.toMatch(/recipe|provenance/iu);
    expect(Object.isFrozen(first)).toBe(true);

    const project = projectWithManualRegion();
    const moved = requiredCommand(adaptManualRegionIntentToProjectCommand(project, {
      type: "move", regionId: "region-manual", x: 30, y: 40,
    }));
    const resized = requiredCommand(adaptManualRegionIntentToProjectCommand(project, {
      type: "resize", regionId: "region-manual", bounds: { x: 10, y: 12, width: 24, height: 22 },
    }));
    const removed = requiredCommand(adaptManualRegionIntentToProjectCommand(project, {
      type: "delete", regionId: "region-manual",
    }));
    expect(moved).toEqual({
      type: "region.update",
      regionId: "region-manual",
      patch: { bounds: { x: 30, y: 40, width: 20, height: 18 } },
    });
    expect(resized).toEqual({
      type: "region.update",
      regionId: "region-manual",
      patch: { bounds: { x: 10, y: 12, width: 24, height: 22 } },
    });
    expect(removed).toEqual({ type: "region.remove", regionId: "region-manual", policy: "reject" });
    expect([moved, resized, removed].every((command) => !("commands" in command))).toBe(true);
  });

  it("keeps Region selection/identity through move+resize, survives reload and restores delete with one undo", () => {
    const initial = projectWithManualRegion();
    const { store, history } = createProjectStoreWithHistory(initial, { context });

    const move = requiredCommand(adaptManualRegionIntentToProjectCommand(store.getSnapshot().project as StudioProjectV1, {
      type: "move", regionId: "region-manual", x: 40, y: 30,
    }));
    expect(store.dispatch(envelope(move, "manual-move"))).toMatchObject({ revision: 1, result: { ok: true } });
    expect(store.getSnapshot().project.workspace.selectedRegionId).toBe("region-manual");
    expect(store.getSnapshot().project.regions["region-manual"]).toMatchObject({
      id: "region-manual",
      bounds: { x: 40, y: 30, width: 20, height: 18 },
    });

    const noOp = adaptManualRegionIntentToProjectCommand(store.getSnapshot().project as StudioProjectV1, {
      type: "move", regionId: "region-manual", x: 40, y: 30,
    });
    expect(noOp).toBeNull();
    expect(store.getSnapshot().revision).toBe(1);
    expect(history.getSnapshot().undoEntries).toHaveLength(1);

    const resize = requiredCommand(adaptManualRegionIntentToProjectCommand(store.getSnapshot().project as StudioProjectV1, {
      type: "resize", regionId: "region-manual", bounds: { x: 40, y: 30, width: 30, height: 28 },
    }));
    expect(store.dispatch(envelope(resize, "manual-resize"))).toMatchObject({ revision: 2, result: { ok: true } });
    const reloaded = projectCodec.decode(projectCodec.encode(store.getSnapshot().project as StudioProjectV1));
    expect(reloaded.regions["region-manual"]).toMatchObject({
      id: "region-manual",
      assetId: "asset-sheet",
      bounds: { x: 40, y: 30, width: 30, height: 28 },
    });

    const remove = requiredCommand(adaptManualRegionIntentToProjectCommand(reloaded, {
      type: "delete", regionId: "region-manual",
    }));
    expect(store.dispatch(envelope(remove, "manual-delete"))).toMatchObject({ revision: 3, result: { ok: true } });
    expect(store.getSnapshot().project.regions).not.toHaveProperty("region-manual");
    expect(store.getSnapshot().project.workspace.selectedRegionId).toBeUndefined();

    expect(history.undo()).toEqual({ ok: true, revision: 4 });
    expect(store.getSnapshot().project.regions["region-manual"].bounds).toEqual({ x: 40, y: 30, width: 30, height: 28 });
    expect(store.getSnapshot().project.workspace.selectedRegionId).toBe("region-manual");
    expect(history.undo()).toEqual({ ok: true, revision: 5 });
    expect(history.undo()).toEqual({ ok: true, revision: 6 });
    expect(store.getSnapshot().project).toEqual(initial);
  });

  it("rejects missing targets, non-integer/out-of-source geometry and invalid order", () => {
    const project = projectWithManualRegion();
    const cases: ManualRegionIntent[] = [
      { type: "move", regionId: "missing", x: 0, y: 0 },
      { type: "move", regionId: "region-manual", x: 0.5, y: 0 },
      { type: "move", regionId: "region-manual", x: 250, y: 0 },
      { type: "resize", regionId: "region-manual", bounds: { x: 0, y: 0, width: 0, height: 1 } },
      { ...createIntent, regionId: "region-invalid-order", atIndex: 99 },
      { ...createIntent, regionId: "region-outside", bounds: { x: 255, y: 127, width: 2, height: 1 } },
    ];
    for (const intent of cases) {
      expect(() => adaptManualRegionIntentToProjectCommand(project, intent)).toThrow(TypeError);
    }

    const referencedDelete = requiredCommand(adaptManualRegionIntentToProjectCommand(studioProjectV1Fixture, {
      type: "delete", regionId: "region-hero",
    }));
    const blocked = applyProjectCommand(studioProjectV1Fixture, referencedDelete, context);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error("Expected referenced Region deletion to fail.");
    expect(blocked.diagnostics.length).toBeGreaterThan(0);
    expect(blocked.diagnostics.every(({ code }) => code === "REFERENCE_BLOCKED")).toBe(true);
    expect(blocked.project).toBe(studioProjectV1Fixture);
    expect(blocked.project.workspace.selectedRegionId).toBe("region-hero");
  });

  it("contains hostile project/intent descriptors and proxies without getter execution or secret leakage", () => {
    let projectReads = 0;
    const hostileProject = { ...studioProjectV1Fixture } as Record<string, unknown>;
    Object.defineProperty(hostileProject, "regions", {
      enumerable: true,
      get() {
        projectReads += 1;
        return studioProjectV1Fixture.regions;
      },
    });
    expect(() => adaptManualRegionIntentToProjectCommand(hostileProject, createIntent)).toThrow(
      "Manual Region command adapter requires a canonical data-only StudioProjectV1.",
    );
    expect(projectReads).toBe(0);

    let intentReads = 0;
    const hostileIntent = { ...createIntent } as Record<string, unknown>;
    Object.defineProperty(hostileIntent, "type", {
      enumerable: true,
      get() {
        intentReads += 1;
        return "create";
      },
    });
    expect(() => adaptManualRegionIntentToProjectCommand(
      studioProjectV1Fixture,
      hostileIntent,
    )).toThrow("Manual Region command adapter received an invalid intent shape.");
    expect(intentReads).toBe(0);

    const secretProxy = new Proxy({}, {
      ownKeys() {
        throw new Error("PRIVATE_MANUAL_REGION_SECRET");
      },
    });
    let thrown: unknown;
    try {
      adaptManualRegionIntentToProjectCommand(studioProjectV1Fixture, secretProxy);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(String(thrown)).toBe("TypeError: Manual Region command adapter received an invalid intent shape.");
    expect(String(thrown)).not.toContain("PRIVATE_MANUAL_REGION_SECRET");

    const revokedProject = Proxy.revocable({}, {});
    revokedProject.revoke();
    expect(() => adaptManualRegionIntentToProjectCommand(
      revokedProject.proxy,
      createIntent,
    )).toThrow("Manual Region command adapter requires a canonical data-only StudioProjectV1.");
  });

  it("rejects inherited prototype-like IDs but accepts exact own canonical records with those IDs", () => {
    for (const id of prototypeLikeIds) {
      expect(() => adaptManualRegionIntentToProjectCommand(studioProjectV1Fixture, {
        ...createIntent,
        regionId: `region-from-${id}`,
        sourceAssetId: id,
      })).toThrow("Manual Region command adapter source Asset does not exist in the canonical project.");
      expect(() => adaptManualRegionIntentToProjectCommand(studioProjectV1Fixture, {
        type: "delete", regionId: id,
      })).toThrow("Manual Region command adapter target Region does not exist in the canonical project.");
      expect(() => adaptManualRegionIntentToProjectCommand(studioProjectV1Fixture, {
        type: "move", regionId: id, x: 1, y: 1,
      })).toThrow("Manual Region command adapter target Region does not exist in the canonical project.");
      expect(() => adaptManualRegionIntentToProjectCommand(studioProjectV1Fixture, {
        type: "resize", regionId: id, bounds: { x: 0, y: 0, width: 2, height: 2 },
      })).toThrow("Manual Region command adapter target Region does not exist in the canonical project.");
    }

    const ownProject = projectWithOwnPrototypeLikeRecords();
    for (const id of prototypeLikeIds) {
      expect(adaptManualRegionIntentToProjectCommand(ownProject, {
        ...createIntent,
        regionId: `region-from-${id}`,
        sourceAssetId: id,
      })).toMatchObject({ type: "region.create", region: { assetId: id } });
      expect(adaptManualRegionIntentToProjectCommand(ownProject, {
        type: "delete", regionId: id,
      })).toEqual({ type: "region.remove", regionId: id, policy: "reject" });
      expect(adaptManualRegionIntentToProjectCommand(ownProject, {
        type: "move", regionId: id, x: 1, y: 1,
      })).toMatchObject({ type: "region.update", regionId: id, patch: { bounds: { x: 1, y: 1 } } });
      expect(adaptManualRegionIntentToProjectCommand(ownProject, {
        type: "resize", regionId: id, bounds: { x: 0, y: 0, width: 2, height: 2 },
      })).toMatchObject({ type: "region.update", regionId: id, patch: { bounds: { width: 2, height: 2 } } });
    }
  });

  it("enforces the deterministic manual Region count limit", () => {
    const project = structuredClone(studioProjectV1Fixture);
    for (let index = 1; index < MAX_MANUAL_REGIONS; index += 1) {
      const id = `region-limit-${index}`;
      project.regions[id] = {
        id,
        assetId: "asset-sheet",
        bounds: { x: index % 256, y: Math.floor(index / 256) % 128, width: 1, height: 1 },
        createdAt: NOW,
        updatedAt: NOW,
      };
      project.rootOrder.regionIds.push(id);
    }
    expect(Object.keys(project.regions)).toHaveLength(MAX_MANUAL_REGIONS);
    expect(() => adaptManualRegionIntentToProjectCommand(project, {
      ...createIntent,
      regionId: "region-over-limit",
      atIndex: MAX_MANUAL_REGIONS,
    })).toThrow(`Manual Region command adapter cannot exceed ${MAX_MANUAL_REGIONS} Regions.`);
  });
});
