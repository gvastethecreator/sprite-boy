import { GridConfig, ResizeHandle, SnappingGuide } from "../types";
import { calculateGeometry } from "./renderUtils";

/** Size in pixels of resize handles drawn on frame selection. */
export const HANDLE_SIZE = 8;
/** Width in pixels of the ruler area on each canvas edge. */
export const RULER_SIZE = 24;

/** Returns which resize handle (if any) the mouse is hovering over for a given frame rect. */
export const getResizeHandle = (
  mx: number,
  my: number,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
): ResizeHandle | null => {
  const s = HANDLE_SIZE / scale;
  const half = s / 2;
  const padding = 6 / scale;

  const within = (px: number, py: number) =>
    mx >= px - half - padding &&
    mx <= px + s + padding &&
    my >= py - half - padding &&
    my <= py + s + padding;

  if (within(x - half, y - half)) return "nw";
  if (within(x + w - half, y - half)) return "ne";
  if (within(x + w - half, y + h - half)) return "se";
  if (within(x - half, y + h - half)) return "sw";
  if (within(x + w / 2 - half, y - half)) return "n";
  if (within(x + w - half, y + h / 2 - half)) return "e";
  if (within(x + w / 2 - half, y + h - half)) return "s";
  if (within(x - half, y + h / 2 - half)) return "w";

  return null;
};

/** Calculates snap offsets so a moving/resizing frame aligns to grid lines or other frames. */
export const calculateSnapping = (
  x: number,
  y: number,
  w: number,
  h: number,
  otherObjects: { x: number; y: number; w: number; h: number }[],
  canvasW: number,
  canvasH: number,
  snapThreshold: number,
  scale: number,
  enabled: boolean,
) => {
  if (!enabled) return { x, y, guides: [] };

  const guides: SnappingGuide[] = [];
  const threshold = snapThreshold / scale;

  let newX = x;
  let newY = y;

  // Targets to snap to: Canvas Edges + Centers, Other Objects Edges + Centers
  const targetsX = [0, canvasW, canvasW / 2];
  const targetsY = [0, canvasH, canvasH / 2];

  otherObjects.forEach((obj) => {
    targetsX.push(obj.x, obj.x + obj.w, obj.x + obj.w / 2);
    targetsY.push(obj.y, obj.y + obj.h, obj.y + obj.h / 2);
  });

  const myLeft = x;
  const myRight = x + w;
  const myCenterX = x + w / 2;

  const myTop = y;
  const myBottom = y + h;
  const myCenterY = y + h / 2;

  // Check Horizontal Snaps (Vertical Guides)
  for (const tx of targetsX) {
    if (Math.abs(myLeft - tx) < threshold) {
      newX = tx;
      guides.push({
        type: "vertical",
        position: tx,
        start: Math.min(y, 0),
        end: Math.max(y + h, canvasH),
      });
      break;
    }
    if (Math.abs(myRight - tx) < threshold) {
      newX = tx - w;
      guides.push({
        type: "vertical",
        position: tx,
        start: Math.min(y, 0),
        end: Math.max(y + h, canvasH),
      });
      break;
    }
    if (Math.abs(myCenterX - tx) < threshold) {
      newX = tx - w / 2;
      guides.push({
        type: "vertical",
        position: tx,
        start: Math.min(y, 0),
        end: Math.max(y + h, canvasH),
      });
      break;
    }
  }

  // Check Vertical Snaps (Horizontal Guides)
  for (const ty of targetsY) {
    if (Math.abs(myTop - ty) < threshold) {
      newY = ty;
      guides.push({
        type: "horizontal",
        position: ty,
        start: Math.min(x, 0),
        end: Math.max(x + w, canvasW),
      });
      break;
    }
    if (Math.abs(myBottom - ty) < threshold) {
      newY = ty - h;
      guides.push({
        type: "horizontal",
        position: ty,
        start: Math.min(x, 0),
        end: Math.max(x + w, canvasW),
      });
      break;
    }
    if (Math.abs(myCenterY - ty) < threshold) {
      newY = ty - h / 2;
      guides.push({
        type: "horizontal",
        position: ty,
        start: Math.min(x, 0),
        end: Math.max(x + w, canvasW),
      });
      break;
    }
  }

  return { x: newX, y: newY, guides };
};

/** Converts a canvas pixel coordinate to a grid cell index (col, row). */
export const getGridIndexFromPos = (
  x: number,
  y: number,
  canvasW: number,
  canvasH: number,
  gridConfig: GridConfig,
) => {
  const geometry = calculateGeometry(canvasW, canvasH, gridConfig);
  const { rows, cols, marginX, marginY, paddingX, paddingY, cellW, cellH } = geometry;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = marginX + c * (cellW + paddingX);
      const cy = marginY + r * (cellH + paddingY);
      if (x >= cx && x <= cx + cellW && y >= cy && y <= cy + cellH) return r * cols + c;
    }
  }
  return -1;
};
