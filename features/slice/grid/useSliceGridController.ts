import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GridSplitRecipeV1 } from "../../../core/project";
import { buildManualGrid } from "../../../core/processing/gridProcessingGeometry";
import { validateGridLayoutSource } from "../../../core/processing/gridLayoutValidation";
import type {
  GridProcessingRectV1,
  GridProcessingWarningCode,
} from "../../../core/processing/gridProcessingProtocol";
import type { ImageMeta } from "../../../types";
import type {
  SourceReadyMetadata,
  SourceSessionSnapshot,
} from "../source/sourceSession";
import {
  serializeGridRecipeLayout,
  setGridLayoutMode,
  setManualGridLayout,
  type GridLayoutDraft,
  type GridLayoutMode,
  type GridLayoutSourceDimensions,
  type GridLayoutValidationIssue,
} from "./gridLayoutDraft";
import {
  inferGridPreviewLayout,
  type GridPreviewInference,
  type GridPreviewSource,
} from "./gridPreviewInference";
import {
  createDefaultSliceGridRecipeState,
  hydrateSliceGridRecipeState,
  recipeStateToDraft,
  updateSliceGridRecipeLayout,
  updateSliceGridRecipeCrop,
  updateSliceGridRecipeChroma,
  updateSliceGridRecipePixel,
  type SliceGridRecipeStateV1,
} from "./gridRecipeState";

export type SliceGridDetectionStatus = "idle" | "detecting" | "detected" | "fallback" | "error";

export interface EffectiveGridLayout {
  readonly origin: "manual" | "detected" | "fallback";
  readonly rows: number;
  readonly cols: number;
  readonly cells: readonly GridProcessingRectV1[];
  readonly warnings: readonly GridProcessingWarningCode[];
  readonly recipeLayout: GridSplitRecipeV1["layout"];
}

export interface SliceGridControllerSourceOptions {
  /** Changes only after committed source replacement/reset, never candidate selection. */
  readonly generation: number;
  readonly committedMetadata: SourceReadyMetadata | null;
  readonly sessionSnapshot: SourceSessionSnapshot;
  readonly legacyImage: ImageMeta | null;
}

export interface UseSliceGridControllerOptions extends SliceGridControllerSourceOptions {
  readonly inferPreview?: GridPreviewInference;
  /** Transitional draft persisted by the current host; never a canonical ProcessingRecipe record. */
  readonly persistedState?: unknown;
  readonly sourceAssetId?: string | null;
  readonly onInitializeState?: (state: SliceGridRecipeStateV1) => void;
  readonly onCommitState?: (state: SliceGridRecipeStateV1) => void;
}

export interface SliceGridController {
  readonly sourceDimensions: GridLayoutSourceDimensions | null;
  readonly draft: GridLayoutDraft;
  readonly manualRowsInput: string;
  readonly manualColsInput: string;
  readonly validationIssues: readonly GridLayoutValidationIssue[];
  readonly status: SliceGridDetectionStatus;
  readonly detectedLayout: EffectiveGridLayout | null;
  readonly effectiveLayout: EffectiveGridLayout | null;
  readonly recipeState: SliceGridRecipeStateV1;
  readonly recipe: GridSplitRecipeV1;
  readonly errorMessage: string | null;
  readonly cropPreview: Readonly<{
    enabled: boolean;
    threshold: number;
    padding: number;
    cellCount: number;
  }>;
  readonly chroma: GridSplitRecipeV1["chroma"];
  readonly pixel: GridSplitRecipeV1["pixel"];
  readonly setMode: (mode: GridLayoutMode) => void;
  readonly setManualRowsInput: (value: string) => void;
  readonly setManualColsInput: (value: string) => void;
  readonly setCropThreshold: (value: number) => boolean;
  readonly setCropPadding: (value: number) => boolean;
  readonly resetCrop: () => boolean;
  readonly setChromaEnabled: (value: boolean) => boolean;
  readonly setChromaColor: (value: string) => boolean;
  readonly setChromaTolerance: (value: number) => boolean;
  readonly setChromaSmoothness: (value: number) => boolean;
  readonly setChromaSpill: (value: number) => boolean;
  readonly resetChroma: () => boolean;
  readonly setPixelEnabled: (value: boolean) => boolean;
  readonly setPixelSize: (value: number) => boolean;
  readonly setPixelQuantize: (value: boolean) => boolean;
  readonly setPixelColors: (value: number) => boolean;
  readonly setPixelPalette: (value: readonly string[] | undefined) => boolean;
  readonly setPixelAutoPalette: () => boolean;
  readonly setPixelFixedPalette: (value: readonly string[]) => boolean;
  readonly resetPixel: () => boolean;
  readonly retry: () => void;
}

interface ResolvedGridSource {
  readonly generation: number;
  readonly dimensions: GridLayoutSourceDimensions;
  readonly preview: GridPreviewSource;
}

function validDimensions(value: { readonly width: number; readonly height: number } | null):
  GridLayoutSourceDimensions | null {
  if (!value) return null;
  const result = validateGridLayoutSource({ width: value.width, height: value.height });
  return result.ok ? result.value : null;
}

/** Committed metadata wins; session and legacy metadata are migration fallbacks. */
export function resolveSliceGridSource(options: SliceGridControllerSourceOptions):
  ResolvedGridSource | null {
  const sessionMetadata = options.sessionSnapshot.metadata;
  const dimensions = validDimensions(options.committedMetadata) ??
    validDimensions(sessionMetadata) ?? validDimensions(options.legacyImage);
  if (!dimensions) return null;

  const sessionSource = options.sessionSnapshot.source;
  const sessionImage = sessionSource &&
    sessionSource.width === dimensions.width && sessionSource.height === dimensions.height
    ? sessionSource.image
    : null;
  const legacyUrl = typeof options.legacyImage?.src === "string" && options.legacyImage.src.length > 0
    ? options.legacyImage.src
    : null;
  if (sessionImage === null && legacyUrl === null) return null;

  return Object.freeze({
    generation: options.generation,
    dimensions,
    preview: Object.freeze({
      width: dimensions.width,
      height: dimensions.height,
      image: sessionImage,
      legacyUrl,
    }),
  });
}

function parseInput(value: string): number {
  if (value.trim() === "") return Number.NaN;
  return Number(value);
}

function safeDetectionError(): string {
  return "Grid detection could not analyze this source. Your manual values are still available.";
}

function manualLayout(
  draft: GridLayoutDraft,
  dimensions: GridLayoutSourceDimensions,
): EffectiveGridLayout {
  return Object.freeze({
    origin: "manual" as const,
    rows: draft.manual.rows,
    cols: draft.manual.cols,
    cells: buildManualGrid(dimensions.width, dimensions.height, draft.manual.rows, draft.manual.cols),
    warnings: Object.freeze([]),
    recipeLayout: serializeGridRecipeLayout(draft, dimensions),
  });
}

function migrationSourceAssetId(
  source: ResolvedGridSource | null,
  requested: string | null | undefined,
): string {
  if (typeof requested === "string" && requested.trim().length > 0 && requested.length <= 256) {
    return requested;
  }
  if (!source) return "slice-source:empty";
  return `slice-source:${source.generation}:${source.dimensions.width}x${source.dimensions.height}`;
}

function compatiblePersistedState(
  value: unknown,
  source: ResolvedGridSource,
  requestedSourceAssetId: string | null | undefined,
): SliceGridRecipeStateV1 | null {
  const hydrated = hydrateSliceGridRecipeState(value, source.dimensions);
  if (!hydrated) return null;
  if (typeof requestedSourceAssetId !== "string" || requestedSourceAssetId.trim().length === 0 ||
    requestedSourceAssetId.length > 256) return hydrated;
  return hydrated.recipe.sourceAssetId === requestedSourceAssetId ? hydrated : null;
}

function initialRecipeState(
  source: ResolvedGridSource | null,
  options: Pick<UseSliceGridControllerOptions, "persistedState" | "sourceAssetId">,
): SliceGridRecipeStateV1 {
  const dimensions = source?.dimensions ?? { width: 1, height: 1 };
  const hydrated = source
    ? compatiblePersistedState(options.persistedState, source, options.sourceAssetId)
    : hydrateSliceGridRecipeState(options.persistedState, dimensions);
  return hydrated ??
    createDefaultSliceGridRecipeState(
      migrationSourceAssetId(source, options.sourceAssetId),
      dimensions,
    );
}

export function useSliceGridController(options: UseSliceGridControllerOptions): SliceGridController {
  const inferPreview = options.inferPreview ?? inferGridPreviewLayout;
  const source = resolveSliceGridSource(options);
  const sourceRef = useRef(source);
  const inferPreviewRef = useRef(inferPreview);
  sourceRef.current = source;
  inferPreviewRef.current = inferPreview;

  const [recipeState, setRecipeState] = useState<SliceGridRecipeStateV1>(() =>
    initialRecipeState(source, options));
  const initialDraft = recipeStateToDraft(recipeState);
  const [draft, setDraft] = useState<GridLayoutDraft>(initialDraft);
  const [manualRowsInput, setRowsInput] = useState(String(initialDraft.manual.rows));
  const [manualColsInput, setColsInput] = useState(String(initialDraft.manual.cols));
  const [validationIssues, setValidationIssues] = useState<readonly GridLayoutValidationIssue[]>([]);
  const [status, setStatus] = useState<SliceGridDetectionStatus>(source ? "detecting" : "idle");
  const [detectedLayout, setDetectedLayout] = useState<EffectiveGridLayout | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const draftRef = useRef(draft);
  const recipeStateRef = useRef(recipeState);
  const rowsInputRef = useRef(manualRowsInput);
  const colsInputRef = useRef(manualColsInput);
  const operationRef = useRef(0);
  const draftSourceGenerationRef = useRef<number | null>(null);
  const sourceKey = source ? `${source.generation}:ready` : `${options.generation}:empty`;
  draftRef.current = draft;
  recipeStateRef.current = recipeState;
  rowsInputRef.current = manualRowsInput;
  colsInputRef.current = manualColsInput;

  useEffect(() => {
    const operation = ++operationRef.current;
    const current = sourceRef.current;
    const controller = new AbortController();

    if (!current) {
      setStatus("idle");
      setDetectedLayout(null);
      setErrorMessage(null);
      return () => controller.abort();
    }

    if (draftSourceGenerationRef.current !== current.generation) {
      const hydrated = compatiblePersistedState(
        options.persistedState,
        current,
        options.sourceAssetId,
      );
      const nextRecipeState = hydrated ?? createDefaultSliceGridRecipeState(
        migrationSourceAssetId(current, options.sourceAssetId),
        current.dimensions,
      );
      const nextDraft = recipeStateToDraft(nextRecipeState);
      draftSourceGenerationRef.current = current.generation;
      draftRef.current = nextDraft;
      recipeStateRef.current = nextRecipeState;
      rowsInputRef.current = String(nextDraft.manual.rows);
      colsInputRef.current = String(nextDraft.manual.cols);
      setRecipeState(nextRecipeState);
      setDraft(nextDraft);
      setRowsInput(String(nextDraft.manual.rows));
      setColsInput(String(nextDraft.manual.cols));
      setValidationIssues([]);
      if (!hydrated) {
        try {
          options.onInitializeState?.(nextRecipeState);
        } catch {
          // Host persistence is isolated from grid inference and rendering.
        }
      }
    }
    setStatus("detecting");
    setDetectedLayout(null);
    setErrorMessage(null);

    void inferPreviewRef.current(current.preview, controller.signal).then((inference) => {
      if (controller.signal.aborted || operationRef.current !== operation) return;
      const recipeLayout = Object.freeze({ mode: "auto" as const });
      setDetectedLayout(Object.freeze({
        origin: inference.origin,
        rows: inference.rows,
        cols: inference.cols,
        cells: inference.cells,
        warnings: inference.warnings,
        recipeLayout,
      }));
      setStatus(inference.origin === "fallback" ? "fallback" : "detected");
    }).catch((error: unknown) => {
      if (controller.signal.aborted || operationRef.current !== operation) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setDetectedLayout(null);
      setStatus("error");
      setErrorMessage(safeDetectionError());
    });

    return () => controller.abort();
  }, [options.sourceAssetId, retryGeneration, sourceKey]);

  useEffect(() => {
    const current = sourceRef.current;
    if (!current) return;
    const hydrated = compatiblePersistedState(
      options.persistedState,
      current,
      options.sourceAssetId,
    );
    if (!hydrated || hydrated === recipeStateRef.current) return;
    const currentSerialized = JSON.stringify(recipeStateRef.current);
    const nextSerialized = JSON.stringify(hydrated);
    if (currentSerialized === nextSerialized) return;
    const nextDraft = recipeStateToDraft(hydrated);
    recipeStateRef.current = hydrated;
    draftRef.current = nextDraft;
    rowsInputRef.current = String(nextDraft.manual.rows);
    colsInputRef.current = String(nextDraft.manual.cols);
    setRecipeState(hydrated);
    setDraft(nextDraft);
    setRowsInput(String(nextDraft.manual.rows));
    setColsInput(String(nextDraft.manual.cols));
    setValidationIssues([]);
  }, [options.persistedState, options.sourceAssetId, sourceKey]);

  useEffect(() => () => {
    operationRef.current += 1;
  }, []);

  const commitDraft = useCallback((nextDraft: GridLayoutDraft): boolean => {
    const currentSource = sourceRef.current;
    if (!currentSource) return false;
    const nextState = updateSliceGridRecipeLayout(
      recipeStateRef.current,
      nextDraft,
      currentSource.dimensions,
    );
    try {
      options.onCommitState?.(nextState);
    } catch {
      return false;
    }
    recipeStateRef.current = nextState;
    draftRef.current = nextDraft;
    setRecipeState(nextState);
    setDraft(nextDraft);
    return true;
  }, [options.onCommitState]);

  const commitCrop = useCallback((threshold: number, padding: number): boolean => {
    if (!sourceRef.current) return false;
    const currentCrop = recipeStateRef.current.recipe.crop;
    if (currentCrop.threshold === threshold && currentCrop.padding === padding) return true;
    let nextState: SliceGridRecipeStateV1;
    try {
      nextState = updateSliceGridRecipeCrop(recipeStateRef.current, { threshold, padding });
    } catch {
      return false;
    }
    try {
      options.onCommitState?.(nextState);
    } catch {
      return false;
    }
    recipeStateRef.current = nextState;
    setRecipeState(nextState);
    return true;
  }, [options.onCommitState]);

  const commitChroma = useCallback((chroma: GridSplitRecipeV1["chroma"]): boolean => {
    if (!sourceRef.current) return false;
    const currentChroma = recipeStateRef.current.recipe.chroma;
    if (currentChroma.enabled === chroma.enabled && currentChroma.color === chroma.color &&
      currentChroma.tolerance === chroma.tolerance && currentChroma.smoothness === chroma.smoothness &&
      currentChroma.spill === chroma.spill) return true;
    let nextState: SliceGridRecipeStateV1;
    try {
      nextState = updateSliceGridRecipeChroma(recipeStateRef.current, chroma);
    } catch {
      return false;
    }
    try {
      options.onCommitState?.(nextState);
    } catch {
      return false;
    }
    recipeStateRef.current = nextState;
    setRecipeState(nextState);
    return true;
  }, [options.onCommitState]);

  const commitPixel = useCallback((pixel: GridSplitRecipeV1["pixel"]): boolean => {
    if (!sourceRef.current) return false;
    const currentPixel = recipeStateRef.current.recipe.pixel;
    if (currentPixel.enabled === pixel.enabled && currentPixel.size === pixel.size &&
      currentPixel.quantize === pixel.quantize && currentPixel.colors === pixel.colors &&
      JSON.stringify(currentPixel.palette) === JSON.stringify(pixel.palette)) return true;
    let nextState: SliceGridRecipeStateV1;
    try {
      nextState = updateSliceGridRecipePixel(recipeStateRef.current, pixel);
    } catch {
      return false;
    }
    try {
      options.onCommitState?.(nextState);
    } catch {
      return false;
    }
    recipeStateRef.current = nextState;
    setRecipeState(nextState);
    return true;
  }, [options.onCommitState]);

  const setMode = useCallback((mode: GridLayoutMode): void => {
    const currentSource = sourceRef.current;
    if (!currentSource) return;
    const result = setGridLayoutMode(draftRef.current, mode, currentSource.dimensions);
    if (!result.ok) {
      setValidationIssues(result.issues);
      return;
    }
    commitDraft(result.value);
  }, [commitDraft]);

  const updateManual = useCallback((rowsInput: string, colsInput: string): void => {
    const currentSource = sourceRef.current;
    if (!currentSource) return;
    const result = setManualGridLayout(draftRef.current, {
      rows: parseInput(rowsInput),
      cols: parseInput(colsInput),
    }, currentSource.dimensions);
    if (!result.ok) {
      setValidationIssues(result.issues);
      return;
    }
    if (!commitDraft(result.value)) return;
    setValidationIssues([]);
  }, [commitDraft]);

  const updateRows = useCallback((value: string): void => {
    rowsInputRef.current = value;
    setRowsInput(value);
    updateManual(value, colsInputRef.current);
  }, [updateManual]);

  const updateCols = useCallback((value: string): void => {
    colsInputRef.current = value;
    setColsInput(value);
    updateManual(rowsInputRef.current, value);
  }, [updateManual]);

  const effectiveLayout = useMemo(() => {
    if (!source) return null;
    if (draft.mode !== "manual") return detectedLayout;
    // A committed replacement renders once before its reset effect. Never let
    // old manual values escape against new, smaller source dimensions.
    try {
      return manualLayout(draft, source.dimensions);
    } catch {
      return null;
    }
  }, [detectedLayout, draft, source]);

  const retry = useCallback(() => setRetryGeneration((value) => value + 1), []);
  const setCropThreshold = useCallback((value: number): boolean => {
    return commitCrop(value, recipeStateRef.current.recipe.crop.padding);
  }, [commitCrop]);
  const setCropPadding = useCallback((value: number): boolean => {
    return commitCrop(recipeStateRef.current.recipe.crop.threshold, value);
  }, [commitCrop]);
  const resetCrop = useCallback((): boolean => {
    return commitCrop(0, 0);
  }, [commitCrop]);
  const setChromaEnabled = useCallback((value: boolean): boolean => {
    return commitChroma({ ...recipeStateRef.current.recipe.chroma, enabled: value });
  }, [commitChroma]);
  const setChromaColor = useCallback((value: string): boolean => {
    return commitChroma({ ...recipeStateRef.current.recipe.chroma, color: value });
  }, [commitChroma]);
  const setChromaTolerance = useCallback((value: number): boolean => {
    return commitChroma({ ...recipeStateRef.current.recipe.chroma, tolerance: value });
  }, [commitChroma]);
  const setChromaSmoothness = useCallback((value: number): boolean => {
    return commitChroma({ ...recipeStateRef.current.recipe.chroma, smoothness: value });
  }, [commitChroma]);
  const setChromaSpill = useCallback((value: number): boolean => {
    return commitChroma({ ...recipeStateRef.current.recipe.chroma, spill: value });
  }, [commitChroma]);
  const resetChroma = useCallback((): boolean => {
    return commitChroma({
      enabled: false,
      color: "#00ff00",
      tolerance: 0,
      smoothness: 0,
      spill: 0,
    });
  }, [commitChroma]);
  const setPixelEnabled = useCallback((value: boolean): boolean => {
    return commitPixel({ ...recipeStateRef.current.recipe.pixel, enabled: value });
  }, [commitPixel]);
  const setPixelSize = useCallback((value: number): boolean => {
    return commitPixel({ ...recipeStateRef.current.recipe.pixel, size: value });
  }, [commitPixel]);
  const setPixelQuantize = useCallback((value: boolean): boolean => {
    return commitPixel({ ...recipeStateRef.current.recipe.pixel, quantize: value });
  }, [commitPixel]);
  const setPixelColors = useCallback((value: number): boolean => {
    return commitPixel({ ...recipeStateRef.current.recipe.pixel, colors: value });
  }, [commitPixel]);
  const setPixelPalette = useCallback((value: readonly string[] | undefined): boolean => {
    const current = recipeStateRef.current.recipe.pixel;
    const next: GridSplitRecipeV1["pixel"] = {
      enabled: current.enabled,
      size: current.size,
      quantize: current.quantize,
      colors: current.colors,
      ...(value ? { palette: [...value] } : {}),
    };
    return commitPixel(next);
  }, [commitPixel]);
  const setPixelAutoPalette = useCallback((): boolean => {
    const current = recipeStateRef.current.recipe.pixel;
    return commitPixel({
      enabled: current.enabled,
      size: current.size,
      quantize: true,
      colors: current.colors,
    });
  }, [commitPixel]);
  const setPixelFixedPalette = useCallback((value: readonly string[]): boolean => {
    const current = recipeStateRef.current.recipe.pixel;
    return commitPixel({
      enabled: current.enabled,
      size: current.size,
      quantize: false,
      colors: current.colors,
      palette: [...value],
    });
  }, [commitPixel]);
  const resetPixel = useCallback((): boolean => {
    return commitPixel({ enabled: false, size: 16, quantize: false, colors: 16 });
  }, [commitPixel]);
  const cropPreview = useMemo(() => Object.freeze({
    enabled: recipeState.recipe.crop.threshold > 0,
    threshold: recipeState.recipe.crop.threshold,
    padding: recipeState.recipe.crop.padding,
    cellCount: effectiveLayout?.cells.length ?? 0,
  }), [effectiveLayout?.cells.length, recipeState.recipe.crop]);

  return useMemo(() => ({
    sourceDimensions: source?.dimensions ?? null,
    draft,
    manualRowsInput,
    manualColsInput,
    validationIssues,
    status,
    detectedLayout,
    effectiveLayout,
    recipeState,
    recipe: recipeState.recipe,
    errorMessage,
    cropPreview,
    chroma: recipeState.recipe.chroma,
    pixel: recipeState.recipe.pixel,
    setMode,
    setManualRowsInput: updateRows,
    setManualColsInput: updateCols,
    setCropThreshold,
    setCropPadding,
    resetCrop,
    setChromaEnabled,
    setChromaColor,
    setChromaTolerance,
    setChromaSmoothness,
    setChromaSpill,
    resetChroma,
    setPixelEnabled,
    setPixelSize,
    setPixelQuantize,
    setPixelColors,
    setPixelPalette,
    setPixelAutoPalette,
    setPixelFixedPalette,
    resetPixel,
    retry,
  }), [
    cropPreview,
    setChromaColor,
    setChromaEnabled,
    setChromaSmoothness,
    setChromaSpill,
    setChromaTolerance,
    setPixelColors,
    setPixelAutoPalette,
    setPixelEnabled,
    setPixelFixedPalette,
    setPixelPalette,
    setPixelQuantize,
    setPixelSize,
    resetChroma,
    resetPixel,
    detectedLayout,
    draft,
    effectiveLayout,
    errorMessage,
    manualColsInput,
    manualRowsInput,
    resetCrop,
    retry,
    recipeState,
    source?.dimensions,
    status,
    setCropPadding,
    setCropThreshold,
    updateCols,
    updateRows,
    validationIssues,
  ]);
}
