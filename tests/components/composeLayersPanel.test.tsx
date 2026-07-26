import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createEmptyStudioProject, type AssetRecord, type Composition, type Layer } from "../../core/project";
import { createProjectStoreWithHistory } from "../../core/stores";
import { ComposeLayersPanel } from "../../features/compose/layers/ComposeLayersPanel";

const NOW = "2026-07-26T09:00:00.000Z";

function setup() {
  const project = createEmptyStudioProject({ id: "project-layer-panel", now: NOW });
  const asset = (id: string): AssetRecord => ({
    id,
    name: `${id}.png`,
    blobKey: id,
    contentHash: id.padEnd(64, "c").slice(0, 64),
    mimeType: "image/png",
    width: 24,
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
  const composition: Composition = {
    id: "composition",
    name: "Hero",
    owner: { type: "project" },
    layerIds: ["base"],
    width: 64,
    height: 64,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const layer: Layer = {
    id: "base",
    compositionId: composition.id,
    name: "Base",
    source: { type: "asset", id: "a" },
    transform: { x: 32, y: 32, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, flipX: false, flipY: false },
    visible: true,
    locked: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
  project.compositions.composition = composition;
  project.layers.base = layer;
  project.rootOrder.compositionIds.push(composition.id);
  project.workspace = { activeWorkspace: "compose", selectedCompositionId: composition.id, selectedLayerId: layer.id };
  let id = 0;
  const runtime = createProjectStoreWithHistory(project, {
    context: { nextId: () => `generated-${++id}`, now: () => NOW },
  });
  render(<ComposeLayersPanel store={runtime.store} />);
  return runtime;
}

describe("ComposeLayersPanel", () => {
  it("adds a selected source and exposes the new layer", () => {
    const { store } = setup();
    fireEvent.change(screen.getByLabelText("Layer source"), { target: { value: "asset:b" } });
    fireEvent.click(screen.getByRole("button", { name: "Add layer" }));
    const project = store.getSnapshot().project;
    expect(project.compositions.composition.layerIds).toHaveLength(2);
    expect(project.layers[project.workspace.selectedLayerId as string].source).toEqual({ type: "asset", id: "b" });
    expect(screen.getByRole("status")).toHaveTextContent("Layer added");
  });

  it("edits transform, opacity, visibility and lock through canonical commands", () => {
    const { store } = setup();
    fireEvent.change(screen.getByLabelText("Layer X"), { target: { value: "7" } });
    fireEvent.blur(screen.getByLabelText("Layer X"));
    fireEvent.change(screen.getByLabelText("Layer opacity"), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "Hide Base" }));
    fireEvent.click(screen.getByRole("button", { name: "Lock Base" }));
    expect(store.getSnapshot().project.layers.base).toMatchObject({
      visible: false,
      locked: true,
      transform: { x: 7, opacity: 0.42 },
    });
    expect(screen.getByLabelText("Layer X")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Unlock Base" })).toBeEnabled();
  });

  it("duplicates and removes a layer with clear feedback", () => {
    const { store } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate layer" }));
    expect(store.getSnapshot().project.compositions.composition.layerIds).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Delete layer" }));
    expect(store.getSnapshot().project.compositions.composition.layerIds).toEqual(["base"]);
    expect(screen.getByRole("status")).toHaveTextContent("Layer removed");
  });
});
