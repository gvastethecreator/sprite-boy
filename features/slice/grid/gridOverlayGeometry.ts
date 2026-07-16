import {
  GRID_PROCESSING_LIMITS,
  type GridProcessingRectV1,
} from "../../../core/processing/gridProcessingProtocol";

export interface GridOverlayTransform {
  /** Source-pixel to CSS-pixel scale. */
  readonly scale: number;
  /** Source origin in overlay-local CSS pixels. */
  readonly offset: Readonly<{ x: number; y: number }>;
}

export interface GridOverlaySurface {
  /** Overlay size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** CSS-to-device-pixel ratio used by the backing canvas. */
  readonly devicePixelRatio: number;
}

export interface GridOverlayRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GridOverlayRectProjection {
  readonly index: number;
  readonly source: GridProcessingRectV1;
  readonly css: GridOverlayRect;
  readonly device: GridOverlayRect;
}

export interface GridOverlayProjection {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly transform: GridOverlayTransform;
  readonly surface: GridOverlaySurface;
  readonly backingWidth: number;
  readonly backingHeight: number;
  readonly sourceBoundsCss: GridOverlayRect;
  readonly sourceBoundsDevice: GridOverlayRect;
  readonly cells: readonly GridOverlayRectProjection[];
}

const MAX_CSS_SURFACE = 65_536;
const MAX_DEVICE_PIXEL_RATIO = 8;
const MAX_SCALE = 4_096;
const MAX_ABSOLUTE_OFFSET = 1_000_000_000;

function requireCanonicalInteger(
  value: unknown,
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
    throw new TypeError(`${label} is not a canonical grid overlay integer.`);
  }
  return value;
}

function requireCanonicalNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Object.is(value, -0) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${label} is not a canonical grid overlay number.`);
  }
  return value;
}

function readOwnData(record: unknown, key: string): unknown {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("Grid overlay input must be an object.");
  }
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError(`Grid overlay ${key} must be own data.`);
  }
  return descriptor.value;
}

function exactOwnDataRecord(record: unknown, keys: readonly string[]): void {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("Grid overlay input must be an object.");
  }
  let ownKeys: readonly PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(record);
  } catch {
    throw new TypeError("Grid overlay input could not be inspected.");
  }
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string") ||
    keys.some((key) => !ownKeys.includes(key))
  ) {
    throw new TypeError("Grid overlay input has an invalid shape.");
  }
}

function readCells(value: unknown, sourceWidth: number, sourceHeight: number) {
  if (!Array.isArray(value)) throw new TypeError("Grid overlay cells must be an array.");
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !length ||
    !("value" in length) ||
    !Number.isSafeInteger(length.value) ||
    length.value < 1 ||
    length.value > GRID_PROCESSING_LIMITS.maxResultCount ||
    Reflect.ownKeys(value).length !== length.value + 1
  ) {
    throw new TypeError("Grid overlay cells have an invalid length.");
  }

  const output: GridProcessingRectV1[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const cellDescriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!cellDescriptor || !("value" in cellDescriptor) || !cellDescriptor.enumerable) {
      throw new TypeError("Grid overlay cells must be dense own data.");
    }
    const cell = cellDescriptor.value;
    exactOwnDataRecord(cell, ["x", "y", "width", "height"]);
    const x = requireCanonicalInteger(readOwnData(cell, "x"), 0, sourceWidth - 1, "cell.x");
    const y = requireCanonicalInteger(readOwnData(cell, "y"), 0, sourceHeight - 1, "cell.y");
    const width = requireCanonicalInteger(readOwnData(cell, "width"), 1, sourceWidth, "cell.width");
    const height = requireCanonicalInteger(readOwnData(cell, "height"), 1, sourceHeight, "cell.height");
    if (x + width > sourceWidth || y + height > sourceHeight) {
      throw new TypeError("Grid overlay cell exceeds the source bounds.");
    }
    output.push(Object.freeze({ x, y, width, height }));
  }
  return Object.freeze(output);
}

function projectRect(
  rect: GridProcessingRectV1,
  scale: number,
  offsetX: number,
  offsetY: number,
): GridOverlayRect {
  const left = offsetX + rect.x * scale;
  const top = offsetY + rect.y * scale;
  const right = offsetX + (rect.x + rect.width) * scale;
  const bottom = offsetY + (rect.y + rect.height) * scale;
  return Object.freeze({ x: left, y: top, width: right - left, height: bottom - top });
}

function cssRectToDevice(rect: GridOverlayRect, dpr: number): GridOverlayRect {
  const left = rect.x * dpr;
  const top = rect.y * dpr;
  const right = (rect.x + rect.width) * dpr;
  const bottom = (rect.y + rect.height) * dpr;
  return Object.freeze({ x: left, y: top, width: right - left, height: bottom - top });
}

/**
 * Projects immutable source-space cell geometry into CSS and backing-device pixels.
 * No viewport clipping or integer snapping is applied, so adjacent source edges stay exact
 * through fractional zoom, pan, browser zoom and device-pixel-ratio changes.
 */
export function projectGridOverlay(
  cellsValue: unknown,
  sourceWidthValue: unknown,
  sourceHeightValue: unknown,
  transformValue: unknown,
  surfaceValue: unknown,
): GridOverlayProjection {
  const sourceWidth = requireCanonicalInteger(
    sourceWidthValue,
    1,
    GRID_PROCESSING_LIMITS.maxDimension,
    "sourceWidth",
  );
  const sourceHeight = requireCanonicalInteger(
    sourceHeightValue,
    1,
    GRID_PROCESSING_LIMITS.maxDimension,
    "sourceHeight",
  );
  if (sourceWidth * sourceHeight > GRID_PROCESSING_LIMITS.maxSourcePixels) {
    throw new TypeError("Grid overlay source dimensions exceed the processing limit.");
  }
  const cells = readCells(cellsValue, sourceWidth, sourceHeight);

  exactOwnDataRecord(transformValue, ["scale", "offset"]);
  const scale = requireCanonicalNumber(readOwnData(transformValue, "scale"), Number.EPSILON, MAX_SCALE, "scale");
  const offsetValue = readOwnData(transformValue, "offset");
  exactOwnDataRecord(offsetValue, ["x", "y"]);
  const offsetX = requireCanonicalNumber(
    readOwnData(offsetValue, "x"),
    -MAX_ABSOLUTE_OFFSET,
    MAX_ABSOLUTE_OFFSET,
    "offset.x",
  );
  const offsetY = requireCanonicalNumber(
    readOwnData(offsetValue, "y"),
    -MAX_ABSOLUTE_OFFSET,
    MAX_ABSOLUTE_OFFSET,
    "offset.y",
  );

  exactOwnDataRecord(surfaceValue, ["width", "height", "devicePixelRatio"]);
  const surfaceWidth = requireCanonicalNumber(readOwnData(surfaceValue, "width"), 0, MAX_CSS_SURFACE, "surface.width");
  const surfaceHeight = requireCanonicalNumber(readOwnData(surfaceValue, "height"), 0, MAX_CSS_SURFACE, "surface.height");
  const dpr = requireCanonicalNumber(
    readOwnData(surfaceValue, "devicePixelRatio"),
    0.25,
    MAX_DEVICE_PIXEL_RATIO,
    "surface.devicePixelRatio",
  );
  const backingWidth = Math.round(surfaceWidth * dpr);
  const backingHeight = Math.round(surfaceHeight * dpr);
  if (backingWidth > MAX_CSS_SURFACE * MAX_DEVICE_PIXEL_RATIO ||
    backingHeight > MAX_CSS_SURFACE * MAX_DEVICE_PIXEL_RATIO) {
    throw new TypeError("Grid overlay backing size exceeds the safe limit.");
  }

  const transform = Object.freeze({ scale, offset: Object.freeze({ x: offsetX, y: offsetY }) });
  const surface = Object.freeze({ width: surfaceWidth, height: surfaceHeight, devicePixelRatio: dpr });
  const sourceRect = Object.freeze({ x: 0, y: 0, width: sourceWidth, height: sourceHeight });
  const sourceBoundsCss = projectRect(sourceRect, scale, offsetX, offsetY);
  const sourceBoundsDevice = cssRectToDevice(sourceBoundsCss, dpr);
  const projectedCells = cells.map((source, index): GridOverlayRectProjection => {
    const css = projectRect(source, scale, offsetX, offsetY);
    return Object.freeze({ index, source, css, device: cssRectToDevice(css, dpr) });
  });
  return Object.freeze({
    sourceWidth,
    sourceHeight,
    transform,
    surface,
    backingWidth,
    backingHeight,
    sourceBoundsCss,
    sourceBoundsDevice,
    cells: Object.freeze(projectedCells),
  });
}

export interface GridOverlayPaintStyle {
  readonly lineColor: string;
  readonly fillColor: string;
  readonly outerLineColor: string;
  readonly lineWidthCss: number;
}

export const DEFAULT_GRID_OVERLAY_PAINT_STYLE: GridOverlayPaintStyle = Object.freeze({
  lineColor: "rgba(125, 211, 252, 0.92)",
  fillColor: "rgba(14, 165, 233, 0.055)",
  outerLineColor: "rgba(224, 242, 254, 0.98)",
  lineWidthCss: 1,
});

/** Paints one deterministic frame; callers schedule only on input/size changes. */
export function paintGridOverlay(
  context: CanvasRenderingContext2D,
  projection: GridOverlayProjection,
  style: GridOverlayPaintStyle = DEFAULT_GRID_OVERLAY_PAINT_STYLE,
): void {
  const { backingWidth, backingHeight, surface, cells, sourceBoundsCss } = projection;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, backingWidth, backingHeight);
  if (backingWidth === 0 || backingHeight === 0) return;
  context.setTransform(surface.devicePixelRatio, 0, 0, surface.devicePixelRatio, 0, 0);
  context.lineWidth = style.lineWidthCss;
  context.fillStyle = style.fillColor;
  context.strokeStyle = style.lineColor;
  context.beginPath();
  for (const cell of cells) {
    context.rect(cell.css.x, cell.css.y, cell.css.width, cell.css.height);
  }
  context.fill();
  context.stroke();
  context.strokeStyle = style.outerLineColor;
  context.strokeRect(
    sourceBoundsCss.x,
    sourceBoundsCss.y,
    sourceBoundsCss.width,
    sourceBoundsCss.height,
  );
  context.setTransform(1, 0, 0, 1, 0, 0);
}
