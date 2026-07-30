import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssetRepository } from "../../core/assets";
import { createEmptyStudioProject } from "../../core/project";
import { createProjectStoreWithHistory } from "../../core/stores";
import { StudioLocalStoresProvider } from "../../contexts/StudioStoreContext";
import { ComposeBootstrapWorkspace } from "../../features/compose/project";

const NOW = "2026-07-16T16:00:00.000Z";

function repository(projectId: string): AssetRepository {
  return {
    projectId,
    put: vi.fn(),
    getMetadata: vi.fn(),
    getBlob: vi.fn(),
    list: vi.fn(async () => []),
    verify: vi.fn(),
    scanIntegrity: vi.fn(),
    remove: vi.fn(),
    exportMany: vi.fn(),
    createRuntimeUrl: vi.fn(),
    releaseRuntimeUrl: vi.fn(),
    releaseOwner: vi.fn(),
    dispose: vi.fn(),
  } as unknown as AssetRepository;
}

describe("ComposeBootstrapWorkspace", () => {
  it("uses one roving keyboard stop per grid cell", async () => {
    const project = createEmptyStudioProject({ id: "project-compose-keyboard", now: NOW });
    const { store } = createProjectStoreWithHistory(project, {
      context: { nextId: () => "unused", now: () => NOW },
    });
    render(
      <StudioLocalStoresProvider>
        <ComposeBootstrapWorkspace store={store} assets={repository(project.id)} />
      </StudioLocalStoresProvider>,
    );

    fireEvent.click(await screen.findByRole("radio", { name: "Grid" }));
    const cells = await screen.findAllByRole("gridcell");
    expect(cells).toHaveLength(4);
    expect(cells.filter((cell) => cell.tabIndex === 0)).toHaveLength(1);
    cells[0]?.focus();
    fireEvent.keyDown(cells[0]!, { key: "ArrowRight" });
    expect(cells[1]).toHaveFocus();
    expect(cells[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(cells[1]!, { key: "End" });
    expect(cells[3]).toHaveFocus();
  });

  it("projects decode/import busy state to the Studio command boundary", async () => {
    const project = createEmptyStudioProject({ id: "project-compose-busy", now: NOW });
    const { store } = createProjectStoreWithHistory(project, {
      context: { nextId: () => "unused", now: () => NOW },
    });
    const onBusyChange = vi.fn();
    render(
      <StudioLocalStoresProvider>
        <ComposeBootstrapWorkspace
          store={store}
          assets={repository(project.id)}
          onBusyChange={onBusyChange}
        />
      </StudioLocalStoresProvider>,
    );

    const input = screen.getByLabelText("Import images into Compose");
    const brokenPng = new File([
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    ], "broken.png", { type: "image/png" });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: { 0: brokenPng, length: 1, item: () => brokenPng },
    });
    fireEvent.change(input);

    await waitFor(() => expect(onBusyChange).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.getByLabelText("Image source could not be decoded.")).toBeVisible());
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  });
});
