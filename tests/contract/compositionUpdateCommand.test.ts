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
  ProjectCommandEnvelope,
  ProjectCommandResult,
} from "../../core/project/commands";
import { cloneStudioProject } from "../../core/project/graph";
import { analyzeProjectCommandImpact } from "../../core/project/impact";
import { validateStudioProject } from "../../core/project/validation";
import { createProjectStoreWithHistory } from "../../core/stores";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const NOW = "2026-07-16T13:00:00.000Z";
const UPDATED_AT = "2026-07-16T12:59:00.000Z";
const context: ProjectCommandContext = { nextId: () => "unused", now: () => NOW };

function command(value: unknown): ProjectCommand {
  return value as ProjectCommand;
}

function ok(result: ProjectCommandResult): Extract<ProjectCommandResult, { ok: true }> {
  if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join("; "));
  return result;
}

function semanticInverse(result: Extract<ProjectCommandResult, { ok: true }>) {
  return result.inverse.type === "project.restoreSnapshot"
    ? result.inverse.semantic
    : result.inverse;
}

function envelope(
  compositionId: string,
  patch: Extract<ProjectCommand, { type: "composition.update" }>["patch"],
  commandId: string,
): ProjectCommandEnvelope {
  return {
    command: { type: "composition.update", compositionId, patch },
    metadata: { commandId, origin: "user", history: "record" },
  };
}

describe("composition.update command", () => {
  it("patches canvas settings immutably and returns an exact roundtrip inverse", () => {
    const before = cloneStudioProject(studioProjectV1Fixture);
    const originalComposition = studioProjectV1Fixture.compositions["composition-project"];
    const result = ok(applyProjectCommand(
      studioProjectV1Fixture,
      {
        type: "composition.update",
        compositionId: "composition-project",
        patch: {
          name: "Renamed canvas",
          width: 256,
          height: 192,
          background: "#1a2B3cDD",
          updatedAt: UPDATED_AT,
        },
      },
      context,
    ));

    expect(result.project).not.toBe(studioProjectV1Fixture);
    expect(result.project.compositions["composition-project"]).toMatchObject({
      id: "composition-project",
      name: "Renamed canvas",
      width: 256,
      height: 192,
      background: "#1a2B3cDD",
      updatedAt: UPDATED_AT,
    });
    expect(result.project.compositions["composition-project"].owner).toEqual(originalComposition.owner);
    expect(result.project.compositions["composition-project"].layerIds).toEqual(originalComposition.layerIds);
    expect(result.project.compositions["composition-project"].createdAt).toBe(originalComposition.createdAt);
    expect(result.project.layers).toEqual(studioProjectV1Fixture.layers);
    expect(result.project.rootOrder).toEqual(studioProjectV1Fixture.rootOrder);
    expect(result.project.cels).toEqual(studioProjectV1Fixture.cels);
    expect(result.project.variantSets).toEqual(studioProjectV1Fixture.variantSets);
    expect(result.project.updatedAt).toBe(NOW);
    expect(result.changedIds).toEqual({ compositions: ["composition-project"] });
    expect(result.impact).toEqual({
      direct: [{ collection: "compositions", id: "composition-project" }],
      referencedBy: [],
      cascades: [],
      blockers: [],
    });
    expect(semanticInverse(result)).toEqual({
      type: "composition.update",
      compositionId: "composition-project",
      patch: {
        name: "Workspace composition",
        width: 128,
        height: 128,
        background: null,
        updatedAt: "2026-01-01T00:01:00.000Z",
      },
    });
    expect(validateStudioProject(result.project).valid).toBe(true);

    const restored = ok(applyProjectCommandInverse(result.project, result.inverse, context));
    expect(restored.project).toEqual(before);
    expect(studioProjectV1Fixture).toEqual(before);
  });

  it("updates project, cel and variant-owned compositions without changing ownership or graph refs", () => {
    const cases = [
      ["composition-project", { type: "project" }],
      ["composition-cel", { type: "cel", celId: "cel-composition" }],
      ["composition-variant-a", { type: "variantSet", variantSetId: "variant-set-main", variant: "A" }],
    ] as const;

    for (const [compositionId, owner] of cases) {
      const result = ok(applyProjectCommand(
        studioProjectV1Fixture,
        { type: "composition.update", compositionId, patch: { name: `Updated ${compositionId}` } },
        context,
      ));
      expect(result.project.compositions[compositionId]).toMatchObject({
        id: compositionId,
        name: `Updated ${compositionId}`,
        owner,
        updatedAt: NOW,
      });
      expect(result.project.compositions[compositionId].layerIds).toEqual(
        studioProjectV1Fixture.compositions[compositionId].layerIds,
      );
      expect(Object.keys(result.project.compositions)).toEqual(Object.keys(studioProjectV1Fixture.compositions));
      expect(Object.keys(result.project.layers)).toEqual(Object.keys(studioProjectV1Fixture.layers));
      expect(validateStudioProject(result.project).valid).toBe(true);
    }
  });

  it("treats an equal non-empty patch as a stable no-op", () => {
    const result = ok(applyProjectCommand(
      studioProjectV1Fixture,
      {
        type: "composition.update",
        compositionId: "composition-project",
        patch: { name: "Workspace composition", width: 128, background: null },
      },
      context,
    ));
    expect(result.project).toBe(studioProjectV1Fixture);
    expect(result.changedIds).toEqual({});
    expect(result.warnings).toEqual([
      { code: "NO_CHANGES", message: "The command produced no document changes." },
    ]);
  });

  it("rejects empty, extra, undefined, unsafe string, dimension, color and timestamp patches atomically", () => {
    const invalidPatches: unknown[] = [
      {},
      { owner: { type: "project" } },
      { name: undefined },
      { width: undefined },
      { height: undefined },
      { background: undefined },
      { updatedAt: undefined },
      { name: "   " },
      { name: "bad\u0000name" },
      { name: "x".repeat(257) },
      { width: 0 },
      { width: -0 },
      { width: NaN },
      { width: Number.POSITIVE_INFINITY },
      { width: 1.5 },
      { width: 16_385 },
      { height: 16_385 },
      { width: 16_384, height: 4_097 },
      { background: "transparent" },
      { background: "rgb(1 2 3)" },
      { background: "#12" },
      { updatedAt: "yesterday" },
    ];

    for (const patch of invalidPatches) {
      const result = applyProjectCommand(
        studioProjectV1Fixture,
        command({ type: "composition.update", compositionId: "composition-project", patch }),
        context,
      );
      expect(result.ok, JSON.stringify(patch)).toBe(false);
      expect(result.project).toBe(studioProjectV1Fixture);
      if (!result.ok) expect(result.diagnostics[0].code).toBe("INVALID_PATCH");
    }

    for (const value of [
      { type: "composition.update", compositionId: "missing", patch: { name: "Valid" } },
      { type: "composition.update", compositionId: "", patch: { name: "Valid" } },
      { type: "composition.update", compositionId: "composition-project", patch: null },
      { type: "composition.update", compositionId: "composition-project", patch: [], extra: true },
    ]) {
      const result = applyProjectCommand(studioProjectV1Fixture, command(value), context);
      expect(result.ok).toBe(false);
      expect(result.project).toBe(studioProjectV1Fixture);
    }
  });

  it("accepts canonical transparent and hex colors at safe canvas boundaries", () => {
    for (const background of [null, "#abc", "#abcd", "#A1b2C3", "#A1b2C3d4"] as const) {
      const result = ok(applyProjectCommand(
        studioProjectV1Fixture,
        {
          type: "composition.update",
          compositionId: "composition-project",
          patch: { width: 16_384, height: 4_096, background },
        },
        context,
      ));
      expect(result.project.compositions["composition-project"]).toMatchObject({
        width: 16_384,
        height: 4_096,
        background,
      });
    }
  });

  it("contains accessors and revoked proxies without executing getters", () => {
    let reads = 0;
    const accessorPatch = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessorPatch, "name", {
      enumerable: true,
      get() {
        reads += 1;
        return "Compromised";
      },
    });
    const accessor = applyProjectCommand(
      studioProjectV1Fixture,
      command({ type: "composition.update", compositionId: "composition-project", patch: accessorPatch }),
      context,
    );
    expect(accessor.ok).toBe(false);
    expect(accessor.project).toBe(studioProjectV1Fixture);
    expect(reads).toBe(0);

    const accessorCommand = { compositionId: "composition-project", patch: { name: "Compromised" } };
    Object.defineProperty(accessorCommand, "type", {
      enumerable: true,
      get() {
        reads += 1;
        return "composition.update";
      },
    });
    expect(applyProjectCommand(studioProjectV1Fixture, command(accessorCommand), context).ok).toBe(false);
    expect(reads).toBe(0);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const proxyResult = applyProjectCommand(
      studioProjectV1Fixture,
      command({ type: "composition.update", compositionId: "composition-project", patch: revoked.proxy }),
      context,
    );
    expect(proxyResult.ok).toBe(false);
    expect(proxyResult.project).toBe(studioProjectV1Fixture);

    const impact = analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "composition.update",
      compositionId: "composition-project",
      patch: accessorPatch,
    });
    expect(impact.blockers).toMatchObject([{ code: "INVALID_PATCH", path: "$.patch" }]);
    expect(reads).toBe(0);
  });

  it("reports minimal impact and keeps batches atomic", () => {
    expect(analyzeProjectCommandImpact(studioProjectV1Fixture, {
      type: "composition.update",
      compositionId: "composition-cel",
      patch: { width: 256 },
    })).toEqual({
      direct: [{ collection: "compositions", id: "composition-cel" }],
      referencedBy: [],
      cascades: [],
      blockers: [],
    });

    const batch: ProjectCommandBatch = {
      type: "command.batch",
      commands: [
        { type: "composition.update", compositionId: "composition-project", patch: { name: "First" } },
        { type: "composition.update", compositionId: "composition-cel", patch: { width: 0 } },
      ],
    };
    const failed = applyProjectCommandBatch(studioProjectV1Fixture, batch, context);
    expect(failed.ok).toBe(false);
    expect(failed.project).toBe(studioProjectV1Fixture);
    expect(studioProjectV1Fixture.compositions["composition-project"].name).toBe("Workspace composition");
  });

  it("integrates one store revision with exact undo and redo", () => {
    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, { context });
    const stable = store.dispatch(envelope(
      "composition-project",
      { name: "Workspace composition" },
      "composition-stable",
    ));
    expect(stable.revision).toBe(0);

    const changed = store.dispatch(envelope(
      "composition-project",
      { name: "Stored canvas", width: 320, height: 180, background: null },
      "composition-change",
    ));
    expect(changed).toMatchObject({ revision: 1, result: { ok: true } });
    expect(store.getSnapshot().project.compositions["composition-project"]).toMatchObject({
      name: "Stored canvas",
      width: 320,
      height: 180,
    });
    expect(history.undo()).toEqual({ ok: true, revision: 2 });
    expect(store.getSnapshot().project).toEqual(studioProjectV1Fixture);
    expect(history.redo()).toEqual({ ok: true, revision: 3 });
    expect(store.getSnapshot().project.compositions["composition-project"]).toMatchObject({
      name: "Stored canvas",
      width: 320,
      height: 180,
    });
  });
});
