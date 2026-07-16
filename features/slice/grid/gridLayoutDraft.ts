import type { GridSplitRecipeV1 } from "../../../core/project";
import {
  assertGridLayoutDraft,
  type GridLayoutDraft,
  type GridLayoutValidationResult,
  validateGridLayoutDraft,
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

/** Exact GridSplitRecipeV1 layout payload consumed by processing workers. */
export function serializeGridRecipeLayout(
  value: unknown,
  source: unknown,
): GridSplitRecipeV1["layout"] {
  const draft = assertGridLayoutDraft(value, source);
  return draft.mode === "auto"
    ? Object.freeze({ mode: "auto" as const })
    : Object.freeze({ mode: "manual" as const, rows: draft.manual.rows, cols: draft.manual.cols });
}
