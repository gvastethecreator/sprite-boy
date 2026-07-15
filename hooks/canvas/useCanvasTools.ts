import { useState, useEffect } from "react";
import { RATIO_PRESETS } from "../domains/useBuilderLogic";
import { isEditableKeyboardTarget } from "../../utils/keyboard";

export interface Modifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export interface UseCanvasKeyboardOptions {
  readonly spacePanEnabled?: boolean;
}

/** Tracks canvas modifiers and owns Space-pan only while workspace content has focus. */
export function useCanvasKeyboard({
  spacePanEnabled = true,
}: UseCanvasKeyboardOptions = {}) {
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [modifiers, setModifiers] = useState<Modifiers>({ shift: false, ctrl: false, alt: false });

  useEffect(() => {
    if (!spacePanEnabled) setIsSpacePressed(false);

    const down = (e: KeyboardEvent) => {
      if (isEditableKeyboardTarget(e.target)) return;
      setModifiers({ shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey });
      const activeElement = document.activeElement;
      const workspaceHasFocus = activeElement instanceof Element
        && activeElement.closest("[data-studio-workspace-content]") !== null;
      if (spacePanEnabled && workspaceHasFocus && e.code === "Space") {
        e.preventDefault();
        setIsSpacePressed(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setIsSpacePressed(false);
      setModifiers({ shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey });
    };
    const resetTransientKeys = () => {
      setIsSpacePressed(false);
      setModifiers({ shift: false, ctrl: false, alt: false });
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", resetTransientKeys);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", resetTransientKeys);
    };
  }, [spacePanEnabled]);

  return { isSpacePressed, modifiers };
}

/** Manages initial canvas creation form state (width/height/ratio). */
/** Manages width/height/ratio state for the "create new canvas" form. */
export function useInitCanvasForm() {
  const [initW, setInitW] = useState("1024");
  const [initH, setInitH] = useState("1024");
  const [initRatio, setInitRatio] = useState("1:1");

  const handleRatioSelect = (ratio: string) => {
    setInitRatio(ratio);
    const preset = RATIO_PRESETS[ratio];
    if (preset) {
      setInitW(preset.w.toString());
      setInitH(preset.h.toString());
    }
  };

  return { initW, setInitW, initH, setInitH, initRatio, handleRatioSelect };
}
