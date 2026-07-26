import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssetRepository } from "../../core/assets";
import { createEmptyStudioProject, type Cel, type Region, type Sequence } from "../../core/project";
import { createProjectStoreWithHistory } from "../../core/stores";
import { StudioLocalStoresProvider } from "../../contexts/StudioStoreContext";
import { AnimateFrameWorkspace } from "../../features/animate/AnimateFrameWorkspace";

vi.mock("../../features/compose/canvas/ComposeCanvasWorkspace", () => ({
  ComposeCanvasWorkspace: ({ ariaLabel }: { readonly ariaLabel?: string | null }) => (
    <div aria-label={ariaLabel ?? undefined} data-mocked-scene-canvas="" />
  ),
}));

const NOW = "2026-07-26T05:30:00.000Z";

function repository(projectId: string): AssetRepository {
  return { projectId } as AssetRepository;
}

function setup() {
  const project = createEmptyStudioProject({ id: "project-animate-ui", now: NOW });
  project.assets.asset = {
    id: "asset",
    name: "frames.png",
    mimeType: "image/png",
    blobKey: "asset",
    contentHash: "b".repeat(64),
    width: 40,
    height: 30,
    byteSize: 12,
    createdAt: NOW,
    updatedAt: NOW,
    provenance: { source: "import", importedAt: NOW },
    media: { type: "image" },
  };
  project.rootOrder.assetIds.push("asset");
  const region: Region = {
    id: "region",
    assetId: "asset",
    name: "Frame source",
    bounds: { x: 0, y: 0, width: 40, height: 30 },
    createdAt: NOW,
    updatedAt: NOW,
  };
  project.regions.region = region;
  project.rootOrder.regionIds.push("region");
  const sequence: Sequence = {
    id: "sequence",
    name: "Walk",
    celIds: ["cel-1", "cel-2"],
    fps: 10,
    loop: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const cel = (id: string): Cel => ({
    id,
    sequenceId: sequence.id,
    source: { type: "region", regionId: region.id },
    durationMs: 100,
    createdAt: NOW,
    updatedAt: NOW,
  });
  project.sequences.sequence = sequence;
  project.rootOrder.sequenceIds.push("sequence");
  project.cels["cel-1"] = cel("cel-1");
  project.cels["cel-2"] = cel("cel-2");
  project.workspace = {
    activeWorkspace: "animate",
    selectedSequenceId: "sequence",
    selectedCelIds: ["cel-1"],
  };
  let id = 0;
  const runtime = createProjectStoreWithHistory(project, {
    context: { nextId: () => `generated-${++id}`, now: () => NOW },
  });
  render(
    <StudioLocalStoresProvider>
      <AnimateFrameWorkspace store={runtime.store} assets={repository(project.id)} />
    </StudioLocalStoresProvider>,
  );
  return runtime;
}

describe("AnimateFrameWorkspace", () => {
  it("selects and edits each canonical cel without the legacy timeline", () => {
    const { store } = setup();
    expect(screen.getByRole("heading", { name: "Frame alignment" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /02/ }));
    expect(store.getSnapshot().project.workspace.selectedCelIds).toEqual(["cel-2"]);

    const x = screen.getByLabelText("X");
    fireEvent.change(x, { target: { value: "7" } });
    fireEvent.blur(x);
    expect(store.getSnapshot().project.cels["cel-2"].transform?.x).toBe(7);

    fireEvent.keyDown(screen.getByRole("application"), { key: "ArrowRight" });
    expect(store.getSnapshot().project.cels["cel-2"].transform?.x).toBe(8);
  });

  it("uses Toolcraft controls for onion and durable opacity", () => {
    const { store } = setup();
    const onion = screen.getByLabelText("Onion opacity");
    fireEvent.change(onion, { target: { value: "35" } });
    expect(screen.getByText("35%")).toBeInTheDocument();

    const opacity = screen.getByLabelText("Frame opacity");
    fireEvent.change(opacity, { target: { value: "42" } });
    expect(store.getSnapshot().project.cels["cel-1"].transform?.opacity).toBe(0.42);
  });

  it("locks transform controls while keeping unlock available", () => {
    const { store } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Lock frame" }));
    expect(store.getSnapshot().project.cels["cel-1"].locked).toBe(true);
    expect(screen.getByLabelText("X")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Unlock frame" })).toBeEnabled();
  });
});
