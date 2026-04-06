import { useState, useCallback } from "react";
import {
  ToastData,
  ExportModalState,
  GenerationModalState,
  GenerationPanelState,
  ViewportState,
} from "../types";
import { uiFeedback } from "../utils/uiFeedback";

const generateId = () => Math.random().toString(36).substr(2, 9);

/** Central UI state: toasts, modals, loading, viewport, generation panel. */
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
  const [generationModal, setGenerationModal] = useState<GenerationModalState>({
    isOpen: false,
    targetSlotIndex: null,
  });
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);

  // Feature UI States (Transferred from ProjectController for cleanliness)
  const [isEyedropperActive, setIsEyedropperActive] = useState(false);
  const [eyedropperColor, setEyedropperColor] = useState<string | null>(null);
  const [isMagicWandActive, setIsMagicWandActive] = useState(false);
  const [wandTolerance, setWandTolerance] = useState(30);

  // Panel States
  const [genPanel, setGenPanel] = useState<GenerationPanelState>({
    model: "gemini-3-pro-image-preview",
    prompt: "",
    mode: "variation",
    contextSlots: [null, null, null],
  });

  const [bgPreviewBlobUrl, setBgPreviewBlobUrl] = useState<string | null>(null);

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
    setGenerationModal((prev) => ({ ...prev, isOpen: false }));
    setIsCommandPaletteOpen(false);
    setAnalysisResult(null);
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
    generationModal,
    setGenerationModal,
    analysisResult,
    setAnalysisResult,
    genPanel,
    setGenPanel,
    bgPreviewBlobUrl,
    setBgPreviewBlobUrl,
    isEyedropperActive,
    setIsEyedropperActive,
    eyedropperColor,
    setEyedropperColor,
    isMagicWandActive,
    setIsMagicWandActive,
    wandTolerance,
    setWandTolerance,
    closeAllModals,
  };
}
