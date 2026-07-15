import React, { useCallback, useEffect, useMemo, useRef } from "react";
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
import {
  createStudioCommandRegistry,
  getStudioWorkspace,
  type StudioCommandContext,
  type StudioCommandId,
  type StudioWorkspaceId,
} from "../../core/studio";
import { StudioHeader, useStudioNavigation } from "../studio";
import { AppMode, CanvasHandle } from "../../types";

function legacyModeForWorkspace(workspaceId: StudioWorkspaceId): AppMode {
  switch (workspaceId) {
    case "slice":
    case "compose":
      return AppMode.BUILDER;
    case "animate":
      return AppMode.ANIMATION;
    case "collision":
      return AppMode.COLLISION;
    case "export":
      return AppMode.TEMPLATE;
  }
}

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
    handleExportZip,
    handleExportGif,
    handleSetMode,
    handleUpload,
    handleLoadProject,
    handleSaveProject,
    handleNewProject,
    isLoading,
  } = controller;

  const canvasRef = useRef<CanvasHandle>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const { activeWorkspace, navigate } = useStudioNavigation();
  const hasWorkspace = !!slicerImage || !!builderCanvas;
  const activeWorkspaceDefinition = getStudioWorkspace(activeWorkspace);

  useEffect(() => {
    const legacyMode = legacyModeForWorkspace(activeWorkspace);
    if (currentMode !== legacyMode) handleSetMode(legacyMode);
  }, [activeWorkspace, currentMode, handleSetMode]);

  const commandRegistry = useMemo(() => createStudioCommandRegistry({
    newProject: () => {
      handleNewProject();
      navigate("slice");
    },
    openProject: () => projectInputRef.current?.click(),
    saveProject: handleSaveProject,
    importAsset: () => assetInputRef.current?.click(),
    undo,
    redo,
    openWorkspace: navigate,
    resetCanvas: () => canvasRef.current?.resetView(),
    openCommandPalette: () => setIsCommandPaletteOpen(true),
    openPreferences: () => setIsSettingsOpen(true),
    openHelp: () => setIsHelpOpen(true),
  }), [
    handleNewProject,
    handleSaveProject,
    navigate,
    redo,
    setIsCommandPaletteOpen,
    setIsHelpOpen,
    setIsSettingsOpen,
    undo,
  ]);

  const commandContext = useMemo<StudioCommandContext>(() => ({
    projectAvailable: true,
    busy: isLoading,
    canUndo,
    canRedo,
    canvasAvailable: hasWorkspace,
  }), [canRedo, canUndo, hasWorkspace, isLoading]);

  const executeCommand = useCallback((commandId: StudioCommandId) => {
    void commandRegistry.execute(commandId, commandContext).catch((error: unknown) => {
      console.error(`Studio command failed: ${commandId}`, error);
      showToast(
        error instanceof Error ? error.message : `Could not run ${commandId}.`,
        "error",
      );
    });
  }, [commandContext, commandRegistry, showToast]);

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
    <div
      className="h-screen w-screen flex flex-col bg-app text-textMain overflow-hidden p-2 gap-2 select-none"
      data-studio-workspace={activeWorkspace}
    >
      <input
        ref={assetInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          handleUpload(file);
          navigate("slice");
        }}
      />
      <input
        ref={projectInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) handleLoadProject(file);
        }}
      />

      <StudioHeader
        activeWorkspace={activeWorkspace}
        registry={commandRegistry}
        commandContext={commandContext}
        onExecute={executeCommand}
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
          {hasWorkspace && activeWorkspaceDefinition.capabilities.timeline === "editable" && (
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
        registry={commandRegistry}
        context={commandContext}
        onExecute={executeCommand}
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
