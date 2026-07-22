import type { Rect } from "../../../core/project/schema";

export type ManualRegionResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export interface ManualRegionSourceDimensions {
  readonly width: number;
  readonly height: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export function moveManualRegionBounds(
  bounds: Readonly<Rect>,
  deltaX: number,
  deltaY: number,
  source: ManualRegionSourceDimensions,
): Readonly<Rect> {
  return Object.freeze({
    ...bounds,
    x: clamp(bounds.x + deltaX, 0, Math.max(0, source.width - bounds.width)),
    y: clamp(bounds.y + deltaY, 0, Math.max(0, source.height - bounds.height)),
  });
}

export function resizeManualRegionBounds(
  bounds: Readonly<Rect>,
  handle: ManualRegionResizeHandle,
  deltaX: number,
  deltaY: number,
  source: ManualRegionSourceDimensions,
): Readonly<Rect> {
  let left = bounds.x;
  let top = bounds.y;
  let right = bounds.x + bounds.width;
  let bottom = bounds.y + bounds.height;

  if (handle.includes("w")) left = clamp(left + deltaX, 0, right - 1);
  if (handle.includes("e")) right = clamp(right + deltaX, left + 1, source.width);
  if (handle.includes("n")) top = clamp(top + deltaY, 0, bottom - 1);
  if (handle.includes("s")) bottom = clamp(bottom + deltaY, top + 1, source.height);

  return Object.freeze({ x: left, y: top, width: right - left, height: bottom - top });
}

export function sameManualRegionBounds(left: Readonly<Rect>, right: Readonly<Rect>): boolean {
  return left.x === right.x && left.y === right.y
    && left.width === right.width && left.height === right.height;
}
