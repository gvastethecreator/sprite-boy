import { useState, useEffect, useCallback } from "react";
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
import { analyzeImageBlob } from "../utils/lazyFeatureModules";

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

const loadPreferences = (): UserPreferences => {
  try {
    const stored = localStorage.getItem("spriteSlice_prefs");
    if (stored) return { ...DEFAULT_PREFERENCES, ...JSON.parse(stored) };
  } catch {}
  return DEFAULT_PREFERENCES;
};

const loadUIState = () => {
  try {
    const stored = localStorage.getItem("spriteSlice_ui");
    if (stored) return JSON.parse(stored);
  } catch {}
  return {
    mode: AppMode.BUILDER,
    slicerGrid: { rows: 2, cols: 2, marginX: 0, marginY: 0, paddingX: 0, paddingY: 0 },
    builderGrid: { rows: 2, cols: 2, marginX: 0, marginY: 0, paddingX: 0, paddingY: 0 },
  };
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
  } = useUndo<ProjectState>(INITIAL_STATE);
  const ui = useUIController();
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

  // Asynchronous asset loading from IndexedDB
  useEffect(() => {
    const loadAssetsFromDB = async () => {
      try {
        const storedAssets = await getAllAssets();
        const assetsWithUrls = storedAssets.map((asset) => ({
          ...asset,
          src: URL.createObjectURL(asset.blob),
        }));
        setProject((prev) => ({ ...prev, builderAssets: assetsWithUrls }));
      } catch (error) {
        console.error("Failed to load assets from IndexedDB", error);
        notify("Could not load asset library.", "error");
      }
    };

    loadAssetsFromDB();

    // Cleanup blob URLs on unmount
    return () => {
      project.builderAssets.forEach((asset) => {
        if (asset.src.startsWith("blob:")) {
          URL.revokeObjectURL(asset.src);
        }
      });
    };
  }, [setProject]); // Run only on mount

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

  const handleUpload = (
    file: File,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<void> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    const signal = options.signal;
    let image: HTMLImageElement | null = null;
    let settled = false;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (reader.readyState === FileReader.LOADING) reader.abort();
      } catch {
        // The settled flag remains authoritative if a browser abort primitive fails.
      }
      if (image) image.src = "";
      reject(new DOMException("Slice source import was cancelled.", "AbortError"));
    };
    const cleanup = (): void => {
      signal?.removeEventListener("abort", onAbort);
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
      if (image) {
        image.onload = null;
        image.onerror = null;
      }
    };
    const fail = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (image) image.src = "";
      try {
        notify("The validated source could not be opened in Slice.", "error");
      } finally {
        reject(new Error("Validated Slice source import failed."));
      }
    };
    reader.onerror = fail;
    reader.onabort = fail;
    reader.onload = () => {
      const src = reader.result;
      if (typeof src !== "string") {
        fail();
        return;
      }
      try {
        image = new Image();
        image.onerror = fail;
        image.onload = () => {
          if (
            settled || signal?.aborted || image === null ||
            image.width <= 0 || image.height <= 0
          ) {
            if (signal?.aborted) onAbort();
            else fail();
            return;
          }
          try {
            const width = image.width;
            const height = image.height;
            const newFrames = generateFramesFromGrid(width, height, defaultGrid);
            if (signal?.aborted) {
              onAbort();
              return;
            }
            setProject((prev) => ({
              ...prev,
              imageMeta: {
                src,
                width,
                height,
                name: file.name,
                fileSize: file.size,
              },
              builderCanvas: { width, height },
              frames: newFrames,
              builderSlots: {},
            }));
            try {
              ui.setBgPreviewBlobUrl(null);
            } catch {
              // Preview cleanup must not invalidate an already committed project.
            }
            settled = true;
            cleanup();
            resolve();
            try {
              notify(`Imported ${file.name}`, "success");
            } catch {
              // Feedback is best effort after the project transaction commits.
            }
          } catch {
            fail();
          }
        };
        image.src = src;
      } catch {
        fail();
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
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

  const handleAnalyzeSheet = async (blob: Blob) => {
    ui.setIsLoading(true);
    ui.setLoadingMessage("Gemini analysis...");
    try {
      ui.setAnalysisResult(await analyzeImageBlob(blob));
    } catch {
      notify("Analysis failed", "error");
    } finally {
      ui.setIsLoading(false);
    }
  };

  const handlePreviewBackground = (color: string, tolerance: number, softness: number) => {
    if (ui.bgPreviewBlobUrl) URL.revokeObjectURL(ui.bgPreviewBlobUrl);
    slicerLogic.handlePreviewBackground(color, tolerance, softness, ui.setBgPreviewBlobUrl);
  };

  const handleCancelPreview = () => {
    if (ui.bgPreviewBlobUrl) URL.revokeObjectURL(ui.bgPreviewBlobUrl);
    ui.setBgPreviewBlobUrl(null);
  };

  const handleRemoveBackground = (color: string, tolerance: number, softness: number) => {
    handleCancelPreview();
    slicerLogic.handleRemoveBackground(color, tolerance, softness);
  };

  const handleRunAIProjectGen = async () => {
    const contextImages = ui.genPanel.contextSlots
      .filter((s) => s !== null)
      .map((s) => s!.previewSrc);

    await builderLogic.runGeneration(
      ui.genPanel.prompt,
      contextImages,
      null,
      setSelectedIndex,
      ui.genPanel.model,
      ui.genPanel.mode,
    );
  };

  const handleDropContextToAI = (idx: number, type: "asset" | "keyframe" | "frame", id: string) => {
    let src = "";
    if (type === "asset") {
      src = project.builderAssets.find((a) => a.id === id)?.src || "";
    } else if (type === "frame") {
      const frame = project.frames.find((f) => f.id === parseInt(id));
      if (frame && project.imageMeta) src = project.imageMeta.src;
    } else {
      const anim = project.animations.find((a) => a.keyframes.some((kf) => kf.uid === id));
      if (anim) {
        const kf = anim.keyframes.find((kf) => kf.uid === id);
        if (kf && project.imageMeta) src = project.imageMeta.src;
      }
    }
    if (src) {
      const newContext = [...ui.genPanel.contextSlots];
      newContext[idx] = { id: idx, type, dataId: id, previewSrc: src };
      ui.setGenPanel({ ...ui.genPanel, contextSlots: newContext });
    }
  };

  const handleClearAIContext = (idx: number) => {
    const newContext = [...ui.genPanel.contextSlots];
    newContext[idx] = null;
    ui.setGenPanel({ ...ui.genPanel, contextSlots: newContext });
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

  const handleGenerateSlot = (
    slotIndex: number,
    prompt: string,
    _contextType: string,
    contextAssetId?: string,
  ) => {
    const contextImages: string[] = [];
    if (contextAssetId) {
      const asset = project.builderAssets.find((a) => a.id === contextAssetId);
      if (asset) contextImages.push(asset.src);
    }
    builderLogic.runGeneration(
      prompt,
      contextImages,
      slotIndex,
      setSelectedIndex,
      ui.genPanel.model,
      ui.genPanel.mode,
    );
  };

  return {
    ...ui,
    preferences,
    setPreferences,
    currentMode,
    handleSetMode,
    slicerImage: project.imageMeta,
    builderCanvas: project.builderCanvas,
    activeGrid,
    builderGrid,
    frames: project.frames,
    builderSlots: project.builderSlots,
    animations: project.animations,
    builderAssets: project.builderAssets,
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
    isPreviewActive: !!ui.bgPreviewBlobUrl,
    handleRemoveBackground,
    handlePreviewBackground,
    handleCancelPreview,
    handleAnalyzeSheet,
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
    handleRunAIProjectGen,
    handleDropContextToAI,
    handleClearAIContext,
    setBuilderCanvas,
    handleDeleteSelection,
    handleGenerateCode: exportLogic.handleGenerateCode,
    handleGenerateSlot,
  };
}
