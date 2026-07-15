import {
  createBrowserSceneViewport,
  createSceneProjection,
  type BrowserSceneViewportDiagnostic,
} from "../../core/render";
import type { WorkspaceState } from "../../core/stores";
import { sceneCompositorProjectFixture } from "../contract/fixtures/sceneCompositorV1";

interface BrowserGateResult {
  readonly status: "pass" | "fail";
  readonly devicePixelRatio: number;
  readonly initialBacking: readonly [number, number];
  readonly resizedBacking: readonly [number, number];
  readonly sampledRgba: readonly [number, number, number, number];
  readonly idleFrameCount: number;
  readonly restoredFrameCount: number;
  readonly cleanupBacking: readonly [number, number];
  readonly diagnostics: readonly string[];
  readonly errors: readonly string[];
}

declare global {
  interface Window {
    __sceneViewportResult?: BrowserGateResult;
  }
}

function requireElement<TElement extends Element>(selector: string): TElement {
  const element = document.querySelector<TElement>(selector);
  if (element === null) throw new Error(`Browser gate is missing ${selector}.`);
  return element;
}

const resultElement = requireElement<HTMLPreElement>("#result");
const stage = requireElement<HTMLDivElement>("#stage");
const canvas = requireElement<HTMLCanvasElement>("#scene");

const errors: string[] = [];
window.addEventListener("error", (event) => errors.push(event.message));
window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)));

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function waitForRender(milliseconds = 120): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function projection() {
  const project = structuredClone(sceneCompositorProjectFixture);
  project.workspace.activeWorkspace = "assets";
  const workspace: WorkspaceState = {
    panelSizes: {},
    viewports: { assets: { scale: 20, offset: { x: 10, y: 10 } } },
    preferences: {},
  };
  return createSceneProjection({ project, revision: 56 }, workspace);
}

function createSource(): HTMLCanvasElement {
  const source = document.createElement("canvas");
  source.width = 4;
  source.height = 2;
  const context = source.getContext("2d");
  invariant(context, "Source Canvas2D unavailable.");
  context.fillStyle = "#ff3040";
  context.fillRect(0, 0, 4, 2);
  context.fillStyle = "#37d67a";
  context.fillRect(2, 0, 2, 2);
  return source;
}

async function run(): Promise<BrowserGateResult> {
  const source = createSource();
  const diagnostics: BrowserSceneViewportDiagnostic[] = [];
  const viewport = createBrowserSceneViewport({
    canvas,
    resizeTarget: stage,
    getProjection: projection,
    resolver: { resolve: () => source },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  await waitForRender();
  const dpr = window.devicePixelRatio;
  const initialBacking = [canvas.width, canvas.height] as const;
  invariant(canvas.width === Math.round(320 * dpr), "Initial DPR width mismatch.");
  invariant(canvas.height === Math.round(180 * dpr), "Initial DPR height mismatch.");

  stage.style.width = "200px";
  stage.style.height = "100px";
  await waitForRender();
  const resizedBacking = [canvas.width, canvas.height] as const;
  invariant(canvas.width === Math.round(200 * dpr), "ResizeObserver width mismatch.");
  invariant(canvas.height === Math.round(100 * dpr), "ResizeObserver height mismatch.");

  const context = canvas.getContext("2d");
  invariant(context, "Viewport Canvas2D unavailable after resize.");
  const sample = context.getImageData(Math.round(20 * dpr), Math.round(20 * dpr), 1, 1).data;
  const sampledRgba = [sample[0], sample[1], sample[2], sample[3]] as const;
  invariant(sampledRgba[0] > 200 && sampledRgba[3] === 255, "Canvas pixel sample is blank.");

  const idleFrameCount = viewport.getSnapshot().scheduler.frameCount;
  await waitForRender();
  invariant(
    viewport.getSnapshot().scheduler.frameCount === idleFrameCount,
    "Viewport scheduled frames while idle.",
  );
  invariant(!viewport.getSnapshot().scheduler.scheduled, "Viewport retained an idle rAF.");

  const lost = new Event("contextlost", { cancelable: true });
  canvas.dispatchEvent(lost);
  invariant(lost.defaultPrevented, "Context loss was not made recoverable.");
  invariant(viewport.getSnapshot().contextLost, "Context loss did not suspend viewport.");
  canvas.dispatchEvent(new Event("contextrestored"));
  await waitForRender();
  invariant(!viewport.getSnapshot().contextLost, "Context restore did not resume viewport.");
  const restoredFrameCount = viewport.getSnapshot().scheduler.frameCount;
  invariant(restoredFrameCount > idleFrameCount, "Context restore did not redraw scene.");

  const cleanupCanvas = document.createElement("canvas");
  const cleanupTarget = document.createElement("div");
  cleanupTarget.style.cssText = "position:absolute;left:-10000px;width:64px;height:64px";
  cleanupTarget.append(cleanupCanvas);
  document.body.append(cleanupTarget);
  const cleanupViewport = createBrowserSceneViewport({
    canvas: cleanupCanvas,
    resizeTarget: cleanupTarget,
    getProjection: projection,
    resolver: { resolve: () => source },
  });
  await waitForRender();
  cleanupViewport.dispose();
  const cleanupBacking = [cleanupCanvas.width, cleanupCanvas.height] as const;
  invariant(cleanupBacking[0] === 0 && cleanupBacking[1] === 0, "Dispose retained backing pixels.");
  invariant(cleanupViewport.getSnapshot().scheduler.disposed, "Dispose retained scheduler.");
  cleanupTarget.remove();

  invariant(errors.length === 0, `Browser emitted errors: ${errors.join(" | ")}`);
  return {
    status: "pass",
    devicePixelRatio: dpr,
    initialBacking,
    resizedBacking,
    sampledRgba,
    idleFrameCount,
    restoredFrameCount,
    cleanupBacking,
    diagnostics: diagnostics.map(({ code }) => code),
    errors,
  };
}

void run().then(
  (result) => {
    window.__sceneViewportResult = result;
    resultElement.dataset.status = "pass";
    resultElement.textContent = JSON.stringify(result, null, 2);
  },
  (error: unknown) => {
    const result: BrowserGateResult = {
      status: "fail",
      devicePixelRatio: window.devicePixelRatio,
      initialBacking: [canvas.width, canvas.height],
      resizedBacking: [canvas.width, canvas.height],
      sampledRgba: [0, 0, 0, 0],
      idleFrameCount: 0,
      restoredFrameCount: 0,
      cleanupBacking: [-1, -1],
      diagnostics: [],
      errors: [...errors, error instanceof Error ? error.message : String(error)],
    };
    window.__sceneViewportResult = result;
    resultElement.dataset.status = "fail";
    resultElement.textContent = JSON.stringify(result, null, 2);
  },
);
