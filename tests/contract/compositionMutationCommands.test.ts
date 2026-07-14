import { describe, expect, it } from "vitest";
import { applyCompositionFamilyCommand } from "../../core/project/applyCompositionCommands";
import { applyProjectCommand } from "../../core/project/applyCommand";
import type {
  ProjectCommand,
  ProjectCommandContext,
  ProjectCommandResult,
} from "../../core/project/commands";
import { cloneStudioProject } from "../../core/project/graph";
import type { Composition, Layer } from "../../core/project/schema";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const NOW = "2026-01-01T00:10:00.000Z";
const UPDATED_AT = "2026-01-01T00:11:00.000Z";

const context: ProjectCommandContext = {
  nextId: () => "unused-id",
  now: () => NOW,
};

function ok(result: ProjectCommandResult | undefined) {
  if (!result || !result.ok) {
    throw new Error(
      result?.diagnostics.map(({ code, message }) => `${code}: ${message}`).join("; ") ??
        "Expected a handled command result.",
    );
  }
  return result;
}

function semanticInverse(result: Extract<ProjectCommandResult, { ok: true }>) {
  return result.inverse.type === "project.restoreSnapshot"
    ? result.inverse.semantic
    : result.inverse;
}

function composition(id: string, layerIds: string[] = []): Composition {
  return {
    id,
    name: `${id} composition`,
    owner: { type: "project" },
    layerIds,
    width: 128,
    height: 128,
    background: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function layer(id: string, compositionId: string, source: Layer["source"] = { type: "asset", id: "asset-sheet" }): Layer {
  return {
    id,
    compositionId,
    name: `${id} layer`,
    source,
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
      flipX: false,
      flipY: false,
    },
    visible: true,
    locked: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("applyCompositionFamilyCommand (F1-04)", () => {
  it("creates a project composition with layers in payload order and a typed batch inverse", () => {
    const project = studioProjectV1Fixture;
    const createdComposition = composition("composition-new", ["layer-new-a", "layer-new-b"]);
    const createdLayers = [
      layer("layer-new-a", createdComposition.id),
      layer("layer-new-b", createdComposition.id, { type: "region", id: "region-hero" }),
    ];
    const result = ok(
      applyCompositionFamilyCommand(
        project,
        { type: "composition.create", composition: createdComposition, layers: createdLayers, atIndex: 0 },
        context,
      ),
    );

    expect(result.project).not.toBe(project);
    expect(result.project.rootOrder.compositionIds).toEqual([
      "composition-new",
      "composition-project",
    ]);
    expect(result.project.compositions["composition-new"].layerIds).toEqual([
      "layer-new-a",
      "layer-new-b",
    ]);
    expect(Object.keys(result.project.layers).slice(-2)).toEqual(["layer-new-a", "layer-new-b"]);
    expect(result.project.updatedAt).toBe(NOW);
    expect(result.changedIds).toEqual({
      compositions: ["composition-new"],
      layers: ["layer-new-a", "layer-new-b"],
      rootOrder: ["composition-new"],
    });
    expect(result.impact.direct).toEqual([
      { collection: "compositions", id: "composition-new" },
      { collection: "layers", id: "layer-new-a" },
      { collection: "layers", id: "layer-new-b" },
    ]);
    expect(semanticInverse(result)).toEqual({
      type: "command.batch",
      commands: [
        { type: "layer.remove", layerId: "layer-new-b" },
        { type: "layer.remove", layerId: "layer-new-a" },
        { type: "composition.remove", compositionId: "composition-new", policy: "reject" },
      ],
    });
    expect(project.rootOrder.compositionIds).toEqual(["composition-project"]);
    expect(project.compositions).not.toHaveProperty("composition-new");
  });

  it("adds a layer to the owning composition at the requested index without aliasing payloads", () => {
    const project = cloneStudioProject(studioProjectV1Fixture);
    const added = layer("layer-added", "composition-project");
    const result = ok(
      applyCompositionFamilyCommand(
        project,
        { type: "layer.add", compositionId: "composition-project", layer: added, atIndex: 0 },
        context,
      ),
    );

    expect(result.project.compositions["composition-project"].layerIds).toEqual([
      "layer-added",
      "layer-project",
    ]);
    expect(result.project.layers["layer-added"]).toEqual(added);
    expect(result.project.layers["layer-added"]).not.toBe(added);
    expect(result.changedIds).toEqual({ layers: ["layer-added"], compositions: ["composition-project"] });
    expect(semanticInverse(result)).toEqual({ type: "layer.remove", layerId: "layer-added" });
    expect(project.compositions["composition-project"].layerIds).toEqual(["layer-project"]);
  });

  it("updates only touched layer fields, removes optional undefined values, and restores them in the inverse", () => {
    const project = studioProjectV1Fixture;
    const result = ok(
      applyCompositionFamilyCommand(
        project,
        {
          type: "layer.update",
          layerId: "layer-project",
          patch: { name: undefined, visible: undefined, locked: undefined },
        },
        context,
      ),
    );
    const updated = result.project.layers["layer-project"];
    expect(updated).not.toHaveProperty("name");
    expect(updated).not.toHaveProperty("visible");
    expect(updated).not.toHaveProperty("locked");
    expect(updated.updatedAt).toBe(NOW);
    expect(Object.values(updated)).not.toContain(undefined);
    expect(result.changedIds).toEqual({ layers: ["layer-project"] });
    expect(semanticInverse(result)).toEqual({
      type: "layer.update",
      layerId: "layer-project",
      patch: {
        name: "Project layer",
        visible: true,
        locked: false,
        updatedAt: "2026-01-01T00:01:00.000Z",
      },
    });
    expect(project.layers["layer-project"].name).toBe("Project layer");
  });

  it("reorders layers by composition ownership and returns the previous index", () => {
    const project = cloneStudioProject(studioProjectV1Fixture);
    const second = layer("layer-second", "composition-project");
    project.layers[second.id] = second;
    project.compositions["composition-project"].layerIds = ["layer-project", second.id];

    const result = ok(
      applyCompositionFamilyCommand(
        project,
        { type: "layer.reorder", layerId: "layer-project", toIndex: 1 },
        context,
      ),
    );
    expect(result.project.compositions["composition-project"].layerIds).toEqual([
      "layer-second",
      "layer-project",
    ]);
    expect(result.changedIds).toEqual({ layers: ["layer-project"], compositions: ["composition-project"] });
    expect(semanticInverse(result)).toEqual({ type: "layer.reorder", layerId: "layer-project", toIndex: 0 });
  });

  it("activates only a variant key present in the set and preserves the previous value in the inverse", () => {
    const project = studioProjectV1Fixture;
    const result = ok(
      applyCompositionFamilyCommand(
        project,
        {
          type: "variant.activate",
          variantSetId: "variant-set-main",
          variant: "B",
          updatedAt: UPDATED_AT,
        },
        context,
      ),
    );
    expect(result.project.variantSets["variant-set-main"].activeVariant).toBe("B");
    expect(result.project.variantSets["variant-set-main"].updatedAt).toBe(UPDATED_AT);
    expect(result.changedIds).toEqual({ variantSets: ["variant-set-main"] });
    expect(semanticInverse(result)).toEqual({
      type: "variant.activate",
      variantSetId: "variant-set-main",
      variant: "A",
      updatedAt: "2026-01-01T00:01:00.000Z",
    });
    expect(project.variantSets["variant-set-main"].activeVariant).toBe("A");
  });

  it("rejects missing references, ownership mismatches, and invalid order atomically", () => {
    const project = studioProjectV1Fixture;
    const missingComposition = applyCompositionFamilyCommand(
      project,
      { type: "layer.add", compositionId: "composition-missing", layer: layer("layer-new", "composition-missing") },
      context,
    );
    expect(missingComposition?.ok).toBe(false);
    if (missingComposition && !missingComposition.ok) expect(missingComposition.diagnostics[0].code).toBe("ENTITY_NOT_FOUND");
    expect(missingComposition?.project).toBe(project);

    const mismatchedLayer = applyCompositionFamilyCommand(
      project,
      { type: "layer.add", compositionId: "composition-project", layer: layer("layer-new", "composition-cel") },
      context,
    );
    expect(mismatchedLayer?.ok).toBe(false);
    if (mismatchedLayer && !mismatchedLayer.ok) expect(mismatchedLayer.diagnostics[0].code).toBe("PRECONDITION_FAILED");
    expect(mismatchedLayer?.project).toBe(project);

    const invalidOrder = applyCompositionFamilyCommand(
      project,
      { type: "layer.reorder", layerId: "layer-project", toIndex: 2 },
      context,
    );
    expect(invalidOrder?.ok).toBe(false);
    if (invalidOrder && !invalidOrder.ok) expect(invalidOrder.diagnostics[0].code).toBe("INVALID_ORDER");
    expect(invalidOrder?.project).toBe(project);

    const missingVariant = applyCompositionFamilyCommand(
      project,
      { type: "variant.activate", variantSetId: "variant-set-main", variant: "C", updatedAt: UPDATED_AT },
      context,
    );
    expect(missingVariant?.ok).toBe(false);
    if (missingVariant && !missingVariant.ok) expect(missingVariant.diagnostics[0].code).toBe("PRECONDITION_FAILED");
    expect(missingVariant?.project).toBe(project);
  });

  it("maps candidate validation failures to invariant diagnostics and keeps the original identity", () => {
    const project = studioProjectV1Fixture;
    const invalidLayer = layer("layer-invalid", "composition-project");
    invalidLayer.transform.opacity = 2;
    const result = applyCompositionFamilyCommand(
      project,
      { type: "layer.add", compositionId: "composition-project", layer: invalidLayer },
      context,
    );
    expect(result?.ok).toBe(false);
    if (result && !result.ok) expect(result.diagnostics.some(({ code }) => code === "INVARIANT_VIOLATION")).toBe(true);
    expect(result?.project).toBe(project);
    expect(project.layers).not.toHaveProperty("layer-invalid");
  });

  it("contains malformed and getter-backed payloads as INVALID_PATCH without throwing", () => {
    const project = studioProjectV1Fixture;
    const getterCommand = {
      type: "layer.add",
      compositionId: "composition-project",
      get layer(): never {
        throw new Error("hostile getter");
      },
    };
    const commands = [null, getterCommand, { type: "composition.create", composition: {}, layers: undefined }];
    for (const command of commands) {
      const result = applyCompositionFamilyCommand(project, command as ProjectCommand, context);
      expect(result?.ok).toBe(false);
      if (result && !result.ok) expect(result.diagnostics[0].code).toBe("INVALID_PATCH");
      expect(result?.project).toBe(project);
    }
  });

  it("returns undefined only for command types owned by another family", () => {
    expect(
      applyCompositionFamilyCommand(
        studioProjectV1Fixture,
        { type: "project.rename", name: "other", updatedAt: UPDATED_AT },
        context,
      ),
    ).toBeUndefined();
    expect(
      applyCompositionFamilyCommand(
        studioProjectV1Fixture,
        { type: "composition.remove", compositionId: "composition-project", policy: "reject" },
        context,
      ),
    ).toBeUndefined();
  });

  it("is reachable through the public ProjectEngine dispatcher", () => {
    const result = applyProjectCommand(
      studioProjectV1Fixture,
      {
        type: "variant.activate",
        variantSetId: "variant-set-main",
        variant: "B",
        updatedAt: UPDATED_AT,
      },
      context,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.variantSets["variant-set-main"].activeVariant).toBe("B");
  });

  it("returns original identity for an empty layer patch", () => {
    const result = ok(
      applyProjectCommand(
        studioProjectV1Fixture,
        { type: "layer.update", layerId: "layer-project", patch: {} },
        context,
      ),
    );
    expect(result.project).toBe(studioProjectV1Fixture);
    expect(result.changedIds).toEqual({});
    expect(result.warnings[0].code).toBe("NO_CHANGES");
  });
});
