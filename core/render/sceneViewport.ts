import type { WorkspaceViewport } from "../stores";
import type { SceneAffineMatrix } from "./affine";

export const MAX_SCENE_VIEWPORT_EDGE = 16_384;
export const MAX_SCENE_VIEWPORT_PIXELS = 64_000_000;

export interface SceneViewportMetrics {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly devicePixelRatio: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

export type SceneViewportErrorCode =
  | "SCENE_VIEWPORT_INVALID_METRICS"
  | "SCENE_VIEWPORT_DIMENSIONS_EXCEEDED";

export class SceneViewportError extends Error {
  readonly code: SceneViewportErrorCode;

  constructor(code: SceneViewportErrorCode, message: string) {
    super(message);
    this.name = "SceneViewportError";
    this.code = code;
  }
}

function invalidMetrics(message: string): SceneViewportError {
  return new SceneViewportError("SCENE_VIEWPORT_INVALID_METRICS", message);
}

export function createSceneViewportMetrics(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): SceneViewportMetrics {
  if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight) || cssWidth < 0 || cssHeight < 0) {
    throw invalidMetrics("Scene viewport CSS dimensions must be finite non-negative numbers.");
  }
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
    throw invalidMetrics("Scene viewport devicePixelRatio must be a finite positive number.");
  }
  const pixelWidth = cssWidth === 0 ? 0 : Math.max(1, Math.round(cssWidth * devicePixelRatio));
  const pixelHeight = cssHeight === 0 ? 0 : Math.max(1, Math.round(cssHeight * devicePixelRatio));
  if (
    pixelWidth > MAX_SCENE_VIEWPORT_EDGE ||
    pixelHeight > MAX_SCENE_VIEWPORT_EDGE ||
    pixelWidth * pixelHeight > MAX_SCENE_VIEWPORT_PIXELS
  ) {
    throw new SceneViewportError(
      "SCENE_VIEWPORT_DIMENSIONS_EXCEEDED",
      `Scene viewport ${pixelWidth}x${pixelHeight} exceeds the backing-store limit.`,
    );
  }
  return Object.freeze({
    cssWidth,
    cssHeight,
    devicePixelRatio,
    pixelWidth,
    pixelHeight,
  });
}

export function createSceneViewportTransform(
  metrics: SceneViewportMetrics,
  viewport: WorkspaceViewport,
): SceneAffineMatrix {
  if (
    !viewport ||
    typeof viewport !== "object" ||
    !Number.isFinite(viewport.scale) ||
    viewport.scale <= 0 ||
    !viewport.offset ||
    !Number.isFinite(viewport.offset.x) ||
    !Number.isFinite(viewport.offset.y)
  ) {
    throw invalidMetrics("Scene viewport transform must contain a positive scale and finite offset.");
  }
  const dpr = metrics.devicePixelRatio;
  return Object.freeze({
    a: dpr * viewport.scale,
    b: 0,
    c: 0,
    d: dpr * viewport.scale,
    e: dpr * viewport.offset.x,
    f: dpr * viewport.offset.y,
  });
}
