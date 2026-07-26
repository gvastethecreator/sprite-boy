import type { WorkspaceViewport } from "../../../core/stores";

const AUTO_FIT_PADDING = 0.9;
const MAX_AUTO_FIT_SCALE = 24;

function isDefaultViewport(viewport: WorkspaceViewport): boolean {
  return viewport.scale === 1 && viewport.offset.x === 0 && viewport.offset.y === 0;
}

/**
 * Fits an untouched scene into its host while preserving an intentional user view.
 * Pixel art uses whole-number zoom levels whenever the host can show it above 1x.
 */
export function resolveFittedSceneViewport(
  viewport: WorkspaceViewport,
  canvasWidth: number,
  canvasHeight: number,
  hostWidth: number,
  hostHeight: number,
): WorkspaceViewport {
  if (
    canvasWidth <= 0
    || canvasHeight <= 0
    || hostWidth <= 0
    || hostHeight <= 0
  ) {
    return viewport;
  }

  const rawFit = Math.min(hostWidth / canvasWidth, hostHeight / canvasHeight) * AUTO_FIT_PADDING;
  if (!Number.isFinite(rawFit) || rawFit <= 0) return viewport;

  const boundedFit = Math.min(rawFit, MAX_AUTO_FIT_SCALE);
  const fittedScale = boundedFit >= 2 ? Math.floor(boundedFit) : boundedFit;
  if (!isDefaultViewport(viewport) && viewport.scale <= fittedScale) return viewport;

  return Object.freeze({
    scale: fittedScale,
    offset: Object.freeze({
      x: (hostWidth - canvasWidth * fittedScale) / 2,
      y: (hostHeight - canvasHeight * fittedScale) / 2,
    }),
  });
}
