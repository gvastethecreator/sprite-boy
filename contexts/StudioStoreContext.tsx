import { createContext, useContext, useRef, type ReactNode } from "react";
import {
  createInteractionStore,
  createJobStore,
  createPlaybackStore,
  createWorkspaceStore,
  type InteractionStore,
  type JobStore,
  type PlaybackStore,
  type WorkspaceStore,
} from "../core/stores";

export interface StudioLocalStores {
  readonly workspace: WorkspaceStore;
  readonly interaction: InteractionStore;
  readonly jobs: JobStore;
  readonly playback: PlaybackStore;
}

const StudioStoreContext = createContext<StudioLocalStores | null>(null);

function createDefaultStores(): StudioLocalStores {
  return Object.freeze({
    workspace: createWorkspaceStore(),
    interaction: createInteractionStore(),
    jobs: createJobStore(),
    playback: createPlaybackStore(),
  });
}

export function StudioLocalStoresProvider({
  children,
  stores,
}: {
  readonly children: ReactNode;
  readonly stores?: StudioLocalStores;
}) {
  const defaultStores = useRef<StudioLocalStores | null>(null);
  if (defaultStores.current === null) defaultStores.current = createDefaultStores();
  return (
    <StudioStoreContext.Provider value={stores ?? defaultStores.current}>
      {children}
    </StudioStoreContext.Provider>
  );
}

export function useStudioLocalStores(): StudioLocalStores {
  const stores = useContext(StudioStoreContext);
  if (!stores) throw new Error("Studio local stores require StudioLocalStoresProvider.");
  return stores;
}

export function useWorkspaceStore(): WorkspaceStore {
  return useStudioLocalStores().workspace;
}

export function useInteractionStore(): InteractionStore {
  return useStudioLocalStores().interaction;
}

export function useJobStore(): JobStore {
  return useStudioLocalStores().jobs;
}

export function usePlaybackStore(): PlaybackStore {
  return useStudioLocalStores().playback;
}
