
import { useState, useCallback } from 'react';

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

const MAX_HISTORY_STEPS = 50; 

export function useUndo<T>(initialPresent: T) {
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
      
      // DEEP EQUALITY CHECK (Simplified for project state objects)
      if (JSON.stringify(value) === JSON.stringify(currentState.present)) return currentState;

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
  }, []);
  
  const setEphemeral = useCallback((newPresent: T | ((curr: T) => T)) => {
      setState((currentState) => {
          const value = newPresent instanceof Function ? newPresent(currentState.present) : newPresent;
          return {
              ...currentState,
              present: value
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
    history: state 
  };
}
