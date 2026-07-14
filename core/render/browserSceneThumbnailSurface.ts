import { multiplySceneMatrices, sceneScale } from "./affine";
import { createCanvas2DSceneTarget } from "./canvas2dSceneTarget";
import {
  createBrowserEncodedSceneCanvas,
  type BrowserSceneCanvasScope,
} from "./browserEncodedSceneCanvas";
import type {
  SceneCompositorFrame,
  SceneCompositorTarget,
  SceneDrawOperation,
} from "./sceneCompositor";
import {
  renderSceneThumbnail,
  type RenderSceneThumbnailRequest,
  type SceneThumbnailLayout,
  type SceneThumbnailResult,
  type SceneThumbnailSurface,
  type SceneThumbnailSurfaceFactory,
} from "./sceneThumbnail";

export type BrowserSceneThumbnailScope = BrowserSceneCanvasScope;

export interface RenderBrowserSceneThumbnailRequest extends Omit<
  RenderSceneThumbnailRequest<CanvasImageSource>,
  "surfaceFactory"
> {
  readonly scope?: BrowserSceneThumbnailScope;
}

function scaledTarget(
  target: SceneCompositorTarget<CanvasImageSource>,
  layout: SceneThumbnailLayout,
): SceneCompositorTarget<CanvasImageSource> {
  const scale = sceneScale(layout.scaleX, layout.scaleY);
  return Object.freeze({
    beginFrame(frame: SceneCompositorFrame): void | PromiseLike<void> {
      if (
        frame.width !== layout.sourceWidth ||
        frame.height !== layout.sourceHeight
      ) {
        throw new Error("Scene thumbnail surface source dimensions changed.");
      }
      return target.beginFrame(Object.freeze({
        ...frame,
        width: layout.width,
        height: layout.height,
      }));
    },
    drawImage(
      image: CanvasImageSource,
      operation: SceneDrawOperation,
    ): void | PromiseLike<void> {
      return target.drawImage(image, Object.freeze({
        ...operation,
        matrix: multiplySceneMatrices(scale, operation.matrix),
      }));
    },
    endFrame(): void | PromiseLike<void> {
      return target.endFrame();
    },
    abortFrame(): void | PromiseLike<void> {
      return target.abortFrame();
    },
  });
}

export function createBrowserSceneThumbnailSurfaceFactory(
  scope: BrowserSceneThumbnailScope = globalThis,
): SceneThumbnailSurfaceFactory<CanvasImageSource> {
  return Object.freeze({
    create(layout: SceneThumbnailLayout): SceneThumbnailSurface<CanvasImageSource> {
      const surface = createBrowserEncodedSceneCanvas(layout.width, layout.height, scope);
      return Object.freeze({
        target: scaledTarget(createCanvas2DSceneTarget(surface.context), layout),
        encode: surface.encode,
        dispose: surface.dispose,
      });
    },
  });
}

export function renderBrowserSceneThumbnail(
  request: RenderBrowserSceneThumbnailRequest,
): Promise<SceneThumbnailResult | null> {
  const { scope, ...thumbnailRequest } = request;
  return renderSceneThumbnail({
    ...thumbnailRequest,
    surfaceFactory: createBrowserSceneThumbnailSurfaceFactory(scope),
  });
}
