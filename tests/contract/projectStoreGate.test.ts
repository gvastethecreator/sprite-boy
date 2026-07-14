import { describe, expect, it, vi } from "vitest";
import {
  cloneStudioProject,
  type ProjectCommandBatch,
  type ProjectCommandEnvelope,
  type StudioProjectV1,
} from "../../core/project";
import {
  createInteractionStore,
  createPlaybackStore,
  createProjectStore,
  createProjectStoreWithHistory,
  createWorkspaceStore,
} from "../../core/stores";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const context = {
  nextId: () => "generated-id",
  now: () => "2026-07-14T17:00:00.000Z",
};

function batchEnvelope(
  commandId: string,
  commands: ProjectCommandBatch["commands"],
): ProjectCommandEnvelope<ProjectCommandBatch> {
  return {
    command: { type: "command.batch", commands },
    metadata: { commandId, origin: "user", history: "record" },
  };
}

function rename(name: string, commandId: string): ProjectCommandEnvelope {
  return {
    command: {
      type: "project.rename",
      name,
      updatedAt: `2026-07-14T17:00:${commandId.length.toString().padStart(2, "0")}.000Z`,
    },
    metadata: { commandId, origin: "user", history: "record" },
  };
}

describe("F4-06 ProjectStore gate", () => {
  it("commits an atomic batch as one revision and one undo/redo entry", () => {
    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, { context });
    const result = store.dispatch(batchEnvelope("batch-edit", [
      {
        type: "project.rename",
        name: "Batch project",
        updatedAt: "2026-07-14T17:01:00.000Z",
      },
      {
        type: "region.update",
        regionId: "region-hero",
        patch: { name: "Batch region" },
      },
    ]));

    expect(result).toMatchObject({ revision: 1, result: { ok: true } });
    expect(store.getSnapshot()).toMatchObject({
      revision: 1,
      project: {
        name: "Batch project",
        regions: { "region-hero": { name: "Batch region" } },
      },
    });
    expect(history.getSnapshot()).toEqual({
      undoEntries: [{
        mode: "record",
        commandIds: ["batch-edit"],
        fromRevision: 0,
        toRevision: 1,
      }],
      redoEntries: [],
    });

    expect(history.undo()).toEqual({ ok: true, revision: 2 });
    expect(store.getSnapshot().project).toEqual(studioProjectV1Fixture);
    expect(history.redo()).toEqual({ ok: true, revision: 3 });
    expect(store.getSnapshot().project).toMatchObject({
      name: "Batch project",
      regions: { "region-hero": { name: "Batch region" } },
    });
  });

  it("rolls back a failed batch without a revision, notification or history entry", () => {
    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, { context });
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getSnapshot();
    const failed = store.dispatch(batchEnvelope("batch-failed", [
      {
        type: "project.rename",
        name: "Must rollback",
        updatedAt: "2026-07-14T17:02:00.000Z",
      },
      { type: "region.remove", regionId: "missing-region", policy: "reject" },
    ]));

    expect(failed).toMatchObject({ revision: 0, result: { ok: false } });
    expect(failed.result.project).toBe(before.project);
    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot().project.name).toBe(studioProjectV1Fixture.name);
    expect(history.getSnapshot()).toEqual({ undoEntries: [], redoEntries: [] });
    expect(listener).not.toHaveBeenCalled();

    const empty = store.dispatch(batchEnvelope("batch-empty", []));
    expect(empty).toMatchObject({ revision: 0, result: { ok: true } });
    expect(store.getSnapshot()).toBe(before);
    expect(history.getSnapshot()).toEqual({ undoEntries: [], redoEntries: [] });

    const bypass = store.dispatch({
      command: { type: "project.restoreSnapshot", project: studioProjectV1Fixture },
      metadata: { commandId: "snapshot-bypass", origin: "user", history: "record" },
    } as unknown as ProjectCommandEnvelope);
    expect(bypass).toMatchObject({
      revision: 0,
      result: { ok: false, diagnostics: [{ code: "COMMAND_UNSUPPORTED" }] },
    });
    expect(store.getSnapshot()).toBe(before);
  });

  it("detaches hostile batch arrays and commands without executing get traps", () => {
    const arrayGets = vi.fn();
    const commandGets = vi.fn();
    const command = new Proxy({
      type: "project.rename" as const,
      name: "Detached batch",
      updatedAt: "2026-07-14T17:03:00.000Z",
    }, {
      get(target, property, receiver) {
        commandGets(property);
        return Reflect.get(target, property, receiver);
      },
    });
    const commands = new Proxy([command], {
      get(target, property, receiver) {
        arrayGets(property);
        return Reflect.get(target, property, receiver);
      },
    });
    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, { context });

    const result = store.dispatch(batchEnvelope(
      "hostile-batch",
      commands as ProjectCommandBatch["commands"],
    ));

    expect(result).toMatchObject({ revision: 1, result: { ok: true } });
    expect(store.getSnapshot().project.name).toBe("Detached batch");
    expect(history.getSnapshot().undoEntries).toHaveLength(1);
    expect(arrayGets).not.toHaveBeenCalled();
    expect(commandGets).not.toHaveBeenCalled();
  });

  it("uses only detached commands in reducers and history hooks", () => {
    const singleGets = vi.fn();
    const singleCommand = new Proxy({
      type: "project.rename" as const,
      name: "Detached single",
      updatedAt: "2026-07-14T17:04:00.000Z",
    }, {
      get(target, property, receiver) {
        singleGets(property);
        return Reflect.get(target, property, receiver);
      },
    });
    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, { context });
    const single = store.dispatch({
      command: singleCommand,
      metadata: { commandId: "hostile-single", origin: "user", history: "record" },
    });
    expect(single).toMatchObject({ revision: 1, result: { ok: true } });
    expect(store.getSnapshot().project.name).toBe("Detached single");
    expect(singleGets).not.toHaveBeenCalled();

    const batchGets = vi.fn();
    const ignoredBatch = new Proxy({
      type: "command.batch" as const,
      commands: [{
        type: "project.rename" as const,
        name: "Detached ignored batch",
        updatedAt: "2026-07-14T17:05:00.000Z",
      }],
    }, {
      get() {
        batchGets();
        throw new Error("External batch must not be reread");
      },
    });
    const ignored = store.dispatch({
      command: ignoredBatch,
      metadata: { commandId: "hostile-ignore", origin: "user", history: "ignore" },
    });
    expect(ignored).toMatchObject({ revision: 2, result: { ok: true } });
    expect(store.getSnapshot().project.name).toBe("Detached ignored batch");
    expect(history.getSnapshot()).toEqual({ undoEntries: [], redoEntries: [] });
    expect(batchGets).not.toHaveBeenCalled();
  });

  it("rejects nested batch accessors without executing them or partially committing", () => {
    const nestedGetter = vi.fn(() => "Executable name");
    const patch = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(patch, "name", { enumerable: true, get: nestedGetter });
    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, { context });
    const before = store.getSnapshot();
    const result = store.dispatch(batchEnvelope("nested-accessor", [
      {
        type: "project.rename",
        name: "Must rollback",
        updatedAt: "2026-07-14T17:06:00.000Z",
      },
      {
        type: "region.update",
        regionId: "region-hero",
        patch,
      } as unknown as ProjectCommandBatch["commands"][number],
    ]));

    expect(result).toMatchObject({ revision: 0, result: { ok: false } });
    expect(result.result.project).toBe(before.project);
    expect(store.getSnapshot()).toBe(before);
    expect(history.getSnapshot()).toEqual({ undoEntries: [], redoEntries: [] });
    expect(nestedGetter).not.toHaveBeenCalled();
  });

  it("isolates and deeply freezes initial, committed and failed public values", () => {
    const initial = cloneStudioProject(studioProjectV1Fixture);
    const { store, history } = createProjectStoreWithHistory(initial, { context });
    const initialSnapshot = store.getSnapshot();

    initial.name = "External initial mutation";
    initial.regions["region-hero"].name = "External nested mutation";
    initial.rootOrder.assetIds.push("asset-external");
    expect(initialSnapshot.project).toEqual(studioProjectV1Fixture);
    expect(initialSnapshot.project).not.toBe(initial);
    expect(Object.isFrozen(initialSnapshot.project)).toBe(true);
    expect(Object.isFrozen(initialSnapshot.project.regions["region-hero"])).toBe(true);
    expect(Object.isFrozen(initialSnapshot.project.rootOrder.assetIds)).toBe(true);

    expect(() => {
      (initialSnapshot.project as unknown as StudioProjectV1).name = "Snapshot mutation";
    }).toThrow(TypeError);
    expect(() => {
      (initialSnapshot.project.rootOrder.assetIds as unknown as string[]).push("asset-mutation");
    }).toThrow(TypeError);

    const committed = store.dispatch(rename("Committed frozen", "frozen"));
    expect(committed.result.ok).toBe(true);
    expect(Object.isFrozen(committed.result)).toBe(true);
    expect(Object.isFrozen(committed.result.project)).toBe(true);
    if (!committed.result.ok) throw new Error("Expected committed result");
    expect(Object.isFrozen(committed.result.inverse)).toBe(true);
    expect(Object.isFrozen(committed.result.changedIds)).toBe(true);
    expect(() => {
      (committed.result.project as unknown as StudioProjectV1).name = "Result mutation";
    }).toThrow(TypeError);
    expect(store.getSnapshot().project.name).toBe("Committed frozen");
    expect(history.undo()).toEqual({ ok: true, revision: 2 });
    expect(store.getSnapshot().project.name).toBe(studioProjectV1Fixture.name);

    const failed = store.dispatch({
      command: { type: "region.remove", regionId: "missing", policy: "reject" },
      metadata: { commandId: "failed-frozen", origin: "user", history: "record" },
    });
    expect(failed.result.ok).toBe(false);
    expect(Object.isFrozen(failed.result)).toBe(true);
    if (failed.result.ok) throw new Error("Expected failed result");
    expect(Object.isFrozen(failed.result.diagnostics)).toBe(true);
    expect(Object.isFrozen(failed.result.diagnostics[0])).toBe(true);
  });

  it("rejects executable initial documents before cloning or publishing them", () => {
    const proxyGets = vi.fn();
    const proxy = new Proxy(cloneStudioProject(studioProjectV1Fixture), {
      get(target, property, receiver) {
        proxyGets(property);
        if (property === "toJSON") return () => ({ schemaVersion: 1 });
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() => createProjectStore(proxy, { context })).toThrow(/could not isolate/);
    expect(proxyGets).not.toHaveBeenCalled();

    const accessor = cloneStudioProject(studioProjectV1Fixture);
    const nameGetter = vi.fn(() => "Getter project");
    Object.defineProperty(accessor, "name", { enumerable: true, get: nameGetter });
    expect(() => createProjectStore(accessor, { context })).toThrow(/could not isolate/);
    expect(nameGetter).not.toHaveBeenCalled();

    const shallowFrozen = cloneStudioProject(studioProjectV1Fixture);
    Object.freeze(shallowFrozen);
    const store = createProjectStore(shallowFrozen, { context });
    expect(Object.isFrozen(store.getSnapshot().project.regions["region-hero"])).toBe(true);
  });

  it("retains the newest configured number of snapshots across undo/redo", () => {
    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, {
      context,
      maxHistoryEntries: 2,
    });
    store.dispatch(rename("A", "a"));
    store.dispatch(rename("B", "b"));
    store.dispatch(rename("C", "c"));

    expect(history.getSnapshot().undoEntries.map(({ commandIds }) => commandIds)).toEqual([
      ["b"],
      ["c"],
    ]);
    expect(history.undo()).toEqual({ ok: true, revision: 4 });
    expect(store.getSnapshot().project.name).toBe("B");
    expect(history.undo()).toEqual({ ok: true, revision: 5 });
    expect(store.getSnapshot().project.name).toBe("A");
    expect(history.undo()).toMatchObject({ ok: false, reason: "empty", revision: 5 });
    expect(history.redo()).toEqual({ ok: true, revision: 6 });
    expect(store.getSnapshot().project.name).toBe("B");
    expect(history.redo()).toEqual({ ok: true, revision: 7 });
    expect(store.getSnapshot().project.name).toBe("C");
  });

  it("contains invalid retention options and keeps transient stores outside history", () => {
    expect(() => createProjectStoreWithHistory(studioProjectV1Fixture, {
      context,
      maxHistoryEntries: undefined,
      onHistorySubscriberError: undefined,
    })).not.toThrow();
    for (const maxHistoryEntries of [0, 1_001, 1.5]) {
      expect(() => createProjectStoreWithHistory(studioProjectV1Fixture, {
        context,
        maxHistoryEntries,
      })).toThrow(/maxHistoryEntries/);
    }
    const getter = vi.fn(() => 10);
    const hostileOptions = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostileOptions, "context", { enumerable: true, value: context });
    Object.defineProperty(hostileOptions, "maxHistoryEntries", { enumerable: true, get: getter });
    expect(() => createProjectStoreWithHistory(
      studioProjectV1Fixture,
      hostileOptions as unknown as { context: typeof context },
    )).toThrow(/maxHistoryEntries/);
    expect(getter).not.toHaveBeenCalled();

    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, { context });
    const projectBefore = store.getSnapshot();
    const historyBefore = history.getSnapshot();
    const workspace = createWorkspaceStore();
    const interaction = createInteractionStore();
    const playback = createPlaybackStore();
    workspace.dispatch({ type: "workspace.setPanelSize", panelId: "timeline", size: 300 });
    interaction.dispatch({ type: "interaction.setModal", modalId: "settings" });
    playback.dispatch({ type: "playback.setSequence", sequenceId: "sequence-main" });

    expect(store.getSnapshot()).toBe(projectBefore);
    expect(history.getSnapshot()).toBe(historyBefore);
  });
});
