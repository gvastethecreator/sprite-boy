import { describe, expect, it, vi } from "vitest";
import {
  applyProjectCommand,
  applyProjectCommandInverse,
  type ProjectCommandContext,
  type ProjectCommandResult,
  type WorkspacePatch,
} from "../../core/project";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const NOW = "2026-07-14T15:00:00.000Z";
const context: ProjectCommandContext = {
  nextId: () => "unused-id",
  now: () => NOW,
};

function ok(result: ProjectCommandResult): Extract<ProjectCommandResult, { ok: true }> {
  if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join("; "));
  return result;
}

function update(patch: WorkspacePatch): ProjectCommandResult {
  return applyProjectCommand(studioProjectV1Fixture, { type: "workspace.update", patch }, context);
}

describe("workspace.update command", () => {
  it("updates durable workspace state, deletes undefined fields and round-trips exactly", () => {
    const selectedCelIds = ["cel-composition"];
    const changed = ok(update({
      activeWorkspace: "animate",
      selectedAssetId: undefined,
      selectedCelIds,
    }));
    selectedCelIds[0] = "cel-variants";

    expect(changed.project.workspace).toMatchObject({
      activeWorkspace: "animate",
      selectedCelIds: ["cel-composition"],
    });
    expect(changed.project.workspace).not.toHaveProperty("selectedAssetId");
    expect(changed.project.updatedAt).toBe(NOW);
    expect(changed.changedIds).toEqual({ workspace: [studioProjectV1Fixture.id] });

    const restored = ok(applyProjectCommandInverse(changed.project, changed.inverse, context));
    expect(restored.project).toEqual(studioProjectV1Fixture);
  });

  it("returns the original project for a semantic no-op", () => {
    const unchanged = ok(update({
      activeWorkspace: "compose",
      selectedCelIds: ["cel-composition", "cel-variants"],
    }));

    expect(unchanged.project).toBe(studioProjectV1Fixture);
    expect(unchanged.project.updatedAt).toBe(studioProjectV1Fixture.updatedAt);
    expect(unchanged.warnings).toMatchObject([{ code: "NO_CHANGES" }]);
  });

  it("rejects dangling scalar and cel selections atomically", () => {
    for (const patch of [
      { selectedAssetId: "asset-missing" },
      { selectedCelIds: ["cel-missing"] },
    ] satisfies WorkspacePatch[]) {
      const result = update(patch);
      expect(result.ok).toBe(false);
      expect(result.project).toBe(studioProjectV1Fixture);
      if (result.ok) throw new Error("Expected invalid workspace reference");
      expect(result.diagnostics).toMatchObject([{ code: "INVARIANT_VIOLATION" }]);
    }
  });

  it("rejects sparse, custom-field and duplicate cel arrays", () => {
    const sparse: string[] = [];
    sparse.length = 1;
    const custom = ["cel-composition"] as string[] & { extra?: boolean };
    custom.extra = true;

    for (const selectedCelIds of [
      sparse,
      custom,
      ["cel-composition", "cel-composition"],
    ]) {
      const result = update({ selectedCelIds });
      expect(result.ok).toBe(false);
      expect(result.project).toBe(studioProjectV1Fixture);
      if (result.ok) throw new Error("Expected invalid selectedCelIds");
      expect(result.diagnostics[0]).toMatchObject({ code: "INVALID_PATCH" });
      expect(result.diagnostics[0].path).toMatch(/^\$\.patch\.selectedCelIds/);
    }
  });

  it("contains accessors and never reads an array Proxy length through get", () => {
    const getter = vi.fn(() => "asset-sheet");
    const accessorPatch = Object.create(null) as WorkspacePatch;
    Object.defineProperty(accessorPatch, "selectedAssetId", { enumerable: true, get: getter });

    const accessorResult = update(accessorPatch);
    expect(accessorResult.ok).toBe(false);
    expect(accessorResult.project).toBe(studioProjectV1Fixture);
    expect(getter).not.toHaveBeenCalled();

    const lengthReads: PropertyKey[] = [];
    const selectedCelIds = new Proxy(["cel-composition"], {
      get(target, property, receiver) {
        if (property === "length") lengthReads.push(property);
        return Reflect.get(target, property, receiver);
      },
    });
    const proxyResult = ok(update({ selectedCelIds }));

    expect(proxyResult.project.workspace.selectedCelIds).toEqual(["cel-composition"]);
    expect(lengthReads).toEqual([]);
  });
});
