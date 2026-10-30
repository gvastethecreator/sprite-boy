import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  navigateStudioMount,
  navigateStudioRoute,
  useStudioNavigation,
} from "../../components/studio/useStudioNavigation";
import { STUDIO_LANE_ROUTES, routeHref } from "../../core/studio";

const initialState = { source: "studio-navigation-test" };

function setHash(hash: string): void {
  window.history.replaceState(initialState, "", hash);
}

describe("useStudioNavigation", () => {
  beforeEach(() => {
    setHash("#/studio/items/source");
  });

  afterEach(() => {
    setHash("#/studio/items/source");
  });

  it.each(STUDIO_LANE_ROUTES.map((route) => [routeHref(route), route] as const))(
    "reads a direct canonical route: %s",
    (hash, route) => {
      setHash(hash);
      const { result } = renderHook(() => useStudioNavigation());

      expect(result.current.route).toEqual(route);
    },
  );

  it.each([
    "#/studio/not-a-lane",
    "#/studio/slice",
    "#/studio/compose",
    "#/studio/export",
    "#/studio/items/registration",
    "#/",
  ])("normalizes %j to Items source without another history entry", async (hash) => {
    setHash(hash);
    const historyLength = window.history.length;
    const { result } = renderHook(() => useStudioNavigation());

    await waitFor(() => {
      expect(result.current.route).toEqual({ tab: "items", step: "source" });
      expect(window.location.hash).toBe("#/studio/items/source");
    });
    expect(window.history.length).toBe(historyLength);
    expect(window.history.state).toBe(initialState);
  });

  it("pushes canonical navigation through the returned port", () => {
    const historyLength = window.history.length;
    const { result } = renderHook(() => useStudioNavigation());

    act(() => result.current.navigate({ tab: "animation", step: "collision" }));

    expect(window.location.hash).toBe("#/studio/animation/collision");
    expect(result.current.route).toEqual({ tab: "animation", step: "collision" });
    expect(result.current.mount).toBe("collision");
    expect(window.history.length).toBe(historyLength + 1);
    expect(window.history.state).toBe(initialState);
  });

  it("reports no mounted editor on a native step", () => {
    const { result } = renderHook(() => useStudioNavigation());
    expect(result.current.mount).toBeNull();

    act(() => result.current.navigate({ tab: "library", step: null }));
    expect(result.current.mount).toBeNull();
  });

  it("does not push a duplicate entry for the current route", () => {
    const { result } = renderHook(() => useStudioNavigation());
    const historyLength = window.history.length;

    act(() => result.current.navigate({ tab: "items", step: "source" }));

    expect(window.history.length).toBe(historyLength);
  });

  it("publishes browser back/forward and hash changes", async () => {
    const { result } = renderHook(() => useStudioNavigation());

    act(() => {
      window.history.pushState(initialState, "", "#/studio/grid/review");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.route).toEqual({ tab: "grid", step: "review" });

    act(() => {
      window.location.hash = "#/studio/tileset/map";
    });
    await waitFor(() => expect(result.current.route).toEqual({ tab: "tileset", step: "map" }));
  });

  it("removes listeners on cleanup while keeping another subscriber alive", () => {
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const first = renderHook(() => useStudioNavigation());
    const second = renderHook(() => useStudioNavigation());

    first.unmount();
    act(() => {
      window.history.pushState(initialState, "", "#/studio/animation/timing");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(second.result.current.route).toEqual({ tab: "animation", step: "timing" });

    second.unmount();
    expect(removeEventListener).toHaveBeenCalledWith("hashchange", expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith("popstate", expect.any(Function));
    removeEventListener.mockRestore();
  });

  it("exposes the same navigation ports for non-hook callers", () => {
    act(() => navigateStudioRoute({ tab: "tileset", step: "tiles" }));
    expect(window.location.hash).toBe("#/studio/tileset/tiles");

    act(() => navigateStudioMount("compose"));
    expect(window.location.hash).toBe("#/studio/items/sheet");

    act(() => navigateStudioMount("slice"));
    expect(window.location.hash).toBe("#/studio/grid/source");
  });
});
