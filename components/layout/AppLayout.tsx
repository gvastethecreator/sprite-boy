import React, { useRef } from "react";
import Header from "./Header";
import LeftSidebar from "./LeftSidebar";
import RightSidebar from "./RightSidebar";
import CanvasArea from "../canvas/CanvasArea";
import TimelinePanel from "./TimelinePanel";
import ExportModal from "../overlays/ExportModal";
import SettingsModal from "../overlays/SettingsModal";
import HelpModal from "../overlays/HelpModal";
import ToastContainer from "../overlays/ToastContainer";
import CommandPalette from "../overlays/CommandPalette";
import GenerationModal from "../overlays/GenerationModal";
import AnalysisModal from "../overlays/AnalysisModal";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useProject } from "../../contexts/ProjectContext";
import { AppMode, CanvasHandle } from "../../types";

const AppLayout: React.FC = () => {
  const controller = useProject();
  const {
    preferences,
    setPreferences,
    isSettingsOpen,
    setIsSettingsOpen,
    isHelpOpen,
    setIsHelpOpen,
    isCommandPaletteOpen,
    setIsCommandPaletteOpen,
    commands,
    currentMode,
    toasts,
    removeToast,
    slicerImage,
    frames,
    activeAnimationId,
    isPlaying,
    setIsPlaying,
    exportModal,
    selectedIndex,
    builderCanvas,
    undo,
    redo,
    canUndo,
    canRedo,
    handleUpdateFrame,
    handleStepFrame,
    handleGenerateCode,
    showToast,
    handleDeleteSelection,
    generationModal,
    analysisResult,
    setAnalysisResult,
    handleAnalyzeSheet,
    handleExportZip,
    handleExportGif,
  } = controller;

  const canvasRef = useRef<CanvasHandle>(null);
  const hasWorkspace = !!slicerImage || !!builderCanvas;

  useKeyboardShortcuts({
    undo,
    redo,
    deleteSelection: handleDeleteSelection,
    nudge: (dx: number, dy: number) => {
      if (selectedIndex !== null)
        handleUpdateFrame(frames[selectedIndex].id, {
          x: frames[selectedIndex].x + dx,
          y: frames[selectedIndex].y + dy,
        });
    },
    copyHitboxes: () => {},
    pasteHitboxes: () => {},
    togglePlay: () => setIsPlaying(!isPlaying),
    stepFrame: handleStepFrame,
    toggleCommandPalette: () => setIsCommandPaletteOpen(!isCommandPaletteOpen),
    resetView: () => canvasRef.current?.resetView(),
    closeModals: () => {
      controller.closeAllModals();
    },
    currentMode,
    canUndo,
    canRedo,
    isModalOpen:
      isSettingsOpen ||
      isHelpOpen ||
      exportModal.isOpen ||
      generationModal.isOpen ||
      isCommandPaletteOpen ||
      !!analysisResult,
    activeAnimationId,
  });

  return (
    <div className="h-screen w-screen flex flex-col bg-app text-textMain overflow-hidden p-2 gap-2 select-none">
      <Header
        onAnalyzeSheet={async () => {
          try {
            const hasKey = await (window as any).aistudio?.hasSelectedApiKey();
            if (!hasKey) {
              await (window as any).aistudio?.openSelectKey();
            }
          } catch (e) {
            console.warn("API Key selection skipped or failed", e);
          }
          const b = await canvasRef.current?.exportSnapshot(false);
          if (b) handleAnalyzeSheet(b);
        }}
      />

      <div className="flex-1 flex min-h-0 gap-2">
        {hasWorkspace && (
          <div className="w-[280px] bg-panel rounded-panel flex flex-col shrink-0 border border-border/20 overflow-hidden animate-fade-in">
            <LeftSidebar />
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0 gap-2">
          <div className="flex-1 relative overflow-hidden bg-workspace rounded-panel border border-border/20">
            <CanvasArea ref={canvasRef} />
          </div>
          {hasWorkspace && currentMode !== AppMode.BUILDER && (
            <TimelinePanel />
          )}
        </div>

        {hasWorkspace && (
          <div className="w-[280px] bg-panel rounded-panel flex flex-col shrink-0 border border-border/20 overflow-hidden animate-fade-in">
            <RightSidebar />
          </div>
        )}
      </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        commands={commands}
      />
      <ExportModal
        onGenerateCode={handleGenerateCode}
        onExportPng={async (g) => {
          const b = await canvasRef.current?.exportSnapshot(g);
          if (b) {
            const u = URL.createObjectURL(b);
            const l = document.createElement("a");
            l.href = u;
            l.download = "export.png";
            l.click();
            URL.revokeObjectURL(u);
          }
        }}
        onExportZip={() => handleExportZip(canvasRef.current)}
        onExportGif={(aid) => handleExportGif(aid, canvasRef.current)}
        onCopyCode={(c) => {
          navigator.clipboard.writeText(c);
          showToast("Copied!", "success");
        }}
      />
      <GenerationModal />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        preferences={preferences}
        onUpdatePreferences={setPreferences}
      />
      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
      <AnalysisModal
        isOpen={!!analysisResult}
        onClose={() => setAnalysisResult(null)}
        analysisResult={analysisResult}
      />
    </div>
  );
};

export default AppLayout;
