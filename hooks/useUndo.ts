import { useState, useCallback } from "react";

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

const MAX_HISTORY_STEPS = 50;

export interface UseUndoOptions<T> {
  /**
   * Optional equality key. When provided, history stacking skips
   * JSON.stringify of the full value (critical when T holds image payloads).
   */
  historyKey?: (value: T) => string;
}

/** Generic undo/redo hook with bounded history (max 50 steps). */
export function useUndo<T>(initialPresent: T, options?: UseUndoOptions<T>) {
  const historyKey = options?.historyKey;
  const [state, setState] = useState<HistoryState<T>>({
    past: [],
    present: initialPresent,
    future: [],
  });

  const canUndo = state.past.length > 0;
  const canRedo = state.future.length > 0;

  const undo = useCallback(() => {
    setState((currentState) => {
      if (currentState.past.length === 0) return currentState;

      const previous = currentState.past[currentState.past.length - 1];
      const newPast = currentState.past.slice(0, currentState.past.length - 1);

      return {
        past: newPast,
        present: previous,
        future: [currentState.present, ...currentState.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setState((currentState) => {
      if (currentState.future.length === 0) return currentState;

      const next = currentState.future[0];
      const newFuture = currentState.future.slice(1);

      return {
        past: [...currentState.past, currentState.present],
        present: next,
        future: newFuture,
      };
    });
  }, []);

  const set = useCallback((newPresent: T | ((curr: T) => T)) => {
    setState((currentState) => {
      const value = newPresent instanceof Function ? newPresent(currentState.present) : newPresent;

      if (historyKey) {
        if (historyKey(value) === historyKey(currentState.present)) return currentState;
      } else if (Object.is(value, currentState.present)) {
        return currentState;
      } else if (
        // Default deep equality for small values only; ProjectState must pass historyKey
        // so multi-MB image payloads are never JSON.stringified for history.
        typeof value === "object" &&
        value !== null &&
        typeof currentState.present === "object" &&
        currentState.present !== null &&
        JSON.stringify(value) === JSON.stringify(currentState.present)
      ) {
        return currentState;
      }

      const newPast = [...currentState.past, currentState.present];
      if (newPast.length > MAX_HISTORY_STEPS) {
        newPast.shift();
      }

      return {
        past: newPast,
        present: value,
        future: [],
      };
    });
  }, [historyKey]);

  const setEphemeral = useCallback((newPresent: T | ((curr: T) => T)) => {
    setState((currentState) => {
      const value = newPresent instanceof Function ? newPresent(currentState.present) : newPresent;
      return {
        ...currentState,
        present: value,
      };
    });
  }, []);

  return {
    state: state.present,
    set,
    setEphemeral,
    undo,
    redo,
    canUndo,
    canRedo,
    history: state,
  };
}
