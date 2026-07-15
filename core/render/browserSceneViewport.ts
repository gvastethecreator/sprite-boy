import {
  compositeSceneDrawPlan,
  createSceneDrawPlan,
  type SceneAssetImageResolver,
  type SceneCompositorFrame,
  type SceneCompositorTarget,
  type SceneDrawOperation,
  type SceneSampling,
} from "./sceneCompositor";
import { createCanvas2DSceneTarget } from "./canvas2dSceneTarget";
import type { SceneProjection } from "./sceneProjection";
import {
  createBrowserRenderFrameHost,
  createRenderScheduler,
  type BrowserAnimationFrameScope,
  type ContinuousRenderReason,
  type RenderContinuityLease,
  type RenderInvalidation,
  type RenderScheduler,
  type RenderSchedulerDiagnostic,
  type RenderSchedulerSnapshot,
} from "./renderScheduler";
import {
  createSceneViewportMetrics,
  createSceneViewportTransform,
  type SceneViewportMetrics,
} from "./sceneViewport";

export interface BrowserSceneViewportScope extends BrowserAnimationFrameScope {
  readonly devicePixelRatio?: number;
  readonly ResizeObserver?: typeof ResizeObserver;
  addEventListener(type: "resize", listener: EventListener): void;
  removeEventListener(type: "resize", listener: EventListener): void;
  matchMedia?(query: string): MediaQueryList;
}

export type BrowserSceneViewportDiagnosticCode =
  | "SCENE_VIEWPORT_RESIZE_FAILED"
  | "SCENE_VIEWPORT_CONTEXT_LOST"
  | "SCENE_VIEWPORT_CONTEXT_RESTORE_FAILED"
  | "SCENE_VIEWPORT_RENDER_FAILED"
  | "SCENE_VIEWPORT_STALE_PROJECTION";

export interface BrowserSceneViewportDiagnostic {
  readonly code: BrowserSceneViewportDiagnosticCode;
  readonly message: string;
  readonly cause?: unknown;
}

export interface BrowserSceneViewportOptions {
  readonly canvas: HTMLCanvasElement;
  readonly resizeTarget: HTMLElement;
  readonly getProjection: () => SceneProjection;
  readonly resolver: SceneAssetImageResolver<CanvasImageSource>;
  readonly sampling?: SceneSampling;
  readonly scope?: BrowserSceneViewportScope;
  readonly onDiagnostic?: (diagnostic: BrowserSceneViewportDiagnostic) => void;
}

export interface BrowserSceneViewportSnapshot {
  readonly disposed: boolean;
  readonly contextLost: boolean;
  readonly generation: number;
  readonly metrics: SceneViewportMetrics | null;
  readonly scheduler: RenderSchedulerSnapshot;
}

function sameMetrics(left: SceneViewportMetrics | null, right: SceneViewportMetrics): boolean {
  return left !== null &&
    left.cssWidth === right.cssWidth &&
    left.cssHeight === right.cssHeight &&
    left.devicePixelRatio === right.devicePixelRatio &&
    left.pixelWidth === right.pixelWidth &&
    left.pixelHeight === right.pixelHeight;
}

function suppressHostCleanup(action: () => void): void {
  try {
    action();
  } catch {
    // Best-effort cleanup must continue across independent host ports.
  }
}

export class BrowserSceneViewport {
  private readonly canvas: HTMLCanvasElement;
  private readonly resizeTarget: HTMLElement;
  private readonly getProjection: BrowserSceneViewportOptions["getProjection"];
  private readonly resolver: BrowserSceneViewportOptions["resolver"];
  private readonly sampling: SceneSampling;
  private readonly scope: BrowserSceneViewportScope;
  private readonly onDiagnostic: BrowserSceneViewportOptions["onDiagnostic"];
  private readonly scheduler: RenderScheduler;
  private readonly resizeObserver: ResizeObserver;
  private context: CanvasRenderingContext2D;
  private metrics: SceneViewportMetrics | null = null;
  private dprMedia: MediaQueryList | null = null;
  private generation = 0;
  private contextLost = false;
  private disposed = false;

  private readonly handleWindowResize = (): void => {
    this.refreshMetrics();
  };

  private readonly handleDprChange = (): void => {
    if (this.disposed) return;
    this.refreshMetrics();
    if (!this.disposed) this.armDprListener();
  };

  private readonly handleContextLost = (event: Event): void => {
    if (this.disposed) return;
    event.preventDefault();
    this.contextLost = true;
    this.generation += 1;
    this.scheduler.suspend();
    this.report({
      code: "SCENE_VIEWPORT_CONTEXT_LOST",
      message: "Scene viewport Canvas2D context was lost.",
    });
  };

  private readonly handleContextRestored = (): void => {
    if (this.disposed) return;
    let context: CanvasRenderingContext2D | null;
    try {
      context = this.canvas.getContext("2d");
    } catch (cause) {
      this.report({
        code: "SCENE_VIEWPORT_CONTEXT_RESTORE_FAILED",
        message: "Scene viewport Canvas2D context could not be restored.",
        cause,
      });
      return;
    }
    if (context === null) {
      this.report({
        code: "SCENE_VIEWPORT_CONTEXT_RESTORE_FAILED",
        message: "Scene viewport Canvas2D context could not be restored.",
      });
      return;
    }
    this.context = context;
    this.contextLost = false;
    this.generation += 1;
    this.refreshMetrics(true);
    this.scheduler.invalidate({ reason: "scene" });
    this.scheduler.resume();
  };

  constructor(options: BrowserSceneViewportOptions) {
    if (!options || typeof options !== "object") {
      throw new TypeError("Browser scene viewport options are required.");
    }
    if (!options.canvas || typeof options.canvas.getContext !== "function") {
      throw new TypeError("Browser scene viewport requires an HTML canvas.");
    }
    if (!options.resizeTarget || options.resizeTarget === options.canvas) {
      throw new TypeError("Browser scene viewport requires an external resize target.");
    }
    if (typeof options.getProjection !== "function") {
      throw new TypeError("Browser scene viewport requires a projection provider.");
    }
    if (!options.resolver || typeof options.resolver.resolve !== "function") {
      throw new TypeError("Browser scene viewport requires an image resolver.");
    }
    if (options.onDiagnostic !== undefined && typeof options.onDiagnostic !== "function") {
      throw new TypeError("Browser scene viewport onDiagnostic must be a function.");
    }
    const scope = options.scope ?? (globalThis as BrowserSceneViewportScope);
    if (
      typeof scope.ResizeObserver !== "function" ||
      typeof scope.addEventListener !== "function" ||
      typeof scope.removeEventListener !== "function"
    ) {
      throw new TypeError("Browser scene viewport APIs are unavailable.");
    }
    const context = options.canvas.getContext("2d");
    if (context === null) throw new TypeError("Browser scene viewport Canvas2D is unavailable.");

    this.canvas = options.canvas;
    this.resizeTarget = options.resizeTarget;
    this.getProjection = options.getProjection;
    this.resolver = options.resolver;
    this.sampling = options.sampling ?? "nearest";
    this.scope = scope;
    this.onDiagnostic = options.onDiagnostic;
    this.context = context;
    this.scheduler = createRenderScheduler({
      host: createBrowserRenderFrameHost(scope),
      render: (frame) => this.render(frame.projectRevision),
      onError: (diagnostic) => this.handleSchedulerDiagnostic(diagnostic),
    });
    this.resizeObserver = new scope.ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (entry) this.applyMetrics(entry.contentRect.width, entry.contentRect.height);
    });

    try {
      this.canvas.addEventListener("contextlost", this.handleContextLost);
      this.canvas.addEventListener("contextrestored", this.handleContextRestored);
      this.scope.addEventListener("resize", this.handleWindowResize);
      this.resizeObserver.observe(this.resizeTarget);
    } catch (cause) {
      suppressHostCleanup(() => this.canvas.removeEventListener("contextlost", this.handleContextLost));
      suppressHostCleanup(() => (
        this.canvas.removeEventListener("contextrestored", this.handleContextRestored)
      ));
      suppressHostCleanup(() => this.scope.removeEventListener("resize", this.handleWindowResize));
      suppressHostCleanup(() => this.resizeObserver.disconnect());
      this.scheduler.dispose();
      suppressHostCleanup(() => {
        this.canvas.width = 0;
        this.canvas.height = 0;
      });
      throw new TypeError("Browser scene viewport lifecycle could not be initialized.", {
        cause,
      });
    }
    this.armDprListener();
    this.refreshMetrics();
  }

  invalidate(invalidation: RenderInvalidation): void {
    this.scheduler.invalidate(invalidation);
  }

  beginContinuous(reason: ContinuousRenderReason): RenderContinuityLease {
    return this.scheduler.beginContinuous(reason);
  }

  refreshMetrics(force = false): void {
    if (this.disposed) return;
    try {
      const cssWidth = this.metrics?.cssWidth ?? this.resizeTarget.clientWidth;
      const cssHeight = this.metrics?.cssHeight ?? this.resizeTarget.clientHeight;
      this.applyMetrics(cssWidth, cssHeight, force);
    } catch (cause) {
      this.generation += 1;
      this.metrics = null;
      try {
        this.canvas.width = 0;
        this.canvas.height = 0;
      } catch {
        // Preserve the resize diagnostic when the host also rejects release.
      }
      this.report({
        code: "SCENE_VIEWPORT_RESIZE_FAILED",
        message: "Scene viewport metrics could not be refreshed.",
        cause,
      });
    }
  }

  getSnapshot(): BrowserSceneViewportSnapshot {
    return Object.freeze({
      disposed: this.disposed,
      contextLost: this.contextLost,
      generation: this.generation,
      metrics: this.metrics,
      scheduler: this.scheduler.getSnapshot(),
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.scheduler.dispose();
    suppressHostCleanup(() => this.resizeObserver.disconnect());
    suppressHostCleanup(() => this.scope.removeEventListener("resize", this.handleWindowResize));
    this.disarmDprListener();
    suppressHostCleanup(() => this.canvas.removeEventListener("contextlost", this.handleContextLost));
    suppressHostCleanup(() => (
      this.canvas.removeEventListener("contextrestored", this.handleContextRestored)
    ));
    this.metrics = null;
    try {
      this.canvas.width = 0;
      this.canvas.height = 0;
    } catch (cause) {
      this.report({
        code: "SCENE_VIEWPORT_RESIZE_FAILED",
        message: "Scene viewport backing store could not be released.",
        cause,
      });
    }
  }

  private applyMetrics(cssWidth: number, cssHeight: number, force = false): void {
    if (this.disposed) return;
    try {
      const metrics = createSceneViewportMetrics(
        cssWidth,
        cssHeight,
        this.scope.devicePixelRatio ?? 1,
      );
      if (!force && sameMetrics(this.metrics, metrics)) return;
      this.canvas.width = metrics.pixelWidth;
      this.canvas.height = metrics.pixelHeight;
      this.metrics = metrics;
      this.generation += 1;
      if (metrics.pixelWidth > 0 && metrics.pixelHeight > 0) {
        this.scheduler.invalidate({ reason: "resize" });
      }
    } catch (cause) {
      this.generation += 1;
      this.metrics = null;
      try {
        this.canvas.width = 0;
        this.canvas.height = 0;
      } catch {
        // Preserve the resize diagnostic when the host also rejects release.
      }
      this.report({
        code: "SCENE_VIEWPORT_RESIZE_FAILED",
        message: "Scene viewport backing store could not be resized.",
        cause,
      });
    }
  }

  private async render(projectRevision: number | undefined): Promise<void> {
    const metrics = this.metrics;
    if (
      this.disposed ||
      this.contextLost ||
      metrics === null ||
      metrics.pixelWidth === 0 ||
      metrics.pixelHeight === 0
    ) {
      return;
    }
    const generation = this.generation;
    const projection = this.getProjection();
    if (projectRevision !== undefined && projection.revision < projectRevision) {
      this.report({
        code: "SCENE_VIEWPORT_STALE_PROJECTION",
        message: "Scene viewport projection is older than the scheduled revision.",
      });
      throw new Error("Scene viewport projection is stale.");
    }
    const plan = createSceneDrawPlan(projection);
    const target = createCanvas2DSceneTarget(this.context, {
      transform: createSceneViewportTransform(metrics, projection.viewport),
    });
    const guardedTarget = this.guardTarget(target, generation);
    try {
      await compositeSceneDrawPlan({
        plan,
        resolver: this.resolver,
        target: guardedTarget,
        sampling: this.sampling,
      });
    } catch (error) {
      if (this.disposed || this.contextLost || this.generation !== generation) return;
      throw error;
    }
  }

  private guardTarget(
    target: SceneCompositorTarget<CanvasImageSource>,
    generation: number,
  ): SceneCompositorTarget<CanvasImageSource> {
    const assertCurrent = (): void => {
      if (this.disposed || this.contextLost || this.generation !== generation) {
        throw new Error("Scene viewport render generation is stale.");
      }
    };
    return Object.freeze({
      beginFrame: (frame: SceneCompositorFrame): void | PromiseLike<void> => {
        assertCurrent();
        return target.beginFrame(frame);
      },
      drawImage: (image: CanvasImageSource, operation: SceneDrawOperation): void | PromiseLike<void> => {
        assertCurrent();
        return target.drawImage(image, operation);
      },
      endFrame: (): void | PromiseLike<void> => {
        assertCurrent();
        return target.endFrame();
      },
      abortFrame: (): void | PromiseLike<void> => {
        assertCurrent();
        return target.abortFrame();
      },
    });
  }

  private armDprListener(): void {
    if (this.disposed) return;
    this.disarmDprListener();
    if (typeof this.scope.matchMedia !== "function") return;
    try {
      this.dprMedia = this.scope.matchMedia(
        `(resolution: ${this.scope.devicePixelRatio ?? 1}dppx)`,
      );
      this.dprMedia.addEventListener("change", this.handleDprChange);
    } catch {
      this.dprMedia = null;
    }
  }

  private disarmDprListener(): void {
    if (this.dprMedia === null) return;
    const media = this.dprMedia;
    this.dprMedia = null;
    try {
      media.removeEventListener("change", this.handleDprChange);
    } catch {
      // Continue cleanup even when a host listener port is broken.
    }
  }

  private handleSchedulerDiagnostic(diagnostic: RenderSchedulerDiagnostic): void {
    this.report({
      code: "SCENE_VIEWPORT_RENDER_FAILED",
      message: diagnostic.message,
    });
  }

  private report(diagnostic: BrowserSceneViewportDiagnostic): void {
    if (!this.onDiagnostic) return;
    try {
      this.onDiagnostic(Object.freeze({ ...diagnostic }));
    } catch {
      // Diagnostics cannot destabilize viewport lifecycle.
    }
  }
}

export function createBrowserSceneViewport(
  options: BrowserSceneViewportOptions,
): BrowserSceneViewport {
  return new BrowserSceneViewport(options);
}
