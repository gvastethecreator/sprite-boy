import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssetRepository } from "../../core/assets";
import { createEmptyStudioProject } from "../../core/project";
import { CanonicalProjectProvider } from "../../contexts/CanonicalProjectContext";
import { StudioLocalStoresProvider } from "../../contexts/StudioStoreContext";
import { CollisionWorkspacePanel } from "../../features/collision/CollisionWorkspacePanel";
import { studioProjectV1Fixture } from "../contract/fixtures/studioProjectV1";

vi.mock("../../features/compose/canvas/ComposeCanvasWorkspace", () => ({
  ComposeCanvasWorkspace: ({ ariaLabel }: { readonly ariaLabel?: string }) => (
    <div aria-label={ariaLabel} data-mocked-scene-canvas="" />
  ),
}));

function repository(projectId: string): AssetRepository {
  return { projectId, dispose: vi.fn() } as unknown as AssetRepository;
}

function renderWorkspace(project = structuredClone(studioProjectV1Fixture)) {
  return render(
    <StudioLocalStoresProvider>
      <CanonicalProjectProvider
        initialProject={project}
        assetRepositoryFactory={repository}
        autosave={null}
      >
        <CollisionWorkspacePanel />
      </CanonicalProjectProvider>
    </StudioLocalStoresProvider>,
  );
}

describe("CollisionWorkspacePanel", () => {
  it("makes the source and shapes visible, then adds a hitbox in one action", async () => {
    renderWorkspace();

    expect(screen.getByLabelText("Collision source preview")).toBeInTheDocument();
    expect(screen.getByText("hurtbox")).toBeInTheDocument();
    expect(screen.getByText("8, 8 · 112 × 112")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ensure/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add hitbox" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Collision shapes").querySelector("[data-collision-shape-count]")).toHaveTextContent("2");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Hitbox added.");
  });

  it("gives an empty project a direct recovery path", () => {
    renderWorkspace(createEmptyStudioProject({
      id: "empty-collision-project",
      now: "2026-07-26T10:00:00.000Z",
    }));

    expect(screen.getByRole("heading", { name: "Create a region first" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Slice" })).toHaveAttribute("href", "#/studio/slice");
    expect(screen.queryByRole("button", { name: "Add hitbox" })).toBeNull();
  });
});
