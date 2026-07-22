import {
  GRID_PROCESSING_LIMITS,
  type GridProcessingRectV1,
} from "./gridProcessingProtocol";

export interface GridProcessingDimensions {
  readonly width: number;
  readonly height: number;
}

export interface GridProcessingDetectionGeometry extends GridProcessingDimensions {
  /** Target width scale before integer height rounding. Always in the inclusive range (0, 1]. */
  readonly scale: number;
}

function requireInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    !Number.isFinite(value) ||
    Object.is(value, -0) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${label} must be a canonical safe integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function requireSourceDimensions(width: number, height: number): GridProcessingDimensions {
  const safeWidth = requireInteger(width, 1, GRID_PROCESSING_LIMITS.maxDimension, "width");
  const safeHeight = requireInteger(height, 1, GRID_PROCESSING_LIMITS.maxDimension, "height");
  if (safeWidth * safeHeight > GRID_PROCESSING_LIMITS.maxSourcePixels) {
    throw new TypeError("width * height exceeds the grid processing source pixel limit.");
  }
  return { width: safeWidth, height: safeHeight };
}

/** Returns internal dividers for the legacy uniform grid layout. */
export function createUniformGridBoundaries(
  totalLength: number,
  segments: number,
): readonly number[] {
  const safeLength = requireInteger(totalLength, 1, GRID_PROCESSING_LIMITS.maxDimension, "totalLength");
  const safeSegments = requireInteger(segments, 1, GRID_PROCESSING_LIMITS.maxResultCount, "segments");
  if (safeSegments > safeLength) {
    throw new TypeError("Grid segments cannot create zero-sized cells.");
  }
  const cellLength = Math.floor(safeLength / safeSegments);
  const boundaries = Array.from(
    { length: safeSegments - 1 },
    (_, index) => (index + 1) * cellLength,
  );
  return Object.freeze(boundaries);
}

function resolveGridBoundaries(
  totalLength: number,
  segments: number,
  value: readonly number[] | undefined,
  label: string,
): readonly number[] {
  const fallback = createUniformGridBoundaries(totalLength, segments);
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.length !== segments - 1) {
    throw new TypeError(`${label} must contain one divider for each internal grid edge.`);
  }
  const boundaries: number[] = [];
  let previous = 0;
  for (const boundary of value) {
    const safeBoundary = requireInteger(boundary, 1, totalLength - 1, label);
    if (safeBoundary <= previous) {
      throw new TypeError(`${label} must be strictly increasing.`);
    }
    boundaries.push(safeBoundary);
    previous = safeBoundary;
  }
  return Object.freeze(boundaries);
}

/**
 * Builds source-space cells from optional internal dividers. Missing dividers
 * retain the prior equal-size grid behavior for stored legacy recipes.
 */
export function buildManualGridFromBoundaries(
  totalWidth: number,
  totalHeight: number,
  rows: number,
  cols: number,
  rowBoundaries?: readonly number[],
  columnBoundaries?: readonly number[],
): readonly GridProcessingRectV1[] {
  const dimensions = requireSourceDimensions(totalWidth, totalHeight);
  const safeRows = requireInteger(rows, 1, GRID_PROCESSING_LIMITS.maxResultCount, "rows");
  const safeCols = requireInteger(cols, 1, GRID_PROCESSING_LIMITS.maxResultCount, "cols");
  if (
    safeRows > dimensions.height ||
    safeCols > dimensions.width ||
    safeRows * safeCols > GRID_PROCESSING_LIMITS.maxResultCount
  ) {
    throw new TypeError("Grid rows and columns cannot create zero-sized or excessive cells.");
  }

  const verticalEdges = Object.freeze([
    0,
    ...resolveGridBoundaries(dimensions.width, safeCols, columnBoundaries, "columnBoundaries"),
    dimensions.width,
  ]);
  const horizontalEdges = Object.freeze([
    0,
    ...resolveGridBoundaries(dimensions.height, safeRows, rowBoundaries, "rowBoundaries"),
    dimensions.height,
  ]);
  const cells: GridProcessingRectV1[] = [];
  for (let row = 0; row < safeRows; row += 1) {
    const y = horizontalEdges[row]!;
    const height = horizontalEdges[row + 1]! - y;
    for (let column = 0; column < safeCols; column += 1) {
      const x = verticalEdges[column]!;
      cells.push(Object.freeze({
        x,
        y,
        width: verticalEdges[column + 1]! - x,
        height,
      }));
    }
  }
  return Object.freeze(cells);
}

/** Builds exact source-space cells in row-major order. Last row/column absorb integer remainder. */
export function buildManualGrid(
  totalWidth: number,
  totalHeight: number,
  rows: number,
  cols: number,
): readonly GridProcessingRectV1[] {
  return buildManualGridFromBoundaries(totalWidth, totalHeight, rows, cols);
}

/** Scales so the longest output side equals maxSide. Pixel-stage use may intentionally upscale. */
export function getScaledDimensions(
  width: number,
  height: number,
  maxSide: number,
): GridProcessingDimensions {
  const dimensions = requireSourceDimensions(width, height);
  const safeMaxSide = requireInteger(maxSide, 1, GRID_PROCESSING_LIMITS.maxPixelSize, "maxSide");
  const output = dimensions.width >= dimensions.height
    ? {
        width: safeMaxSide,
        height: Math.max(1, Math.round(dimensions.height * (safeMaxSide / dimensions.width))),
      }
    : {
        width: Math.max(1, Math.round(dimensions.width * (safeMaxSide / dimensions.height))),
        height: safeMaxSide,
      };
  if (output.width * output.height > GRID_PROCESSING_LIMITS.maxResultPixels) {
    throw new TypeError("Scaled dimensions exceed the grid processing result pixel limit.");
  }
  return Object.freeze(output);
}

/**
 * Returns donor-width detection dimensions and a uniform scale that never upscales source pixels.
 * Portrait analysis may remain taller than maxWidth; width is the donor compatibility budget.
 */
export function getDetectionGeometry(
  width: number,
  height: number,
  maxWidth = 600,
): GridProcessingDetectionGeometry {
  const dimensions = requireSourceDimensions(width, height);
  const safeMaxWidth = requireInteger(maxWidth, 1, GRID_PROCESSING_LIMITS.maxDimension, "maxWidth");
  const scale = Math.min(1, safeMaxWidth / dimensions.width);
  return Object.freeze({
    width: scale === 1 ? dimensions.width : safeMaxWidth,
    height: Math.max(1, Math.floor(dimensions.height * scale)),
    scale,
  });
}

/** Exact removed-area fraction. Zero-sized retained content represents an empty crop. */
export function calculateReductionRatio(
  originalWidth: number,
  originalHeight: number,
  finalWidth: number,
  finalHeight: number,
): number {
  const original = requireSourceDimensions(originalWidth, originalHeight);
  const retainedWidth = requireInteger(finalWidth, 0, original.width, "finalWidth");
  const retainedHeight = requireInteger(finalHeight, 0, original.height, "finalHeight");
  const originalArea = original.width * original.height;
  const retainedArea = retainedWidth * retainedHeight;
  const ratio = (originalArea - retainedArea) / originalArea;
  return ratio === 0 ? 0 : ratio;
}
