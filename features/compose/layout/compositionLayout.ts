import type { Composition, CompositionLayout, LayerTransform } from "../../../core/project";

export const DEFAULT_COMPOSITION_LAYOUT: CompositionLayout = Object.freeze({ mode: "free" });
export const DEFAULT_GRID_LAYOUT: CompositionLayout = Object.freeze({
  mode: "grid",
  rows: 2,
  columns: 2,
  gap: 0,
});

export interface CompositionGridCell {
  readonly index: number;
  readonly row: number;
  readonly column: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerY: number;
}

export interface CompositionSourceDimensions {
  readonly width: number;
  readonly height: number;
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be positive.`);
  return value;
}

export function resolveCompositionLayout(composition: Pick<Composition, "layout">): CompositionLayout {
  return composition.layout ?? DEFAULT_COMPOSITION_LAYOUT;
}

export function createCompositionGridCells(
  canvas: CompositionSourceDimensions,
  layout: Extract<CompositionLayout, { mode: "grid" }>,
): readonly CompositionGridCell[] {
  const width = positive(canvas.width, "Canvas width");
  const height = positive(canvas.height, "Canvas height");
  const rows = positive(layout.rows, "Grid rows");
  const columns = positive(layout.columns, "Grid columns");
  if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns)) {
    throw new TypeError("Grid tracks must be safe integers.");
  }
  if (!Number.isSafeInteger(layout.gap) || layout.gap < 0) {
    throw new TypeError("Grid gap must be a non-negative safe integer.");
  }
  const usableWidth = width - layout.gap * (columns - 1);
  const usableHeight = height - layout.gap * (rows - 1);
  if (usableWidth <= 0 || usableHeight <= 0) throw new RangeError("Grid gaps leave no usable cell area.");
  const cellWidth = usableWidth / columns;
  const cellHeight = usableHeight / rows;
  const cells: CompositionGridCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * (cellWidth + layout.gap);
      const y = row * (cellHeight + layout.gap);
      cells.push(Object.freeze({
        index: row * columns + column,
        row,
        column,
        x,
        y,
        width: cellWidth,
        height: cellHeight,
        centerX: x + cellWidth / 2,
        centerY: y + cellHeight / 2,
      }));
    }
  }
  return Object.freeze(cells);
}

export function resolveCompositionDropTransform(input: {
  readonly composition: Pick<Composition, "width" | "height" | "layout">;
  readonly source: CompositionSourceDimensions;
  readonly cellIndex?: number;
}): LayerTransform {
  positive(input.composition.width, "Canvas width");
  positive(input.composition.height, "Canvas height");
  positive(input.source.width, "Source width");
  positive(input.source.height, "Source height");
  const layout = resolveCompositionLayout(input.composition);
  const area = layout.mode === "grid"
    ? createCompositionGridCells(input.composition, layout)[Math.min(
        Math.max(0, input.cellIndex ?? 0),
        layout.rows * layout.columns - 1,
      )]
    : {
        centerX: input.composition.width / 2,
        centerY: input.composition.height / 2,
        width: input.composition.width,
        height: input.composition.height,
      };
  const scale = Math.min(32, area.width / input.source.width, area.height / input.source.height);
  return Object.freeze({
    x: area.centerX,
    y: area.centerY,
    scaleX: scale,
    scaleY: scale,
    rotation: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
  });
}

export function compositionCellForPoint(
  composition: Pick<Composition, "width" | "height" | "layout">,
  point: { readonly x: number; readonly y: number },
): number | null {
  const layout = resolveCompositionLayout(composition);
  if (layout.mode !== "grid") return null;
  const cell = createCompositionGridCells(composition, layout).find((candidate) =>
    point.x >= candidate.x && point.x <= candidate.x + candidate.width &&
    point.y >= candidate.y && point.y <= candidate.y + candidate.height
  );
  return cell?.index ?? null;
}
