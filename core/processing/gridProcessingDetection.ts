import { detectGridSegments } from "./gridProcessingAlgorithms";
import { buildManualGrid } from "./gridProcessingGeometry";
import { GRID_PROCESSING_LIMITS, type GridProcessingRectV1, type GridProcessingWarningCode } from "./gridProcessingProtocol";

/**
 * The complete, source-space result of auto grid inference. This is deliberately
 * shared by the Worker and preview consumers so a detected count can never disagree
 * with the cells subsequently processed.
 */
export interface GridAutoInference {
  readonly origin: "detected" | "fallback";
  readonly rows: number;
  readonly cols: number;
  /** Exact source cells in stable row-major order. */
  readonly cells: readonly GridProcessingRectV1[];
  readonly warnings: readonly GridProcessingWarningCode[];
}

function detectedCells(
  rows: readonly { readonly start: number; readonly size: number }[],
  cols: readonly { readonly start: number; readonly size: number }[],
): readonly GridProcessingRectV1[] {
  const cells: GridProcessingRectV1[] = [];
  for (const row of rows) {
    for (const column of cols) {
      cells.push(Object.freeze({
        x: column.start,
        y: row.start,
        width: column.size,
        height: row.size,
      }));
    }
  }
  return Object.freeze(cells);
}

function fallback(width: number, height: number): GridAutoInference {
  return Object.freeze({
    origin: "fallback",
    rows: 1,
    cols: 1,
    cells: buildManualGrid(width, height, 1, 1),
    warnings: Object.freeze(["grid-detection-fallback"] as const),
  });
}

/**
 * Infers a bounded grid and materializes its cells once. A non-grid, ambiguous input,
 * or a result over the output ceiling intentionally becomes the deterministic 1x1
 * fallback rather than exposing a partial/inconsistent layout to callers.
 */
export function inferAutoGridLayout(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  maxWidth = 600,
): GridAutoInference {
  const detected = detectGridSegments(pixels, width, height, maxWidth);
  const hasRepeatedAxis = detected && (detected.rows.length > 1 || detected.cols.length > 1);
  if (
    !detected ||
    !hasRepeatedAxis ||
    detected.rows.length * detected.cols.length > GRID_PROCESSING_LIMITS.maxResultCount
  ) {
    return fallback(width, height);
  }
  return Object.freeze({
    origin: "detected",
    rows: detected.rows.length,
    cols: detected.cols.length,
    cells: detectedCells(detected.rows, detected.cols),
    warnings: Object.freeze([]),
  });
}
