import { act, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createJobRunner, createQueuedJob, transitionJob } from "../../core/processing";
import {
  createInteractionStore,
  createJobSelector,
  createJobStore,
  createPlaybackStore,
  createProjectEntitySelector,
  createProjectStore,
  createWorkspacePanelSizeSelector,
  createWorkspacePreferenceSelector,
  createWorkspaceStore,
  createWorkspaceViewportSelector,
  selectActiveModalId,
  selectActiveWorkspace,
  selectDragSession,
  selectHoveredTarget,
  selectIsPlaying,
  selectJobOrder,
  selectPlaybackCursorMs,
  selectPlaybackSequenceId,
  selectProjectDocument,
  selectProjectRevision,
  selectProjectWorkspace,
  selectTransientSelection,
} from "../../core/stores";
import {
  StudioLocalStoresProvider,
  useJobStore,
  useStudioJobRunner,
  useWorkspaceStore,
  type StudioLocalStores,
} from "../../contexts/StudioStoreContext";
import {
  useJobStoreSelector,
  useProjectStoreSelector,
  useWorkspaceStoreSelector,
} from "../../hooks/useStudioStoreSelector";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const queuedJob = (id: string) => createQueuedJob({
  id,
  requestId: `${id}-request`,
  kind: "export",
  label: "Export spritesheet",
  createdAt: "2026-07-14T12:00:00.000Z",
  timeoutMs: 30_000,
});

const context = {
  nextId: () => "generated-id",
  now: () => "2026-07-14T16:00:00.000Z",
};

const selectTimelineHeight = createWorkspacePanelSizeSelector("timeline", 220);

function createLocalStores(): StudioLocalStores {
  return Object.freeze({
    workspace: createWorkspaceStore(),
    interaction: createInteractionStore(),
    jobs: createJobStore(),
    playback: createPlaybackStore(),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("Studio store selectors", () => {
  it("selects canonical project slices and entities without cloning", () => {
    const store = createProjectStore(studioProjectV1Fixture, { context });
    const state = store.getSnapshot();
    const selectAsset = createProjectEntitySelector("assets", "asset-sheet");
    const selectMissing = createProjectEntitySelector("assets", "__proto__");

    expect(selectProjectDocument(state)).toBe(state.project);
    expect(selectProjectRevision(state)).toBe(0);
    expect(selectProjectWorkspace(state)).toBe(state.project.workspace);
    expect(selectActiveWorkspace(state)).toBe("compose");
    expect(selectAsset(state)).toBe(state.project.assets["asset-sheet"]);
    expect(selectMissing(state)).toBeUndefined();
    expect(() => createProjectEntitySelector("assets", "")).toThrow(/EntityId/);
  });

  it("selects stable slices from every local store", () => {
    const stores = createLocalStores();
    stores.workspace.dispatch({ type: "workspace.setPanelSize", panelId: "timeline", size: 280 });
    stores.workspace.dispatch({
      type: "workspace.setViewport",
      workspaceId: "compose",
      viewport: { scale: 2, offset: { x: 4, y: -2 } },
    });
    stores.workspace.dispatch({ type: "workspace.setPreference", key: "grid", value: true });
    stores.interaction.dispatch({
      type: "interaction.setHover",
      target: { surfaceId: "canvas", role: "layer", entityId: "layer-project" },
    });
    stores.interaction.dispatch({
      type: "interaction.setTransientSelection",
      entityIds: ["layer-project"],
    });
    stores.jobs.dispatch({ type: "job.replace", job: queuedJob("job-1") });
    stores.playback.dispatch({ type: "playback.setSequence", sequenceId: "sequence-main" });
    stores.playback.dispatch({ type: "playback.setPlaying", playing: true });
    stores.playback.dispatch({ type: "playback.seek", cursorMs: 80, celIndex: 1 });

    const workspace = stores.workspace.getSnapshot();
    expect(selectTimelineHeight(workspace)).toBe(280);
    expect(createWorkspaceViewportSelector("compose")(workspace)).toBe(
      workspace.viewports.compose,
    );
    expect(createWorkspacePreferenceSelector("grid")(workspace)).toBe(true);

    const interaction = stores.interaction.getSnapshot();
    expect(selectHoveredTarget(interaction)).toBe(interaction.hoveredTarget);
    expect(selectDragSession(interaction)).toBeNull();
    expect(selectTransientSelection(interaction)).toBe(interaction.transientSelection);
    expect(selectActiveModalId(interaction)).toBeNull();

    const jobs = stores.jobs.getSnapshot();
    expect(createJobSelector("job-1")(jobs)).toBe(jobs.jobs["job-1"]);
    expect(createJobSelector("__proto__")(jobs)).toBeUndefined();
    expect(selectJobOrder(jobs)).toBe(jobs.order);

    const playback = stores.playback.getSnapshot();
    expect(selectPlaybackSequenceId(playback)).toBe("sequence-main");
    expect(selectIsPlaying(playback)).toBe(true);
    expect(selectPlaybackCursorMs(playback)).toBe(80);
  });

  it("does not rerender a project consumer for an unrelated project slice", () => {
    const store = createProjectStore(studioProjectV1Fixture, { context });
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useProjectStoreSelector(store, (state) => state.project.name);
    });
    expect(renders).toBe(1);

    act(() => {
      store.dispatch({
        command: { type: "workspace.update", patch: { activeWorkspace: "animate" } },
        metadata: { commandId: "workspace-only", origin: "user", history: "ignore" },
      });
    });
    expect(result.current).toBe(studioProjectV1Fixture.name);
    expect(renders).toBe(1);

    act(() => {
      store.dispatch({
        command: {
          type: "project.rename",
          name: "Selector project",
          updatedAt: "2026-07-14T16:01:00.000Z",
        },
        metadata: { commandId: "rename", origin: "user", history: "record" },
      });
    });
    expect(result.current).toBe("Selector project");
    expect(renders).toBe(2);
  });

  it("supports equality-stable leaf consumers across unrelated notifications", () => {
    const stores = createLocalStores();
    const renders: number[] = [];

    function Probe() {
      const workspace = useWorkspaceStore();
      const jobs = useJobStore();
      const height = useWorkspaceStoreSelector(workspace, selectTimelineHeight);
      const jobCount = useJobStoreSelector(
        jobs,
        (state) => ({ count: state.order.length }),
        (previous, next) => previous.count === next.count,
      );
      renders.push(height);
      return <output data-testid="selection">{height}:{jobCount.count}</output>;
    }

    render(
      <StudioLocalStoresProvider stores={stores}>
        <Probe />
      </StudioLocalStoresProvider>,
    );
    expect(renders).toEqual([220]);

    act(() => {
      stores.workspace.dispatch({ type: "workspace.setPreference", key: "grid", value: true });
      stores.jobs.dispatch({ type: "job.replace", job: queuedJob("job-1") });
    });
    expect(screen.getByTestId("selection")).toHaveTextContent("220:1");
    expect(renders).toEqual([220, 220]);

    act(() => {
      stores.workspace.dispatch({ type: "workspace.setPanelSize", panelId: "timeline", size: 300 });
      const running = transitionJob(queuedJob("job-1"), {
        type: "job.start",
        requestId: "job-1-request",
        at: "2026-07-14T12:00:01.000Z",
      }).job;
      stores.jobs.dispatch({ type: "job.replace", job: running });
    });
    expect(screen.getByTestId("selection")).toHaveTextContent("300:1");
    expect(renders).toEqual([220, 220, 300]);
  });

  it("owns the default job runner lifecycle but leaves an injected runner to its caller", async () => {
    const ownedStores = createLocalStores();
    const ownedWrapper = ({ children }: { readonly children: React.ReactNode }) => (
      <StudioLocalStoresProvider stores={ownedStores}>
        {children}
      </StudioLocalStoresProvider>
    );
    const owned = renderHook(() => useStudioJobRunner(), { wrapper: ownedWrapper });
    const ownedOutput = deferred<string>();
    let ownedSignal!: AbortSignal;
    const ownedHandle = owned.result.current.run(
      queuedJob("owned-runner-job"),
      ({ signal }) => {
        ownedSignal = signal;
        return ownedOutput.promise;
      },
    );

    owned.unmount();
    await expect(ownedHandle.result).resolves.toMatchObject({ status: "cancelled" });
    expect(ownedSignal.aborted).toBe(true);
    expect(() => owned.result.current.run(queuedJob("owned-runner-late"), () => "late"))
      .toThrow(/disposed/);
    ownedOutput.resolve("late");

    const injectedStores = createLocalStores();
    const injectedRunner = createJobRunner({ store: injectedStores.jobs });
    const injectedWrapper = ({ children }: { readonly children: React.ReactNode }) => (
      <StudioLocalStoresProvider stores={injectedStores} jobRunner={injectedRunner}>
        {children}
      </StudioLocalStoresProvider>
    );
    const injected = renderHook(() => useStudioJobRunner(), { wrapper: injectedWrapper });
    expect(injected.result.current).toBe(injectedRunner);
    injected.unmount();
    expect(() => injectedRunner.run(queuedJob("injected-runner-job"), () => "ok"))
      .not.toThrow();
    injectedRunner.dispose();
  });
});
