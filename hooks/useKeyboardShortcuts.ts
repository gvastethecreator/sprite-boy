import { useEffect } from "react";
import type {
  StudioCommandId,
  StudioCommandRegistry,
} from "../core/studio";
import { isEditableKeyboardTarget } from "../utils/keyboard";

interface ShortcutsConfig {
  registry: StudioCommandRegistry;
  executeStudioCommand: (commandId: StudioCommandId) => void;
  deleteSelection: () => void;
  nudge: (dx: number, dy: number) => void;
  togglePlay: () => void;
  stepFrame: (dir: number) => void;
  closeModals: () => void;
  isModalOpen: boolean;
  activeAnimationId: string | null;
  legacyCanvasKeyboardEnabled: boolean;
}

/** Dispatches registry commands first, then scoped editor/animation shortcuts. */
export const useKeyboardShortcuts = ({
  registry,
  executeStudioCommand,
  deleteSelection,
  nudge,
  togglePlay,
  stepFrame,
  closeModals,
  isModalOpen,
  activeAnimationId,
  legacyCanvasKeyboardEnabled,
}: ShortcutsConfig) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const editable = isEditableKeyboardTarget(e.target);

      if (isModalOpen && e.key === "Escape") {
        e.preventDefault();
        closeModals();
        return;
      }

      const command = registry.findByKeyboardInput({
        code: e.code,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        editable,
      });
      if (command && !isModalOpen) {
        e.preventDefault();
        if (!e.repeat) executeStudioCommand(command.id);
        return;
      }

      if (isModalOpen || editable) return;

      // Animation Mode Shortcuts
      if (legacyCanvasKeyboardEnabled && activeAnimationId) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          stepFrame(-1);
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          stepFrame(1);
          return;
        }
        if (e.code === "Space") {
          e.preventDefault();
          if (!e.repeat) togglePlay();
          return;
        }
      }

      // Editor Mode Shortcuts (Slicer/Collision/Builder)
      if (legacyCanvasKeyboardEnabled && !activeAnimationId) {
        const multiplier = e.shiftKey ? 10 : 1;

        // Nudge
        if (e.key === "ArrowUp") {
          e.preventDefault();
          nudge(0, -1 * multiplier);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          nudge(0, 1 * multiplier);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          nudge(-1 * multiplier, 0);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          nudge(1 * multiplier, 0);
        }

        // Delete
        if (e.key === "Delete" || e.key === "Backspace") {
          deleteSelection();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    registry,
    executeStudioCommand,
    deleteSelection,
    nudge,
    togglePlay,
    stepFrame,
    closeModals,
    isModalOpen,
    activeAnimationId,
    legacyCanvasKeyboardEnabled,
  ]);
};
