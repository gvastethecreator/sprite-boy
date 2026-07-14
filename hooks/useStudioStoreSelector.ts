import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type {
  DeepReadonly,
  InteractionState,
  InteractionStore,
  JobStore,
  JobStoreState,
  PlaybackState,
  PlaybackStore,
  ProjectStore,
  ProjectStoreState,
  WorkspaceState,
  WorkspaceStore,
} from "../core/stores";

export type StoreSelectorEquality<TSelection> = (
  previous: TSelection,
  next: TSelection,
) => boolean;

interface ReadableStore<TState> {
  getSnapshot(): DeepReadonly<TState>;
  subscribe(listener: () => void): () => void;
}

interface SelectionInstance<TSelection> {
  hasValue: boolean;
  value: TSelection | undefined;
}

function useConcreteStoreSelector<TState, TSelection>(
  store: ReadableStore<TState>,
  selector: (state: DeepReadonly<TState>) => TSelection,
  equality: StoreSelectorEquality<TSelection>,
): TSelection {
  const instanceRef = useRef<SelectionInstance<TSelection>>({
    hasValue: false,
    value: undefined,
  });
  const getSelection = useMemo(() => {
    let hasMemo = false;
    let memoizedSnapshot: DeepReadonly<TState>;
    let memoizedSelection: TSelection;

    return (): TSelection => {
      const nextSnapshot = store.getSnapshot();
      if (!hasMemo) {
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;
        const nextSelection = selector(nextSnapshot);
        const committed = instanceRef.current;
        if (
          committed.hasValue &&
          equality(committed.value as TSelection, nextSelection)
        ) {
          memoizedSelection = committed.value as TSelection;
          return memoizedSelection;
        }
        memoizedSelection = nextSelection;
        return nextSelection;
      }

      if (Object.is(memoizedSnapshot, nextSnapshot)) return memoizedSelection;
      const nextSelection = selector(nextSnapshot);
      if (equality(memoizedSelection, nextSelection)) {
        memoizedSnapshot = nextSnapshot;
        return memoizedSelection;
      }
      memoizedSnapshot = nextSnapshot;
      memoizedSelection = nextSelection;
      return nextSelection;
    };
  }, [equality, selector, store]);

  const selection = useSyncExternalStore(store.subscribe, getSelection, getSelection);
  useEffect(() => {
    instanceRef.current.hasValue = true;
    instanceRef.current.value = selection;
  }, [selection]);
  return selection;
}

const objectIs: StoreSelectorEquality<unknown> = Object.is;

export function useProjectStoreSelector<TSelection>(
  store: ProjectStore,
  selector: (state: DeepReadonly<ProjectStoreState>) => TSelection,
  equality: StoreSelectorEquality<TSelection> = objectIs,
): TSelection {
  return useConcreteStoreSelector(store, selector, equality);
}

export function useWorkspaceStoreSelector<TSelection>(
  store: WorkspaceStore,
  selector: (state: DeepReadonly<WorkspaceState>) => TSelection,
  equality: StoreSelectorEquality<TSelection> = objectIs,
): TSelection {
  return useConcreteStoreSelector(store, selector, equality);
}

export function useInteractionStoreSelector<TSelection>(
  store: InteractionStore,
  selector: (state: DeepReadonly<InteractionState>) => TSelection,
  equality: StoreSelectorEquality<TSelection> = objectIs,
): TSelection {
  return useConcreteStoreSelector(store, selector, equality);
}

export function useJobStoreSelector<TSelection>(
  store: JobStore,
  selector: (state: DeepReadonly<JobStoreState>) => TSelection,
  equality: StoreSelectorEquality<TSelection> = objectIs,
): TSelection {
  return useConcreteStoreSelector(store, selector, equality);
}

export function usePlaybackStoreSelector<TSelection>(
  store: PlaybackStore,
  selector: (state: DeepReadonly<PlaybackState>) => TSelection,
  equality: StoreSelectorEquality<TSelection> = objectIs,
): TSelection {
  return useConcreteStoreSelector(store, selector, equality);
}
