import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { createJobRunner, type JobRunner, type TerminalJobSnapshot } from "../core/processing";
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

export type StudioJobRetryAction = (
  job: TerminalJobSnapshot,
) => boolean | Promise<boolean>;

interface StudioStoreContextValue {
  readonly stores: StudioLocalStores;
  readonly jobRunner: JobRunner;
  readonly retryJob: StudioJobRetryAction | null;
}

const StudioStoreContext = createContext<StudioStoreContextValue | null>(null);

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
  jobRunner,
  retryJob = null,
}: {
  readonly children: ReactNode;
  readonly stores?: StudioLocalStores;
  readonly jobRunner?: JobRunner;
  readonly retryJob?: StudioJobRetryAction | null;
}) {
  const defaultStores = useRef<StudioLocalStores | null>(null);
  if (defaultStores.current === null) defaultStores.current = createDefaultStores();
  const activeStores = stores ?? defaultStores.current;
  const activeRunner = useMemo(
    () => jobRunner ?? createJobRunner({ store: activeStores.jobs }),
    [activeStores.jobs, jobRunner],
  );
  useEffect(() => {
    if (jobRunner) return;
    return () => activeRunner.dispose();
  }, [activeRunner, jobRunner]);
  const value = useMemo<StudioStoreContextValue>(() => Object.freeze({
    stores: activeStores,
    jobRunner: activeRunner,
    retryJob,
  }), [activeRunner, activeStores, retryJob]);
  return (
    <StudioStoreContext.Provider value={value}>
      {children}
    </StudioStoreContext.Provider>
  );
}

export function useStudioLocalStores(): StudioLocalStores {
  const stores = useContext(StudioStoreContext);
  if (!stores) throw new Error("Studio local stores require StudioLocalStoresProvider.");
  return stores.stores;
}

export function useStudioJobRunner(): JobRunner {
  const runtime = useContext(StudioStoreContext);
  if (!runtime) throw new Error("Studio jobs require StudioLocalStoresProvider.");
  return runtime.jobRunner;
}

export function useStudioJobRetryAction(): StudioJobRetryAction | null {
  const runtime = useContext(StudioStoreContext);
  if (!runtime) throw new Error("Studio jobs require StudioLocalStoresProvider.");
  return runtime.retryJob;
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
