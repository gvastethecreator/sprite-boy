import { describe, expect, it, vi } from "vitest";
import {
  createEmptyStudioProject,
  type ProjectCommandContext,
  type ProjectCommandEnvelope,
  type StudioProjectV1,
} from "../../core/project";
import { createProjectStore } from "../../core/stores";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const context: ProjectCommandContext = {
  nextId: () => "generated-id",
  now: () => "2026-07-14T12:00:00.000Z",
};

function renameEnvelope(name: string, updatedAt = "2026-07-14T12:00:00.000Z"):
  ProjectCommandEnvelope {
  return {
    command: { type: "project.rename", name, updatedAt },
    metadata: {
      commandId: `rename-${name}`,
      origin: "user",
      history: "record",
    },
  };
}

describe("ProjectStore", () => {
  it("dispatches through the canonical reducer and advances one revision per change", () => {
    const initial = createEmptyStudioProject({
      id: "project-store",
      name: "Before",
      now: "2026-07-14T10:00:00.000Z",
    });
    const store = createProjectStore(initial, { context, initialRevision: 4 });
    const before = store.getSnapshot();
    const subscriber = vi.fn();
    store.subscribe(subscriber);

    const dispatch = store.dispatch(renameEnvelope("After"));
    const after = store.getSnapshot();

    expect(store).toMatchObject({
      kind: "project",
      persistence: "durable",
      history: "command",
    });
    expect(Object.keys(store).sort()).toEqual(
      ["dispatch", "getSnapshot", "history", "kind", "persistence", "subscribe"].sort(),
    );
    expect(dispatch.result).toMatchObject({ ok: true });
    expect(dispatch.result.ok && dispatch.result.inverse.type).toBe("project.restoreSnapshot");
    expect(dispatch.revision).toBe(5);
    expect(after).not.toBe(before);
    expect(after).toMatchObject({ revision: 5, project: { name: "After" } });
    expect(initial.name).toBe("Before");
    expect(subscriber).toHaveBeenCalledTimes(1);
  });

  it("retains the stable snapshot and revision for failed and semantic no-op commands", () => {
    const project = createEmptyStudioProject({
      id: "project-stable",
      name: "Stable",
      now: "2026-07-14T10:00:00.000Z",
    });
    const store = createProjectStore(project, { context, initialRevision: 9 });
    const subscriber = vi.fn();
    store.subscribe(subscriber);
    const before = store.getSnapshot();

    const noOp = store.dispatch(renameEnvelope("Stable", "2026-07-14T10:00:00.000Z"));
    const failed = store.dispatch({
      command: {
        type: "region.remove",
        regionId: "missing-region",
        policy: "reject",
      },
      metadata: { commandId: "missing", origin: "user", history: "record" },
    });

    expect(noOp.result.ok).toBe(true);
    expect(noOp.revision).toBe(9);
    expect(failed.result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "ENTITY_NOT_FOUND" }],
    });
    expect(failed.revision).toBe(9);
    expect(store.getSnapshot()).toBe(before);
    expect(subscriber).not.toHaveBeenCalled();
  });

  it("supports idempotent unsubscribe without notifying removed listeners", () => {
    const store = createProjectStore(createEmptyStudioProject({ id: "project-subscribe" }), {
      context,
    });
    const retained = vi.fn();
    const removed = vi.fn();
    store.subscribe(retained);
    const unsubscribe = store.subscribe(removed);
    unsubscribe();
    unsubscribe();

    store.dispatch(renameEnvelope("Subscribed"));

    expect(retained).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });

  it("does not execute an accessor masquerading as an envelope command", () => {
    const store = createProjectStore(createEmptyStudioProject({ id: "project-hostile" }), {
      context,
    });
    const getter = vi.fn(() => renameEnvelope("Compromised").command);
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "command", { enumerable: true, get: getter });
    Object.defineProperty(hostile, "metadata", {
      enumerable: true,
      value: { commandId: "hostile", origin: "user", history: "record" },
    });

    const result = store.dispatch(hostile as unknown as ProjectCommandEnvelope);

    expect(result.result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "INVALID_PATCH" }],
    });
    expect(getter).not.toHaveBeenCalled();
    expect(store.getSnapshot().project.name).toBe("Untitled project");
  });

  it("rejects invalid metadata and metadata accessors before the reducer", () => {
    const store = createProjectStore(createEmptyStudioProject({ id: "project-metadata" }), {
      context,
    });
    const invalid = store.dispatch({
      command: renameEnvelope("Invalid metadata").command,
      metadata: null,
    } as unknown as ProjectCommandEnvelope);
    const getter = vi.fn(() => ({
      commandId: "getter",
      origin: "user",
      history: "record",
    }));
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "command", {
      enumerable: true,
      value: renameEnvelope("Getter metadata").command,
    });
    Object.defineProperty(hostile, "metadata", { enumerable: true, get: getter });

    const accessor = store.dispatch(hostile as unknown as ProjectCommandEnvelope);

    expect(invalid.result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "INVALID_PATCH", path: "$.metadata" }],
    });
    expect(accessor.result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "INVALID_PATCH", path: "$.metadata" }],
    });
    expect(getter).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({
      revision: 0,
      project: { name: "Untitled project" },
    });
  });

  it("rejects reentrant dispatch and preserves one notification per committed revision", () => {
    const store = createProjectStore(createEmptyStudioProject({ id: "project-reentrant" }), {
      context,
    });
    let nested: ReturnType<typeof store.dispatch> | undefined;
    const first = vi.fn(() => {
      nested = store.dispatch(renameEnvelope("Nested"));
    });
    const observed: Array<{ revision: number; name: string }> = [];
    const second = vi.fn(() => {
      const snapshot = store.getSnapshot();
      observed.push({ revision: snapshot.revision, name: snapshot.project.name });
    });
    store.subscribe(first);
    store.subscribe(second);

    const outer = store.dispatch(renameEnvelope("Outer"));

    expect(outer).toMatchObject({
      revision: 1,
      result: { ok: true, project: { name: "Outer" } },
    });
    expect(nested).toMatchObject({
      revision: 1,
      result: {
        ok: false,
        diagnostics: [{ code: "PRECONDITION_FAILED", path: "$.dispatch" }],
      },
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(observed).toEqual([{ revision: 1, name: "Outer" }]);
  });

  it("isolates listener errors and reports only a generic diagnostic", () => {
    const diagnostics: unknown[] = [];
    const store = createProjectStore(createEmptyStudioProject({ id: "project-observer" }), {
      context,
      onSubscriberError: (diagnostic) => diagnostics.push(diagnostic),
    });
    const healthy = vi.fn();
    store.subscribe(() => {
      throw new Error("private listener detail");
    });
    store.subscribe(healthy);

    const dispatch = store.dispatch(renameEnvelope("Committed"));

    expect(dispatch).toMatchObject({ revision: 1, result: { ok: true } });
    expect(store.getSnapshot().project.name).toBe("Committed");
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(diagnostics).toEqual([
      {
        code: "PROJECT_STORE_SUBSCRIBER_FAILED",
        message: "A ProjectStore subscriber failed while observing a committed revision.",
      },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("private listener detail");
  });

  it("normalizes options and context without executing accessors", () => {
    const contextGetter = vi.fn(() => context);
    const hostileOptions = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostileOptions, "context", {
      enumerable: true,
      get: contextGetter,
    });

    expect(() =>
      createProjectStore(
        createEmptyStudioProject({ id: "project-hostile-options" }),
        hostileOptions as unknown as { context: ProjectCommandContext },
      ),
    ).toThrow(/data-only ProjectCommandContext/);
    expect(contextGetter).not.toHaveBeenCalled();
  });

  it("rejects invalid initial documents and revision overflow without committing", () => {
    const invalid = {
      ...createEmptyStudioProject({ id: "project-invalid" }),
      schemaVersion: 2,
    } as unknown as StudioProjectV1;
    expect(() => createProjectStore(invalid, { context })).toThrow(
      /requires a valid StudioProjectV1/,
    );

    const now = vi.fn(() => "2026-07-14T12:00:00.000Z" as const);
    const nextId = vi.fn(() => "unused-id");
    const store = createProjectStore(studioProjectV1Fixture, {
      context: { now, nextId },
      initialRevision: Number.MAX_SAFE_INTEGER,
    });
    const before = store.getSnapshot();
    const result = store.dispatch({
      command: {
        type: "region.update",
        regionId: "region-hero",
        patch: { name: "Cannot commit" },
      },
      metadata: { commandId: "overflow", origin: "user", history: "record" },
    });

    expect(result).toMatchObject({
      revision: Number.MAX_SAFE_INTEGER,
      result: {
        ok: false,
        diagnostics: [{ code: "PRECONDITION_FAILED", path: "$.revision" }],
      },
    });
    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot().project.regions["region-hero"].name).not.toBe("Cannot commit");
    expect(now).not.toHaveBeenCalled();
    expect(nextId).not.toHaveBeenCalled();
  });
});
