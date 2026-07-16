import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import LeftSidebar from "./LeftSidebar";
import RightSidebar from "./RightSidebar";
import CanvasArea from "../canvas/CanvasArea";
import TimelinePanel from "./TimelinePanel";
import SettingsModal from "../overlays/SettingsModal";
import HelpModal from "../overlays/HelpModal";
import ToastContainer from "../overlays/ToastContainer";
import CommandPalette from "../overlays/CommandPalette";
import GenerationModal from "../overlays/GenerationModal";
import AnalysisModal from "../overlays/AnalysisModal";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useProject } from "../../contexts/ProjectContext";
import { useCanonicalProject } from "../../contexts/CanonicalProjectContext";
import {
  useJobStore,
  useStudioJobRetryAction,
  useStudioJobRunner,
} from "../../contexts/StudioStoreContext";
import { createJobCenterSummarySelector } from "../../core/stores";
import { useJobStoreSelector, useProjectStoreSelector } from "../../hooks/useStudioStoreSelector";
import {
  createStudioCommandRegistry,
  getStudioWorkspace,
  resolveStudioWorkspaceState,
  type StudioCommandContext,
  type StudioCommandId,
  type StudioWorkspaceId,
} from "../../core/studio";
import {
  StudioDialog,
  StudioHeader,
  JobCenter,
  StudioPanel,
  StudioWorkspaceStateView,
  useStudioNavigation,
} from "../studio";
import { AppMode, CanvasHandle } from "../../types";
import SliceSourceDropzone from "../../features/slice/source/SliceSourceDropzone";
import SliceSourceActions from "../../features/slice/source/SliceSourceActions";
import SliceSourceResetDialog from "../../features/slice/source/SliceSourceResetDialog";
import {
  SliceSourceCanvasFrame,
  SliceSourcePreview,
} from "../../features/slice/source/SliceSourcePreview";
import { useSliceSourceSession } from "../../features/slice/source/useSourceSession";
import { isSliceSourceSignalAborted } from "../../hooks/useProjectController";
import type {
  SourceReadyMetadata,
  SourceSessionError,
  SourceSessionSnapshot,
} from "../../features/slice/source/sourceSession";
import { useSliceGridController } from "../../features/slice/grid/useSliceGridController";
import ComposeBootstrapWorkspace from "../../features/compose/project/ComposeBootstrapWorkspace";
import CompositionCanvasSettingsInspector from "../../features/compose/canvasSettings/CompositionCanvasSettingsInspector";

const LEGACY_MODE_BY_WORKSPACE = {
  slice: AppMode.BUILDER,
  compose: AppMode.BUILDER,
  animate: AppMode.ANIMATION,
  collision: AppMode.COLLISION,
  export: AppMode.TEMPLATE,
} as const satisfies Record<StudioWorkspaceId, AppMode>;

const COMPACT_STUDIO_QUERY = "(max-width: 1279px)";
const ExportModal = React.lazy(() => import("../overlays/ExportModal"));

interface StudioShellError {
  readonly workspaceId: StudioWorkspaceId;
  readonly commandId: StudioCommandId;
  readonly message: string;
}

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
  const canonical = useCanonicalProject();
  const canonicalProject = useProjectStoreSelector(canonical.store, (state) => state.project);
  const canonicalHistory = useSyncExternalStore(
    canonical.history.subscribe,
    canonical.history.getSnapshot,
    canonical.history.getSnapshot,
  );
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
    setExportModal,
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
    clearLegacyCanvasInteractionState,
    handleUpload,
    handleLoadProject,
    handleSaveProject,
    handleNewProject,
    handleResetSliceSource,
    isLoading,
    loadingMessage,
    animations,
    sliceGridState,
    initializeSliceGridState,
    commitSliceGridState,
  } = controller;

  const canvasRef = useRef<CanvasHandle>(null);
  const workspaceContentRef = useRef<HTMLDivElement>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const replaceSourceTriggerRef = useRef<HTMLButtonElement>(null);
  const retrySourceTriggerRef = useRef<HTMLButtonElement>(null);
  const resetSourceTriggerRef = useRef<HTMLButtonElement>(null);
  const dropzoneBrowseButtonRef = useRef<HTMLButtonElement>(null);
  const sourcePickerReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const focusDropzoneAfterResetRef = useRef(false);
  const { activeWorkspace, navigate } = useStudioNavigation();
  const [compactPanel, setCompactPanel] = useState<"tools" | "properties" | null>(null);
  const [isJobCenterOpen, setJobCenterOpen] = useState(false);
  const [studioError, setStudioError] = useState<StudioShellError | null>(null);
  const [isSourceCommitting, setSourceCommitting] = useState(false);
  const [isResetSourceDialogOpen, setResetSourceDialogOpen] = useState(false);
  const [committedSourceMetadata, setCommittedSourceMetadata] =
    useState<SourceReadyMetadata | null>(null);
  const [sliceGridSourceGeneration, setSliceGridSourceGeneration] = useState(0);
  const [sourceActionError, setSourceActionError] = useState<SourceSessionError | null>(null);
  const sourceImportGenerationRef = useRef(0);
  const sourceCommitControllerRef = useRef<AbortController | null>(null);
  const canonicalNavigationProjectRef = useRef<string | null>(null);
  const [composeImportRequestToken, setComposeImportRequestToken] = useState(0);
  const [composeImportBusy, setComposeImportBusy] = useState(false);
  const {
    snapshot: sourceSessionSnapshot,
    select: selectSourceSession,
    retry: retrySourceSession,
    reset: resetSourceSession,
    getBlob: getSourceBlob,
  } = useSliceSourceSession();
  const sliceGridController = useSliceGridController({
    generation: sliceGridSourceGeneration,
    committedMetadata: committedSourceMetadata,
    sessionSnapshot: sourceSessionSnapshot,
    legacyImage: slicerImage,
    persistedState: sliceGridState,
    onInitializeState: initializeSliceGridState,
    onCommitState: commitSliceGridState,
  });
  const canonicalSliceSourceAvailable = sliceGridController.sourceDimensions !== null;
  const canonicalSliceExportSourceOnly =
    activeWorkspace === "export" && canonicalSliceSourceAvailable;
  const canonicalCanvasOwnership =
    activeWorkspace === "slice" || canonicalSliceExportSourceOnly;
  const isCompactLayout = useCompactStudioLayout();
  const jobStore = useJobStore();
  const jobRunner = useStudioJobRunner();
  const retryJob = useStudioJobRetryAction();
  const selectJobSummary = useMemo(createJobCenterSummarySelector, []);
  const jobSummary = useJobStoreSelector(jobStore, selectJobSummary);
  const hasWorkspace = !!slicerImage || !!builderCanvas;
  const canonicalCompositionId = canonicalProject.workspace.selectedCompositionId;
  const canonicalComposition = canonicalCompositionId
    ? canonicalProject.compositions[canonicalCompositionId]
    : undefined;
  const showLegacyPanels = hasWorkspace && activeWorkspace !== "compose";
  const showComposeProperties = activeWorkspace === "compose" && Boolean(canonicalComposition);
  const hasStudioPanels = showLegacyPanels || showComposeProperties;
  const activeWorkspaceDefinition = getStudioWorkspace(activeWorkspace);

  useEffect(() => {
    if (canonical.persistenceState === "loading") return;
    if (canonicalNavigationProjectRef.current !== canonicalProject.id) {
      canonicalNavigationProjectRef.current = canonicalProject.id;
      const restored = canonicalProject.workspace.activeWorkspace;
      if (restored && restored !== "assets" && restored !== activeWorkspace) navigate(restored);
      return;
    }
    if (canonicalProject.workspace.activeWorkspace !== activeWorkspace) {
      canonical.setActiveWorkspace(activeWorkspace);
    }
  }, [
    activeWorkspace,
    canonical,
    canonical.persistenceState,
    canonicalProject.id,
    canonicalProject.workspace.activeWorkspace,
    navigate,
  ]);

  useEffect(() => {
    if (canonicalCanvasOwnership) clearLegacyCanvasInteractionState();
  }, [canonicalCanvasOwnership, clearLegacyCanvasInteractionState]);

  useEffect(() => {
    const legacyMode = LEGACY_MODE_BY_WORKSPACE[activeWorkspace];
    if (currentMode !== legacyMode) handleSetMode(legacyMode);
  }, [activeWorkspace, currentMode, handleSetMode]);

  useEffect(() => {
    setCompactPanel(null);
    setStudioError(null);
  }, [activeWorkspace, isCompactLayout]);

  useEffect(() => {
    workspaceContentRef.current?.focus({ preventScroll: true });
  }, [activeWorkspace]);

  const cancelSourceCommit = useCallback((): void => {
    sourceCommitControllerRef.current?.abort();
    sourceCommitControllerRef.current = null;
    setSourceCommitting(false);
  }, []);

  const restoreSourcePickerFocus = useCallback((): void => {
    const target = sourcePickerReturnFocusRef.current;
    sourcePickerReturnFocusRef.current = null;
    queueMicrotask(() => target?.focus({ preventScroll: true }));
  }, []);

  const openSourcePicker = useCallback((trigger: HTMLButtonElement | null): void => {
    sourcePickerReturnFocusRef.current = trigger;
    assetInputRef.current?.click();
  }, []);

  const clearSourceWorkflow = useCallback((): void => {
    sourceImportGenerationRef.current += 1;
    setSliceGridSourceGeneration((generation) => generation + 1);
    cancelSourceCommit();
    resetSourceSession();
    setCommittedSourceMetadata(null);
    setSourceActionError(null);
  }, [cancelSourceCommit, resetSourceSession]);

  const commandRegistry = useMemo(() => createStudioCommandRegistry({
    newProject: async () => {
      setResetSourceDialogOpen(false);
      clearSourceWorkflow();
      await canonical.createProject();
      handleNewProject();
      canonical.setActiveWorkspace("slice");
      navigate("slice");
    },
    openProject: () => projectInputRef.current?.click(),
    saveProject: async () => {
      if (activeWorkspace !== "compose") handleSaveProject();
      await canonical.saveProject();
    },
    importAsset: () => {
      if (activeWorkspace === "compose") {
        setComposeImportRequestToken((current) => current + 1);
      } else {
        assetInputRef.current?.click();
      }
    },
    undo: () => {
      if (activeWorkspace === "compose") canonical.history.undo();
      else undo();
    },
    redo: () => {
      if (activeWorkspace === "compose") canonical.history.redo();
      else redo();
    },
    openWorkspace: (workspaceId) => {
      const targetOwnsCanonicalCanvas = workspaceId === "slice" ||
        (workspaceId === "export" && canonicalSliceSourceAvailable);
      if (targetOwnsCanonicalCanvas) clearLegacyCanvasInteractionState();
      handleSetMode(LEGACY_MODE_BY_WORKSPACE[workspaceId]);
      canonical.setActiveWorkspace(workspaceId);
      navigate(workspaceId);
    },
    resetCanvas: () => canvasRef.current?.resetView(),
    openCommandPalette: () => setIsCommandPaletteOpen(true),
    openPreferences: () => setIsSettingsOpen(true),
    openHelp: () => setIsHelpOpen(true),
  }), [
    activeWorkspace,
    canonical,
    handleNewProject,
    handleSaveProject,
    handleSetMode,
    navigate,
    redo,
    setIsCommandPaletteOpen,
    setIsHelpOpen,
    setIsSettingsOpen,
    undo,
    clearSourceWorkflow,
    clearLegacyCanvasInteractionState,
    canonicalSliceSourceAvailable,
  ]);

  const sourceSessionBusy = sourceSessionSnapshot.status === "validating" ||
    sourceSessionSnapshot.status === "decoding" || isSourceCommitting;

  const canonicalCanUndo = canonicalHistory.undoEntries.length > 0;
  const canonicalCanRedo = canonicalHistory.redoEntries.length > 0;

  const commandContext = useMemo<StudioCommandContext>(() => ({
    projectAvailable: true,
    projectOpenAvailable: activeWorkspace !== "compose",
    busy: isLoading || sourceSessionBusy || composeImportBusy
      || canonical.persistenceState === "loading"
      || canonical.persistenceState === "saving",
    canUndo: activeWorkspace === "compose" ? canonicalCanUndo : canUndo,
    canRedo: activeWorkspace === "compose" ? canonicalCanRedo : canRedo,
    canvasAvailable: activeWorkspace === "compose" ? Boolean(canonicalComposition) : hasWorkspace,
  }), [
    activeWorkspace,
    canRedo,
    canUndo,
    canonical.persistenceState,
    canonicalCanRedo,
    canonicalCanUndo,
    canonicalComposition,
    composeImportBusy,
    hasWorkspace,
    isLoading,
    sourceSessionBusy,
  ]);

  const workspaceState = useMemo(() => resolveStudioWorkspaceState({
    workspaceId: activeWorkspace,
    availability: {
      sourceAvailable: !!slicerImage,
      compositionAvailable: !!builderCanvas,
      frameCount: frames.length,
      animationCount: animations.length,
    },
    loading: isLoading,
    loadingMessage,
    failure: studioError?.workspaceId === activeWorkspace
      ? { message: studioError.message, retryCommandId: studioError.commandId }
      : null,
  }), [
    activeWorkspace,
    animations.length,
    builderCanvas,
    frames.length,
    isLoading,
    loadingMessage,
    slicerImage,
    studioError,
  ]);

  useEffect(() => {
    if (workspaceState.kind === "ready") {
      workspaceContentRef.current?.focus({ preventScroll: true });
    }
  }, [workspaceState.kind]);

  useEffect(() => () => {
    sourceImportGenerationRef.current += 1;
    sourceCommitControllerRef.current?.abort();
    sourceCommitControllerRef.current = null;
  }, []);

  useEffect(() => {
    const input = assetInputRef.current;
    if (!input) return;
    // React does not expose the native file-input `cancel` event.  Keep the
    // keyboard return path explicit for every OS picker cancellation route.
    input.addEventListener("cancel", restoreSourcePickerFocus);
    return () => input.removeEventListener("cancel", restoreSourcePickerFocus);
  }, [restoreSourcePickerFocus]);

  const executeCommand = useCallback((commandId: StudioCommandId) => {
    void commandRegistry.execute(commandId, commandContext)
      .then((result) => {
        if (result.status !== "executed") return;
        setStudioError((current) => current?.commandId === commandId ? null : current);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : `Could not run ${commandId}.`;
        console.error(`Studio command failed: ${commandId}`, error);
        setStudioError({ workspaceId: activeWorkspace, commandId, message });
        showToast(message, "error");
      });
  }, [activeWorkspace, commandContext, commandRegistry, showToast]);

  const renameCanonicalProject = useCallback((name: string): string | null => {
    const result = canonical.renameProject(name);
    if (!result.result.ok) {
      return result.result.diagnostics[0]?.message ?? "Project could not be renamed.";
    }
    showToast(`Project renamed to ${name}.`, "success");
    return null;
  }, [canonical, showToast]);

  const commitReadySource = useCallback(async (
    snapshot: SourceSessionSnapshot,
    generation: number,
    replacing: boolean,
  ): Promise<boolean> => {
    if (snapshot.status !== "ready" || sourceImportGenerationRef.current !== generation) return false;
    const blob = getSourceBlob();
    if (!blob) return false;
    cancelSourceCommit();
    const controller = new AbortController();
    sourceCommitControllerRef.current = controller;
    setSourceCommitting(true);
    try {
      const file = new File([blob], snapshot.metadata.name, {
        type: snapshot.metadata.mimeType,
        lastModified: snapshot.metadata.lastModified ?? 0,
      });
      await handleUpload(file, { signal: controller.signal });
      if (sourceImportGenerationRef.current !== generation) return false;
      setCommittedSourceMetadata(snapshot.metadata);
      setSliceGridSourceGeneration((current) => current + 1);
      setSourceActionError(null);
      setStudioError(null);
      navigate("slice");
      return true;
    } catch {
      if (!isSliceSourceSignalAborted(controller.signal) &&
        sourceImportGenerationRef.current === generation) {
        resetSourceSession();
        if (replacing) {
          const replacementError = Object.freeze({
            code: "decode" as const,
            message: "The validated replacement could not be opened in Slice.",
            retryable: false,
          });
          setSourceActionError(replacementError);
          showToast(`${replacementError.message} The current source was kept.`, "error");
        } else {
          setStudioError({
            workspaceId: "slice",
            commandId: "asset.import",
            message: "The validated source could not be opened in Slice.",
          });
        }
      }
      return false;
    } finally {
      if (sourceCommitControllerRef.current === controller) {
        sourceCommitControllerRef.current = null;
      }
      if (sourceImportGenerationRef.current === generation) setSourceCommitting(false);
    }
  }, [cancelSourceCommit, getSourceBlob, handleUpload, navigate, resetSourceSession, showToast]);

  const selectSliceSource = useCallback(async (
    input: File | FileList,
  ): Promise<void> => {
    const replacing = !!slicerImage;
    cancelSourceCommit();
    const generation = ++sourceImportGenerationRef.current;
    setStudioError(null);
    setSourceActionError(null);
    const snapshot = await selectSourceSession(input);
    const committed = await commitReadySource(snapshot, generation, replacing);
    if (committed && sourceImportGenerationRef.current === generation) {
      workspaceContentRef.current?.focus({ preventScroll: true });
    }
  }, [cancelSourceCommit, commitReadySource, selectSourceSession, slicerImage]);

  const retrySliceSource = useCallback(async (): Promise<void> => {
    const replacing = !!slicerImage;
    cancelSourceCommit();
    const generation = ++sourceImportGenerationRef.current;
    setStudioError(null);
    workspaceContentRef.current?.focus({ preventScroll: true });
    const snapshot = await retrySourceSession();
    const committed = await commitReadySource(snapshot, generation, replacing);
    if (committed && sourceImportGenerationRef.current === generation) {
      workspaceContentRef.current?.focus({ preventScroll: true });
    }
  }, [cancelSourceCommit, commitReadySource, retrySourceSession, slicerImage]);

  const loadProjectFile = useCallback(async (file: File): Promise<void> => {
    const loaded = await handleLoadProject(file);
    if (!loaded) return;
    clearSourceWorkflow();
    setCommittedSourceMetadata(null);
    setSliceGridSourceGeneration((current) => current + 1);
    setResetSourceDialogOpen(false);
    setStudioError(null);
    workspaceContentRef.current?.focus({ preventScroll: true });
  }, [clearSourceWorkflow, handleLoadProject]);

  const confirmResetSliceSource = useCallback((): void => {
    focusDropzoneAfterResetRef.current = true;
    setResetSourceDialogOpen(false);
    clearSourceWorkflow();
    handleResetSliceSource();
    setStudioError(null);
    navigate("slice");
  }, [clearSourceWorkflow, handleResetSliceSource, navigate]);

  useEffect(() => {
    if (
      !focusDropzoneAfterResetRef.current || slicerImage ||
      sourceSessionSnapshot.status !== "idle"
    ) return;
    const target = dropzoneBrowseButtonRef.current;
    if (!target) return;
    focusDropzoneAfterResetRef.current = false;
    target.focus({ preventScroll: true });
  }, [slicerImage, sourceSessionSnapshot.status]);

  const visibleSourceError = sourceActionError ?? (
    sourceSessionSnapshot.status === "error" ? sourceSessionSnapshot.error : null
  );
  useKeyboardShortcuts({
    registry: commandRegistry,
    executeStudioCommand: executeCommand,
    legacyCanvasKeyboardEnabled: !canonicalCanvasOwnership,
    deleteSelection: handleDeleteSelection,
    nudge: (dx: number, dy: number) => {
      if (selectedIndex !== null)
        handleUpdateFrame(frames[selectedIndex].id, {
          x: frames[selectedIndex].x + dx,
          y: frames[selectedIndex].y + dy,
        });
    },
    togglePlay: () => setIsPlaying(!isPlaying),
    stepFrame: handleStepFrame,
    closeModals: () => {
      setCompactPanel(null);
      setJobCenterOpen(false);
      setResetSourceDialogOpen(false);
      controller.closeAllModals();
    },
    isModalOpen:
      isSettingsOpen ||
      isHelpOpen ||
      exportModal.isOpen ||
      generationModal.isOpen ||
      isCommandPaletteOpen ||
      isResetSourceDialogOpen ||
      compactPanel !== null ||
      isJobCenterOpen ||
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
          if (!file) {
            restoreSourcePickerFocus();
            return;
          }
          sourcePickerReturnFocusRef.current = null;
          void selectSliceSource(file);
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
          if (file) void loadProjectFile(file);
        }}
      />

      <StudioHeader
        activeWorkspace={activeWorkspace}
        registry={commandRegistry}
        commandContext={commandContext}
        onExecute={executeCommand}
        onOpenJobCenter={() => setJobCenterOpen(true)}
        isJobCenterOpen={isJobCenterOpen}
        jobSummary={{ active: jobSummary.active, total: jobSummary.total }}
        projectName={canonicalProject.name}
        projectPersistenceState={canonical.persistenceState}
        projectPersistenceMessage={canonical.persistenceMessage}
        onRenameProject={renameCanonicalProject}
      />

      {hasStudioPanels && isCompactLayout && (
        <div
          role="toolbar"
          aria-label="Compact Studio panels"
          className="flex h-9 shrink-0 items-center justify-between rounded-md border border-border/30 bg-panel px-2 xl:hidden"
        >
          {showLegacyPanels ? (
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
          ) : <span aria-hidden="true" />}
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
        {showLegacyPanels && !isCompactLayout && (
          <StudioPanel
            label="Tools"
            variant="sidebar"
            className="hidden w-[280px] shrink-0 animate-fade-in rounded-panel border-border/20 xl:flex"
          >
            <LeftSidebar key={`desktop-tools-${activeWorkspace}`} isSliceWorkspace={activeWorkspace === "slice"} />
          </StudioPanel>
        )}

        <div className="flex-1 flex flex-col min-w-0 gap-2">
          <main
            ref={workspaceContentRef}
            tabIndex={-1}
            data-studio-workspace-content={activeWorkspace}
            aria-label={`${activeWorkspaceDefinition.label} workspace content`}
            className="flex-1 relative overflow-hidden bg-workspace rounded-panel border border-border/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {activeWorkspace === "compose" ? (
              <ComposeBootstrapWorkspace
                key={canonicalProject.id}
                store={canonical.store}
                assets={canonical.assets}
                importRequestToken={composeImportRequestToken}
                disabled={canonical.persistenceState === "loading"}
                onBusyChange={setComposeImportBusy}
                onCleanupDebtChange={canonical.reportAssetCleanupDebt}
                onCompositionReady={() => navigate("compose")}
              />
            ) : activeWorkspace === "slice" && !slicerImage && sourceSessionSnapshot.status === "ready" ? (
              <SliceSourcePreview
                snapshot={sourceSessionSnapshot}
                getBlob={getSourceBlob}
                committing={isSourceCommitting}
              />
            ) : activeWorkspace === "slice" && !slicerImage && workspaceState.kind === "empty" ? (
              <SliceSourceDropzone
                snapshot={sourceSessionSnapshot}
                disabled={isSourceCommitting}
                committing={isSourceCommitting}
                browseButtonRef={dropzoneBrowseButtonRef}
                onBrowse={() => openSourcePicker(dropzoneBrowseButtonRef.current)}
                onSelect={(input) => selectSliceSource(input as File | FileList)}
                onRetry={retrySliceSource}
              />
            ) : workspaceState.kind === "ready" ? (
              activeWorkspace === "slice" ? (
                <SliceSourceCanvasFrame
                  snapshot={sourceSessionSnapshot}
                  metadataOverride={committedSourceMetadata}
                  legacyImageMeta={slicerImage}
                  actions={(
                    <SliceSourceActions
                      busy={sourceSessionBusy}
                      error={visibleSourceError}
                      replaceButtonRef={replaceSourceTriggerRef}
                      retryButtonRef={retrySourceTriggerRef}
                      resetButtonRef={resetSourceTriggerRef}
                      onReplace={() => {
                        setSourceActionError(null);
                        openSourcePicker(replaceSourceTriggerRef.current);
                      }}
                      onRequestReset={() => setResetSourceDialogOpen(true)}
                      onRetry={retrySliceSource}
                    />
                  )}
                >
                  <CanvasArea
                    ref={canvasRef}
                    canonicalCanvasOwnership={canonicalCanvasOwnership}
                    sliceGridOverlay={{
                      sourceDimensions: sliceGridController.sourceDimensions,
                      effectiveLayout: sliceGridController.effectiveLayout,
                    }}
                  />
                </SliceSourceCanvasFrame>
              ) : (
                <CanvasArea
                  ref={canvasRef}
                  canonicalCanvasOwnership={canonicalCanvasOwnership}
                />
              )
            ) : (
              <StudioWorkspaceStateView
                state={workspaceState}
                registry={commandRegistry}
                commandContext={commandContext}
                onExecute={executeCommand}
                onDismissError={() => setStudioError(null)}
              />
            )}
          </main>
          {hasWorkspace && activeWorkspace !== "compose" && (
            <TimelinePanel hidden={activeWorkspaceDefinition.capabilities.timeline !== "editable"} />
          )}
        </div>

        {(showLegacyPanels || showComposeProperties) && !isCompactLayout && (
          <StudioPanel
            label="Properties"
            variant="sidebar"
            className="hidden w-[280px] shrink-0 animate-fade-in rounded-panel border-border/20 xl:flex"
          >
            {showComposeProperties && canonicalCompositionId ? (
              <CompositionCanvasSettingsInspector
                store={canonical.store}
                compositionId={canonicalCompositionId}
              />
            ) : (
              <RightSidebar
                isSliceWorkspace={activeWorkspace === "slice"}
                sliceGridController={sliceGridController}
              />
            )}
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
        {compactPanel === "tools" && showLegacyPanels ? (
          <StudioPanel
            label="Tools"
            variant="drawer"
            onClose={() => setCompactPanel(null)}
            className="h-full border-0"
          >
            <LeftSidebar key={`compact-tools-${activeWorkspace}`} isSliceWorkspace={activeWorkspace === "slice"} />
          </StudioPanel>
        ) : compactPanel === "properties" ? (
          <StudioPanel
            label="Properties"
            variant="drawer"
            onClose={() => setCompactPanel(null)}
            className="h-full border-0"
          >
            {showComposeProperties && canonicalCompositionId ? (
              <CompositionCanvasSettingsInspector
                store={canonical.store}
                compositionId={canonicalCompositionId}
              />
            ) : (
              <RightSidebar
                isSliceWorkspace={activeWorkspace === "slice"}
                sliceGridController={sliceGridController}
              />
            )}
          </StudioPanel>
        ) : null}
      </StudioDialog>

      <SliceSourceResetDialog
        isOpen={isResetSourceDialogOpen}
        sourceName={committedSourceMetadata?.name ?? slicerImage?.name}
        restoreFocusRef={resetSourceTriggerRef}
        onCancel={() => setResetSourceDialogOpen(false)}
        onConfirm={confirmResetSliceSource}
      />

      <StudioDialog
        isOpen={isJobCenterOpen}
        onClose={() => setJobCenterOpen(false)}
        ariaLabel="Job Center"
        backdropClassName="!items-stretch !justify-end !p-0 bg-black/70"
        panelClassName="!h-dvh !max-h-dvh !max-w-[420px] !rounded-none !border-y-0 !border-r-0"
      >
        <StudioPanel
          label="Job Center"
          variant="drawer"
          onClose={() => setJobCenterOpen(false)}
          className="h-full border-0"
        >
          <JobCenter store={jobStore} runner={jobRunner} retryJob={retryJob} />
        </StudioPanel>
      </StudioDialog>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        registry={commandRegistry}
        context={commandContext}
        onExecute={executeCommand}
      />
      {exportModal.isOpen ? (
        <React.Suspense
          fallback={(
            <StudioDialog
              isOpen
              onClose={() => setExportModal({ ...exportModal, isOpen: false })}
              ariaLabel="Preparing export tools"
            >
              <div role="status" className="p-6 text-sm text-textMuted">
                Preparing export tools…
              </div>
            </StudioDialog>
          )}
        >
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
        </React.Suspense>
      ) : null}
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
