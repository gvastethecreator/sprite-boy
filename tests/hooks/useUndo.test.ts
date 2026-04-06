import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUndo } from "../../hooks/useUndo";

describe("useUndo", () => {
  it("initializes with the given state", () => {
    const { result } = renderHook(() => useUndo({ count: 0 }));
    expect(result.current.state).toEqual({ count: 0 });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("set() pushes previous state to history", () => {
    const { result } = renderHook(() => useUndo({ count: 0 }));
    act(() => result.current.set({ count: 1 }));
    expect(result.current.state).toEqual({ count: 1 });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("set() with callback receives current state", () => {
    const { result } = renderHook(() => useUndo({ count: 5 }));
    act(() => result.current.set((prev) => ({ count: prev.count + 10 })));
    expect(result.current.state).toEqual({ count: 15 });
  });

  it("set() with identical state is a no-op (deep equality)", () => {
    const { result } = renderHook(() => useUndo({ count: 0 }));
    act(() => result.current.set({ count: 0 }));
    expect(result.current.canUndo).toBe(false);
  });

  it("undo restores previous state", () => {
    const { result } = renderHook(() => useUndo({ count: 0 }));
    act(() => result.current.set({ count: 1 }));
    act(() => result.current.set({ count: 2 }));
    act(() => result.current.undo());
    expect(result.current.state).toEqual({ count: 1 });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(true);
  });

  it("redo restores next state after undo", () => {
    const { result } = renderHook(() => useUndo({ count: 0 }));
    act(() => result.current.set({ count: 1 }));
    act(() => result.current.undo());
    act(() => result.current.redo());
    expect(result.current.state).toEqual({ count: 1 });
    expect(result.current.canRedo).toBe(false);
  });

  it("undo at the beginning is a no-op", () => {
    const { result } = renderHook(() => useUndo({ count: 0 }));
    act(() => result.current.undo());
    expect(result.current.state).toEqual({ count: 0 });
  });

  it("redo at the end is a no-op", () => {
    const { result } = renderHook(() => useUndo({ count: 0 }));
    act(() => result.current.redo());
    expect(result.current.state).toEqual({ count: 0 });
  });

  it("set() after undo clears the future", () => {
    const { result } = renderHook(() => useUndo({ count: 0 }));
    act(() => result.current.set({ count: 1 }));
    act(() => result.current.set({ count: 2 }));
    act(() => result.current.undo());
    act(() => result.current.set({ count: 99 }));
    expect(result.current.state).toEqual({ count: 99 });
    expect(result.current.canRedo).toBe(false);
  });

  it("setEphemeral does NOT push to history", () => {
    const { result } = renderHook(() => useUndo({ count: 0 }));
    act(() => result.current.set({ count: 1 }));
    act(() => result.current.setEphemeral({ count: 42 }));
    expect(result.current.state).toEqual({ count: 42 });
    // Only the set({ count: 1 }) should be in history
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.state).toEqual({ count: 0 });
    expect(result.current.canUndo).toBe(false);
  });

  it("setEphemeral with callback", () => {
    const { result } = renderHook(() => useUndo({ count: 10 }));
    act(() => result.current.setEphemeral((prev) => ({ count: prev.count * 2 })));
    expect(result.current.state).toEqual({ count: 20 });
    expect(result.current.canUndo).toBe(false);
  });

  it("respects MAX_HISTORY_STEPS (50) by dropping oldest", () => {
    const { result } = renderHook(() => useUndo(0));
    for (let i = 1; i <= 55; i++) {
      act(() => result.current.set(i));
    }
    expect(result.current.state).toBe(55);
    // Past should be capped at 50
    expect(result.current.history.past.length).toBe(50);
    // Oldest should be dropped — past[0] should be 5 (not 0..4)
    expect(result.current.history.past[0]).toBe(5);
  });

  it("multiple undo/redo cycles work correctly", () => {
    const { result } = renderHook(() => useUndo("a"));
    act(() => result.current.set("b"));
    act(() => result.current.set("c"));
    act(() => result.current.set("d"));
    // d -> c -> b -> a
    act(() => result.current.undo());
    act(() => result.current.undo());
    act(() => result.current.undo());
    expect(result.current.state).toBe("a");
    expect(result.current.canUndo).toBe(false);
    // a -> b -> c -> d
    act(() => result.current.redo());
    act(() => result.current.redo());
    act(() => result.current.redo());
    expect(result.current.state).toBe("d");
    expect(result.current.canRedo).toBe(false);
  });
});
