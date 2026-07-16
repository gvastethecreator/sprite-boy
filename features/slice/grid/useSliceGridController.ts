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
  createGridLayoutDraft,
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
  readonly errorMessage: string | null;
  readonly setMode: (mode: GridLayoutMode) => void;
  readonly setManualRowsInput: (value: string) => void;
  readonly setManualColsInput: (value: string) => void;
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

export function useSliceGridController(options: UseSliceGridControllerOptions): SliceGridController {
  const inferPreview = options.inferPreview ?? inferGridPreviewLayout;
  const source = resolveSliceGridSource(options);
  const sourceRef = useRef(source);
  const inferPreviewRef = useRef(inferPreview);
  sourceRef.current = source;
  inferPreviewRef.current = inferPreview;

  const [draft, setDraft] = useState<GridLayoutDraft>(() =>
    createGridLayoutDraft(source?.dimensions ?? { width: 1, height: 1 }));
  const [manualRowsInput, setRowsInput] = useState("1");
  const [manualColsInput, setColsInput] = useState("1");
  const [validationIssues, setValidationIssues] = useState<readonly GridLayoutValidationIssue[]>([]);
  const [status, setStatus] = useState<SliceGridDetectionStatus>(source ? "detecting" : "idle");
  const [detectedLayout, setDetectedLayout] = useState<EffectiveGridLayout | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const draftRef = useRef(draft);
  const rowsInputRef = useRef(manualRowsInput);
  const colsInputRef = useRef(manualColsInput);
  const operationRef = useRef(0);
  const draftSourceGenerationRef = useRef<number | null>(null);
  const sourceKey = source ? `${source.generation}:ready` : `${options.generation}:empty`;
  draftRef.current = draft;
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
      const nextDraft = createGridLayoutDraft(current.dimensions);
      draftSourceGenerationRef.current = current.generation;
      draftRef.current = nextDraft;
      rowsInputRef.current = String(nextDraft.manual.rows);
      colsInputRef.current = String(nextDraft.manual.cols);
      setDraft(nextDraft);
      setRowsInput(String(nextDraft.manual.rows));
      setColsInput(String(nextDraft.manual.cols));
      setValidationIssues([]);
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
  }, [retryGeneration, sourceKey]);

  useEffect(() => () => {
    operationRef.current += 1;
  }, []);

  const setMode = useCallback((mode: GridLayoutMode): void => {
    const currentSource = sourceRef.current;
    if (!currentSource) return;
    const result = setGridLayoutMode(draftRef.current, mode, currentSource.dimensions);
    if (!result.ok) {
      setValidationIssues(result.issues);
      return;
    }
    draftRef.current = result.value;
    setDraft(result.value);
  }, []);

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
    draftRef.current = result.value;
    setValidationIssues([]);
    setDraft(result.value);
  }, []);

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

  return useMemo(() => ({
    sourceDimensions: source?.dimensions ?? null,
    draft,
    manualRowsInput,
    manualColsInput,
    validationIssues,
    status,
    detectedLayout,
    effectiveLayout,
    errorMessage,
    setMode,
    setManualRowsInput: updateRows,
    setManualColsInput: updateCols,
    retry,
  }), [
    detectedLayout,
    draft,
    effectiveLayout,
    errorMessage,
    manualColsInput,
    manualRowsInput,
    retry,
    source?.dimensions,
    status,
    updateCols,
    updateRows,
    validationIssues,
  ]);
}
