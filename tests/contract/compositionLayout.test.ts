import { describe, expect, it } from "vitest";

import { applyProjectCommand } from "../../core/project/applyCommand";
import { createEmptyStudioProject } from "../../core/project";
import { validateStudioProject } from "../../core/project/validation";
import { createProjectStoreWithHistory } from "../../core/stores";
import {
  compositionCellForPoint,
  createCompositionGridCells,
  applyCompositionLayout,
  resolveCompositionDropTransform,
} from "../../features/compose/layout";
import { createBlankComposition } from "../../features/compose/project";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const NOW = "2026-07-30T12:00:00.000Z";
const context = { nextId: () => "unused", now: () => NOW };

describe("canonical composition layout", () => {
  it("creates a white free-layout canvas and keeps creation as one undo step", () => {
    const project = createEmptyStudioProject({ id: "project-blank-canvas", now: NOW });
    const { store, history } = createProjectStoreWithHistory(project, { context });

    expect(createBlankComposition(store, {
      compositionId: "composition-blank",
      commandId: "command-blank",
      issuedAt: NOW,
    })).toMatchObject({ ok: true, compositionId: "composition-blank" });

    expect(store.getSnapshot().project.compositions["composition-blank"]).toMatchObject({
      width: 512,
      height: 512,
      background: "#ffffff",
      layout: { mode: "free" },
      layerIds: [],
    });
    expect(store.getSnapshot().project.workspace).toMatchObject({
      activeWorkspace: "compose",
      selectedCompositionId: "composition-blank",
    });
    expect(history.getSnapshot().undoEntries).toHaveLength(1);
    expect(history.undo()).toMatchObject({ ok: true });
    expect(store.getSnapshot().project.compositions["composition-blank"]).toBeUndefined();
  });

  it("can prepare the blank canvas without changing an explicit workspace route", () => {
    const project = createEmptyStudioProject({ id: "project-background-canvas", now: NOW });
    const { store } = createProjectStoreWithHistory(project, { context });
    expect(createBlankComposition(store, {
      compositionId: "composition-background",
      commandId: "command-background",
      issuedAt: NOW,
      origin: "migration",
      history: "ignore",
      activeWorkspace: "slice",
    })).toMatchObject({ ok: true });
    expect(store.getSnapshot().project.workspace).toMatchObject({
      activeWorkspace: "slice",
      selectedCompositionId: "composition-background",
    });
  });

  it("validates grid bounds at the command and document boundaries", () => {
    const accepted = applyProjectCommand(studioProjectV1Fixture, {
      type: "composition.update",
      compositionId: "composition-project",
      patch: { layout: { mode: "grid", rows: 3, columns: 4, gap: 2 } },
    }, context);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(validateStudioProject(accepted.project).valid).toBe(true);

    const rejected = applyProjectCommand(studioProjectV1Fixture, {
      type: "composition.update",
      compositionId: "composition-project",
      patch: { layout: { mode: "grid", rows: 2, columns: 12, gap: 12 } },
    }, context);
    expect(rejected).toMatchObject({ ok: false });
    expect(rejected.project).toBe(studioProjectV1Fixture);

    const invalidLayouts: unknown[] = [
      null,
      { mode: "free", rows: 1 },
      { mode: "runtime" },
      { mode: "grid", rows: 2, columns: 2 },
      { mode: "grid", rows: 2, columns: 2, gap: 0, private: true },
      { mode: "grid", rows: 0, columns: 2, gap: 0 },
      { mode: "grid", rows: 2, columns: 13, gap: 0 },
      { mode: "grid", rows: 2, columns: 2, gap: -1 },
      { mode: "grid", rows: 12, columns: 1, gap: 12 },
    ];
    for (const layout of invalidLayouts) {
      expect(applyProjectCommand(studioProjectV1Fixture, {
        type: "composition.update",
        compositionId: "composition-project",
        patch: { layout: layout as never },
      }, context)).toMatchObject({ ok: false });
    }
  });

  it("derives deterministic cells, hit targets and contain-fit transforms", () => {
    const layout = { mode: "grid" as const, rows: 2, columns: 2, gap: 4 };
    const cells = createCompositionGridCells({ width: 100, height: 80 }, layout);
    expect(cells).toEqual([
      expect.objectContaining({ index: 0, x: 0, y: 0, width: 48, height: 38, centerX: 24, centerY: 19 }),
      expect.objectContaining({ index: 1, x: 52, y: 0, width: 48, height: 38, centerX: 76, centerY: 19 }),
      expect.objectContaining({ index: 2, x: 0, y: 42, width: 48, height: 38, centerX: 24, centerY: 61 }),
      expect.objectContaining({ index: 3, x: 52, y: 42, width: 48, height: 38, centerX: 76, centerY: 61 }),
    ]);
    const composition = { width: 100, height: 80, layout };
    expect(compositionCellForPoint(composition, { x: 76, y: 19 })).toBe(1);
    expect(compositionCellForPoint(composition, { x: 50, y: 40 })).toBeNull();
    expect(resolveCompositionDropTransform({
      composition,
      source: { width: 96, height: 48 },
      cellIndex: 1,
    })).toMatchObject({ x: 76, y: 19, scaleX: 0.5, scaleY: 0.5 });
  });

  it("reflows managed layers with a layout edit in one undo step", () => {
    const project = structuredClone(studioProjectV1Fixture);
    project.compositions["composition-project"].layout = { mode: "grid", rows: 2, columns: 2, gap: 0 };
    project.layers["layer-project"].cellIndex = 0;
    project.layers["layer-project"].transform = {
      ...project.layers["layer-project"].transform,
      x: 32,
      y: 32,
      scaleX: 0.5,
      scaleY: 0.5,
    };
    expect(validateStudioProject(project).valid).toBe(true);
    const { store, history } = createProjectStoreWithHistory(project, { context });

    expect(applyCompositionLayout(store, {
      compositionId: "composition-project",
      layout: { mode: "grid", rows: 1, columns: 2, gap: 0 },
      commandId: "command-layout-reflow",
      issuedAt: NOW,
    })).toMatchObject({ ok: true, revision: 1 });
    expect(store.getSnapshot().project.layers["layer-project"].transform).toMatchObject({
      x: 32,
      y: 64,
      scaleX: 0.5,
      scaleY: 0.5,
    });
    expect(history.getSnapshot().undoEntries).toHaveLength(1);
    expect(history.undo()).toMatchObject({ ok: true });
    expect(store.getSnapshot().project.compositions["composition-project"].layout).toEqual({ mode: "grid", rows: 2, columns: 2, gap: 0 });
    expect(store.getSnapshot().project.layers["layer-project"].transform).toMatchObject({ x: 32, y: 32 });
  });

  it("rejects out-of-range durable cell assignments", () => {
    const result = applyProjectCommand(studioProjectV1Fixture, {
      type: "layer.update",
      layerId: "layer-project",
      patch: { cellIndex: 144 },
    }, context);
    expect(result).toMatchObject({ ok: false });
    expect(result.project).toBe(studioProjectV1Fixture);

    const gridProject = structuredClone(studioProjectV1Fixture);
    gridProject.compositions["composition-project"].layout = { mode: "grid", rows: 2, columns: 2, gap: 0 };
    const outsideGrid = applyProjectCommand(gridProject, {
      type: "layer.update",
      layerId: "layer-project",
      patch: { cellIndex: 4 },
    }, context);
    expect(outsideGrid).toMatchObject({ ok: false });
    expect(outsideGrid.project).toBe(gridProject);

    gridProject.layers["layer-project"].cellIndex = 100;
    expect(validateStudioProject(gridProject)).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ path: "$.layers.layer-project.cellIndex" }),
      ]),
    });
  });

  it("covers hostile and compatible cell assignments at every command boundary", () => {
    for (const cellIndex of [-1, 1.5]) {
      expect(applyProjectCommand(studioProjectV1Fixture, {
        type: "layer.update",
        layerId: "layer-project",
        patch: { cellIndex },
      }, context)).toMatchObject({ ok: false });
    }

    const freeAssignment = applyProjectCommand(studioProjectV1Fixture, {
      type: "layer.update",
      layerId: "layer-project",
      patch: { cellIndex: 100 },
    }, context);
    expect(freeAssignment).toMatchObject({ ok: true });
    if (freeAssignment.ok) expect(validateStudioProject(freeAssignment.project).valid).toBe(true);

    const gridProject = structuredClone(studioProjectV1Fixture);
    gridProject.compositions["composition-project"].layout = { mode: "grid", rows: 2, columns: 2, gap: 0 };
    const invalidLayer = {
      ...structuredClone(gridProject.layers["layer-project"]),
      id: "layer-invalid-cell",
      cellIndex: 4,
    };
    expect(applyProjectCommand(gridProject, {
      type: "layer.add",
      compositionId: "composition-project",
      layer: invalidLayer,
    }, context)).toMatchObject({ ok: false });

    const composition = {
      id: "composition-cell-create",
      name: "Cell create",
      owner: { type: "project" as const },
      layerIds: ["layer-cell-create"],
      width: 128,
      height: 128,
      layout: { mode: "grid" as const, rows: 2, columns: 2, gap: 0 },
      createdAt: NOW,
      updatedAt: NOW,
    };
    const createdLayer = {
      ...structuredClone(studioProjectV1Fixture.layers["layer-project"]),
      id: "layer-cell-create",
      compositionId: composition.id,
      cellIndex: 3,
    };
    expect(applyProjectCommand(studioProjectV1Fixture, {
      type: "composition.create",
      composition,
      layers: [createdLayer],
    }, context)).toMatchObject({ ok: true });
    expect(applyProjectCommand(studioProjectV1Fixture, {
      type: "composition.create",
      composition,
      layers: [{ ...createdLayer, cellIndex: 4 }],
    }, context)).toMatchObject({ ok: false });
  });
});
