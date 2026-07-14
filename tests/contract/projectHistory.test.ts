import { describe, expect, it, vi } from "vitest";
import type { AssetRecord, ProjectCommandEnvelope } from "../../core/project";
import { createProjectStoreWithHistory } from "../../core/stores";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const context = {
  nextId: () => "generated-id",
  now: () => "2026-07-14T15:00:00.000Z",
};

function rename(
  name: string,
  commandId: string,
  history: "record" | "coalesce" | "ignore" = "record",
  transactionId?: string,
): ProjectCommandEnvelope {
  return {
    command: {
      type: "project.rename",
      name,
      updatedAt: `2026-07-14T15:00:${commandId.length.toString().padStart(2, "0")}.000Z`,
    },
    metadata: {
      commandId,
      origin: "user",
      history,
      ...(transactionId ? { transactionId } : {}),
    },
  };
}

function importedAsset(id: string): AssetRecord {
  return {
    ...studioProjectV1Fixture.assets["asset-sheet"],
    id,
    name: `${id}.png`,
    blobKey: `asset/${id}`,
    contentHash: `sha256:${id}`,
    provenance: { source: "derived", parentAssetId: "asset-sheet" },
  };
}

describe("ProjectHistory", () => {
  it("coalesces a drag transaction into one exact undo and redo", () => {
    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, { context });
    const originalName = studioProjectV1Fixture.regions["region-hero"].name;
    for (const [index, name] of ["Drag A", "Drag B", "Drag Final"].entries()) {
      store.dispatch({
        command: {
          type: "region.update",
          regionId: "region-hero",
          patch: { name },
        },
        metadata: {
          commandId: `drag-${index}`,
          origin: "user",
          history: "coalesce",
          transactionId: "drag-transaction",
        },
      });
    }

    expect(store.getSnapshot()).toMatchObject({
      revision: 3,
      project: { regions: { "region-hero": { name: "Drag Final" } } },
    });
    expect(history.getSnapshot()).toEqual({
      undoEntries: [
        {
          mode: "coalesce",
          commandIds: ["drag-0", "drag-1", "drag-2"],
          transactionId: "drag-transaction",
          fromRevision: 0,
          toRevision: 3,
        },
      ],
      redoEntries: [],
    });

    expect(history.undo()).toEqual({ ok: true, revision: 4 });
    expect(store.getSnapshot().project.regions["region-hero"].name).toBe(originalName);
    expect(history.getSnapshot()).toMatchObject({
      undoEntries: [],
      redoEntries: [{ commandIds: ["drag-0", "drag-1", "drag-2"] }],
    });

    expect(history.redo()).toEqual({ ok: true, revision: 5 });
    expect(store.getSnapshot().project.regions["region-hero"].name).toBe("Drag Final");
    expect(history.getSnapshot()).toMatchObject({
      undoEntries: [{ commandIds: ["drag-0", "drag-1", "drag-2"] }],
      redoEntries: [],
    });
  });

  it("records independent commands and rejects coalesce without transactionId", () => {
    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, { context });
    store.dispatch(rename("First", "record-1"));
    store.dispatch(rename("Second", "record-2"));
    const beforeInvalid = store.getSnapshot();
    const invalid = store.dispatch(rename("Invalid", "coalesce", "coalesce"));

    expect(history.getSnapshot().undoEntries).toHaveLength(2);
    expect(invalid.result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "INVALID_PATCH", path: "$.metadata.transactionId" }],
    });
    expect(store.getSnapshot()).toBe(beforeInvalid);

    expect(history.undo()).toEqual({ ok: true, revision: 3 });
    expect(store.getSnapshot().project.name).toBe("First");
    expect(history.undo()).toEqual({ ok: true, revision: 4 });
    expect(store.getSnapshot().project.name).toBe(studioProjectV1Fixture.name);
    expect(history.undo()).toMatchObject({ ok: false, reason: "empty", revision: 4 });
  });

  it("keeps ignored commands out of undo and invalidates divergent redo", () => {
    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, { context });
    store.dispatch(rename("Recorded", "recorded"));
    history.undo();
    expect(history.getSnapshot().redoEntries).toHaveLength(1);

    store.dispatch(rename("Ignored divergence", "ignored", "ignore"));

    expect(history.getSnapshot()).toEqual({ undoEntries: [], redoEntries: [] });
    expect(store.getSnapshot().project.name).toBe("Ignored divergence");
    expect(history.redo()).toMatchObject({ ok: false, reason: "empty" });
  });

  it("treats ignored document changes as a boundary that cannot be undone", () => {
    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, { context });
    store.dispatch(rename("Recorded before ignore", "before-ignore"));
    store.dispatch({
      command: {
        type: "region.update",
        regionId: "region-hero",
        patch: { name: "Ignored region" },
      },
      metadata: {
        commandId: "ignored-region",
        origin: "user",
        history: "ignore",
      },
    });

    expect(history.getSnapshot()).toEqual({ undoEntries: [], redoEntries: [] });
    expect(history.undo()).toMatchObject({ ok: false, reason: "empty" });
    expect(store.getSnapshot().project).toMatchObject({
      name: "Recorded before ignore",
      regions: { "region-hero": { name: "Ignored region" } },
    });
  });

  it("rebases ignored workspace state without coalescing across its boundary", () => {
    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, { context });
    store.dispatch(rename("Recorded", "recorded-before-workspace"));
    store.dispatch({
      command: { type: "workspace.update", patch: { activeWorkspace: "animate" } },
      metadata: {
        commandId: "workspace-ignore",
        origin: "user",
        history: "ignore",
      },
    });

    expect(history.getSnapshot().undoEntries).toHaveLength(1);
    expect(history.undo()).toEqual({ ok: true, revision: 3 });
    expect(store.getSnapshot().project.name).toBe(studioProjectV1Fixture.name);
    expect(store.getSnapshot().project.workspace.activeWorkspace).toBe("animate");
    expect(store.getSnapshot().project.updatedAt).toBe(context.now());

    store.dispatch({
      command: {
        type: "region.update",
        regionId: "region-hero",
        patch: { name: "Coalesce A" },
      },
      metadata: {
        commandId: "coalesce-a",
        origin: "user",
        history: "coalesce",
        transactionId: "reused-transaction",
      },
    });
    store.dispatch({
      command: { type: "workspace.update", patch: { activeWorkspace: "compose" } },
      metadata: {
        commandId: "workspace-boundary",
        origin: "user",
        history: "ignore",
      },
    });
    store.dispatch({
      command: {
        type: "region.update",
        regionId: "region-hero",
        patch: { name: "Coalesce B" },
      },
      metadata: {
        commandId: "coalesce-b",
        origin: "user",
        history: "coalesce",
        transactionId: "reused-transaction",
      },
    });

    expect(history.getSnapshot().undoEntries.slice(-2)).toMatchObject([
      { commandIds: ["coalesce-a"] },
      { commandIds: ["coalesce-b"] },
    ]);
  });

  it("prunes ignored selections that do not exist in an older snapshot", () => {
    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, { context });
    store.dispatch({
      command: { type: "asset.import", asset: importedAsset("asset-new") },
      metadata: { commandId: "asset-new-import", origin: "user", history: "record" },
    });
    store.dispatch({
      command: { type: "workspace.update", patch: { selectedAssetId: "asset-new" } },
      metadata: { commandId: "asset-new-select", origin: "user", history: "ignore" },
    });

    expect(history.undo()).toEqual({ ok: true, revision: 3 });
    expect(store.getSnapshot().project.assets).not.toHaveProperty("asset-new");
    expect(store.getSnapshot().project.workspace.selectedAssetId).toBeUndefined();
    expect(store.getSnapshot().project.updatedAt).toBe(context.now());

    expect(history.redo()).toEqual({ ok: true, revision: 4 });
    expect(store.getSnapshot().project.assets).toHaveProperty("asset-new");
    expect(store.getSnapshot().project.workspace.selectedAssetId).toBe("asset-new");
    expect(store.getSnapshot().project.updatedAt).toBe(context.now());
  });

  it("starts a new coalescing branch after undo and redo", () => {
    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, { context });
    store.dispatch(rename("A", "x-1", "coalesce", "txn-x"));
    store.dispatch(rename("B", "y-1", "coalesce", "txn-y"));

    expect(history.undo()).toEqual({ ok: true, revision: 3 });
    store.dispatch(rename("C", "x-2", "coalesce", "txn-x"));
    expect(history.getSnapshot().undoEntries.map(({ commandIds }) => commandIds)).toEqual([
      ["x-1"],
      ["x-2"],
    ]);
    expect(history.undo()).toEqual({ ok: true, revision: 5 });
    expect(store.getSnapshot().project.name).toBe("A");

    expect(history.redo()).toEqual({ ok: true, revision: 6 });
    store.dispatch(rename("D", "x-3", "coalesce", "txn-x"));
    expect(history.getSnapshot().undoEntries.map(({ commandIds }) => commandIds)).toEqual([
      ["x-1"],
      ["x-2"],
      ["x-3"],
    ]);
    expect(history.undo()).toEqual({ ok: true, revision: 8 });
    expect(store.getSnapshot().project.name).toBe("C");
  });

  it("publishes frozen non-serializing summaries after the project commit", () => {
    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, { context });
    const observed: Array<{ storeRevision: number; historyRevision: number }> = [];
    history.subscribe(() => {
      observed.push({
        storeRevision: store.getSnapshot().revision,
        historyRevision: history.getSnapshot().undoEntries.at(-1)?.toRevision ?? -1,
      });
    });

    store.dispatch(rename("Observed", "observed"));

    expect(observed).toEqual([{ storeRevision: 1, historyRevision: 1 }]);
    expect(Object.isFrozen(history.getSnapshot())).toBe(true);
    expect(Object.isFrozen(history.getSnapshot().undoEntries[0].commandIds)).toBe(true);
    expect(history).not.toHaveProperty("serialize");
    expect(history).not.toHaveProperty("hydrate");
  });

  it("isolates subscriber failures and rejects operations reentrant from history notify", () => {
    const diagnostics: unknown[] = [];
    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, {
      context,
      onHistorySubscriberError: (diagnostic) => diagnostics.push(diagnostic),
    });
    let reentrant: ReturnType<typeof history.undo> | undefined;
    const healthy = vi.fn();
    history.subscribe(() => {
      reentrant = history.undo();
    });
    history.subscribe(() => {
      throw new Error("private history observer");
    });
    history.subscribe(healthy);

    store.dispatch(rename("Committed", "committed"));

    expect(reentrant).toMatchObject({ ok: false, reason: "reentrant", revision: 1 });
    expect(store.getSnapshot()).toMatchObject({ revision: 1, project: { name: "Committed" } });
    expect(history.getSnapshot().undoEntries).toHaveLength(1);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(diagnostics).toEqual([
      {
        code: "PROJECT_HISTORY_SUBSCRIBER_FAILED",
        message: "A ProjectHistory subscriber failed while observing a committed stack.",
      },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("private history observer");
  });

  it("keeps the reentrancy guard active across nested history notifications", () => {
    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, { context });
    store.dispatch(rename("Seed", "seed"));
    const nestedUndoResults: Array<ReturnType<typeof history.undo>> = [];
    let dispatchedNested = false;

    history.subscribe(() => {
      if (dispatchedNested) return;
      dispatchedNested = true;
      store.dispatch(rename("Nested", "nested"));
    });
    history.subscribe(() => {
      nestedUndoResults.push(history.undo());
    });

    history.clear();

    expect(nestedUndoResults).toHaveLength(2);
    expect(nestedUndoResults).toMatchObject([
      { ok: false, reason: "reentrant" },
      { ok: false, reason: "reentrant" },
    ]);
    expect(store.getSnapshot()).toMatchObject({ revision: 2, project: { name: "Nested" } });
    expect(history.getSnapshot()).toMatchObject({
      undoEntries: [{ commandIds: ["nested"] }],
      redoEntries: [],
    });
  });

  it("clears both stacks without mutating the project and contains option accessors", () => {
    const options = Object.create(null) as Record<string, unknown>;
    const getter = vi.fn(() => undefined);
    Object.defineProperty(options, "context", { enumerable: true, value: context });
    Object.defineProperty(options, "onHistorySubscriberError", { enumerable: true, get: getter });
    expect(() =>
      createProjectStoreWithHistory(
        studioProjectV1Fixture,
        options as unknown as { context: typeof context },
      ),
    ).toThrow(/data-only subscriber reporter/);
    expect(getter).not.toHaveBeenCalled();

    const { store, history } = createProjectStoreWithHistory(studioProjectV1Fixture, { context });
    store.dispatch(rename("Clear", "clear"));
    const projectBeforeClear = store.getSnapshot();
    history.clear();
    history.clear();
    expect(history.getSnapshot()).toEqual({ undoEntries: [], redoEntries: [] });
    expect(store.getSnapshot()).toBe(projectBeforeClear);
  });
});
