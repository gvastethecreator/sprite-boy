import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SourceSessionSnapshot } from "../../features/slice/source/sourceSession";
import {
  createDefaultSliceGridRecipeState,
  updateSliceGridRecipeLayout,
  type SliceGridRecipeStateV1,
} from "../../features/slice/grid/gridRecipeState";
import { useSliceGridController } from "../../features/slice/grid/useSliceGridController";
import type { GridPreviewInference } from "../../features/slice/grid/gridPreviewInference";

const IDLE_SESSION: SourceSessionSnapshot = Object.freeze({
  status: "idle",
  generation: 0,
  disposed: false,
  metadata: null,
  candidateMetadata: null,
  source: null,
  error: null,
});
const SOURCE = Object.freeze({ width: 12, height: 8 });
const LEGACY = Object.freeze({
  ...SOURCE,
  src: "data:image/png;base64,g205",
  name: "g205.png",
  fileSize: 128,
});
const INFERENCE = Object.freeze({
  origin: "detected" as const,
  rows: 2,
  cols: 3,
  cells: Object.freeze(Array.from({ length: 6 }, (_, index) => Object.freeze({
    x: (index % 3) * 4,
    y: Math.floor(index / 3) * 4,
    width: 4,
    height: 4,
  }))),
  warnings: Object.freeze([]),
});
const inferPreview = vi.fn<GridPreviewInference>().mockResolvedValue(INFERENCE);

function options(overrides: Record<string, unknown> = {}) {
  return {
    generation: 7,
    committedMetadata: null,
    sessionSnapshot: IDLE_SESSION,
    legacyImage: LEGACY,
    inferPreview,
    ...overrides,
  };
}

describe("useSliceGridController integration (G2-05)", () => {
  it("switches auto/manual from one recipe state and never commits an invalid draft", async () => {
    const commits: SliceGridRecipeStateV1[] = [];
    const { result } = renderHook(() => useSliceGridController(options({
      onCommitState: (state: SliceGridRecipeStateV1) => commits.push(state),
    })));
    await act(async () => Promise.resolve());
    expect(result.current.effectiveLayout).toMatchObject({ origin: "detected", rows: 2, cols: 3 });

    act(() => result.current.setMode("manual"));
    act(() => result.current.setManualRowsInput("3"));
    act(() => result.current.setManualColsInput("4"));
    expect(result.current.recipe.layout).toEqual({ mode: "manual", rows: 3, cols: 4 });
    expect(result.current.effectiveLayout).toMatchObject({ origin: "manual", rows: 3, cols: 4 });
    expect(result.current.effectiveLayout?.cells).toHaveLength(12);

    const committedBeforeInvalid = commits.length;
    const recipeBeforeInvalid = result.current.recipe;
    act(() => result.current.setManualRowsInput("0"));
    expect(commits).toHaveLength(committedBeforeInvalid);
    expect(result.current.recipe).toBe(recipeBeforeInvalid);
    expect(result.current.manualRowsInput).toBe("0");
    expect(result.current.effectiveLayout).toMatchObject({ rows: 3, cols: 4 });

    act(() => result.current.setManualRowsInput("3"));
    act(() => result.current.setMode("auto"));
    expect(result.current.recipe.layout).toEqual({ mode: "auto" });
    expect(result.current.recipeState.manual).toEqual({ rows: 3, cols: 4 });
    expect(result.current.effectiveLayout).toMatchObject({ origin: "detected", rows: 2, cols: 3 });
    act(() => result.current.setMode("manual"));
    expect(result.current.recipe.layout).toEqual({ mode: "manual", rows: 3, cols: 4 });
  });

  it("hydrates reload state and follows host undo/redo without a second controller store", async () => {
    const initial = createDefaultSliceGridRecipeState("asset-reload", SOURCE);
    const manual = updateSliceGridRecipeLayout(initial, {
      mode: "manual",
      manual: { rows: 3, cols: 4 },
    }, SOURCE);
    const automatic = updateSliceGridRecipeLayout(manual, {
      mode: "auto",
      manual: { rows: 3, cols: 4 },
    }, SOURCE);
    const { result, rerender } = renderHook(
      ({ persistedState }) => useSliceGridController(options({ persistedState })),
      { initialProps: { persistedState: manual } },
    );
    await act(async () => Promise.resolve());
    expect(result.current.recipeState).toEqual(manual);
    expect(result.current.effectiveLayout).toMatchObject({ origin: "manual", rows: 3, cols: 4 });

    rerender({ persistedState: automatic });
    expect(result.current.recipeState).toEqual(automatic);
    expect(result.current.effectiveLayout).toMatchObject({ origin: "detected", rows: 2, cols: 3 });
    rerender({ persistedState: manual });
    expect(result.current.recipeState).toEqual(manual);
    expect(result.current.manualRowsInput).toBe("3");
    expect(result.current.manualColsInput).toBe("4");
  });

  it("initializes old hosts ephemerally and contains a rejected host transaction", async () => {
    const initialize = vi.fn();
    const rejectCommit = vi.fn(() => { throw new Error("host transaction rejected"); });
    const { result } = renderHook(() => useSliceGridController(options({
      persistedState: null,
      onInitializeState: initialize,
      onCommitState: rejectCommit,
    })));
    await act(async () => Promise.resolve());
    expect(initialize).toHaveBeenCalledOnce();
    const before = result.current.recipeState;
    act(() => result.current.setMode("manual"));
    expect(rejectCommit).toHaveBeenCalledOnce();
    expect(result.current.recipeState).toBe(before);
    expect(result.current.draft.mode).toBe("auto");
  });

  it("quarantines truthy malformed persisted state before save without requiring an edit", async () => {
    let hostState: unknown = { version: 1, recipe: null, manual: { rows: 4, cols: 4 } };
    const initialize = vi.fn((state: SliceGridRecipeStateV1) => { hostState = state; });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() => useSliceGridController(options({
      persistedState: hostState,
      onInitializeState: initialize,
    })));
    await act(async () => Promise.resolve());

    expect(initialize).toHaveBeenCalledOnce();
    expect(hostState).toBe(result.current.recipeState);
    expect(JSON.parse(JSON.stringify({ sliceGrid: hostState })).sliceGrid.recipe).toEqual(
      result.current.recipe,
    );
    expect(consoleError).not.toHaveBeenCalled();
    unmount();
    consoleError.mockRestore();
  });

  it("contains empty, null-recipe, accessor, proxy and revoked-proxy persisted payloads", async () => {
    let getterCalls = 0;
    const accessor = { version: 1, manual: { rows: 1, cols: 1 } } as Record<string, unknown>;
    Object.defineProperty(accessor, "recipe", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("persisted accessor executed");
      },
    });
    const proxied = new Proxy({ version: 1, recipe: null, manual: { rows: 1, cols: 1 } }, {});
    const revocable = Proxy.revocable({ version: 1, recipe: null, manual: { rows: 1, cols: 1 } }, {});
    revocable.revoke();
    const payloads: readonly unknown[] = [
      {},
      { version: 1, recipe: null, manual: { rows: 1, cols: 1 } },
      accessor,
      proxied,
      revocable.proxy,
    ];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const persistedState of payloads) {
      const initialize = vi.fn();
      const view = renderHook(() => useSliceGridController(options({
        persistedState,
        onInitializeState: initialize,
      })));
      await act(async () => Promise.resolve());
      expect(view.result.current.recipe.layout).toEqual({ mode: "auto" });
      expect(initialize).toHaveBeenCalledOnce();
      view.unmount();
    }
    expect(getterCalls).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
