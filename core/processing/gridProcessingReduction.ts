import { calculateReductionRatio } from "./gridProcessingGeometry";
import { GRID_PROCESSING_LIMITS } from "./gridProcessingLimits";

export const GRID_EMPTY_CELL_POLICY = "retain-transparent-1x1" as const;

export interface GridCellReductionPolicy {
  /** Grid results never skip cells; row-major identity and count stay stable. */
  readonly skip: false;
  readonly empty: boolean;
  readonly surfaceWidth: number;
  readonly surfaceHeight: number;
  readonly cropReductionRatio: number;
  readonly warning: "empty-output" | null;
}

function invalid(label: string): TypeError {
  return new TypeError(`${label} is not valid grid reduction data.`);
}

function requireArea(value: number, minimum: number, maximum: number, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    !Number.isFinite(value) ||
    Object.is(value, -0) ||
    value < minimum ||
    value > maximum
  ) {
    throw invalid(label);
  }
  return value;
}

/** Exact area-weighted crop reduction for a complete result set. */
export function calculateAggregateCropReductionRatio(
  cellPixelCount: number,
  retainedPixelCount: number,
): number {
  const cellPixels = requireArea(
    cellPixelCount,
    1,
    GRID_PROCESSING_LIMITS.maxSourcePixels,
    "cellPixelCount",
  );
  const retainedPixels = requireArea(
    retainedPixelCount,
    0,
    cellPixels,
    "retainedPixelCount",
  );
  const ratio = (cellPixels - retainedPixels) / cellPixels;
  return ratio === 0 ? 0 : ratio;
}

/**
 * Resolves the canonical per-cell crop policy.
 *
 * `null` dimensions mean empty content. Empty cells are retained as one transparent pixel;
 * they are never skipped, so layout count, index, row and column remain deterministic.
 */
export function resolveGridCellReductionPolicy(
  cellWidth: number,
  cellHeight: number,
  retainedWidth: number | null,
  retainedHeight: number | null,
): Readonly<GridCellReductionPolicy> {
  if ((retainedWidth === null) !== (retainedHeight === null)) throw invalid("retainedDimensions");
  if (retainedWidth === null || retainedHeight === null) {
    return Object.freeze({
      skip: false,
      empty: true,
      surfaceWidth: 1,
      surfaceHeight: 1,
      cropReductionRatio: calculateReductionRatio(cellWidth, cellHeight, 0, 0),
      warning: "empty-output",
    });
  }
  if (retainedWidth < 1 || retainedHeight < 1) throw invalid("retainedDimensions");
  return Object.freeze({
    skip: false,
    empty: false,
    surfaceWidth: retainedWidth,
    surfaceHeight: retainedHeight,
    cropReductionRatio: calculateReductionRatio(
      cellWidth,
      cellHeight,
      retainedWidth,
      retainedHeight,
    ),
    warning: null,
  });
}
