import { useEffect, useSyncExternalStore } from "react";
import {
  STUDIO_FALLBACK_ROUTE,
  getLaneMount,
  getRouteForMount,
  parseStudioRouteHref,
  routeHref,
  type StudioLaneRoute,
  type StudioWorkspaceId,
} from "../../core/studio";

const FALLBACK_HREF = routeHref(STUDIO_FALLBACK_ROUTE);

type NavigationListener = () => void;

const listeners = new Set<NavigationListener>();

function readRoute(): StudioLaneRoute {
  if (typeof window === "undefined") return STUDIO_FALLBACK_ROUTE;
  return parseStudioRouteHref(window.location.hash) ?? STUDIO_FALLBACK_ROUTE;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function normalizeLocation(): void {
  if (typeof window === "undefined") return;
  if (parseStudioRouteHref(window.location.hash) !== null) return;

  // Old workspace hashes and unknown routes land on the first Items step.
  // replaceState avoids creating a history entry for an unsupported route.
  window.history.replaceState(window.history.state, "", FALLBACK_HREF);
}

function handleLocationChange(): void {
  normalizeLocation();
  notify();
}

function subscribe(listener: NavigationListener): () => void {
  const shouldAttachBrowserListeners = listeners.size === 0;
  listeners.add(listener);

  if (typeof window === "undefined") return () => listeners.delete(listener);

  if (shouldAttachBrowserListeners) {
    window.addEventListener("hashchange", handleLocationChange);
    window.addEventListener("popstate", handleLocationChange);
  }

  return () => {
    if (!listeners.delete(listener) || listeners.size > 0) return;
    window.removeEventListener("hashchange", handleLocationChange);
    window.removeEventListener("popstate", handleLocationChange);
  };
}

function getServerSnapshot(): StudioLaneRoute {
  return STUDIO_FALLBACK_ROUTE;
}

/** Push a canonical Studio route and publish it to subscribers. */
export function navigateStudioRoute(route: StudioLaneRoute): void {
  if (typeof window === "undefined") return;

  const href = routeHref(route);
  if (window.location.hash === href) return;

  window.history.pushState(window.history.state, "", href);
  notify();
}

/** Open the lane step that still mounts an old workspace editor. */
export function navigateStudioMount(workspaceId: StudioWorkspaceId): void {
  navigateStudioRoute(getRouteForMount(workspaceId));
}

export interface StudioNavigation {
  readonly route: StudioLaneRoute;
  /** Old editor mounted by the current step, or null when the step is native. */
  readonly mount: StudioWorkspaceId | null;
  readonly navigate: (route: StudioLaneRoute) => void;
  readonly navigateMount: (workspaceId: StudioWorkspaceId) => void;
}

/**
 * Shell navigation boundary. The URL hash is the only source of truth for the
 * active lane and step.
 */
export function useStudioNavigation(): StudioNavigation {
  const route = useSyncExternalStore(subscribe, readRoute, getServerSnapshot);

  useEffect(() => {
    normalizeLocation();
  }, []);

  return {
    route,
    mount: getLaneMount(route),
    navigate: navigateStudioRoute,
    navigateMount: navigateStudioMount,
  };
}
