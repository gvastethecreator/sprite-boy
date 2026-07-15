import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  navigateStudioWorkspace,
  useStudioNavigation,
} from "../../components/studio/useStudioNavigation";

const initialState = { source: "studio-navigation-test" };

function setHash(hash: string): void {
  window.history.replaceState(initialState, "", hash);
}

describe("useStudioNavigation", () => {
  beforeEach(() => {
    setHash("#/studio/slice");
  });

  afterEach(() => {
    setHash("#/studio/slice");
  });

  it.each([
    ["slice", "#/studio/slice"],
    ["compose", "#/studio/compose"],
    ["animate", "#/studio/animate"],
    ["collision", "#/studio/collision"],
    ["export", "#/studio/export"],
  ] as const)("reads a direct canonical route: %s", (workspace, hash) => {
    setHash(hash);
    const { result } = renderHook(() => useStudioNavigation());

    expect(result.current.activeWorkspace).toBe(workspace);
  });

  it("normalizes an invalid direct route to Slice without another history entry", async () => {
    setHash("#/studio/not-a-workspace");
    const historyLength = window.history.length;
    const { result } = renderHook(() => useStudioNavigation());

    await waitFor(() => {
      expect(result.current.activeWorkspace).toBe("slice");
      expect(window.location.hash).toBe("#/studio/slice");
    });
    expect(window.history.length).toBe(historyLength);
    expect(window.history.state).toBe(initialState);
  });

  it("pushes canonical navigation through the returned port", () => {
    const historyLength = window.history.length;
    const { result } = renderHook(() => useStudioNavigation());

    act(() => result.current.navigate("collision"));

    expect(window.location.hash).toBe("#/studio/collision");
    expect(result.current.activeWorkspace).toBe("collision");
    expect(window.history.length).toBe(historyLength + 1);
    expect(window.history.state).toBe(initialState);
  });

  it("publishes browser back/forward and hash changes", async () => {
    const { result } = renderHook(() => useStudioNavigation());

    act(() => {
      window.history.pushState(initialState, "", "#/studio/animate");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.activeWorkspace).toBe("animate");

    act(() => {
      window.location.hash = "#/studio/export";
    });
    await waitFor(() => expect(result.current.activeWorkspace).toBe("export"));
  });

  it("removes listeners on cleanup while keeping another subscriber alive", () => {
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const first = renderHook(() => useStudioNavigation());
    const second = renderHook(() => useStudioNavigation());

    first.unmount();
    act(() => {
      window.history.pushState(initialState, "", "#/studio/collision");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(second.result.current.activeWorkspace).toBe("collision");

    second.unmount();
    expect(removeEventListener).toHaveBeenCalledWith("hashchange", expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith("popstate", expect.any(Function));
    removeEventListener.mockRestore();
  });

  it("exposes the same navigation port for non-hook callers", () => {
    act(() => navigateStudioWorkspace("compose"));
    expect(window.location.hash).toBe("#/studio/compose");
  });
});
