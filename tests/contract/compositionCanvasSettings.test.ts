import { describe, expect, it } from "vitest";
import { projectCodec } from "../../core/persistence";
import type { StudioProjectV1 } from "../../core/project";
import { createSceneProjection, renderSceneExport, type SceneCompositorFrame, type SceneCompositorTarget } from "../../core/render";
import { createProjectStoreWithHistory, type WorkspaceState } from "../../core/stores";
import type { ProjectStore } from "../../core/stores";
import {
  COMPOSITION_ASPECT_RATIOS,
  applyCompositionAspectRatio,
  applyCompositionCanvasSettings,
  createCompositionCanvasBaseline,
  createCompositionCanvasDraft,
  detectCompositionAspectRatio,
  validateCompositionCanvasDraft,
} from "../../features/compose/canvasSettings";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const NOW = "2026-07-16T16:00:00.000Z";
const WORKSPACE: WorkspaceState = { panelSizes: {}, viewports: {}, preferences: {} };

function runtime() {
  return createProjectStoreWithHistory(structuredClone(studioProjectV1Fixture), {
    context: { nextId: () => "unused-id", now: () => NOW },
  });
}

describe("A1-03 composition canvas settings", () => {
  it("validates custom dimensions and preserves every supported exact ratio", () => {
    const base = createCompositionCanvasDraft(studioProjectV1Fixture.compositions["composition-project"]);
    for (const ratio of COMPOSITION_ASPECT_RATIOS) {
      const draft = applyCompositionAspectRatio(base, ratio.id);
      const result = validateCompositionCanvasDraft(draft);
      expect(result.valid, ratio.id).toBe(true);
      expect(detectCompositionAspectRatio(result.value!.width, result.value!.height)).toBe(ratio.id);
    }
    expect(detectCompositionAspectRatio(127, 91)).toBe("custom");
    expect(validateCompositionCanvasDraft({
      width: "127",
      height: "91",
      backgroundMode: "color",
      backgroundColor: "#A1b2C3",
    })).toEqual({
      valid: true,
      value: { width: 127, height: 91, background: "#a1b2c3" },
      errors: {},
    });
    const boundedSquare = applyCompositionAspectRatio({
      width: "16384",
      height: "4096",
      backgroundMode: "transparent",
      backgroundColor: "#ffffff",
    }, "1:1");
    expect(boundedSquare).toMatchObject({ width: "8192", height: "8192" });
    expect(validateCompositionCanvasDraft(boundedSquare).valid).toBe(true);
  });

  it("keeps invalid draft text visible and rejects unsafe dimensions before dispatch", () => {
    const invalid = [
      { width: "0", height: "64", backgroundMode: "transparent" as const, backgroundColor: "#ffffff" },
      { width: "1.5", height: "64", backgroundMode: "transparent" as const, backgroundColor: "#ffffff" },
      { width: "16385", height: "64", backgroundMode: "transparent" as const, backgroundColor: "#ffffff" },
      { width: "16384", height: "4097", backgroundMode: "transparent" as const, backgroundColor: "#ffffff" },
      { width: "64", height: "64", backgroundMode: "color" as const, backgroundColor: "red" },
    ];
    for (const draft of invalid) expect(validateCompositionCanvasDraft(draft).valid).toBe(false);

    const { store } = runtime();
    const before = store.getSnapshot();
    const result = applyCompositionCanvasSettings(store, {
      compositionId: "composition-project",
      draft: invalid[0],
      baseline: createCompositionCanvasBaseline(before.revision, before.project.compositions["composition-project"]),
      commandId: "canvas-invalid",
      issuedAt: NOW,
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_DRAFT", revision: 0 });
    expect(store.getSnapshot()).toBe(before);
  });

  it("preserves canonical short and alpha colors when only dimensions change", () => {
    for (const background of ["#abc", "#abcd", "#11223344"] as const) {
      const composition = { ...studioProjectV1Fixture.compositions["composition-project"], background };
      const draft = createCompositionCanvasDraft(composition);
      const validation = validateCompositionCanvasDraft({ ...draft, width: "256" });
      expect(validation).toMatchObject({
        valid: true,
        value: { width: 256, height: 128, background },
      });
    }
  });

  it("contains accessors and revoked draft/composition boundaries without executing getters", () => {
    let reads = 0;
    const accessorDraft = Object.create(null) as Record<string, unknown>;
    for (const [key, value] of Object.entries({
      width: "128",
      height: "128",
      backgroundMode: "transparent",
      backgroundColor: "#ffffff",
    })) {
      Object.defineProperty(accessorDraft, key, {
        enumerable: true,
        get() {
          reads += 1;
          return value;
        },
      });
    }
    expect(() => validateCompositionCanvasDraft(accessorDraft)).not.toThrow();
    expect(validateCompositionCanvasDraft(accessorDraft)).toMatchObject({ valid: false });

    const accessorComposition = Object.create(null) as Record<string, unknown>;
    for (const [key, value] of Object.entries({ width: 128, height: 128, background: null })) {
      Object.defineProperty(accessorComposition, key, {
        enumerable: true,
        get() {
          reads += 1;
          return value;
        },
      });
    }
    expect(createCompositionCanvasDraft(accessorComposition as never)).toMatchObject({ width: "", height: "" });
    expect(createCompositionCanvasBaseline(3, accessorComposition as never)).toMatchObject({ width: 0, height: 0 });

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => validateCompositionCanvasDraft(revoked.proxy)).not.toThrow();
    expect(validateCompositionCanvasDraft(revoked.proxy)).toMatchObject({ valid: false });
    expect(() => createCompositionCanvasDraft(revoked.proxy as never)).not.toThrow();
    expect(() => createCompositionCanvasBaseline(0, revoked.proxy as never)).not.toThrow();
    expect(reads).toBe(0);
  });

  it("contains hostile store and result boundaries without leaking private errors", () => {
    const input = {
      compositionId: "composition-project",
      draft: { width: "320", height: "180", backgroundMode: "transparent" as const, backgroundColor: "#ffffff" },
      baseline: { revision: 0, width: 128, height: 128, background: null },
      commandId: "hostile-canvas-command",
      issuedAt: NOW,
    };
    const getThrows = {
      getSnapshot() { throw new Error("PRIVATE_GET_SECRET"); },
      dispatch() { throw new Error("should not dispatch"); },
    } as unknown as ProjectStore;
    const getFailure = applyCompositionCanvasSettings(getThrows, input);
    expect(getFailure).toMatchObject({ ok: false, code: "BOUNDARY_FAILED" });
    expect(JSON.stringify(getFailure)).not.toContain("PRIVATE");

    const project = structuredClone(studioProjectV1Fixture);
    const dispatchThrows = {
      getSnapshot: () => ({ project, revision: 0 }),
      dispatch() { throw new Error("PRIVATE_DISPATCH_SECRET"); },
    } as unknown as ProjectStore;
    const dispatchFailure = applyCompositionCanvasSettings(dispatchThrows, input);
    expect(dispatchFailure).toMatchObject({ ok: false, code: "BOUNDARY_FAILED" });
    expect(JSON.stringify(dispatchFailure)).not.toContain("PRIVATE");

    let resultReads = 0;
    const hostileResult = {};
    Object.defineProperty(hostileResult, "result", {
      enumerable: true,
      get() {
        resultReads += 1;
        throw new Error("PRIVATE_RESULT_SECRET");
      },
    });
    Object.defineProperty(hostileResult, "revision", { enumerable: true, value: 1 });
    const resultStore = {
      getSnapshot: () => ({ project, revision: 0 }),
      dispatch: () => hostileResult,
    } as unknown as ProjectStore;
    const resultFailure = applyCompositionCanvasSettings(resultStore, input);
    expect(resultFailure).toMatchObject({ ok: false, code: "BOUNDARY_FAILED" });
    expect(JSON.stringify(resultFailure)).not.toContain("PRIVATE");
    expect(resultReads).toBe(0);

    const revokedInput = Proxy.revocable({}, {});
    revokedInput.revoke();
    expect(() => applyCompositionCanvasSettings(dispatchThrows, revokedInput.proxy)).not.toThrow();
    expect(applyCompositionCanvasSettings(dispatchThrows, revokedInput.proxy)).toMatchObject({
      ok: false,
      code: "INVALID_DRAFT",
    });
  });

  it("accepts only a canonical matching success without traversing unrelated project or inverse data", () => {
    const input = {
      compositionId: "composition-project",
      draft: { width: "320", height: "180", backgroundMode: "transparent" as const, backgroundColor: "#ffffff" },
      baseline: { revision: 0, width: 128, height: 128, background: null },
      commandId: "fake-success-command",
      issuedAt: NOW,
    };
    const beforeProject = structuredClone(studioProjectV1Fixture);
    const resultProject = structuredClone(studioProjectV1Fixture) as StudioProjectV1 & Record<string, unknown>;
    resultProject.compositions["composition-project"].width = 320;
    resultProject.compositions["composition-project"].height = 180;
    const hugeUnrelated: Record<string, number> = {};
    for (let index = 0; index < 110_000; index += 1) hugeUnrelated[`key-${index}`] = index;
    resultProject.unrelatedHuge = hugeUnrelated;
    let unrelatedReads = 0;
    Object.defineProperty(resultProject, "unrelatedGetter", {
      enumerable: true,
      get() {
        unrelatedReads += 1;
        throw new Error("PRIVATE_PROJECT_SECRET");
      },
    });
    const success: Record<string, unknown> = {
      ok: true,
      project: resultProject,
      changedIds: { compositions: ["composition-project"] },
      warnings: [],
    };
    Object.defineProperty(success, "impact", {
      enumerable: true,
      get() {
        unrelatedReads += 1;
        throw new Error("PRIVATE_IMPACT_SECRET");
      },
    });
    Object.defineProperty(success, "inverse", {
      enumerable: true,
      get() {
        unrelatedReads += 1;
        throw new Error("PRIVATE_INVERSE_SECRET");
      },
    });
    const fakeStore = (result: unknown, revision = 1): ProjectStore => ({
      getSnapshot: () => ({ project: beforeProject, revision: 0 }),
      dispatch: () => ({ revision, result }),
    }) as unknown as ProjectStore;

    expect(applyCompositionCanvasSettings(fakeStore(success), input)).toMatchObject({
      ok: true,
      outcome: "updated",
      revision: 1,
    });
    expect(unrelatedReads).toBe(0);

    const ordinarySuccess = (project: unknown) => ({
      ok: true,
      project,
      changedIds: { compositions: ["composition-project"] },
      warnings: [],
      impact: {},
      inverse: {},
    });
    const incomplete = {
      ok: true,
      changedIds: { compositions: ["composition-project"] },
      warnings: [],
      impact: {},
      inverse: {},
    };
    expect(applyCompositionCanvasSettings(fakeStore(incomplete), input)).toMatchObject({ ok: false, code: "BOUNDARY_FAILED" });
    expect(applyCompositionCanvasSettings(fakeStore(success, 0), input)).toMatchObject({ ok: false, code: "BOUNDARY_FAILED" });

    const mismatchProject = structuredClone(studioProjectV1Fixture) as StudioProjectV1;
    mismatchProject.compositions["composition-project"].height = 180;
    mismatchProject.compositions["composition-project"].width = 319;
    expect(applyCompositionCanvasSettings(fakeStore(ordinarySuccess(mismatchProject)), input)).toMatchObject({
      ok: false,
      code: "BOUNDARY_FAILED",
    });

    let targetReads = 0;
    const accessorTarget = structuredClone(
      resultProject.compositions["composition-project"],
    ) as unknown as Record<string, unknown>;
    Object.defineProperty(accessorTarget, "width", {
      enumerable: true,
      get() {
        targetReads += 1;
        return 320;
      },
    });
    const accessorProject = structuredClone(studioProjectV1Fixture) as StudioProjectV1;
    accessorProject.compositions["composition-project"] = accessorTarget as never;
    expect(applyCompositionCanvasSettings(fakeStore(ordinarySuccess(accessorProject)), input)).toMatchObject({
      ok: false,
      code: "BOUNDARY_FAILED",
    });
    expect(targetReads).toBe(0);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => applyCompositionCanvasSettings(fakeStore(ordinarySuccess(revoked.proxy)), input)).not.toThrow();
    expect(applyCompositionCanvasSettings(fakeStore(ordinarySuccess(revoked.proxy)), input)).toMatchObject({
      ok: false,
      code: "BOUNDARY_FAILED",
    });
  });

  it("atomically applies dimensions and color through one command with undo/redo", () => {
    const { store, history } = runtime();
    const before = store.getSnapshot();
    const result = applyCompositionCanvasSettings(store, {
      compositionId: "composition-project",
      draft: { width: "320", height: "180", backgroundMode: "color", backgroundColor: "#123456" },
      baseline: createCompositionCanvasBaseline(before.revision, before.project.compositions["composition-project"]),
      commandId: "canvas-apply",
      issuedAt: NOW,
    });
    expect(result).toEqual({
      ok: true,
      outcome: "updated",
      revision: 1,
      value: { width: 320, height: 180, background: "#123456" },
    });
    expect(store.getSnapshot().project.compositions["composition-project"]).toMatchObject({
      width: 320,
      height: 180,
      background: "#123456",
    });
    expect(history.getSnapshot().undoEntries).toHaveLength(1);
    expect(history.undo()).toMatchObject({ ok: true, revision: 2 });
    expect(store.getSnapshot().project.compositions["composition-project"]).toMatchObject({
      width: 128,
      height: 128,
      background: null,
    });
    expect(history.redo()).toMatchObject({ ok: true, revision: 3 });
    expect(store.getSnapshot().project.compositions["composition-project"]).toMatchObject({
      width: 320,
      height: 180,
      background: "#123456",
    });
  });

  it("refuses a stale dirty draft instead of overwriting a concurrent canvas update", () => {
    const { store } = runtime();
    const before = store.getSnapshot();
    const baseline = createCompositionCanvasBaseline(before.revision, before.project.compositions["composition-project"]);
    store.dispatch({
      command: { type: "composition.update", compositionId: "composition-project", patch: { width: 256, height: 144 } },
      metadata: { commandId: "external-update", origin: "user", history: "record", issuedAt: NOW },
    });
    const result = applyCompositionCanvasSettings(store, {
      compositionId: "composition-project",
      draft: { width: "640", height: "480", backgroundMode: "transparent", backgroundColor: "#ffffff" },
      baseline,
      commandId: "stale-update",
      issuedAt: NOW,
    });
    expect(result).toMatchObject({ ok: false, code: "STALE_DRAFT", revision: 1 });
    expect(store.getSnapshot().project.compositions["composition-project"]).toMatchObject({ width: 256, height: 144 });
  });

  it("survives codec reload and drives the canonical projection and export frame", async () => {
    const { store } = runtime();
    const before = store.getSnapshot();
    expect(applyCompositionCanvasSettings(store, {
      compositionId: "composition-project",
      draft: { width: "320", height: "180", backgroundMode: "color", backgroundColor: "#2468ac" },
      baseline: createCompositionCanvasBaseline(before.revision, before.project.compositions["composition-project"]),
      commandId: "canvas-project-export",
      issuedAt: NOW,
    }).ok).toBe(true);

    const reloaded = projectCodec.decode(projectCodec.encode(
      structuredClone(store.getSnapshot().project) as StudioProjectV1,
    ));
    const projection = createSceneProjection({ project: reloaded, revision: 1 }, WORKSPACE);
    expect(projection.canvas).toEqual({ width: 320, height: 180, background: "#2468ac" });
    expect(projection.root).toMatchObject({
      kind: "composition",
      width: 320,
      height: 180,
      background: "#2468ac",
    });

    let exportedFrame: SceneCompositorFrame | null = null;
    let disposed = 0;
    const target: SceneCompositorTarget<object> = {
      beginFrame(frame) { exportedFrame = frame; },
      drawImage() {},
      endFrame() {},
      abortFrame() {},
    };
    const result = await renderSceneExport({
      projection,
      resolver: { resolve: () => ({}) },
      surfaceFactory: {
        create: () => ({
          target,
          encode: () => new Blob(["png"], { type: "image/png" }),
          dispose: () => { disposed += 1; },
        }),
      },
    });
    expect(exportedFrame).toEqual({
      width: 320,
      height: 180,
      background: "#2468ac",
      sampling: "nearest",
    });
    expect(result).toMatchObject({ width: 320, height: 180, background: "#2468ac", mimeType: "image/png" });
    expect(disposed).toBe(1);
  });
});
