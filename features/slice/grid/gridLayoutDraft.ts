import type { GridSplitRecipeV1 } from "../../../core/project";
import { createUniformGridBoundaries } from "../../../core/processing/gridProcessingGeometry";
import {
  assertGridLayoutDraft,
  type GridLayoutDraft,
  type GridLayoutValidationResult,
  validateGridLayoutDraft,
  validateGridLayoutSource,
} from "../../../core/processing/gridLayoutValidation";

export {
  assertGridLayoutDraft,
  type GridLayoutDraft,
  type GridLayoutMode,
  type GridLayoutSourceDimensions,
  type GridLayoutValidationCode,
  type GridLayoutValidationIssue,
  type GridLayoutValidationPath,
  type GridLayoutValidationResult,
  validateGridLayoutDraft,
} from "../../../core/processing/gridLayoutValidation";

export function createGridLayoutDraft(
  source: unknown,
  manual: unknown = { rows: 1, cols: 1 },
): GridLayoutDraft {
  return assertGridLayoutDraft({ mode: "auto", manual }, source);
}

/** Mode-only transition: the nested manual choice is copied exactly. */
export function setGridLayoutMode(
  value: unknown,
  mode: unknown,
  source: unknown,
): GridLayoutValidationResult {
  const current = validateGridLayoutDraft(value, source);
  if (!current.ok) return current;
  return validateGridLayoutDraft({ mode, manual: current.value.manual }, source);
}

/** Manual edit that retains the current mode; no invalid input is clamped. */
export function setManualGridLayout(
  value: unknown,
  manual: unknown,
  source: unknown,
): GridLayoutValidationResult {
  const current = validateGridLayoutDraft(value, source);
  if (!current.ok) return current;
  return validateGridLayoutDraft({ mode: current.value.mode, manual }, source);
}

export type GridManualBoundaryAxis = "row" | "column";

/**
 * Updates one internal manual divider in source pixels. A legacy uniform
 * layout gains explicit dividers only when the user first resizes it.
 */
export function setManualGridBoundary(
  value: unknown,
  axis: GridManualBoundaryAxis,
  index: number,
  boundary: number,
  source: unknown,
): GridLayoutValidationResult {
  const current = validateGridLayoutDraft(value, source);
  if (!current.ok) return current;
  const sourceResult = validateGridLayoutSource(source);
  if (!sourceResult.ok) return sourceResult;

  const rows = current.value.manual.rows;
  const cols = current.value.manual.cols;
  const rowBoundaries = current.value.manual.rowBoundaries
    ? [...current.value.manual.rowBoundaries]
    : [...createUniformGridBoundaries(sourceResult.value.height, rows)];
  const columnBoundaries = current.value.manual.columnBoundaries
    ? [...current.value.manual.columnBoundaries]
    : [...createUniformGridBoundaries(sourceResult.value.width, cols)];
  const target = axis === "row" ? rowBoundaries : columnBoundaries;
  if (!Number.isSafeInteger(index) || index < 0 || index >= target.length) return current;
  target[index] = boundary;
  return validateGridLayoutDraft({
    mode: current.value.mode,
    manual: { rows, cols, rowBoundaries, columnBoundaries },
  }, source);
}

/** Exact GridSplitRecipeV1 layout payload consumed by processing workers. */
export function serializeGridRecipeLayout(
  value: unknown,
  source: unknown,
): GridSplitRecipeV1["layout"] {
  const draft = assertGridLayoutDraft(value, source);
  return draft.mode === "auto"
    ? Object.freeze({ mode: "auto" as const })
    : Object.freeze({
        mode: "manual" as const,
        rows: draft.manual.rows,
        cols: draft.manual.cols,
        ...(draft.manual.rowBoundaries && draft.manual.columnBoundaries
          ? {
              rowBoundaries: Object.freeze([...draft.manual.rowBoundaries]),
              columnBoundaries: Object.freeze([...draft.manual.columnBoundaries]),
            }
          : {}),
      });
}
