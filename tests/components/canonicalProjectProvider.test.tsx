import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AssetRepositoryError, type AssetRepository } from "../../core/assets";
import { createEmptyStudioProject } from "../../core/project";
import type { ProjectAutosaveJournal } from "../../core/persistence";
import {
  CanonicalProjectProvider,
  useCanonicalProject,
} from "../../contexts/CanonicalProjectContext";
import { useProjectStoreSelector } from "../../hooks/useStudioStoreSelector";

const NOW = "2026-07-16T13:00:00.000Z";

function fakeRepository(projectId: string): AssetRepository {
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

function Probe() {
  const runtime = useCanonicalProject();
  const project = useProjectStoreSelector(runtime.store, (state) => state.project);
  return (
    <div>
      <output aria-label="Project identity">{project.id}</output>
      <output aria-label="Project name">{project.name}</output>
      <output aria-label="Workspace">{project.workspace.activeWorkspace ?? "none"}</output>
      <output aria-label="Persistence">{runtime.persistenceState}</output>
      <button type="button" onClick={() => runtime.renameProject("Renamed project")}>Rename</button>
      <button type="button" onClick={() => runtime.history.undo()}>Undo</button>
      <button type="button" onClick={() => runtime.setActiveWorkspace("compose")}>Compose</button>
      <button type="button" onClick={() => void runtime.createProject("Fresh project")}>New</button>
      <button
        type="button"
        onClick={() => void Promise.all([
          runtime.createProject("First project"),
          runtime.createProject("Second project"),
        ])}
      >
        New twice
      </button>
      <button type="button" onClick={() => runtime.reportAssetCleanupDebt(runtime.assets.projectId, "asset-debt", true)}>Debt</button>
      <button type="button" onClick={() => runtime.reportAssetCleanupDebt(runtime.assets.projectId, "asset-debt", false)}>Resolve debt</button>
      <button type="button" onClick={() => runtime.reportAssetCleanupDebt("stale-project", "asset-debt", true)}>Stale debt</button>
      <button type="button" onClick={() => void runtime.saveProject()}>Save</button>
    </div>
  );
}

describe("CanonicalProjectProvider", () => {
  it("keeps the active repository alive through the Strict Mode effect replay", async () => {
    const repository = fakeRepository("project-strict");
    const initialProject = createEmptyStudioProject({
      id: "project-strict",
      name: "Strict project",
      now: NOW,
    });
    const view = render(
      <StrictMode>
        <CanonicalProjectProvider
          initialProject={initialProject}
          autosave={null}
          assetRepositoryFactory={() => repository}
        >
          <Probe />
        </CanonicalProjectProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(repository.dispose).not.toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByLabelText("Project name")).toHaveTextContent("Renamed project");

    view.unmount();
    await waitFor(() => expect(repository.dispose).toHaveBeenCalledTimes(1));
  });

  it("owns one canonical store/history/repository bundle and replaces it on New", async () => {
    const repositories: AssetRepository[] = [];
    const initialProject = createEmptyStudioProject({
      id: "project-provider",
      name: "Provider project",
      now: NOW,
    });
    render(
      <CanonicalProjectProvider
        initialProject={initialProject}
        autosave={null}
        assetRepositoryFactory={(projectId) => {
          const repository = fakeRepository(projectId);
          repositories.push(repository);
          return repository;
        }}
      >
        <Probe />
      </CanonicalProjectProvider>,
    );

    expect(screen.getByLabelText("Project identity")).toHaveTextContent("project-provider");
    expect(screen.getByLabelText("Persistence")).toHaveTextContent("saved");

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByLabelText("Project name")).toHaveTextContent("Renamed project");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Project name")).toHaveTextContent("Provider project");

    fireEvent.click(screen.getByRole("button", { name: "Compose" }));
    expect(screen.getByLabelText("Workspace")).toHaveTextContent("compose");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Workspace")).toHaveTextContent("compose");

    fireEvent.click(screen.getByRole("button", { name: "New" }));
    await waitFor(() => expect(screen.getByLabelText("Project name")).toHaveTextContent("Fresh project"));
    expect(screen.getByLabelText("Project identity")).not.toHaveTextContent("project-provider");
    expect(repositories).toHaveLength(2);
    expect(repositories[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent New requests into one durable project transition", async () => {
    const repositories: AssetRepository[] = [];
    const initialProject = createEmptyStudioProject({
      id: "project-concurrent",
      name: "Concurrent project",
      now: NOW,
    });
    render(
      <CanonicalProjectProvider
        initialProject={initialProject}
        autosave={null}
        assetRepositoryFactory={(projectId) => {
          const repository = fakeRepository(projectId);
          repositories.push(repository);
          return repository;
        }}
      >
        <Probe />
      </CanonicalProjectProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "New twice" }));
    await waitFor(() => expect(screen.getByLabelText("Project name")).toHaveTextContent("First project"));
    expect(repositories).toHaveLength(2);
    expect(repositories[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it("stays saving until the newest queued project snapshot is durable", async () => {
    const pending: Array<() => void> = [];
    const checkpoint = vi.fn(() => new Promise<void>((resolve) => pending.push(resolve)));
    const autosave = { checkpoint } as unknown as ProjectAutosaveJournal;
    const initialProject = createEmptyStudioProject({
      id: "project-queue",
      name: "Queue project",
      now: NOW,
    });
    const activeRepository = fakeRepository(initialProject.id);
    render(
      <CanonicalProjectProvider
        initialProject={initialProject}
        autosave={autosave}
        assetRepositoryFactory={() => activeRepository}
      >
        <Probe />
      </CanonicalProjectProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.click(screen.getByRole("button", { name: "Compose" }));
    await waitFor(() => expect(checkpoint).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Persistence")).toHaveTextContent("saving");

    await act(async () => pending.shift()?.());
    await waitFor(() => expect(checkpoint).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Persistence")).toHaveTextContent("saving");

    await act(async () => pending.shift()?.());
    await waitFor(() => expect(screen.getByLabelText("Persistence")).toHaveTextContent("saved"));
    expect(activeRepository.list).not.toHaveBeenCalled();
  });

  it("keeps identified cleanup debt visible until its exact Asset id is resolved", async () => {
    const initialProject = createEmptyStudioProject({
      id: "project-debt",
      name: "Debt project",
      now: NOW,
    });
    render(
      <CanonicalProjectProvider
        initialProject={initialProject}
        autosave={null}
        assetRepositoryFactory={(projectId) => fakeRepository(projectId)}
      >
        <Probe />
      </CanonicalProjectProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Debt" }));
    expect(screen.getByLabelText("Persistence")).toHaveTextContent("error");
    fireEvent.click(screen.getByRole("button", { name: "Resolve debt" }));
    expect(screen.getByLabelText("Persistence")).toHaveTextContent("saved");
  });

  it("ignores cleanup completion from a project that has already been replaced", () => {
    const initialProject = createEmptyStudioProject({
      id: "project-current-debt",
      name: "Current debt project",
      now: NOW,
    });
    render(
      <CanonicalProjectProvider
        initialProject={initialProject}
        autosave={null}
        assetRepositoryFactory={(projectId) => fakeRepository(projectId)}
      >
        <Probe />
      </CanonicalProjectProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stale debt" }));
    expect(screen.getByLabelText("Persistence")).toHaveTextContent("saved");
  });

  it("treats an already-removed exact debt as resolved after a durable checkpoint", async () => {
    const initialProject = createEmptyStudioProject({
      id: "project-debt-retry",
      name: "Debt retry project",
      now: NOW,
    });
    const activeRepository = fakeRepository(initialProject.id);
    vi.mocked(activeRepository.remove).mockRejectedValueOnce(new AssetRepositoryError(
      "ASSET_NOT_FOUND",
      "Already removed.",
      { operation: "remove", assetId: "asset-debt" },
    ));
    const autosave = {
      checkpoint: vi.fn(async () => undefined),
    } as unknown as ProjectAutosaveJournal;
    render(
      <CanonicalProjectProvider
        initialProject={initialProject}
        autosave={autosave}
        assetRepositoryFactory={() => activeRepository}
      >
        <Probe />
      </CanonicalProjectProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Debt" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(activeRepository.remove)
      .toHaveBeenCalledWith("asset-debt", "release-and-remove"));
    await waitFor(() => expect(screen.getByLabelText("Persistence")).toHaveTextContent("saved"));
    expect(activeRepository.list).not.toHaveBeenCalled();
  });

  it("retries a transient startup scan after storage recovers while history is empty", async () => {
    const project = createEmptyStudioProject({
      id: "project-startup-scan",
      name: "Startup scan project",
      now: NOW,
    });
    const activeRepository = fakeRepository(project.id);
    vi.mocked(activeRepository.list)
      .mockRejectedValueOnce(new Error("IndexedDB temporarily unavailable"))
      .mockResolvedValueOnce([]);
    const autosave = {
      inspect: vi.fn(async () => ({ confirmed: { project } })),
      checkpoint: vi.fn(async () => undefined),
    } as unknown as ProjectAutosaveJournal;

    const view = render(
      <CanonicalProjectProvider
        autosave={autosave}
        assetRepositoryFactory={(projectId) => (
          projectId === project.id ? activeRepository : fakeRepository(projectId)
        )}
      >
        <Probe />
      </CanonicalProjectProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText("Persistence")).toHaveTextContent("error"));
    expect(activeRepository.list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByLabelText("Persistence")).toHaveTextContent("saved"));
    expect(activeRepository.list).toHaveBeenCalledTimes(2);

    view.unmount();
  });
});
