import { describe, expect, it, vi } from "vitest";
import {
  createInteractionStore,
  createJobStore,
  createPlaybackStore,
  createWorkspaceStore,
} from "../../core/stores";

function rejects(store: { dispatch(action: never): void }, actions: readonly unknown[]): void {
  for (const action of actions) {
    expect(() => store.dispatch(action as never)).toThrow(TypeError);
  }
}

describe("local Studio store validation matrix", () => {
  it("covers every workspace action state/no-op and hostile shape", () => {
    const store = createWorkspaceStore();
    store.dispatch({ type: "workspace.setPreference", key: "theme", value: "dark" });
    store.dispatch({ type: "workspace.setPreference", key: "count", value: 2 });
    store.dispatch({ type: "workspace.setPreference", key: "enabled", value: false });
    store.dispatch({ type: "workspace.setPreference", key: "empty", value: null });
    store.dispatch({
      type: "workspace.setViewport",
      workspaceId: "animate",
      viewport: { scale: 1, offset: { x: 0, y: 0 } },
    });
    const stable = store.getSnapshot();
    store.dispatch({
      type: "workspace.setViewport",
      workspaceId: "animate",
      viewport: { scale: 1, offset: { x: 0, y: 0 } },
    });
    expect(store.getSnapshot()).toBe(stable);

    rejects(store, [
      null,
      [],
      { type: "workspace.unknown" },
      { type: "workspace.reset", extra: true },
      { type: "workspace.setPanelSize", panelId: "", size: 1 },
      { type: "workspace.setPanelSize", panelId: "left", size: -1 },
      { type: "workspace.setPanelSize", panelId: "left", size: Number.NaN },
      { type: "workspace.setPanelSize", panelId: "left", size: -0 },
      { type: "workspace.setViewport", workspaceId: "unknown", viewport: { scale: 1, offset: { x: 0, y: 0 } } },
      { type: "workspace.setViewport", workspaceId: "slice", viewport: null },
      { type: "workspace.setViewport", workspaceId: "slice", viewport: { scale: 0, offset: { x: 0, y: 0 } } },
      { type: "workspace.setViewport", workspaceId: "slice", viewport: { scale: 1, offset: { x: 0 } } },
      { type: "workspace.setPreference", key: "bad", value: {} },
      { type: "workspace.setPreference", key: " ", value: true },
    ]);

    store.dispatch({ type: "workspace.reset" });
    expect(store.getSnapshot()).toEqual({ panelSizes: {}, viewports: {}, preferences: {} });
  });

  it("covers interaction payloads, semantic no-ops, clears and validation failures", () => {
    const store = createInteractionStore();
    const target = { surfaceId: "canvas", role: "layer", entityId: "layer-1" };
    const session = {
      pointerId: 1,
      transactionId: "drag-1",
      target,
      origin: { x: 1, y: 2 },
      current: { x: 3, y: 4 },
    };
    store.dispatch({ type: "interaction.setDrag", session });
    store.dispatch({ type: "interaction.setDrag", session: { ...session } });
    store.dispatch({ type: "interaction.setGuides", guides: [
      { axis: "x", position: 10 },
      { axis: "y", position: 20 },
    ] });
    store.dispatch({ type: "interaction.setMarquee", marquee: { x: 1, y: 2, width: 3, height: 4 } });
    store.dispatch({ type: "interaction.setTransientSelection", entityIds: ["a", "b"] });
    store.dispatch({ type: "interaction.setModal", modalId: "settings" });
    store.dispatch({
      type: "interaction.setContextMenu",
      contextMenu: { anchor: { x: 8, y: 9 }, target: null },
    });
    store.dispatch({ type: "interaction.setMarquee", marquee: null });
    store.dispatch({ type: "interaction.setModal", modalId: null });
    store.dispatch({ type: "interaction.setContextMenu", contextMenu: null });
    store.dispatch({ type: "interaction.setDrag", session: null });

    rejects(store, [
      { type: "interaction.unknown" },
      { type: "interaction.reset", extra: true },
      { type: "interaction.setHover" },
      { type: "interaction.setHover", target: { surfaceId: "", role: "layer" } },
      { type: "interaction.setHover", target: { surfaceId: "canvas", role: "layer", entityId: "" } },
      { type: "interaction.setDrag", session: { ...session, pointerId: 1.5 } },
      { type: "interaction.setDrag", session: { ...session, transactionId: "" } },
      { type: "interaction.setGuides", guides: [{ axis: "z", position: 0 }] },
      { type: "interaction.setGuides", guides: [{ axis: "x", position: Infinity }] },
      { type: "interaction.setMarquee", marquee: { x: 0, y: 0, width: -1, height: 1 } },
      { type: "interaction.setTransientSelection", entityIds: ["a", "a"] },
      { type: "interaction.setTransientSelection", entityIds: [""] },
      { type: "interaction.setModal", modalId: " " },
      { type: "interaction.setContextMenu", contextMenu: { anchor: { x: 0 }, target: null } },
      { type: "interaction.setContextMenu", contextMenu: { anchor: { x: 0, y: 0 }, target: {} } },
    ]);

    store.dispatch({ type: "interaction.reset" });
    expect(store.getSnapshot().guides).toEqual([]);
  });

  it("covers playback seek/no-op branches and canonical numeric validation", () => {
    const store = createPlaybackStore();
    store.dispatch({ type: "playback.setSequence", sequenceId: "sequence-1" });
    const sequence = store.getSnapshot();
    store.dispatch({ type: "playback.setSequence", sequenceId: "sequence-1" });
    expect(store.getSnapshot()).toBe(sequence);
    store.dispatch({ type: "playback.seek", cursorMs: 32, celIndex: 2 });
    const seek = store.getSnapshot();
    store.dispatch({ type: "playback.seek", cursorMs: 32, celIndex: 2 });
    expect(store.getSnapshot()).toBe(seek);
    store.dispatch({ type: "playback.setPlaying", playing: true });
    store.dispatch({
      type: "playback.advance",
      cursorMs: 48,
      celIndex: 3,
      accumulatorMs: 0.5,
      droppedFrames: 0,
    });
    const advanced = store.getSnapshot();
    store.dispatch({
      type: "playback.advance",
      cursorMs: 48,
      celIndex: 3,
      accumulatorMs: 0.5,
      droppedFrames: 0,
    });
    expect(store.getSnapshot()).toBe(advanced);

    rejects(store, [
      { type: "playback.unknown" },
      { type: "playback.reset", extra: true },
      { type: "playback.setSequence", sequenceId: "" },
      { type: "playback.setPlaying", playing: "yes" },
      { type: "playback.seek", cursorMs: -1, celIndex: 0 },
      { type: "playback.seek", cursorMs: 1, celIndex: 1.5 },
      { type: "playback.advance", cursorMs: 1, celIndex: 0, accumulatorMs: -1, droppedFrames: 0 },
      { type: "playback.advance", cursorMs: 1, celIndex: 0, accumulatorMs: 0, droppedFrames: 1.5 },
    ]);
  });

  it("validates store options/subscriptions and isolates a failing diagnostic observer", () => {
    expect(() => createWorkspaceStore(null as never)).toThrow(/data-only/);
    expect(() => createWorkspaceStore({ unsupported: true } as never)).toThrow(/data-only/);
    expect(() => createJobStore({ unsupported: true } as never)).toThrow(/unsupported/);
    expect(() => createJobStore({ onSubscriberError: "bad" } as never)).toThrow(/data method/);
    expect(() => createJobStore({ retention: 1 } as never)).toThrow();

    const observer = vi.fn(() => { throw new Error("observer failure"); });
    const store = createInteractionStore({ onSubscriberError: observer });
    expect(() => store.subscribe(null as never)).toThrow(/function/);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    unsubscribe();
    store.subscribe(() => { throw new Error("subscriber failure"); });
    expect(() => store.dispatch({ type: "interaction.setModal", modalId: "help" })).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
    expect(observer).toHaveBeenCalledOnce();
  });
});
