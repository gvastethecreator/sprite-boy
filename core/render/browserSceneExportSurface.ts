import {
  createBrowserEncodedSceneCanvas,
  type BrowserSceneCanvasScope,
} from "./browserEncodedSceneCanvas";
import { createCanvas2DSceneTarget } from "./canvas2dSceneTarget";
import {
  renderSceneExport,
  type RenderSceneExportRequest,
  type SceneExportResult,
  type SceneExportSurface,
  type SceneExportSurfaceFactory,
} from "./sceneExport";
import type { SceneCanvas } from "./sceneProjection";

export type BrowserSceneExportScope = BrowserSceneCanvasScope;

export interface RenderBrowserSceneExportRequest extends Omit<
  RenderSceneExportRequest<CanvasImageSource>,
  "surfaceFactory"
> {
  readonly scope?: BrowserSceneExportScope;
}

export function createBrowserSceneExportSurfaceFactory(
  scope: BrowserSceneExportScope = globalThis,
): SceneExportSurfaceFactory<CanvasImageSource> {
  return Object.freeze({
    create(frame: SceneCanvas): SceneExportSurface<CanvasImageSource> {
      const surface = createBrowserEncodedSceneCanvas(frame.width, frame.height, scope);
      return Object.freeze({
        target: createCanvas2DSceneTarget(surface.context),
        encode: surface.encode,
        dispose: surface.dispose,
      });
    },
  });
}

export function renderBrowserSceneExport(
  request: RenderBrowserSceneExportRequest,
): Promise<SceneExportResult | null> {
  const { scope, ...exportRequest } = request;
  return renderSceneExport({
    ...exportRequest,
    surfaceFactory: createBrowserSceneExportSurfaceFactory(scope),
  });
}
