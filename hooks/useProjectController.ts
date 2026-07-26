import { useState, useEffect, useCallback, useRef } from "react";
import { useUndo } from "./useUndo";
import { useUIController } from "./useUIController";
import {
  AppMode,
  ProjectState,
  GridConfig,
  TemplateConfig,
  UserPreferences,
  DEFAULT_PREFERENCES,
  OnionSkinConfig,
  SlotData,
  BuilderCanvasSize,
} from "../types";
import { generateFramesFromGrid } from "../utils/algorithms";
import { useAnimationLogic } from "./domains/useAnimationLogic";
import { useSlicerLogic } from "./domains/useSlicerLogic";
import { useBuilderLogic, DEFAULT_SLOT_DATA, RATIO_PRESETS } from "./domains/useBuilderLogic";
import { useExportLogic } from "./domains/useExportLogic";
import { usePersistence } from "./domains/usePersistence";
import { getAllAssets } from "../utils/db";
import {
  assertHostImageDimensions,
  clampUserPreferences,
  collectOwnedBlobUrls,
  mergeHydratedBuilderAssets,
  parseHostUiState,
  projectStateHistoryKey,
  revokeBlobUrls,
} from "../utils/hostProjectPolicy";

const INITIAL_STATE: ProjectState = {
  imageMeta: null,
  builderCanvas: null,
  frames: [],
  builderSlots: {},
  builderFreeObjects: [],
  animations: [],
  builderAssets: [],
  aspectRatio: "1:1",
};

/** Clear only the graph derived from the active Slice source. */
export function resetSliceSourceProjectState(previous: ProjectState): ProjectState {
  const { sliceGrid: _sliceGrid, ...retained } = previous;
  return {
    ...retained,
    imageMeta: null,
    builderCanvas: null,
    frames: [],
    builderSlots: {},
    builderFreeObjects: [],
    animations: [],
  };
}

export interface SliceSourceProjectReplacement {
  readonly imageMeta: NonNullable<ProjectState["imageMeta"]>;
  readonly builderCanvas: NonNullable<ProjectState["builderCanvas"]>;
  readonly frames: ProjectState["frames"];
}

/** Atomically remove the old source graph and install only the new source graph. */
export function replaceSliceSourceProjectState(
  previous: ProjectState,
  replacement: SliceSourceProjectReplacement,
): ProjectState {
  return {
    ...resetSliceSourceProjectState(previous),
    imageMeta: replacement.imageMeta,
    builderCanvas: replacement.builderCanvas,
    frames: replacement.frames,
  };
}

export interface SliceRuntimeUrlHost {
  revokeObjectURL(url: string): void;
}

export interface SliceOwnedRuntimeUrls {
  readonly source?: string | null;
  readonly protectedAssetUrls?: readonly string[];
}

/** Revoke each Slice-owned Blob URL at most once; unrelated asset URLs are never accepted. */
export function revokeSliceOwnedRuntimeUrls(
  ownedUrls: SliceOwnedRuntimeUrls,
  configuredHost?: SliceRuntimeUrlHost | null,
): number {
  let host: SliceRuntimeUrlHost | null = configuredHost ?? null;
  if (configuredHost === undefined) {
    try {
      const owner = globalThis.URL;
      const revoke = owner?.revokeObjectURL;
      host = typeof revoke === "function"
        ? { revokeObjectURL: (url: string) => Reflect.apply(revoke, owner, [url]) }
        : null;
    } catch {
      host = null;
    }
  }
  if (host === null) return 0;
  const protectedUrls = new Set(ownedUrls.protectedAssetUrls ?? []);
  const uniqueUrls = new Set([ownedUrls.source].filter(
    (url): url is string => typeof url === "string" && url.startsWith("blob:") &&
      !protectedUrls.has(url),
  ));
  let released = 0;
  for (const runtimeUrl of uniqueUrls) {
    released += 1;
    try {
      host.revokeObjectURL(runtimeUrl);
    } catch {
      // Release remains terminal when a revoked/hostile browser object throws.
    }
  }
  return released;
}

/** Run terminal effects independently so one hostile observer cannot block the rest. */
export function runSliceTerminalEffects(actions: readonly (() => void)[]): void {
  for (const action of actions) {
    try {
      action();
    } catch {
      // The project transaction already committed; terminal effects are best effort.
    }
  }
}

const ABORT_SIGNAL_ABORTED_GETTER = (() => {
  try {
    return Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get ?? null;
  } catch {
    return null;
  }
})();

/** Read cancellation without invoking caller-controlled `aborted` accessors. */
export function isSliceSourceSignalAborted(signal: AbortSignal | undefined): boolean {
  if (!signal) return false;
  if (ABORT_SIGNAL_ABORTED_GETTER) {
    try {
      return Boolean(Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []));
    } catch {
      // A proxy/non-native object falls through to a data-descriptor capture.
    }
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(signal, "aborted");
    if (descriptor && "value" in descriptor && typeof descriptor.value === "boolean") {
      return descriptor.value;
    }
  } catch {
    // A revoked proxy is conservatively treated as cancelled.
  }
  return true;
}

const loadPreferences = (): UserPreferences => {
  try {
    const stored = localStorage.getItem("spriteSlice_prefs");
    if (stored) return clampUserPreferences(JSON.parse(stored));
  } catch {}
  return { ...DEFAULT_PREFERENCES };
};

const loadUIState = () => {
  try {
    const stored = localStorage.getItem("spriteSlice_ui");
    if (stored) return parseHostUiState(JSON.parse(stored));
  } catch {}
  return parseHostUiState(null);
};

/** Top-level project orchestrator combining all domain hooks + undo. */
export function useProjectController() {
  const {
    state: project,
    set: setProject,
    setEphemeral: setProjectEphemeral,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useUndo<ProjectState>(INITIAL_STATE, { historyKey: projectStateHistoryKey });
  const ui = useUIController();
  const projectRef = useRef(project);
  const ownedAssetBlobUrlsRef = useRef<Set<string>>(new Set());
  projectRef.current = project;
  const uiState = loadUIState();
  const defaultGrid: GridConfig = {
    rows: 2,
    cols: 2,
    marginX: 0,
    marginY: 0,
    paddingX: 0,
    paddingY: 0,
  };

  const [currentMode, setCurrentMode] = useState<AppMode>(uiState.mode || AppMode.BUILDER);
  const [preferences, setPreferencesState] = useState<UserPreferences>(loadPreferences());
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const [slicerGrid, setSlicerGrid] = useState<GridConfig>(uiState.slicerGrid || defaultGrid);
  const [builderGrid, setBuilderGrid] = useState<GridConfig>(uiState.builderGrid || defaultGrid);

  const activeGrid = currentMode === AppMode.BUILDER ? builderGrid : slicerGrid;

  const [templateConfig, setTemplateConfig] = useState<TemplateConfig>({
    viewType: "full",
    showIndices: true,
    gridColor: "#3b82f6",
    gridWidth: 1,
    backgroundColor: "#09090b",
  });
  const [onionSkin, setOnionSkin] = useState<OnionSkinConfig>({
    enabled: false,
    opacity: 0.3,
    showHitboxes: false,
  });

  const notify = useCallback(
    (msg: string, type: "success" | "error" | "info" = "info") => {
      ui.showToast(msg, type, preferences.soundEnabled);
    },
    [ui.showToast, preferences.soundEnabled],
  );

  const animLogic = useAnimationLogic(project, setProject, preferences);
  const slicerLogic = useSlicerLogic(
    project,
    setProject,
    setProjectEphemeral,
    preferences,
    notify,
    ui.setIsLoading,
    ui.setLoadingMessage,
  );
  const builderLogic = useBuilderLogic(
    project,
    setProject,
    setProjectEphemeral,
    preferences,
    notify,
    ui.setIsLoading,
    ui.setLoadingMessage,
  );

  const exportLogic = useExportLogic({
    project,
    currentMode,
    activeGrid,
    builderGrid,
    setIsLoading: ui.setIsLoading,
    setLoadingMessage: ui.setLoadingMessage,
    notify,
  });

  const persistence = usePersistence({
    project,
    slicerGrid,
    builderGrid,
    templateConfig,
    onionSkin,
    currentMode,
    setProject,
    setSlicerGrid,
    setBuilderGrid,
    setTemplateConfig,
    setCurrentMode,
    notify,
  });

  // Asynchronous asset loading from IndexedDB (merge by id; track owned blob URLs)
  useEffect(() => {
    let cancelled = false;
    const loadAssetsFromDB = async () => {
      try {
        const storedAssets = await getAllAssets();
        if (cancelled) return;
        const assetsWithUrls = storedAssets.map((asset) => ({
          ...asset,
          src: URL.createObjectURL(asset.blob),
        }));
        for (const url of collectOwnedBlobUrls(assetsWithUrls)) {
          ownedAssetBlobUrlsRef.current.add(url);
        }
        setProject((prev) => ({
          ...prev,
          builderAssets: mergeHydratedBuilderAssets(prev.builderAssets, assetsWithUrls),
        }));
      } catch (error) {
        console.error("Failed to load assets from IndexedDB", error);
        notify("Could not load asset library.", "error");
      }
    };

    loadAssetsFromDB();

    return () => {
      cancelled = true;
      revokeBlobUrls(ownedAssetBlobUrlsRef.current);
      ownedAssetBlobUrlsRef.current.clear();
      const live = projectRef.current.builderAssets;
      revokeBlobUrls(collectOwnedBlobUrls(live));
    };
  }, [setProject, notify]);

  const setPreferences = (newPrefs: UserPreferences) => {
    setPreferencesState(newPrefs);
    localStorage.setItem("spriteSlice_prefs", JSON.stringify(newPrefs));
  };

  useEffect(() => {
    if (preferences.autoSaveGrid) {
      localStorage.setItem(
        "spriteSlice_ui",
        JSON.stringify({ mode: currentMode, slicerGrid, builderGrid }),
      );
    }
  }, [currentMode, slicerGrid, builderGrid, preferences.autoSaveGrid]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(preferences.theme);
    const rgb = preferences.accentColor.split(" ").map(Number);
    if (rgb.length === 3) root.style.setProperty("--accent-rgb", preferences.accentColor);
  }, [preferences.theme, preferences.accentColor]);

  const clearLegacyCanvasInteractionState = useCallback((): void => {
    runSliceTerminalEffects([
      () => setSelectedIndex(null),
      () => animLogic.setActiveAnimationId(null),
      () => animLogic.setIsPlaying(false),
      () => ui.setIsEyedropperActive(false),
      () => ui.setIsMagicWandActive(false),
    ]);
  }, [
    animLogic.setActiveAnimationId,
    animLogic.setIsPlaying,
    ui.setIsEyedropperActive,
    ui.setIsMagicWandActive,
  ]);

  const handleUpload = (
    file: File,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<void> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    const signal = options.signal;
    let image: HTMLImageElement | null = null;
    let settled = false;
    let abortListenerAttached = false;
    const cleanup = (): void => {
      runSliceTerminalEffects([
        () => {
          const shouldRemove = signal !== undefined && abortListenerAttached;
          abortListenerAttached = false;
          if (shouldRemove) signal.removeEventListener("abort", onAbort);
        },
        () => { reader.onload = null; },
        () => { reader.onerror = null; },
        () => { reader.onabort = null; },
        () => { if (image) image.onload = null; },
        () => { if (image) image.onerror = null; },
      ]);
    };
    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      runSliceTerminalEffects([
        () => { if (image) image.src = ""; },
        () => notify("The validated source could not be opened in Slice.", "error"),
      ]);
      reject(error);
    };
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      runSliceTerminalEffects([
        () => { if (reader.readyState === FileReader.LOADING) reader.abort(); },
        () => { if (image) image.src = ""; },
      ]);
      reject(new DOMException("Slice source import was cancelled.", "AbortError"));
    };
    const fail = (): void => rejectOnce(new Error("Validated Slice source import failed."));
    try {
      reader.onerror = fail;
      reader.onabort = fail;
      reader.onload = () => {
        let src: string;
        try {
          const result = reader.result;
          if (typeof result !== "string") {
            fail();
            return;
          }
          src = result;
        } catch {
          fail();
          return;
        }
        try {
          image = new Image();
          image.onerror = fail;
        } catch {
          fail();
          return;
        }
        const handleImageLoad = (): void => {
          const abortedAtLoad = isSliceSourceSignalAborted(signal);
          if (
            settled || abortedAtLoad || image === null ||
            image.width <= 0 || image.height <= 0
          ) {
            if (abortedAtLoad) onAbort();
            else fail();
            return;
          }

          let nextProject: ProjectState;
          let previousSourceRuntimeUrl: string | null | undefined;
          let protectedAssetUrls: string[];
          try {
            const width = image.width;
            const height = image.height;
            assertHostImageDimensions(width, height);
            const newFrames = generateFramesFromGrid(width, height, defaultGrid);
            if (isSliceSourceSignalAborted(signal)) {
              onAbort();
              return;
            }
            const currentProject = projectRef.current;
            previousSourceRuntimeUrl = currentProject.imageMeta?.src;
            protectedAssetUrls = currentProject.builderAssets.map((asset) => asset.src);
            nextProject = replaceSliceSourceProjectState(currentProject, {
              imageMeta: {
                src,
                width,
                height,
                name: file.name,
                fileSize: file.size,
              },
              builderCanvas: { width, height },
              frames: newFrames,
            });
          } catch {
            fail();
            return;
          }

          try {
            setProject(nextProject);
          } catch {
            fail();
            return;
          }

          // Terminal boundary: the replacement is installed. Nothing below
          // may call fail/reject or prevent the public promise from settling.
          settled = true;
          runSliceTerminalEffects([
            () => { projectRef.current = nextProject; },
            clearLegacyCanvasInteractionState,
            () => revokeSliceOwnedRuntimeUrls({
              source: previousSourceRuntimeUrl,
              protectedAssetUrls,
            }),
            cleanup,
            resolve,
            () => notify(`Imported ${file.name}`, "success"),
          ]);
        };
        try {
          image.onload = handleImageLoad;
        } catch {
          fail();
          return;
        }
        try {
          image.src = src;
        } catch {
          fail();
        }
      };
      if (signal) {
        abortListenerAttached = true;
        signal.addEventListener("abort", onAbort, { once: true });
      }
    } catch {
      fail();
      return;
    }
    if (isSliceSourceSignalAborted(signal)) {
      onAbort();
      return;
    }
    try {
      reader.readAsDataURL(file);
    } catch {
      fail();
    }
  });

  const handleCreateCanvas = (w: number, h: number) => {
    const newFrames = generateFramesFromGrid(w, h, builderGrid);
    setProject((prev) => ({
      ...prev,
      builderCanvas: { width: w, height: h },
      frames: newFrames,
      builderSlots: {},
      builderFreeObjects: [],
    }));
    notify("Workspace initialized", "success");
  };

  const handleSetAspectRatio = (ratioStr: string) => {
    if (!ratioStr) return;
    const preset = RATIO_PRESETS[ratioStr];
    let newW, newH;
    if (preset) {
      newW = preset.w;
      newH = preset.h;
    } else {
      const [wPart, hPart] = ratioStr.split(":").map(Number);
      const ratio = wPart / hPart;
      const BASE_SIZE = 1024;
      if (ratio >= 1) {
        newW = BASE_SIZE;
        newH = Math.round(BASE_SIZE / ratio);
      } else {
        newH = BASE_SIZE;
        newW = Math.round(BASE_SIZE * ratio);
      }
    }
    const newFrames = generateFramesFromGrid(newW, newH, builderGrid);
    setProject((prev) => ({
      ...prev,
      builderCanvas: { width: newW, height: newH },
      aspectRatio: ratioStr,
      frames: newFrames,
    }));
  };

  const handleSetGridConfig = (c: GridConfig) => {
    const safeC = {
      ...c,
      rows: Math.min(256, Math.max(1, c.rows)),
      cols: Math.min(256, Math.max(1, c.cols)),
    };
    if (currentMode === AppMode.BUILDER) setBuilderGrid(safeC);
    else setSlicerGrid(safeC);
    const w = project.imageMeta?.width || project.builderCanvas?.width || 1024;
    const h = project.imageMeta?.height || project.builderCanvas?.height || 1024;
    const newFrames = generateFramesFromGrid(w, h, safeC);
    setProject((prev) => ({ ...prev, frames: newFrames }));
  };

  const handleNewProject = () => {
    setProject({ ...INITIAL_STATE, builderAssets: project.builderAssets });
    setSelectedIndex(null);
    setSlicerGrid(defaultGrid);
    setBuilderGrid(defaultGrid);
    notify("New project.", "info");
  };

  const handleResetSliceSource = () => {
    let nextProject: ProjectState;
    let sourceRuntimeUrl: string | null | undefined;
    let protectedAssetUrls: string[];
    try {
      const currentProject = projectRef.current;
      nextProject = resetSliceSourceProjectState(currentProject);
      sourceRuntimeUrl = currentProject.imageMeta?.src;
      protectedAssetUrls = currentProject.builderAssets.map((asset) => asset.src);
      setProject(nextProject);
    } catch {
      runSliceTerminalEffects([
        () => notify("The Slice source could not be reset.", "error"),
      ]);
      return;
    }

    runSliceTerminalEffects([
      () => { projectRef.current = nextProject; },
      clearLegacyCanvasInteractionState,
      () => revokeSliceOwnedRuntimeUrls({
        source: sourceRuntimeUrl,
        protectedAssetUrls,
      }),
      () => notify("Slice source reset.", "info"),
    ]);
  };

  const handleSetMode = (mode: AppMode) => {
    if (currentMode === mode) return;
    const update = () => {
      setCurrentMode(mode);
      setSelectedIndex(null);
      animLogic.setActiveAnimationId(null);
      animLogic.setIsPlaying(false);
    };
    if (typeof document.startViewTransition === "function") {
      const transition = document.startViewTransition(update);
      // Rapid workspace changes may legitimately skip the previous visual transition.
      // The state update still completes, so consume that presentation-only rejection.
      void transition.ready.catch(() => undefined);
    } else {
      update();
    }
  };

  const handleSyncGrid = () => {
    setBuilderGrid(slicerGrid);
    setSlicerGrid(builderGrid);
    notify("Grids synchronized", "success");
  };

  const handleDeleteFrame = (index: number) => {
    setProject((prev) => ({
      ...prev,
      frames: prev.frames.filter((_, i) => i !== index),
    }));
    setSelectedIndex(null);
    notify("Frame removed", "info");
  };

  const setBuilderCanvas = (size: BuilderCanvasSize | null) => {
    setProject((prev) => ({ ...prev, builderCanvas: size }));
  };

  const handleDeleteSelection = () => {
    if (selectedIndex === null) return;
    if (currentMode === AppMode.BUILDER) {
      const slot = project.builderSlots[selectedIndex];
      if (slot) builderLogic.handleUpdateSlot(selectedIndex, null);
    } else {
      const frame = project.frames[selectedIndex];
      if (frame) handleDeleteFrame(frame.id);
    }
  };

  const initializeSliceGridState = useCallback((state: NonNullable<ProjectState["sliceGrid"]>) => {
    setProjectEphemeral((previous) => previous.sliceGrid === state ? previous : { ...previous, sliceGrid: state });
  }, [setProjectEphemeral]);

  const commitSliceGridState = useCallback((state: NonNullable<ProjectState["sliceGrid"]>) => {
    setProject((previous) => previous.sliceGrid === state ? previous : { ...previous, sliceGrid: state });
  }, [setProject]);

  return {
    ...ui,
    preferences,
    setPreferences,
    currentMode,
    handleSetMode,
    clearLegacyCanvasInteractionState,
    slicerImage: project.imageMeta,
    builderCanvas: project.builderCanvas,
    activeGrid,
    builderGrid,
    frames: project.frames,
    builderSlots: project.builderSlots,
    animations: project.animations,
    builderAssets: project.builderAssets,
    sliceGridState: project.sliceGrid as unknown,
    initializeSliceGridState,
    commitSliceGridState,
    ...animLogic,
    ...slicerLogic,
    ...builderLogic,
    templateConfig,
    setTemplateConfig,
    selectedIndex,
    setSelectedIndex,
    undo,
    redo,
    canUndo,
    canRedo,
    handleSetGridConfig,
    handleUpload,
    handleCreateCanvas,
    handleSyncGrid,
    handleSaveProject: persistence.handleSaveProject,
    handleLoadProject: persistence.handleLoadProject,
    handleNewProject,
    handleResetSliceSource,
    onionSkin,
    setOnionSkin,
    handleToggleFrameVisibility: (id: number) => {
      setProject((prev) => ({
        ...prev,
        frames: prev.frames.map((f) => (f.id === id ? { ...f, hidden: !f.hidden } : f)),
      }));
    },
    handleAddKeyframeFromAsset: (id: string) => {
      if (!animLogic.activeAnimationId) return notify("Create animation first", "info");
      const slot = (Object.values(project.builderSlots) as SlotData[]).find(
        (s) => s.assetId === id,
      );
      if (slot) animLogic.handleAddKeyframe(slot.gridIndex);
      else notify("Asset not in grid", "info");
    },
    handleSmartFillSlot: (idx: number) =>
      builderLogic.handleSmartFillSlot(idx, builderGrid.cols, setSelectedIndex),
    handleExportZip: exportLogic.handleExportZip,
    handleExportGif: exportLogic.handleExportGif,
    handleDeleteFrame,
    handleDuplicateFrame: (id: number) => slicerLogic.handleDuplicateFrame(id, setSelectedIndex),
    currentAspectRatio: project.aspectRatio,
    handleSetAspectRatio,
    handleUpdateSlot: (idx: number, data: SlotData | null) => {
      if (data && data.assetId && !project.builderSlots[idx]) {
        builderLogic.handleUpdateSlot(idx, DEFAULT_SLOT_DATA(idx, data.assetId));
      } else {
        builderLogic.handleUpdateSlot(idx, data);
      }
    },
    setBuilderCanvas,
    handleDeleteSelection,
    handleGenerateCode: exportLogic.handleGenerateCode,
  };
}
