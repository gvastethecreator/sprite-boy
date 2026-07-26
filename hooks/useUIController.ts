import { useState, useCallback } from "react";
import {
  ToastData,
  ExportModalState,
  ViewportState,
} from "../types";
import { uiFeedback } from "../utils/uiFeedback";

const generateId = () => Math.random().toString(36).substr(2, 9);

/** Central UI state: toasts, modals, loading and viewport. */
export function useUIController() {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string>("Processing...");

  // Global Canvas Viewport State (Camera)
  const [viewport, setViewport] = useState<ViewportState>({
    scale: 1,
    offset: { x: 0, y: 0 },
  });

  // Modals & Panels State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [exportModal, setExportModal] = useState<ExportModalState>({ isOpen: false, type: null });
  // Feature UI States (Transferred from ProjectController for cleanliness)
  const [isEyedropperActive, setIsEyedropperActive] = useState(false);
  const [isMagicWandActive, setIsMagicWandActive] = useState(false);
  const [wandTolerance, setWandTolerance] = useState(30);

  // Toast Logic
  const showToast = useCallback(
    (msg: string, type: "success" | "error" | "info" = "info", soundEnabled: boolean = true) => {
      const id = generateId();
      setToasts((prev) => [...prev, { id, msg, type }]);
      setTimeout(() => removeToast(id), 3000);
      if (soundEnabled) {
        uiFeedback.play(type === "success" ? "success" : type === "error" ? "error" : "neutral");
      }
    },
    [],
  );

  const removeToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const closeAllModals = () => {
    setIsSettingsOpen(false);
    setIsHelpOpen(false);
    setExportModal((prev) => ({ ...prev, isOpen: false }));
    setIsCommandPaletteOpen(false);
    setIsEyedropperActive(false);
  };

  return {
    toasts,
    showToast,
    removeToast,
    isLoading,
    setIsLoading,
    loadingMessage,
    setLoadingMessage,
    viewport,
    setViewport,
    isSettingsOpen,
    setIsSettingsOpen,
    isHelpOpen,
    setIsHelpOpen,
    isCommandPaletteOpen,
    setIsCommandPaletteOpen,
    exportModal,
    setExportModal,
    isEyedropperActive,
    setIsEyedropperActive,
    isMagicWandActive,
    setIsMagicWandActive,
    wandTolerance,
    setWandTolerance,
    closeAllModals,
  };
}
