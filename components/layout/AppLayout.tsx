import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
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
import { StudioDialog, StudioHeader, StudioPanel, useStudioNavigation } from "../studio";
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

const COMPACT_STUDIO_QUERY = "(max-width: 1279px)";

function useCompactStudioLayout(): boolean {
  const readMatch = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(COMPACT_STUDIO_QUERY).matches
      : false;
  const [isCompact, setCompact] = useState(readMatch);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(COMPACT_STUDIO_QUERY);
    const update = () => setCompact(query.matches);
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener?.(update);
    return () => query.removeListener?.(update);
  }, []);

  return isCompact;
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
  const [compactPanel, setCompactPanel] = useState<"tools" | "properties" | null>(null);
  const isCompactLayout = useCompactStudioLayout();
  const hasWorkspace = !!slicerImage || !!builderCanvas;
  const activeWorkspaceDefinition = getStudioWorkspace(activeWorkspace);

  useEffect(() => {
    const legacyMode = legacyModeForWorkspace(activeWorkspace);
    if (currentMode !== legacyMode) handleSetMode(legacyMode);
  }, [activeWorkspace, currentMode, handleSetMode]);

  useEffect(() => {
    setCompactPanel(null);
  }, [activeWorkspace, isCompactLayout]);

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
      setCompactPanel(null);
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
      compactPanel !== null ||
      !!analysisResult,
    activeAnimationId,
  });

  return (
    <div
      className="h-dvh w-screen flex flex-col bg-app text-textMain overflow-hidden p-1 gap-1 select-none sm:p-2 sm:gap-2"
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

      {hasWorkspace && isCompactLayout && (
        <div
          role="toolbar"
          aria-label="Compact Studio panels"
          className="flex h-9 shrink-0 items-center justify-between rounded-md border border-border/30 bg-panel px-2 xl:hidden"
        >
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={compactPanel === "tools"}
            onClick={() => setCompactPanel("tools")}
            className="inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-xs font-medium text-textMuted hover:bg-white/5 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <PanelLeftOpen size={14} aria-hidden="true" />
            Tools
          </button>
          <span className="truncate px-3 text-[10px] font-medium uppercase tracking-wider text-textMuted/70">
            {activeWorkspaceDefinition.label} workspace
          </span>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={compactPanel === "properties"}
            onClick={() => setCompactPanel("properties")}
            className="inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-xs font-medium text-textMuted hover:bg-white/5 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Properties
            <PanelRightOpen size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="flex-1 flex min-h-0 gap-2">
        {hasWorkspace && !isCompactLayout && (
          <StudioPanel
            label="Tools"
            variant="sidebar"
            className="hidden w-[280px] shrink-0 animate-fade-in rounded-panel border-border/20 xl:flex"
          >
            <LeftSidebar />
          </StudioPanel>
        )}

        <div className="flex-1 flex flex-col min-w-0 gap-2">
          <div className="flex-1 relative overflow-hidden bg-workspace rounded-panel border border-border/20">
            <CanvasArea ref={canvasRef} />
          </div>
          {hasWorkspace && activeWorkspaceDefinition.capabilities.timeline === "editable" && (
            <TimelinePanel />
          )}
        </div>

        {hasWorkspace && !isCompactLayout && (
          <StudioPanel
            label="Properties"
            variant="sidebar"
            className="hidden w-[280px] shrink-0 animate-fade-in rounded-panel border-border/20 xl:flex"
          >
            <RightSidebar />
          </StudioPanel>
        )}
      </div>

      <StudioDialog
        isOpen={isCompactLayout && compactPanel !== null}
        onClose={() => setCompactPanel(null)}
        ariaLabel={compactPanel === "tools" ? "Tools panel" : "Properties panel"}
        backdropClassName="!items-stretch !justify-start !p-0 !pt-0 bg-black/70"
        panelClassName="!h-dvh !max-h-dvh !max-w-[360px] !rounded-none !border-y-0 !border-l-0"
      >
        {compactPanel === "tools" ? (
          <StudioPanel
            label="Tools"
            variant="drawer"
            onClose={() => setCompactPanel(null)}
            className="h-full border-0"
          >
            <LeftSidebar />
          </StudioPanel>
        ) : compactPanel === "properties" ? (
          <StudioPanel
            label="Properties"
            variant="drawer"
            onClose={() => setCompactPanel(null)}
            className="h-full border-0"
          >
            <RightSidebar />
          </StudioPanel>
        ) : null}
      </StudioDialog>

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
