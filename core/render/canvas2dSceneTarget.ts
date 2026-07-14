import type {
  SceneCompositorFrame,
  SceneCompositorTarget,
  SceneDrawOperation,
} from "./sceneCompositor";

/**
 * Canvas2D executor for a compiled scene plan. DPR/viewport base transforms are
 * intentionally deferred to the F5-06 adapter; this target renders logical
 * scene pixels into the supplied context.
 */
export function createCanvas2DSceneTarget(
  context: CanvasRenderingContext2D,
): SceneCompositorTarget<CanvasImageSource> {
  let activeFrame: SceneCompositorFrame | null = null;

  function withSavedContext(action: () => void): void {
    context.save();
    try {
      action();
    } finally {
      context.restore();
    }
  }

  function clearPhysicalCanvas(): void {
    withSavedContext(() => {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    });
  }

  function normalizePaintState(): void {
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.filter = "none";
    context.shadowColor = "rgba(0, 0, 0, 0)";
    context.shadowBlur = 0;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
  }

  return {
    beginFrame(frame): void {
      if (activeFrame !== null) throw new Error("Canvas scene target already has an active frame.");
      activeFrame = frame;
      clearPhysicalCanvas();
      const background = frame.background;
      if (background !== null) {
        withSavedContext(() => {
          context.setTransform(1, 0, 0, 1, 0, 0);
          normalizePaintState();
          context.fillStyle = background;
          context.fillRect(0, 0, frame.width, frame.height);
        });
      }
    },

    drawImage(image: CanvasImageSource, operation: SceneDrawOperation): void {
      const frame = activeFrame;
      if (frame === null) throw new Error("Canvas scene target has no active frame.");
      const { sourceRect, matrix } = operation;
      withSavedContext(() => {
        context.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
        normalizePaintState();
        context.globalAlpha = operation.opacity;
        context.imageSmoothingEnabled = frame.sampling === "smooth";
        context.imageSmoothingQuality = frame.sampling === "smooth" ? "high" : "low";
        context.drawImage(
          image,
          sourceRect.x,
          sourceRect.y,
          sourceRect.width,
          sourceRect.height,
          0,
          0,
          sourceRect.width,
          sourceRect.height,
        );
      });
    },

    endFrame(): void {
      if (activeFrame === null) throw new Error("Canvas scene target has no active frame.");
      activeFrame = null;
    },

    abortFrame(): void {
      activeFrame = null;
      clearPhysicalCanvas();
    },
  };
}
