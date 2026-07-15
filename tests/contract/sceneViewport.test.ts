import { describe, expect, it } from "vitest";
import {
  MAX_SCENE_VIEWPORT_EDGE,
  SceneViewportError,
  createBrowserSceneViewport,
  createSceneProjection,
  createSceneViewportMetrics,
  createSceneViewportTransform,
  type BrowserSceneViewportDiagnostic,
  type BrowserSceneViewportScope,
  type SceneProjection,
} from "../../core/render";
import type { WorkspaceState } from "../../core/stores";
import {
  sceneCompositorProjectFixture,
} from "./fixtures/sceneCompositorV1";

const image = Object.freeze({}) as CanvasImageSource;

function projection(revision = 21): SceneProjection {
  const project = structuredClone(sceneCompositorProjectFixture);
  project.workspace.activeWorkspace = "assets";
  const workspace: WorkspaceState = {
    panelSizes: {},
    viewports: {
      assets: { scale: 1.5, offset: { x: 10, y: 20 } },
    },
    preferences: {},
  };
  return createSceneProjection({ project, revision }, workspace);
}

class RecordingContext {
  readonly calls: Array<readonly unknown[]> = [];
  canvas!: HTMLCanvasElement;
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  filter = "none";
  shadowColor = "rgba(0, 0, 0, 0)";
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  imageSmoothingEnabled = false;
  imageSmoothingQuality: ImageSmoothingQuality = "low";

  save(): void { this.calls.push(["save"]); }
  restore(): void { this.calls.push(["restore"]); }
  setTransform(...values: readonly number[]): void { this.calls.push(["setTransform", ...values]); }
  clearRect(...values: readonly number[]): void { this.calls.push(["clearRect", ...values]); }
  fillRect(...values: readonly number[]): void { this.calls.push(["fillRect", ...values]); }
  drawImage(...values: readonly unknown[]): void { this.calls.push(["drawImage", ...values]); }
}

class FakeCanvas {
  width = 300;
  height = 150;
  cssWidth = 300;
  cssHeight = 150;
  getContextCount = 0;
  contextAvailable = true;
  getContextError: Error | null = null;
  readonly context = new RecordingContext();
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor() {
    this.context.canvas = this as unknown as HTMLCanvasElement;
  }

  get clientWidth(): number { return this.cssWidth; }
  get clientHeight(): number { return this.cssHeight; }

  getContext(contextId: string): CanvasRenderingContext2D | null {
    this.getContextCount += 1;
    if (this.getContextError !== null) throw this.getContextError;
    if (contextId !== "2d" || !this.contextAvailable) return null;
    return this.context as unknown as CanvasRenderingContext2D;
  }

  getBoundingClientRect(): DOMRect {
    return { width: this.cssWidth, height: this.cssHeight } as DOMRect;
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeMediaQueryList {
  readonly listeners = new Set<EventListener>();

  addEventListener(type: string, listener: EventListener): void {
    if (type === "change") this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (type === "change") this.listeners.delete(listener);
  }

  emitChange(): void {
    for (const listener of this.listeners) listener(new Event("change"));
  }
}

class FakeBrowserScope {
  devicePixelRatio = 2;
  readonly frameCallbacks = new Map<number, FrameRequestCallback>();
  readonly cancelledFrames: number[] = [];
  readonly mediaQueries: FakeMediaQueryList[] = [];
  readonly windowResizeListeners = new Set<EventListener>();
  resizeCallback: ResizeObserverCallback | null = null;
  observedTarget: Element | null = null;
  observerDisconnected = false;
  observeError: Error | null = null;
  private nextFrame = 1;
  readonly ResizeObserver: typeof ResizeObserver;

  constructor() {
    const setCallback = (callback: ResizeObserverCallback): void => {
      this.resizeCallback = callback;
    };
    const recordTarget = (target: Element): void => {
      if (this.observeError !== null) throw this.observeError;
      this.observedTarget = target;
    };
    const recordDisconnect = (): void => {
      this.observerDisconnected = true;
    };
    this.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        setCallback(callback);
      }
      observe(target: Element): void { recordTarget(target); }
      unobserve(): void {}
      disconnect(): void { recordDisconnect(); }
      takeRecords(): ResizeObserverEntry[] { return []; }
    } as unknown as typeof ResizeObserver;
  }

  requestAnimationFrame(callback: FrameRequestCallback): number {
    const handle = this.nextFrame;
    this.nextFrame += 1;
    this.frameCallbacks.set(handle, callback);
    return handle;
  }

  cancelAnimationFrame(handle: number): void {
    this.cancelledFrames.push(handle);
    this.frameCallbacks.delete(handle);
  }

  addEventListener(type: "resize", listener: EventListener): void {
    if (type === "resize") this.windowResizeListeners.add(listener);
  }

  removeEventListener(type: "resize", listener: EventListener): void {
    if (type === "resize") this.windowResizeListeners.delete(listener);
  }

  matchMedia(): MediaQueryList {
    const media = new FakeMediaQueryList();
    this.mediaQueries.push(media);
    return media as unknown as MediaQueryList;
  }

  emitResize(width: number, height: number): void {
    this.resizeCallback?.(
      [{ contentRect: { width, height } } as ResizeObserverEntry],
      {} as ResizeObserver,
    );
  }

  flushFrame(timestamp = 10): void {
    const next = this.frameCallbacks.entries().next();
    if (next.done) throw new Error("No pending frame.");
    const [handle, callback] = next.value;
    this.frameCallbacks.delete(handle);
    callback(timestamp);
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function createFixture(options: {
  readonly canvas?: FakeCanvas;
  readonly resizeTarget?: FakeCanvas;
  readonly scope?: FakeBrowserScope;
  readonly getProjection?: () => SceneProjection;
  readonly resolve?: () => CanvasImageSource | PromiseLike<CanvasImageSource>;
  readonly diagnostics?: BrowserSceneViewportDiagnostic[];
} = {}) {
  const canvas = options.canvas ?? new FakeCanvas();
  const resizeTarget = options.resizeTarget ?? new FakeCanvas();
  const scope = options.scope ?? new FakeBrowserScope();
  const diagnostics = options.diagnostics ?? [];
  const viewport = createBrowserSceneViewport({
    canvas: canvas as unknown as HTMLCanvasElement,
    resizeTarget: resizeTarget as unknown as HTMLElement,
    getProjection: options.getProjection ?? (() => projection()),
    resolver: {
      resolve: options.resolve ?? (() => image),
    },
    scope: scope as unknown as BrowserSceneViewportScope,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  return { canvas, resizeTarget, scope, diagnostics, viewport };
}

describe("scene viewport metrics", () => {
  it("maps CSS pixels, DPR and workspace viewport into one physical transform", () => {
    const metrics = createSceneViewportMetrics(320.25, 180.5, 2);
    expect(metrics).toEqual({
      cssWidth: 320.25,
      cssHeight: 180.5,
      devicePixelRatio: 2,
      pixelWidth: 641,
      pixelHeight: 361,
    });
    expect(createSceneViewportTransform(metrics, {
      scale: 1.5,
      offset: { x: 10, y: -4 },
    })).toEqual({ a: 3, b: 0, c: 0, d: 3, e: 20, f: -8 });
  });

  it("rejects invalid and excessive backing stores before allocation", () => {
    expect(() => createSceneViewportMetrics(-1, 20, 1)).toThrowError(SceneViewportError);
    expect(() => createSceneViewportMetrics(20, 20, 0)).toThrowError(SceneViewportError);
    expect(() => createSceneViewportMetrics(MAX_SCENE_VIEWPORT_EDGE, 20, 2))
      .toThrowError(expect.objectContaining({ code: "SCENE_VIEWPORT_DIMENSIONS_EXCEEDED" }));
    expect(() => createSceneViewportTransform(createSceneViewportMetrics(20, 20, 1), {
      scale: 0,
      offset: { x: 0, y: 0 },
    })).toThrowError(SceneViewportError);
  });
});

describe("browser scene viewport lifecycle", () => {
  it("renders on invalidation with DPR/viewport transform and stays idle afterward", async () => {
    const { canvas, resizeTarget, scope, viewport } = createFixture();

    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(300);
    expect(scope.frameCallbacks.size).toBe(1);
    scope.flushFrame();
    await settle();

    expect(canvas.context.calls).toContainEqual(["setTransform", 3, 0, 0, 3, 20, 40]);
    expect(canvas.context.calls.some(([name]) => name === "drawImage")).toBe(true);
    expect(scope.frameCallbacks.size).toBe(0);
    expect(viewport.getSnapshot().scheduler).toMatchObject({
      scheduled: false,
      rendering: false,
      frameCount: 1,
    });

    resizeTarget.cssWidth = 200;
    resizeTarget.cssHeight = 100;
    scope.emitResize(200, 100);
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(200);
    scope.flushFrame();
    await settle();

    const oldMedia = scope.mediaQueries.at(-1)!;
    scope.devicePixelRatio = 1.5;
    oldMedia.emitChange();
    expect(oldMedia.listeners.size).toBe(0);
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);
    expect(scope.mediaQueries.at(-1)).not.toBe(oldMedia);
    scope.flushFrame();
    await settle();

    viewport.dispose();
  });

  it("suspends an in-flight generation on context loss and redraws after restore", async () => {
    let resolveAsset!: (value: CanvasImageSource) => void;
    const pendingAsset = new Promise<CanvasImageSource>((resolve) => { resolveAsset = resolve; });
    const { canvas, scope, diagnostics, viewport } = createFixture({
      resolve: () => pendingAsset,
    });

    scope.flushFrame();
    await Promise.resolve();
    const lost = new Event("contextlost", { cancelable: true });
    canvas.emit("contextlost", lost);
    expect(lost.defaultPrevented).toBe(true);
    resolveAsset(image);
    await settle();

    expect(canvas.context.calls.some(([name]) => name === "drawImage")).toBe(false);
    expect(viewport.getSnapshot()).toMatchObject({ contextLost: true });
    expect(diagnostics.map(({ code }) => code)).toContain("SCENE_VIEWPORT_CONTEXT_LOST");
    expect(diagnostics.map(({ code }) => code)).not.toContain("SCENE_VIEWPORT_RENDER_FAILED");

    canvas.emit("contextrestored", new Event("contextrestored"));
    expect(canvas.getContextCount).toBe(2);
    expect(scope.frameCallbacks.size).toBe(1);
    scope.flushFrame();
    await settle();

    expect(canvas.context.calls.some(([name]) => name === "drawImage")).toBe(true);
    expect(viewport.getSnapshot()).toMatchObject({ contextLost: false });
    viewport.dispose();
  });

  it("retires an old async generation after resize and schedules the fresh frame", async () => {
    let resolveAsset!: (value: CanvasImageSource) => void;
    let pending = true;
    const firstAsset = new Promise<CanvasImageSource>((resolve) => { resolveAsset = resolve; });
    const { canvas, resizeTarget, scope, diagnostics, viewport } = createFixture({
      resolve: () => pending ? firstAsset : image,
    });
    scope.flushFrame();
    await Promise.resolve();

    resizeTarget.cssWidth = 200;
    resizeTarget.cssHeight = 100;
    scope.emitResize(200, 100);
    expect(scope.frameCallbacks.size).toBe(0);
    pending = false;
    resolveAsset(image);
    await settle();

    expect(viewport.getSnapshot().scheduler).toMatchObject({
      failed: false,
      rendering: false,
      pendingInvalidations: ["resize"],
    });
    expect(scope.frameCallbacks.size).toBe(1);
    scope.flushFrame();
    await settle();

    expect(viewport.getSnapshot().scheduler).toMatchObject({ failed: false, scheduled: false });
    expect(canvas.context.calls.some(([name]) => name === "drawImage")).toBe(true);
    expect(diagnostics.map(({ code }) => code)).not.toContain("SCENE_VIEWPORT_RENDER_FAILED");
    viewport.dispose();
  });

  it("pauses continuous rendering while context is lost and resumes it once", async () => {
    const { canvas, scope, viewport } = createFixture();
    const lease = viewport.beginContinuous("playback");
    expect(scope.frameCallbacks.size).toBe(1);

    canvas.emit("contextlost", new Event("contextlost", { cancelable: true }));
    expect(scope.frameCallbacks.size).toBe(0);
    expect(viewport.getSnapshot().scheduler).toMatchObject({
      suspended: true,
      continuous: ["playback"],
    });

    canvas.emit("contextrestored", new Event("contextrestored"));
    expect(scope.frameCallbacks.size).toBe(1);
    scope.flushFrame();
    await settle();
    lease.release();
    expect(scope.frameCallbacks.size).toBe(0);
    expect(viewport.getSnapshot().scheduler.suspended).toBe(false);
    viewport.dispose();
  });

  it("reports a throwing context restore and remains suspended", async () => {
    const { canvas, scope, diagnostics, viewport } = createFixture();
    scope.flushFrame();
    await settle();
    canvas.emit("contextlost", new Event("contextlost", { cancelable: true }));
    canvas.getContextError = new Error("restore failed");

    canvas.emit("contextrestored", new Event("contextrestored"));

    expect(diagnostics.at(-1)).toMatchObject({
      code: "SCENE_VIEWPORT_CONTEXT_RESTORE_FAILED",
      cause: canvas.getContextError,
    });
    expect(viewport.getSnapshot().contextLost).toBe(true);
    expect(scope.frameCallbacks.size).toBe(0);
    canvas.getContextError = null;
    viewport.dispose();
  });

  it("rejects stale scheduled revisions without publishing pixels", async () => {
    const diagnostics: BrowserSceneViewportDiagnostic[] = [];
    const { canvas, scope, viewport } = createFixture({ diagnostics });
    viewport.invalidate({ reason: "scene", projectRevision: 22 });
    scope.flushFrame();
    await settle();

    expect(canvas.context.calls.some(([name]) => name === "drawImage")).toBe(false);
    expect(diagnostics.map(({ code }) => code)).toContain("SCENE_VIEWPORT_STALE_PROJECTION");
    expect(viewport.getSnapshot().scheduler.failed).toBe(true);
    viewport.dispose();
  });

  it("releases observers, listeners, frames and backing pixels on dispose", async () => {
    let resolveLate!: (value: CanvasImageSource) => void;
    let late = false;
    const pending = new Promise<CanvasImageSource>((resolve) => { resolveLate = resolve; });
    const { canvas, scope, viewport } = createFixture({
      resolve: () => late ? pending : image,
    });
    scope.flushFrame();
    await settle();
    late = true;
    viewport.invalidate({ reason: "scene" });
    scope.flushFrame();
    await Promise.resolve();
    const callsBeforeDispose = canvas.context.calls.length;
    const queuedDprCallback = [...scope.mediaQueries.at(-1)!.listeners][0]!;
    const mediaCount = scope.mediaQueries.length;

    viewport.dispose();
    queuedDprCallback(new Event("change"));
    resolveLate(image);
    await settle();

    expect(canvas.context.calls).toHaveLength(callsBeforeDispose);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(scope.observerDisconnected).toBe(true);
    expect(scope.windowResizeListeners.size).toBe(0);
    expect(scope.mediaQueries.at(-1)?.listeners.size).toBe(0);
    expect(scope.mediaQueries).toHaveLength(mediaCount);
    expect(canvas.listenerCount("contextlost")).toBe(0);
    expect(canvas.listenerCount("contextrestored")).toBe(0);
    expect(viewport.getSnapshot()).toMatchObject({ disposed: true, metrics: null });
  });

  it("drops an invalid resize instead of allocating or showing stale pixels", async () => {
    const { canvas, scope, diagnostics, viewport } = createFixture();
    scope.flushFrame();
    await settle();
    const drawCount = canvas.context.calls.filter(([name]) => name === "drawImage").length;

    scope.emitResize(MAX_SCENE_VIEWPORT_EDGE, 20);

    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(viewport.getSnapshot().metrics).toBeNull();
    expect(diagnostics.at(-1)).toMatchObject({ code: "SCENE_VIEWPORT_RESIZE_FAILED" });
    expect(canvas.context.calls.filter(([name]) => name === "drawImage")).toHaveLength(drawCount);
    viewport.dispose();
  });

  it("rolls back listeners and backing pixels when lifecycle setup fails", () => {
    const canvas = new FakeCanvas();
    const resizeTarget = new FakeCanvas();
    const scope = new FakeBrowserScope();
    scope.observeError = new Error("observe failed");

    expect(() => createBrowserSceneViewport({
      canvas: canvas as unknown as HTMLCanvasElement,
      resizeTarget: resizeTarget as unknown as HTMLElement,
      getProjection: () => projection(),
      resolver: { resolve: () => image },
      scope: scope as unknown as BrowserSceneViewportScope,
    })).toThrowError("Browser scene viewport lifecycle could not be initialized.");

    expect(canvas.listenerCount("contextlost")).toBe(0);
    expect(canvas.listenerCount("contextrestored")).toBe(0);
    expect(scope.windowResizeListeners.size).toBe(0);
    expect(scope.observerDisconnected).toBe(true);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("rejects observing the canvas backing store as its own resize target", () => {
    const canvas = new FakeCanvas();
    const scope = new FakeBrowserScope();

    expect(() => createBrowserSceneViewport({
      canvas: canvas as unknown as HTMLCanvasElement,
      resizeTarget: canvas as unknown as HTMLElement,
      getProjection: () => projection(),
      resolver: { resolve: () => image },
      scope: scope as unknown as BrowserSceneViewportScope,
    })).toThrowError("Browser scene viewport requires an external resize target.");

    expect(canvas.getContextCount).toBe(0);
    expect(scope.frameCallbacks.size).toBe(0);
  });
});
