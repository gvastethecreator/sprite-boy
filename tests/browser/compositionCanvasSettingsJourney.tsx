import { createRoot } from "react-dom/client";
import "../../index.css";
import { projectCodec } from "../../core/persistence";
import type { StudioProjectV1 } from "../../core/project";
import { createSceneProjection, renderBrowserSceneExport } from "../../core/render";
import { createProjectStoreWithHistory, type WorkspaceState } from "../../core/stores";
import { CompositionCanvasSettingsInspector } from "../../features/compose/canvasSettings";
import { studioProjectV1Fixture } from "../contract/fixtures/studioProjectV1";

interface A103BrowserResult {
  readonly status: "pass" | "fail";
  readonly revision: number;
  readonly historyEntries: number;
  readonly canvas: { readonly width: number; readonly height: number; readonly background: string | null } | null;
  readonly export: { readonly width: number; readonly height: number; readonly background: string | null; readonly byteSize: number } | null;
  readonly reloadMatches: boolean;
  readonly invalidDraftVisible: boolean;
  readonly keyboardControls: number;
  readonly pageFits: boolean;
  readonly errors: readonly string[];
}

declare global {
  var __spriteBoyA103: Promise<A103BrowserResult> | undefined;
}

const errors: string[] = [];
window.addEventListener("error", (event) => errors.push(event.message));
window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)));

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function setNativeValue(input: HTMLInputElement | HTMLSelectElement, value: string): void {
  const constructor = input instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(constructor.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function clickByText(text: string): void {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  invariant(button instanceof HTMLButtonElement, `Missing ${text} button.`);
  button.click();
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

const project = structuredClone(studioProjectV1Fixture);
const runtime = createProjectStoreWithHistory(project, {
  context: {
    nextId: () => "a103-unused",
    now: () => "2026-07-16T17:00:00.000Z",
  },
});

const root = document.querySelector<HTMLDivElement>("#root");
invariant(root, "Missing browser harness root.");
createRoot(root).render(
  <main className="h-screen overflow-hidden bg-app p-4 text-textMain">
    <div className="mx-auto grid h-full max-w-4xl grid-cols-[minmax(300px,360px)_1fr] gap-4 overflow-hidden rounded-2xl border border-white/10 bg-panel shadow-2xl">
      <section className="min-h-0 border-r border-white/10" aria-label="Composition inspector host">
        <CompositionCanvasSettingsInspector
          store={runtime.store}
          compositionId="composition-project"
          now={() => "2026-07-16T17:00:00.000Z"}
          createCommandId={(revision) => `a103-browser-${revision}`}
        />
      </section>
      <section className="flex min-w-0 flex-col justify-center gap-4 p-6" aria-label="Canonical result">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent">Compose · canonical canvas</p>
        <h1 className="text-2xl font-bold">One canvas, every output</h1>
        <p className="max-w-md text-sm leading-relaxed text-textMuted">
          The inspector writes one Composition command. Preview, reload and export read the same document graph.
        </p>
        <output id="canonical-result" className="rounded-xl border border-white/10 bg-black/30 p-4 font-mono text-xs text-textMuted">Running browser proof…</output>
      </section>
    </div>
  </main>,
);

async function run(): Promise<A103BrowserResult> {
  await nextPaint();
  const ratio = document.querySelector<HTMLSelectElement>("select[id^='composition-ratio-']");
  invariant(ratio, "Ratio selector missing.");
  setNativeValue(ratio, "16:9");
  await nextPaint();
  const colorMode = document.querySelector<HTMLInputElement>('input[name="canvasBackground"][value="color"]');
  invariant(colorMode, "Color mode missing.");
  colorMode.click();
  await nextPaint();
  const color = document.querySelector<HTMLInputElement>('input[aria-label="Canvas background color"]');
  invariant(color, "Color input missing.");
  setNativeValue(color, "#3157a4");
  await nextPaint();
  clickByText("Apply");
  await nextPaint();

  const snapshot = runtime.store.getSnapshot();
  const workspace: WorkspaceState = { panelSizes: {}, viewports: {}, preferences: {} };
  const projection = createSceneProjection(snapshot, workspace);
  invariant(projection.canvas?.width === 128 && projection.canvas.height === 72, "Projection dimensions diverged.");
  invariant(projection.canvas.background === "#3157a4", "Projection background diverged.");

  const source = document.createElement("canvas");
  source.width = 256;
  source.height = 128;
  const sourceContext = source.getContext("2d");
  invariant(sourceContext, "Canvas2D source unavailable.");
  sourceContext.fillStyle = "#f4d35e";
  sourceContext.fillRect(0, 0, source.width, source.height);
  const exported = await renderBrowserSceneExport({
    projection,
    resolver: { resolve: () => source },
  });
  invariant(exported?.width === 128 && exported.height === 72, "Export dimensions diverged.");
  invariant(exported.background === "#3157a4" && exported.byteSize > 0, "Export background diverged.");

  const reloaded = projectCodec.decode(projectCodec.encode(
    structuredClone(snapshot.project) as StudioProjectV1,
  ));
  const reloadProjection = createSceneProjection({ project: reloaded, revision: snapshot.revision }, workspace);
  const reloadMatches = JSON.stringify(reloadProjection.canvas) === JSON.stringify(projection.canvas);
  invariant(reloadMatches, "Codec reload changed canvas settings.");

  const width = document.querySelector<HTMLInputElement>('input[name="canvasWidth"]');
  invariant(width, "Width input missing.");
  setNativeValue(width, "0");
  await nextPaint();
  const invalidDraftVisible = width.value === "0" && width.getAttribute("aria-invalid") === "true" &&
    document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled === true;
  invariant(invalidDraftVisible, "Invalid draft was not visible and blocked.");
  clickByText("Reset");
  await nextPaint();

  const keyboardControls = document.querySelectorAll("button, input, select").length;
  invariant(keyboardControls >= 7, "Keyboard controls are missing.");
  const pageFits = document.documentElement.scrollWidth <= innerWidth &&
    document.documentElement.scrollHeight <= innerHeight;
  invariant(pageFits, "Compact browser harness overflows its viewport.");
  invariant(errors.length === 0, `Browser errors: ${errors.join(" | ")}`);

  const output = document.querySelector<HTMLOutputElement>("#canonical-result");
  invariant(output, "Canonical result output missing.");
  output.textContent = `Composition ${projection.canvas.width}×${projection.canvas.height}\n${projection.canvas.background}\nPNG ${exported.byteSize} bytes\nReload exact`;
  output.className = "rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 font-mono text-xs text-emerald-200";
  return {
    status: "pass",
    revision: snapshot.revision,
    historyEntries: runtime.history.getSnapshot().undoEntries.length,
    canvas: projection.canvas,
    export: {
      width: exported.width,
      height: exported.height,
      background: exported.background,
      byteSize: exported.byteSize,
    },
    reloadMatches,
    invalidDraftVisible,
    keyboardControls,
    pageFits,
    errors,
  };
}

globalThis.__spriteBoyA103 = run().catch((error: unknown) => {
  const output = document.querySelector<HTMLOutputElement>("#canonical-result");
  if (output) {
    output.textContent = error instanceof Error ? error.message : String(error);
    output.className = "rounded-xl border border-red-400/30 bg-red-400/10 p-4 font-mono text-xs text-red-200";
  }
  return {
    status: "fail",
    revision: runtime.store.getSnapshot().revision,
    historyEntries: runtime.history.getSnapshot().undoEntries.length,
    canvas: null,
    export: null,
    reloadMatches: false,
    invalidDraftVisible: false,
    keyboardControls: 0,
    pageFits: false,
    errors: [...errors, error instanceof Error ? error.message : String(error)],
  };
});
