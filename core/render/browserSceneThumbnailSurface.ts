import { multiplySceneMatrices, sceneScale } from "./affine";
import {
  createCanvas2DSceneTarget,
  type SceneCanvas2DContext,
} from "./canvas2dSceneTarget";
import type {
  SceneCompositorFrame,
  SceneCompositorTarget,
  SceneDrawOperation,
} from "./sceneCompositor";
import {
  renderSceneThumbnail,
  type RenderSceneThumbnailRequest,
  type SceneThumbnailEncodeOptions,
  type SceneThumbnailLayout,
  type SceneThumbnailResult,
  type SceneThumbnailSurface,
  type SceneThumbnailSurfaceFactory,
} from "./sceneThumbnail";

export interface BrowserSceneThumbnailScope {
  readonly OffscreenCanvas?: new (width: number, height: number) => OffscreenCanvas;
  readonly document?: Pick<Document, "createElement">;
}

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

function offscreenSurface(
  constructor: new (width: number, height: number) => OffscreenCanvas,
  layout: SceneThumbnailLayout,
): SceneThumbnailSurface<CanvasImageSource> | null {
  const canvas = new constructor(layout.width, layout.height);
  const context = canvas.getContext("2d");
  if (context === null) return null;
  let disposed = false;
  let encoded = false;
  return Object.freeze({
    target: scaledTarget(
      createCanvas2DSceneTarget(context as SceneCanvas2DContext),
      layout,
    ),
    encode(options: SceneThumbnailEncodeOptions): Promise<Blob> {
      if (disposed || encoded) throw new Error("Scene thumbnail surface is unavailable.");
      encoded = true;
      return canvas.convertToBlob({
        type: options.mimeType,
        ...(options.quality === undefined ? {} : { quality: options.quality }),
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      canvas.width = 0;
      canvas.height = 0;
    },
  });
}

function htmlCanvasSurface(
  document: Pick<Document, "createElement">,
  layout: SceneThumbnailLayout,
): SceneThumbnailSurface<CanvasImageSource> | null {
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  let disposed = false;
  let encoded = false;
  return Object.freeze({
    target: scaledTarget(createCanvas2DSceneTarget(context), layout),
    encode(options: SceneThumbnailEncodeOptions): Promise<Blob> {
      if (disposed || encoded) throw new Error("Scene thumbnail surface is unavailable.");
      encoded = true;
      return new Promise((resolve, reject) => {
        try {
          canvas.toBlob(
            (blob) => {
              if (blob === null) reject(new Error("Canvas returned no thumbnail Blob."));
              else resolve(blob);
            },
            options.mimeType,
            options.quality,
          );
        } catch (error) {
          reject(error);
        }
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      canvas.width = 0;
      canvas.height = 0;
    },
  });
}

export function createBrowserSceneThumbnailSurfaceFactory(
  scope: BrowserSceneThumbnailScope = globalThis,
): SceneThumbnailSurfaceFactory<CanvasImageSource> {
  return Object.freeze({
    create(layout: SceneThumbnailLayout): SceneThumbnailSurface<CanvasImageSource> {
      if (typeof scope.OffscreenCanvas === "function") {
        const surface = offscreenSurface(scope.OffscreenCanvas, layout);
        if (surface !== null) return surface;
      }
      if (scope.document !== undefined) {
        const surface = htmlCanvasSurface(scope.document, layout);
        if (surface !== null) return surface;
      }
      throw new Error("Browser Canvas2D thumbnail surfaces are unavailable.");
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
