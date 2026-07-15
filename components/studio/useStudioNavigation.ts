import { useEffect, useSyncExternalStore } from "react";
import {
  getStudioWorkspace,
  parseStudioWorkspaceHref,
  type StudioWorkspaceId,
} from "../../core/studio";

const FALLBACK_WORKSPACE: StudioWorkspaceId = "slice";
const FALLBACK_HREF = getStudioWorkspace(FALLBACK_WORKSPACE).href;

type NavigationListener = () => void;

const listeners = new Set<NavigationListener>();

function readWorkspace(): StudioWorkspaceId {
  if (typeof window === "undefined") return FALLBACK_WORKSPACE;
  return parseStudioWorkspaceHref(window.location.hash) ?? FALLBACK_WORKSPACE;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function normalizeLocation(): void {
  if (typeof window === "undefined") return;
  if (parseStudioWorkspaceHref(window.location.hash) !== null) return;

  // Keep the current pathname/search while replacing only the invalid hash.
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

function getServerSnapshot(): StudioWorkspaceId {
  return FALLBACK_WORKSPACE;
}

/** Push a canonical Studio route and publish it to subscribers. */
export function navigateStudioWorkspace(workspaceId: StudioWorkspaceId): void {
  if (typeof window === "undefined") return;

  const href = getStudioWorkspace(workspaceId).href;
  if (window.location.hash === href) return;

  window.history.pushState(window.history.state, "", href);
  notify();
}

export interface StudioNavigation {
  readonly activeWorkspace: StudioWorkspaceId;
  readonly navigate: (workspaceId: StudioWorkspaceId) => void;
}

/**
 * Temporary shell navigation boundary. The URL hash is the only source of
 * truth until the canonical ProjectStore is mounted by the host shell.
 */
export function useStudioNavigation(): StudioNavigation {
  const activeWorkspace = useSyncExternalStore(
    subscribe,
    readWorkspace,
    getServerSnapshot,
  );

  useEffect(() => {
    normalizeLocation();
  }, []);

  return { activeWorkspace, navigate: navigateStudioWorkspace };
}
