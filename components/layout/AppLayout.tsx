import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import LeftSidebar from "./LeftSidebar";
import RightSidebar from "./RightSidebar";
import CanvasArea, { type CanonicalRegionToolInteraction } from "../canvas/CanvasArea";
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
import type { ProcessingRecipe, ProjectCommand, ProjectCommandBatch, StudioProjectV1 } from "../../core/project";
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
import {
  IRREGULAR_REGION_DONOR_DEFAULTS,
} from "../../core/processing/irregularRegionDetection";
import {
  adaptManualRegionIntentToProjectCommand,
  adaptWandRegionIntentToProjectBatch,
  createEmptyWandSelection,
  selectWandComponent,
  type WandSelectionMode,
  type WandSelectionSnapshot,
} from "../../features/slice/irregular";
import IrregularSliceTools, {
  type IrregularToolMode,
  type ManualRegionDraft,
} from "../../features/slice/irregular/IrregularSliceTools";
import { browserRegionCrop, convertRegionToAsset } from "../../features/slice/assets";
import { useSliceGridController } from "../../features/slice/grid/useSliceGridController";
import {
  commitStagedGridResults,
  SliceResultsTray,
  useStagedGridResults,
  type StagedGridResultsSnapshot,
} from "../../features/slice/results";
import {
  importSliceSource,
  restoreCanonicalSliceSource,
} from "../../features/slice/source/importSliceSource";
import GridExportCenter from "../../features/slice/export/GridExportCenter";
import { openCompositionFromSource } from "../../features/compose/project/compositionEntry";
import {
  clearDurableGridCommitUndo,
  durableGridCommitMatchesProject,
  readDurableGridCommitUndo,
  writeDurableGridCommitUndo,
  type DurableGridCommitUndo,
} from "../../features/slice/results/durableGridCommitUndo";
import ComposeBootstrapWorkspace from "../../features/compose/project/ComposeBootstrapWorkspace";
import CompositionCanvasSettingsInspector from "../../features/compose/canvasSettings/CompositionCanvasSettingsInspector";
import StudioWorkspaceErrorBoundary from "../studio/StudioWorkspaceErrorBoundary";

const LEGACY_MODE_BY_WORKSPACE = {
  slice: AppMode.BUILDER,
  compose: AppMode.BUILDER,
  animate: AppMode.ANIMATION,
  collision: AppMode.COLLISION,
  export: AppMode.TEMPLATE,
} as const satisfies Record<StudioWorkspaceId, AppMode>;

const COMPACT_STUDIO_QUERY = "(max-width: 1279px)";
const ExportModal = React.lazy(() => import("../overlays/ExportModal"));

function newIrregularEntityId(prefix: string): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") return `${prefix}-${globalThis.crypto.randomUUID()}`;
  } catch {
    // Timestamp fallback remains local to this interaction.
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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
  const [irregularToolMode, setIrregularToolMode] = useState<IrregularToolMode>("wand");
  const [wandMode, setWandMode] = useState<WandSelectionMode>("replace");
  const [wandAlphaThreshold, setWandAlphaThreshold] = useState(IRREGULAR_REGION_DONOR_DEFAULTS.alphaThreshold);
  const [wandConnectivity, setWandConnectivity] = useState<4 | 8>(IRREGULAR_REGION_DONOR_DEFAULTS.connectivity);
  const [wandSelection, setWandSelection] = useState<WandSelectionSnapshot>(() => createEmptyWandSelection());
  const [manualRegionDraft, setManualRegionDraft] = useState<ManualRegionDraft>({ x: 0, y: 0, width: 1, height: 1 });
  const [irregularRegionId, setIrregularRegionId] = useState<string | null>(
    () => canonicalProject.workspace.selectedRegionId ?? null,
  );
  const [irregularBusy, setIrregularBusy] = useState(false);
  const [irregularError, setIrregularError] = useState<string | null>(null);
  const [canonicalSliceSourceId, setCanonicalSliceSourceId] = useState<string | null>(
    () => canonicalProject.workspace.selectedAssetId ?? null,
  );
  const [durableGridCommitUndo, setDurableGridCommitUndo] = useState<DurableGridCommitUndo | null>(
    () => readDurableGridCommitUndo(canonicalProject.id),
  );
  const sourceImportGenerationRef = useRef(0);
  const sourceCommitControllerRef = useRef<AbortController | null>(null);
  const canonicalNavigationProjectRef = useRef<string | null>(null);
  const canonicalSourceRestoreRef = useRef<string | null>(null);
  const [composeImportRequestToken, setComposeImportRequestToken] = useState(0);
  const [composeImportBusy, setComposeImportBusy] = useState(false);
  const {
    snapshot: sourceSessionSnapshot,
    select: selectSourceSession,
    retry: retrySourceSession,
    reset: resetSourceSession,
    getBlob: getSourceBlob,
  } = useSliceSourceSession();
  const handleUploadRef = useRef(handleUpload);
  handleUploadRef.current = handleUpload;
  const selectSourceSessionRef = useRef(selectSourceSession);
  selectSourceSessionRef.current = selectSourceSession;
  useEffect(() => {
    setCanonicalSliceSourceId(canonicalProject.workspace.selectedAssetId ?? null);
  }, [canonicalProject.workspace.selectedAssetId]);
  useEffect(() => {
    setWandSelection(createEmptyWandSelection());
    setIrregularRegionId(canonicalProject.workspace.selectedRegionId ?? null);
    setIrregularError(null);
  }, [canonicalProject.workspace.selectedAssetId, canonicalProject.id]);
  useEffect(() => {
    setDurableGridCommitUndo(readDurableGridCommitUndo(canonicalProject.id));
  }, [canonicalProject.id]);
  const sliceGridSourceAssetId = canonicalSliceSourceId;

  useEffect(() => {
    const assetId = canonicalProject.workspace.selectedAssetId;
    if (activeWorkspace !== "slice" || canonical.persistenceState !== "saved" || !assetId || slicerImage ||
      sourceSessionSnapshot.status !== "idle" || canonicalSourceRestoreRef.current === assetId) return;
    canonicalSourceRestoreRef.current = assetId;
    const controller = new AbortController();
    const generation = ++sourceImportGenerationRef.current;
    void (async () => {
      try {
        const restored = await restoreCanonicalSliceSource({
          store: canonical.store,
          repository: canonical.assets,
          assetId,
          signal: controller.signal,
        });
        const file = new File([restored.blob], restored.asset.name, { type: restored.asset.mimeType });
        const snapshot = await selectSourceSessionRef.current(file);
        if (snapshot.status !== "ready") throw new Error("The saved source could not be decoded.");
        await handleUploadRef.current(file, { signal: controller.signal });
        if (controller.signal.aborted || sourceImportGenerationRef.current !== generation) return;
        setCommittedSourceMetadata(snapshot.metadata);
        setCanonicalSliceSourceId(assetId);
        setSliceGridSourceGeneration((current) => current + 1);
      } catch (error) {
        if (!controller.signal.aborted) {
          showToast(error instanceof Error ? error.message : "The saved Slice source could not be restored.", "error");
        }
      }
    })();
    return () => {
      controller.abort();
      if (canonicalSourceRestoreRef.current === assetId) canonicalSourceRestoreRef.current = null;
    };
  }, [activeWorkspace, canonical.assets, canonical.persistenceState, canonical.store, canonicalProject.workspace.selectedAssetId, showToast, slicerImage]);
  const sliceGridController = useSliceGridController({
    generation: sliceGridSourceGeneration,
    committedMetadata: committedSourceMetadata,
    sessionSnapshot: sourceSessionSnapshot,
    legacyImage: slicerImage,
    persistedState: sliceGridState,
    sourceAssetId: sliceGridSourceAssetId,
    onInitializeState: initializeSliceGridState,
    onCommitState: commitSliceGridState,
  });
  const dispatchIrregularCommand = useCallback((command: ProjectCommand | ProjectCommandBatch, commandId: string): boolean => {
    const result = canonical.store.dispatch({
      command,
      metadata: {
        commandId,
        origin: "user",
        history: "record",
        issuedAt: new Date().toISOString(),
      },
    });
    if (!result.result.ok) {
      const message = result.result.diagnostics[0]?.message ?? "The irregular Region change was rejected.";
      setIrregularError(message);
      showToast(message, "error");
      return false;
    }
    setIrregularError(null);
    return true;
  }, [canonical.store, showToast]);
  const createWandRecipe = useCallback((sourceAssetId: string, componentId: string, timestamp: string): ProcessingRecipe => {
    const suffix = componentId.replace(/[^a-zA-Z0-9_-]/gu, "").slice(-48) || newIrregularEntityId("wand");
    const project = canonical.store.getSnapshot().project as StudioProjectV1;
    let id = `recipe-wand-${suffix}`;
    if (project.processingRecipes[id]) id = newIrregularEntityId("recipe-wand");
    return {
      id,
      name: "Magic wand region",
      kind: "grid-split",
      version: 1,
      sourceAssetId,
      layout: { mode: "auto" },
      crop: { threshold: 0, padding: 0 },
      chroma: { enabled: false, color: "#000000", tolerance: 0, smoothness: 0, spill: 0 },
      pixel: { enabled: false, size: 1, quantize: false, colors: 2 },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }, [canonical.store]);
  const handleWandSeed = useCallback((seed: { readonly x: number; readonly y: number }, pixels: Uint8ClampedArray): void => {
    const sourceAssetId = canonicalSliceSourceId;
    const dimensions = sliceGridController.sourceDimensions;
    if (!sourceAssetId || !dimensions) return;
    try {
      const transition = selectWandComponent(wandSelection, {
        sourceAssetId,
        pixels,
        width: dimensions.width,
        height: dimensions.height,
        seed,
        mode: wandMode,
        options: {
          ...IRREGULAR_REGION_DONOR_DEFAULTS,
          alphaThreshold: wandAlphaThreshold,
          connectivity: wandConnectivity,
        },
      });
      if (!transition.intent) {
        setWandSelection(transition.selection);
        return;
      }
      const timestamp = new Date().toISOString();
      const command = adaptWandRegionIntentToProjectBatch(
        transition.intent,
        { regions: canonical.store.getSnapshot().project.regions },
        {
          add: (component) => {
            const recipe = createWandRecipe(sourceAssetId, component.id, timestamp);
            const regionId = newIrregularEntityId("region-wand");
            return {
              type: "regions.commitRecipe",
              recipe,
              regions: [{
                id: regionId,
                assetId: sourceAssetId,
                bounds: { ...component.bounds },
                createdAt: timestamp,
                updatedAt: timestamp,
                provenance: { source: "wand", sourceId: component.id, importedAt: timestamp },
              }],
            };
          },
        },
      );
      if (dispatchIrregularCommand(command, `wand-region:${sourceAssetId}`)) {
        setWandSelection(transition.selection);
        const added = transition.intent.operations.find((operation) => operation.type === "add");
        if (added) setManualRegionDraft({ ...added.component.bounds });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The wand selection could not be applied.";
      setIrregularError(message);
      showToast(message, "error");
    }
  }, [canonical.store, canonicalSliceSourceId, createWandRecipe, dispatchIrregularCommand, showToast, sliceGridController.sourceDimensions, wandAlphaThreshold, wandConnectivity, wandMode, wandSelection]);
  const clearWandSelection = useCallback((): void => {
    setWandSelection(createEmptyWandSelection());
    setIrregularError(null);
  }, []);
  const createManualRegion = useCallback((bounds: ManualRegionDraft = manualRegionDraft): void => {
    const sourceAssetId = canonicalSliceSourceId;
    if (!sourceAssetId) return;
    const timestamp = new Date().toISOString();
    const regionId = newIrregularEntityId("region-manual");
    try {
      const command = adaptManualRegionIntentToProjectCommand(canonical.store.getSnapshot().project, {
        type: "create",
        regionId,
        sourceAssetId,
        bounds,
        timestamp,
      });
      const canonicalCommand = command?.type === "region.create"
        ? {
            ...command,
            region: {
              ...command.region,
              provenance: { source: "manual", importedAt: timestamp },
            },
          }
        : command;
      if (canonicalCommand && dispatchIrregularCommand(canonicalCommand, `manual-region-create:${regionId}`)) {
        setIrregularRegionId(regionId);
        setManualRegionDraft(bounds);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The manual Region could not be created.";
      setIrregularError(message);
      showToast(message, "error");
    }
  }, [canonical.store, canonicalSliceSourceId, dispatchIrregularCommand, manualRegionDraft, showToast]);
  const applyManualRegion = useCallback((): void => {
    if (!irregularRegionId) return;
    try {
      const command = adaptManualRegionIntentToProjectCommand(canonical.store.getSnapshot().project, {
        type: "resize", regionId: irregularRegionId, bounds: manualRegionDraft,
      });
      if (command && dispatchIrregularCommand(command, `manual-region-resize:${irregularRegionId}`)) setManualRegionDraft({ ...manualRegionDraft });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Region bounds could not be applied.";
      setIrregularError(message);
      showToast(message, "error");
    }
  }, [canonical.store, dispatchIrregularCommand, irregularRegionId, manualRegionDraft, showToast]);
  const deleteManualRegion = useCallback((): void => {
    if (!irregularRegionId) return;
    try {
      const command = adaptManualRegionIntentToProjectCommand(canonical.store.getSnapshot().project, { type: "delete", regionId: irregularRegionId });
      if (command && dispatchIrregularCommand(command, `manual-region-delete:${irregularRegionId}`)) setIrregularRegionId(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Region could not be deleted.";
      setIrregularError(message);
      showToast(message, "error");
    }
  }, [canonical.store, dispatchIrregularCommand, irregularRegionId, showToast]);
  const duplicateManualRegion = useCallback((): void => {
    const project = canonical.store.getSnapshot().project;
    const region = irregularRegionId ? project.regions[irregularRegionId] : undefined;
    if (!region) return;
    createManualRegion({ ...region.bounds });
  }, [canonical.store, createManualRegion, irregularRegionId]);
  const toggleManualRegionHidden = useCallback((): void => {
    const project = canonical.store.getSnapshot().project;
    const region = irregularRegionId ? project.regions[irregularRegionId] : undefined;
    if (!region) return;
    dispatchIrregularCommand({
      type: "region.update",
      regionId: region.id,
      patch: { hidden: !region.hidden, updatedAt: new Date().toISOString() },
    }, `manual-region-hidden:${region.id}`);
  }, [canonical.store, dispatchIrregularCommand, irregularRegionId]);
  const convertManualRegionToAsset = useCallback(async (): Promise<void> => {
    if (!irregularRegionId) return;
    setIrregularBusy(true);
    try {
      const result = await convertRegionToAsset(
        { store: canonical.store, repository: canonical.assets, cropper: browserRegionCrop },
        {
          regionId: irregularRegionId,
          name: `Region ${irregularRegionId}`,
          timestamp: new Date().toISOString(),
          grid: { marginX: 0, marginY: 0, gapX: 0, gapY: 0 },
        },
      );
      showToast(result.reused ? "Region Asset already exists." : "Region converted to Asset.", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Region could not be converted to an Asset.";
      setIrregularError(message);
      showToast(message, "error");
    } finally {
      setIrregularBusy(false);
    }
  }, [canonical.assets, canonical.store, irregularRegionId, showToast]);
  const handleManualCanvasCommit = useCallback((bounds: ManualRegionDraft): void => {
    setManualRegionDraft(bounds);
    createManualRegion(bounds);
  }, [createManualRegion]);
  const canonicalRegionTool = useMemo<CanonicalRegionToolInteraction | null>(() => {
    if (activeWorkspace !== "slice" || !sliceGridController.sourceDimensions) return null;
    return {
      mode: irregularToolMode,
      sourceWidth: sliceGridController.sourceDimensions.width,
      sourceHeight: sliceGridController.sourceDimensions.height,
      onWandSeed: handleWandSeed,
      onManualCommit: handleManualCanvasCommit,
      onCancel: clearWandSelection,
    };
  }, [activeWorkspace, clearWandSelection, handleManualCanvasCommit, handleWandSeed, irregularToolMode, sliceGridController.sourceDimensions]);
  const sliceCommitBusyRef = useRef(false);
  const sliceCommitControllerRef = useRef<AbortController | null>(null);
  const sliceCommitProjectIdRef = useRef<string | null>(null);
  const cancelSliceCommit = useCallback((): void => {
    sliceCommitControllerRef.current?.abort();
    sliceCommitControllerRef.current = null;
    sliceCommitProjectIdRef.current = null;
  }, []);
  const commitSliceResults = useCallback(async (staged: StagedGridResultsSnapshot): Promise<boolean> => {
    if (sliceCommitBusyRef.current) return false;
    const sourceAssetId = canonicalSliceSourceId;
    if (!sourceAssetId) {
      showToast("Import and validate a canonical source before committing slices.", "error");
      return false;
    }
    sliceCommitBusyRef.current = true;
    const commitController = new AbortController();
    const commitProjectId = canonical.store.getSnapshot().project.id;
    sliceCommitControllerRef.current = commitController;
    sliceCommitProjectIdRef.current = commitProjectId;
    try {
      const committed = await commitStagedGridResults({
        store: canonical.store,
        repository: canonical.assets,
        staged,
        sourceAssetId,
        name: slicerImage?.name ?? "slice",
        signal: commitController.signal,
      });
      if (commitController.signal.aborted || canonical.store.getSnapshot().project.id !== commitProjectId) return false;
      await canonical.saveProject();
      if (commitController.signal.aborted || canonical.store.getSnapshot().project.id !== commitProjectId) return false;
      writeDurableGridCommitUndo(committed, commitProjectId);
      setDurableGridCommitUndo(readDurableGridCommitUndo(canonical.store.getSnapshot().project.id));
      showToast(`${committed.regions.length} slices committed to the project.`, "success");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Slices could not be committed.";
      showToast(message, "error");
      return false;
    } finally {
      sliceCommitBusyRef.current = false;
      if (sliceCommitControllerRef.current === commitController) {
        sliceCommitControllerRef.current = null;
        sliceCommitProjectIdRef.current = null;
      }
    }
  }, [canonical, canonicalSliceSourceId, showToast, slicerImage?.name]);
  useEffect(() => {
    if (sliceCommitProjectIdRef.current && sliceCommitProjectIdRef.current !== canonicalProject.id) {
      cancelSliceCommit();
    }
  }, [cancelSliceCommit, canonicalProject.id]);
  const openGridRegionInCompose = useCallback((regionId: string): void => {
    const result = openCompositionFromSource(canonical.store, {
      source: { type: "region", id: regionId },
      commandId: `grid-compose-${regionId}`,
      issuedAt: new Date().toISOString(),
    });
    if (!result.ok) {
      showToast(result.message, "error");
      return;
    }
    // Compose layers own the Region source, while Slice keeps the canonical
    // sheet selected so durable Grid undo/source restoration survives a
    // round-trip through another workspace.
    const sourceAssetId = canonicalSliceSourceId;
    if (sourceAssetId && canonical.store.getSnapshot().project.workspace.selectedAssetId !== sourceAssetId) {
      canonical.store.dispatch({
        command: { type: "workspace.update", patch: { selectedAssetId: sourceAssetId } },
        metadata: {
          commandId: `grid-compose-source:${regionId}`,
          origin: "user",
          history: "ignore",
          issuedAt: new Date().toISOString(),
        },
      });
    }
    canonical.setActiveWorkspace("compose");
    navigate("compose");
    showToast("Region opened in Compose.", "success");
  }, [canonical, navigate, showToast]);
  const sliceResultsController = useStagedGridResults({
    sourceSnapshot: sourceSessionSnapshot,
    recipe: sliceGridController.recipe,
    commit: commitSliceResults,
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

  const canonicalSliceHistoryOwned = activeWorkspace === "slice" && canonicalSliceSourceId !== null;
  const canonicalHistoryOwned = activeWorkspace === "compose" || canonicalSliceHistoryOwned;
  const canonicalCanUndo = canonicalHistory.undoEntries.length > 0;
  const canonicalCanRedo = canonicalHistory.redoEntries.length > 0;
  const durableGridCommitAvailable = canonicalSliceHistoryOwned &&
    durableGridCommitMatchesProject(canonicalProject as unknown as StudioProjectV1, durableGridCommitUndo);

  const undoCanonical = useCallback(async (): Promise<void> => {
    if (canonicalCanUndo) {
      canonical.history.undo();
      return;
    }
    if (!durableGridCommitAvailable || !durableGridCommitUndo) return;
    const commands = [
      ...[...durableGridCommitUndo.regionIds].reverse().map((regionId) => ({
        type: "region.remove" as const,
        regionId,
        policy: "reject" as const,
      })),
      ...[...durableGridCommitUndo.derivedAssetIds].reverse().map((assetId) => ({
        type: "asset.remove" as const,
        assetId,
        policy: "reject" as const,
      })),
      {
        type: "processingRecipe.remove" as const,
        recipeId: durableGridCommitUndo.recipeId,
        policy: "reject" as const,
      },
    ];
    const result = canonical.store.dispatch({
      command: { type: "command.batch", commands },
      metadata: {
        commandId: `grid-undo-${durableGridCommitUndo.recipeId}`,
        origin: "user",
        history: "ignore",
        issuedAt: new Date().toISOString(),
      },
    });
    if (!result.result.ok) {
      showToast("The saved Grid commit could not be undone.", "error");
      return;
    }
    try {
      await canonical.saveProject();
      clearDurableGridCommitUndo(canonical.store.getSnapshot().project.id);
      setDurableGridCommitUndo(null);
      showToast("Grid commit undone.", "success");
    } catch {
      showToast("The Grid undo is staged but could not be saved.", "error");
    }
  }, [canonical, canonicalCanUndo, durableGridCommitAvailable, durableGridCommitUndo, showToast]);

  const openSourcePicker = useCallback((trigger: HTMLButtonElement | null): void => {
    sourcePickerReturnFocusRef.current = trigger;
    assetInputRef.current?.click();
  }, []);

  const clearSourceWorkflow = useCallback((): void => {
    sourceImportGenerationRef.current += 1;
    setSliceGridSourceGeneration((generation) => generation + 1);
    cancelSliceCommit();
    cancelSourceCommit();
    resetSourceSession();
    setCommittedSourceMetadata(null);
    setSourceActionError(null);
  }, [cancelSliceCommit, cancelSourceCommit, resetSourceSession]);

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
      if (canonicalHistoryOwned) void undoCanonical();
      else undo();
    },
    redo: () => {
      if (canonicalHistoryOwned) canonical.history.redo();
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
    canonicalHistoryOwned,
    undoCanonical,
  ]);

  const sourceSessionBusy = sourceSessionSnapshot.status === "validating" ||
    sourceSessionSnapshot.status === "decoding" || isSourceCommitting;

  const commandContext = useMemo<StudioCommandContext>(() => ({
    projectAvailable: true,
    projectOpenAvailable: activeWorkspace !== "compose",
    busy: isLoading || sourceSessionBusy || composeImportBusy
      || canonical.persistenceState === "loading"
      || canonical.persistenceState === "saving",
    canUndo: canonicalHistoryOwned ? (canonicalCanUndo || durableGridCommitAvailable) : canUndo,
    canRedo: canonicalHistoryOwned ? canonicalCanRedo : canRedo,
    canvasAvailable: activeWorkspace === "compose" ? Boolean(canonicalComposition) : hasWorkspace,
  }), [
    activeWorkspace,
    canRedo,
    canUndo,
    canonical.persistenceState,
    canonicalCanRedo,
    canonicalCanUndo,
    durableGridCommitAvailable,
    canonicalHistoryOwned,
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
    cancelSliceCommit();
    sourceCommitControllerRef.current?.abort();
    sourceCommitControllerRef.current = null;
  }, [cancelSliceCommit]);

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
    let importedSourceId: string | null = null;
    let importedSourceRevision: number | null = null;
    try {
      const file = new File([blob], snapshot.metadata.name, {
        type: snapshot.metadata.mimeType,
        lastModified: snapshot.metadata.lastModified ?? 0,
      });
      const imported = await importSliceSource({
        store: canonical.store,
        repository: canonical.assets,
        blob,
        name: snapshot.metadata.name,
        mimeType: snapshot.metadata.mimeType,
        width: snapshot.metadata.width,
        height: snapshot.metadata.height,
        signal: controller.signal,
      });
      importedSourceId = imported.asset.id;
      importedSourceRevision = imported.revision;
      setCanonicalSliceSourceId(importedSourceId);
      await handleUpload(file, { signal: controller.signal });
      if (sourceImportGenerationRef.current !== generation) return false;
      setCommittedSourceMetadata(snapshot.metadata);
      setSliceGridSourceGeneration((current) => current + 1);
      setSourceActionError(null);
      setStudioError(null);
      navigate("slice");
      return true;
    } catch {
      if (importedSourceId && importedSourceRevision !== null &&
        canonical.store.getSnapshot().revision === importedSourceRevision) {
        const rollback = canonical.history.undo();
        if (!rollback.ok) {
          canonical.reportAssetCleanupDebt(canonical.store.getSnapshot().project.id, importedSourceId, true);
        }
      }
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
  }, [cancelSourceCommit, canonical, getSourceBlob, handleUpload, navigate, resetSourceSession, showToast]);

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
  const irregularTools = activeWorkspace === "slice" ? (
    <IrregularSliceTools
      project={canonicalProject}
      sourceAssetId={canonicalSliceSourceId}
      selection={wandSelection}
      toolMode={irregularToolMode}
      wandMode={wandMode}
      wandAlphaThreshold={wandAlphaThreshold}
      wandConnectivity={wandConnectivity}
      manualDraft={manualRegionDraft}
      selectedRegionId={irregularRegionId}
      busy={irregularBusy}
      error={irregularError}
      onToolModeChange={setIrregularToolMode}
      onWandModeChange={setWandMode}
      onWandAlphaThresholdChange={setWandAlphaThreshold}
      onWandConnectivityChange={setWandConnectivity}
      onCancelSelection={clearWandSelection}
      onManualDraftChange={(patch) => setManualRegionDraft((current) => ({ ...current, ...patch }))}
      onCreateManual={() => createManualRegion()}
      onApplyManual={applyManualRegion}
      onDeleteRegion={deleteManualRegion}
      onDuplicateRegion={duplicateManualRegion}
      onToggleHidden={toggleManualRegionHidden}
      onConvertToAsset={() => void convertManualRegionToAsset()}
      onSelectRegion={(regionId) => {
        setIrregularRegionId(regionId);
        const region = canonicalProject.regions[regionId];
        if (region) setManualRegionDraft({ ...region.bounds });
      }}
    />
  ) : null;
  const cancelActiveCanonicalTool = useCallback((): boolean => {
    if (activeWorkspace === "slice" && wandSelection.components.length > 0) {
      clearWandSelection();
      return true;
    }
    return false;
  }, [activeWorkspace, clearWandSelection, wandSelection.components.length]);
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
    cancelActiveTool: cancelActiveCanonicalTool,
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
            <LeftSidebar key={`desktop-tools-${activeWorkspace}`} isSliceWorkspace={activeWorkspace === "slice"} irregularTools={irregularTools} />
          </StudioPanel>
        )}

        <div className="flex-1 flex flex-col min-w-0 gap-2">
          <StudioWorkspaceErrorBoundary resetKey={`${canonicalProject.id}:${activeWorkspace}`}>
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
              activeWorkspace === "export" && canonicalSliceSourceAvailable ? (
                <GridExportCenter
                  project={canonicalProject}
                  revision={canonical.store.getSnapshot().revision}
                  repository={canonical.assets}
                  onOpenCompose={openGridRegionInCompose}
                  onToast={showToast}
                />
              ) : activeWorkspace === "slice" ? (
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
                  footer={<SliceResultsTray controller={sliceResultsController} />}
                >
                  <CanvasArea
                    ref={canvasRef}
                    canonicalCanvasOwnership={canonicalCanvasOwnership}
                    onCanonicalPickColor={sliceGridController.setChromaColor}
                    canonicalRegionTool={canonicalRegionTool}
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
                  onCanonicalPickColor={sliceGridController.setChromaColor}
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
          </StudioWorkspaceErrorBoundary>
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
            <LeftSidebar key={`compact-tools-${activeWorkspace}`} isSliceWorkspace={activeWorkspace === "slice"} irregularTools={irregularTools} />
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
