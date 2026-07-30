import { describe, expect, it } from "vitest";
import {
  createEmptyStudioProject,
  type AssetRecord,
  type Composition,
  type Layer,
  type Region,
} from "../../core/project";
import { createProjectStoreWithHistory } from "../../core/stores";
import { createComposeLayerEditor } from "../../features/compose/layers/layerEditor";

const NOW = "2026-07-26T08:00:00.000Z";

function runtime(managed = false) {
  const project = createEmptyStudioProject({ id: "project-layers", now: NOW });
  const asset = (id: string): AssetRecord => ({
    id,
    name: `${id}.png`,
    blobKey: id,
    contentHash: id.padEnd(64, "a").slice(0, 64),
    mimeType: "image/png",
    width: 32,
    height: 24,
    byteSize: 10,
    createdAt: NOW,
    updatedAt: NOW,
    provenance: { source: "fixture" },
    media: { type: "image" },
  });
  project.assets.a = asset("a");
  project.assets.b = asset("b");
  project.rootOrder.assetIds.push("a", "b");
  const region: Region = {
    id: "region",
    assetId: "a",
    name: "Head",
    bounds: { x: 0, y: 0, width: 12, height: 10 },
    createdAt: NOW,
    updatedAt: NOW,
  };
  project.regions.region = region;
  project.rootOrder.regionIds.push(region.id);
  const composition: Composition = {
    id: "composition",
    name: "Hero",
    owner: { type: "project" },
    width: 100,
    height: 80,
    layerIds: ["base"],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const layer: Layer = {
    id: "base",
    compositionId: composition.id,
    name: "Base",
    source: { type: "asset", id: "a" },
    transform: {
      x: 50,
      y: 40,
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
  if (managed) {
    composition.layout = { mode: "grid", rows: 2, columns: 2, gap: 0 };
    layer.cellIndex = 0;
  }
  project.compositions[composition.id] = composition;
  project.layers[layer.id] = layer;
  project.rootOrder.compositionIds.push(composition.id);
  project.workspace = {
    activeWorkspace: "compose",
    selectedCompositionId: composition.id,
    selectedLayerId: layer.id,
  };
  let id = 0;
  const built = createProjectStoreWithHistory(project, {
    context: { nextId: () => `generated-${++id}`, now: () => NOW },
  });
  const editor = createComposeLayerEditor({
    store: built.store,
    nextId: (kind) => `${kind}-${++id}`,
    now: () => NOW,
  });
  return { ...built, editor };
}

describe("compose layer editor", () => {
  it("adds and selects a source in one undoable command", () => {
    const { store, history, editor } = runtime();
    expect(editor.add("composition", { type: "region", id: "region" }, "Face")).toMatchObject({ ok: true });
    const project = store.getSnapshot().project;
    expect(project.compositions.composition.layerIds).toHaveLength(2);
    const selected = project.workspace.selectedLayerId as string;
    expect(project.layers[selected]).toMatchObject({
      name: "Face",
      source: { type: "region", id: "region" },
      transform: { x: 50, y: 40, opacity: 1 },
    });
    expect(history.undo()).toMatchObject({ ok: true });
    expect(store.getSnapshot().project.compositions.composition.layerIds).toEqual(["base"]);
    expect(store.getSnapshot().project.workspace.selectedLayerId).toBe("base");
  });

  it("duplicates, selects, reorders and removes atomically", () => {
    const { store, history, editor } = runtime();
    expect(editor.duplicate("base").ok).toBe(true);
    let project = store.getSnapshot().project;
    const copyId = project.workspace.selectedLayerId as string;
    expect(project.layers[copyId].name).toBe("Base copy");
    expect(editor.move(copyId, "forward")).toEqual({ ok: true, revision: 1 });
    expect(editor.move(copyId, "backward").ok).toBe(true);
    expect(editor.remove(copyId).ok).toBe(true);
    project = store.getSnapshot().project;
    expect(project.layers[copyId]).toBeUndefined();
    expect(project.workspace.selectedLayerId).toBeUndefined();
    expect(history.undo()).toMatchObject({ ok: true });
    expect(store.getSnapshot().project.layers[copyId]).toBeDefined();
  });

  it("merges, clamps and coalesces transform changes", () => {
    const { store, history, editor } = runtime();
    expect(editor.setTransform("base", { x: 12, scaleX: 99, rotation: 540 }, {
      mode: "coalesce",
      transactionId: "drag-1",
    }).ok).toBe(true);
    expect(editor.setTransform("base", { x: 18, opacity: -2 }, {
      mode: "coalesce",
      transactionId: "drag-1",
    }).ok).toBe(true);
    expect(store.getSnapshot().project.layers.base.transform).toEqual({
      x: 18,
      y: 40,
      scaleX: 32,
      scaleY: 1,
      rotation: -180,
      opacity: 0,
      flipX: false,
      flipY: false,
    });
    expect(history.undo()).toMatchObject({ ok: true });
    expect(store.getSnapshot().project.layers.base.transform.x).toBe(50);
  });

  it("keeps cell binding for visual edits and detaches on manual geometry", () => {
    const { store, editor } = runtime(true);
    expect(editor.setTransform("base", { opacity: 0.5, rotation: 10 }).ok).toBe(true);
    expect(store.getSnapshot().project.layers.base.cellIndex).toBe(0);
    expect(editor.setTransform("base", { x: 12 }).ok).toBe(true);
    expect(store.getSnapshot().project.layers.base).toMatchObject({
      transform: { x: 12, opacity: 0.5, rotation: 10 },
    });
    expect(store.getSnapshot().project.layers.base.cellIndex).toBeUndefined();
  });

  it("blocks locked mutations while visibility and unlock stay available", () => {
    const { store, editor } = runtime();
    expect(editor.setLocked("base", true).ok).toBe(true);
    expect(editor.setVisible("base", false).ok).toBe(true);
    expect(editor.rename("base", "Blocked").ok).toBe(false);
    expect(editor.setTransform("base", { x: 9 }).ok).toBe(false);
    expect(editor.remove("base").ok).toBe(false);
    expect(editor.duplicate("base").ok).toBe(false);
    expect(editor.setLocked("base", false).ok).toBe(true);
    expect(store.getSnapshot().project.layers.base).toMatchObject({ visible: false, locked: false });
  });

  it("selects only layers from the active composition without adding history", () => {
    const { store, history, editor } = runtime();
    expect(editor.select(null).ok).toBe(true);
    expect(store.getSnapshot().project.workspace.selectedLayerId).toBeUndefined();
    expect(editor.select("missing").ok).toBe(false);
    expect(history.undo()).toMatchObject({ ok: false, reason: "empty" });
  });

  it("fails closed for bad sources, numbers and hostile patches", () => {
    const { store, editor } = runtime();
    const revision = store.getSnapshot().revision;
    expect(editor.add("composition", { type: "asset", id: "missing" }).ok).toBe(false);
    expect(editor.setTransform("base", { x: Number.NaN }).ok).toBe(false);
    const hostile = new Proxy({}, { ownKeys() { throw new Error("private"); } });
    expect(() => editor.setTransform("base", hostile)).not.toThrow();
    expect(editor.setTransform("base", hostile)).toEqual({
      ok: false,
      message: "Layer edit could not be applied.",
    });
    expect(store.getSnapshot().revision).toBe(revision);
  });

  it("resets geometry and keeps opacity", () => {
    const { store, editor } = runtime();
    expect(editor.setTransform("base", { x: 2, opacity: 0.4, flipX: true }).ok).toBe(true);
    expect(editor.resetTransform("base").ok).toBe(true);
    expect(store.getSnapshot().project.layers.base.transform).toEqual({
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 0.4,
      flipX: false,
      flipY: false,
    });
  });
});
