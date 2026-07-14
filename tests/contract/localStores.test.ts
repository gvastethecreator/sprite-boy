import { describe, expect, it, vi } from "vitest";
import {
  createInteractionStore,
  createJobStore,
  createPlaybackStore,
  createWorkspaceStore,
  type InteractionAction,
  type JobStoreAction,
} from "../../core/stores";

describe("local Studio stores", () => {
  it("keeps workspace view state partial, frozen and outside document history", () => {
    const store = createWorkspaceStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.dispatch({ type: "workspace.setPanelSize", panelId: "left", size: 280 });
    store.dispatch({
      type: "workspace.setViewport",
      workspaceId: "compose",
      viewport: { scale: 2, offset: { x: 12, y: -4 } },
    });
    store.dispatch({ type: "workspace.setPreference", key: "checkerboard", value: true });
    const snapshot = store.getSnapshot();

    expect(store).toMatchObject({ kind: "workspace", persistence: "partial", history: "none" });
    expect(Object.keys(store).sort()).toEqual(
      ["dispatch", "getSnapshot", "history", "kind", "persistence", "subscribe"].sort(),
    );
    expect(snapshot).toEqual({
      panelSizes: { left: 280 },
      viewports: { compose: { scale: 2, offset: { x: 12, y: -4 } } },
      preferences: { checkerboard: true },
    });
    expect(snapshot).not.toHaveProperty("project");
    expect(snapshot).not.toHaveProperty("revision");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.viewports.compose?.offset)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(store).not.toHaveProperty("serialize");
    expect(store).not.toHaveProperty("hydrate");
    expect(store).not.toHaveProperty("undo");
    expect(store).not.toHaveProperty("redo");
  });

  it("isolates notifications and state across interaction, job and playback stores", () => {
    const interaction = createInteractionStore();
    const jobs = createJobStore();
    const playback = createPlaybackStore();
    const interactionListener = vi.fn();
    const jobListener = vi.fn();
    const playbackListener = vi.fn();
    interaction.subscribe(interactionListener);
    jobs.subscribe(jobListener);
    playback.subscribe(playbackListener);
    const jobBefore = jobs.getSnapshot();
    const playbackBefore = playback.getSnapshot();

    interaction.dispatch({
      type: "interaction.setHover",
      target: { surfaceId: "compose-canvas", role: "layer", entityId: "layer-1" },
    });

    expect(interaction.getSnapshot().hoveredTarget).toEqual({
      surfaceId: "compose-canvas",
      role: "layer",
      entityId: "layer-1",
    });
    expect(interactionListener).toHaveBeenCalledTimes(1);
    expect(jobListener).not.toHaveBeenCalled();
    expect(playbackListener).not.toHaveBeenCalled();
    expect(jobs.getSnapshot()).toBe(jobBefore);
    expect(playback.getSnapshot()).toBe(playbackBefore);
    for (const state of [interaction.getSnapshot(), jobs.getSnapshot(), playback.getSnapshot()]) {
      expect(state).not.toHaveProperty("project");
      expect(state).not.toHaveProperty("revision");
    }
  });

  it("maintains safe job identity/order and rejects document pollution", () => {
    const store = createJobStore();
    const first = { id: "__proto__", kind: "export" };
    store.dispatch({ type: "job.replace", job: first });
    store.dispatch({ type: "job.replace", job: { id: "job-2", kind: "worker" } });
    store.dispatch({ type: "job.replace", job: { id: "__proto__", kind: "export-updated" } });

    expect(store.getSnapshot().order).toEqual(["__proto__", "job-2"]);
    expect(store.getSnapshot().jobs["__proto__"]).toEqual({
      id: "__proto__",
      kind: "export-updated",
    });
    expect(Object.getPrototypeOf(store.getSnapshot().jobs)).toBeNull();
    expect(() =>
      store.dispatch({
        type: "job.replace",
        job: {
          id: "polluted",
          kind: "worker",
          project: { schemaVersion: 1 },
        },
      } as unknown as JobStoreAction),
    ).toThrow(/cannot contain project or revision/);
    expect(store.getSnapshot().jobs.polluted).toBeUndefined();

    store.dispatch({ type: "job.remove", jobId: "__proto__" });
    expect(store.getSnapshot().jobs["__proto__"]).toBeUndefined();
    expect(store.getSnapshot().order).toEqual(["job-2"]);
  });

  it("validates playback transitions and resets the transient clock", () => {
    const store = createPlaybackStore();
    expect(() => store.dispatch({ type: "playback.setPlaying", playing: true })).toThrow(
      /active sequence/,
    );
    expect(() =>
      store.dispatch({ type: "playback.seek", cursorMs: 10, celIndex: 1 }),
    ).toThrow(/seek requires an active sequence/);
    expect(() =>
      store.dispatch({
        type: "playback.advance",
        cursorMs: 16,
        celIndex: 1,
        accumulatorMs: 0,
        droppedFrames: 0,
      }),
    ).toThrow(/advance requires a playing sequence/);

    store.dispatch({ type: "playback.setSequence", sequenceId: "sequence-1" });
    expect(() =>
      store.dispatch({
        type: "playback.advance",
        cursorMs: 16,
        celIndex: 1,
        accumulatorMs: 0,
        droppedFrames: 0,
      }),
    ).toThrow(/advance requires a playing sequence/);
    store.dispatch({ type: "playback.setPlaying", playing: true });
    store.dispatch({
      type: "playback.advance",
      cursorMs: 48,
      celIndex: 2,
      accumulatorMs: 1.5,
      droppedFrames: 1,
    });
    expect(store.getSnapshot()).toEqual({
      sequenceId: "sequence-1",
      playing: true,
      cursorMs: 48,
      celIndex: 2,
      accumulatorMs: 1.5,
      droppedFrames: 1,
    });

    store.dispatch({ type: "playback.reset" });
    expect(store.getSnapshot()).toEqual({
      sequenceId: null,
      playing: false,
      cursorMs: 0,
      celIndex: 0,
      accumulatorMs: 0,
      droppedFrames: 0,
    });
  });

  it("rejects hostile action accessors before commit and notification", () => {
    const store = createInteractionStore();
    const listener = vi.fn();
    const getter = vi.fn(() => "interaction.reset");
    store.subscribe(listener);
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "type", { enumerable: true, get: getter });
    const before = store.getSnapshot();

    expect(() => store.dispatch(hostile as unknown as InteractionAction)).toThrow(
      /enumerable data properties/,
    );
    expect(getter).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("contains proxy details and rejects cycles, sparse arrays and runtime prototypes", () => {
    const store = createInteractionStore();
    const before = store.getSnapshot();
    const proxy = new Proxy(
      { type: "interaction.reset" },
      {
        ownKeys: () => {
          throw new Error("private proxy detail");
        },
      },
    );
    expect(() => store.dispatch(proxy as InteractionAction)).toThrow(
      "interaction store action could not be read safely.",
    );

    const cycle = { type: "interaction.setGuides", guides: [] as unknown[] };
    cycle.guides.push(cycle);
    expect(() => store.dispatch(cycle as unknown as InteractionAction)).toThrow(/cannot contain cycles/);

    const sparseGuides: unknown[] = [];
    sparseGuides.length = 1;
    expect(() =>
      store.dispatch({
        type: "interaction.setGuides",
        guides: sparseGuides,
      } as unknown as InteractionAction),
    ).toThrow(/dense data arrays/);

    const prototypeAction = Object.create({ inherited: true }) as Record<string, unknown>;
    prototypeAction.type = "interaction.reset";
    expect(() => store.dispatch(prototypeAction as unknown as InteractionAction)).toThrow(
      /plain data objects/,
    );
    expect(store.getSnapshot()).toBe(before);
  });

  it("isolates subscriber failures and contains reentrant local dispatch", () => {
    const diagnostics: unknown[] = [];
    const store = createInteractionStore({
      onSubscriberError: (diagnostic) => diagnostics.push(diagnostic),
    });
    const healthy = vi.fn();
    store.subscribe(() => {
      store.dispatch({ type: "interaction.reset" });
    });
    store.subscribe(() => {
      throw new Error("private observer detail");
    });
    store.subscribe(healthy);

    store.dispatch({ type: "interaction.setModal", modalId: "settings" });

    expect(store.getSnapshot().activeModalId).toBe("settings");
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics).toEqual([
      {
        code: "LOCAL_STORE_SUBSCRIBER_FAILED",
        storeKind: "interaction",
        message: "A local store subscriber failed while observing a committed snapshot.",
      },
      {
        code: "LOCAL_STORE_SUBSCRIBER_FAILED",
        storeKind: "interaction",
        message: "A local store subscriber failed while observing a committed snapshot.",
      },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("private observer detail");
  });

  it("does not notify on no-op actions and prevents runtime snapshot mutation", () => {
    const store = createWorkspaceStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: "workspace.setPanelSize", panelId: "left", size: 200 });
    const snapshot = store.getSnapshot();
    store.dispatch({ type: "workspace.setPanelSize", panelId: "left", size: 200 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(() => {
      (snapshot.panelSizes as Record<string, number>).left = 999;
    }).toThrow();
    expect(store.getSnapshot().panelSizes.left).toBe(200);
  });

  it("preserves snapshot identity for semantic no-ops and empty resets", () => {
    const workspace = createWorkspaceStore();
    const interaction = createInteractionStore();
    const jobs = createJobStore();
    const playback = createPlaybackStore();
    const listeners = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    workspace.subscribe(listeners[0]);
    interaction.subscribe(listeners[1]);
    jobs.subscribe(listeners[2]);
    playback.subscribe(listeners[3]);
    const initial = [
      workspace.getSnapshot(),
      interaction.getSnapshot(),
      jobs.getSnapshot(),
      playback.getSnapshot(),
    ];

    workspace.dispatch({ type: "workspace.reset" });
    interaction.dispatch({ type: "interaction.reset" });
    jobs.dispatch({ type: "job.reset" });
    playback.dispatch({ type: "playback.reset" });
    expect(workspace.getSnapshot()).toBe(initial[0]);
    expect(interaction.getSnapshot()).toBe(initial[1]);
    expect(jobs.getSnapshot()).toBe(initial[2]);
    expect(playback.getSnapshot()).toBe(initial[3]);
    listeners.forEach((listener) => expect(listener).not.toHaveBeenCalled());

    const target = { surfaceId: "compose", role: "layer", entityId: "layer-1" };
    interaction.dispatch({ type: "interaction.setHover", target });
    const hoverSnapshot = interaction.getSnapshot();
    interaction.dispatch({ type: "interaction.setHover", target: { ...target } });
    expect(interaction.getSnapshot()).toBe(hoverSnapshot);

    jobs.dispatch({ type: "job.replace", job: { id: "job-1", kind: "export" } });
    const jobSnapshot = jobs.getSnapshot();
    jobs.dispatch({ type: "job.replace", job: { kind: "export", id: "job-1" } });
    expect(jobs.getSnapshot()).toBe(jobSnapshot);
    expect(listeners[1]).toHaveBeenCalledTimes(1);
    expect(listeners[2]).toHaveBeenCalledTimes(1);
  });
});
