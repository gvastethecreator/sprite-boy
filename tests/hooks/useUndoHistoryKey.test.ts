import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUndo } from "../../hooks/useUndo";
import { projectStateHistoryKey } from "../../utils/hostProjectPolicy";
import type { ProjectState } from "../../types";

function base(): ProjectState {
  return {
    imageMeta: null,
    builderCanvas: null,
    frames: [],
    builderSlots: {},
    builderFreeObjects: [],
    animations: [],
    builderAssets: [],
  };
}

describe("useUndo with projectStateHistoryKey", () => {
  it("does not stack history when only data URL payload content would differ by stringify cost", () => {
    const hugeA = "data:image/png;base64," + "A".repeat(50_000);
    const hugeB = "data:image/png;base64," + "B".repeat(50_000);
    // Same length + same prefix slice for fingerprint path? lengths equal; prefix after data: is same length start
    // Our key uses length + slice(5,24) — so A vs B differs.
    const { result } = renderHook(() =>
      useUndo(base(), { historyKey: projectStateHistoryKey }),
    );
    act(() => {
      result.current.set({
        ...base(),
        imageMeta: { src: hugeA, width: 1, height: 1, name: "x", fileSize: 1 },
      });
    });
    expect(result.current.canUndo).toBe(true);
    act(() => {
      result.current.set({
        ...base(),
        imageMeta: { src: hugeB, width: 1, height: 1, name: "x", fileSize: 1 },
      });
    });
    // Different payload fingerprints should still create a step, but keys stay small.
    expect(projectStateHistoryKey(result.current.state).length).toBeLessThan(2000);
    expect(result.current.canUndo).toBe(true);
  });

  it("skips history when historyKey is unchanged", () => {
    const { result } = renderHook(() =>
      useUndo(base(), { historyKey: projectStateHistoryKey }),
    );
    const next = { ...base(), frames: [{ id: 1, x: 0, y: 0, w: 1, h: 1 }] };
    act(() => result.current.set(next));
    act(() => result.current.set({ ...next }));
    expect(result.current.history.past.length).toBe(1);
  });
});
