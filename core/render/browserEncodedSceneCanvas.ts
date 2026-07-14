import type { SceneCanvas2DContext } from "./canvas2dSceneTarget";
import type { SceneRasterEncodeOptions } from "./sceneEncoding";

export interface BrowserSceneCanvasScope {
  readonly OffscreenCanvas?: new (width: number, height: number) => OffscreenCanvas;
  readonly document?: Pick<Document, "createElement">;
}

export interface BrowserEncodedSceneCanvas {
  readonly context: SceneCanvas2DContext;
  encode(options: SceneRasterEncodeOptions): Promise<Blob>;
  dispose(): void;
}

function createOffscreenCanvas(
  constructor: new (width: number, height: number) => OffscreenCanvas,
  width: number,
  height: number,
): BrowserEncodedSceneCanvas | null {
  const canvas = new constructor(width, height);
  let context: OffscreenCanvasRenderingContext2D | null;
  try {
    context = canvas.getContext("2d");
  } catch (error) {
    canvas.width = 0;
    canvas.height = 0;
    throw error;
  }
  if (context === null) {
    canvas.width = 0;
    canvas.height = 0;
    return null;
  }
  let disposed = false;
  let encoded = false;
  return Object.freeze({
    context: context as SceneCanvas2DContext,
    encode(options: SceneRasterEncodeOptions): Promise<Blob> {
      if (disposed || encoded) throw new Error("Encoded scene canvas is unavailable.");
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

function createHtmlCanvas(
  document: Pick<Document, "createElement">,
  width: number,
  height: number,
): BrowserEncodedSceneCanvas | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  let context: CanvasRenderingContext2D | null;
  try {
    context = canvas.getContext("2d");
  } catch (error) {
    canvas.width = 0;
    canvas.height = 0;
    throw error;
  }
  if (context === null) {
    canvas.width = 0;
    canvas.height = 0;
    return null;
  }
  let disposed = false;
  let encoded = false;
  return Object.freeze({
    context,
    encode(options: SceneRasterEncodeOptions): Promise<Blob> {
      if (disposed || encoded) throw new Error("Encoded scene canvas is unavailable.");
      encoded = true;
      return new Promise((resolve, reject) => {
        try {
          canvas.toBlob(
            (blob) => {
              if (blob === null) reject(new Error("Canvas returned no encoded scene Blob."));
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

export function createBrowserEncodedSceneCanvas(
  width: number,
  height: number,
  scope: BrowserSceneCanvasScope = globalThis,
): BrowserEncodedSceneCanvas {
  let lastError: unknown;
  if (typeof scope.OffscreenCanvas === "function") {
    try {
      const surface = createOffscreenCanvas(scope.OffscreenCanvas, width, height);
      if (surface !== null) return surface;
    } catch (error) {
      lastError = error;
    }
  }
  if (scope.document !== undefined) {
    try {
      const surface = createHtmlCanvas(scope.document, width, height);
      if (surface !== null) return surface;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError === undefined) {
    throw new Error("Browser Canvas2D encoded surfaces are unavailable.");
  }
  throw new Error("Browser Canvas2D encoded surfaces are unavailable.", {
    cause: lastError,
  });
}
