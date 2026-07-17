import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Play, RefreshCw, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { StagedGridResultsController } from "./useStagedGridResults";
import type { StagedGridResultOutput } from "./stagedGridResults";

export interface SliceResultsTrayProps {
  readonly controller: StagedGridResultsController;
}

/** Keep the tray bounded even when an auto-detected sheet contains thousands of cells. */
export const STAGED_OUTPUT_PAGE_SIZE = 48;

function statusLabel(controller: StagedGridResultsController): string {
  switch (controller.state.status) {
    case "processing": return controller.state.progress
      ? `Processing ${controller.state.progress.stage} · ${Math.round(controller.state.progress.ratio * 100)}%`
      : "Preparing slices…";
    case "succeeded": return `${controller.state.summary?.outputCount ?? 0} staged slices ready`;
    case "failed": return controller.state.error?.message ?? "Processing failed.";
    case "cancelled": return "Processing cancelled.";
    default: return controller.canProcess ? "Ready to process the current recipe." : "Load a validated source to process slices.";
  }
}

function warningLabel(warning: string): string {
  switch (warning) {
    case "empty-output": return "Empty cells were kept in row-major order.";
    case "grid-detection-fallback": return "Automatic detection used a safe fallback layout.";
    case "pixel-size-clamped": return "Pixel size was clamped to the safe source limit.";
    case "palette-reduced": return "The palette was reduced to the colors present in the output.";
    default: return "The worker reported a processing warning.";
  }
}

function OutputPreview({
  output,
  selected,
  onSelect,
}: {
  readonly output: StagedGridResultOutput;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = output.surface.width;
    canvas.height = output.surface.height;
    let context: CanvasRenderingContext2D | null = null;
    try {
      context = canvas.getContext("2d", { alpha: true });
    } catch {
      return;
    }
    if (!context) return;
    context.imageSmoothingEnabled = false;
    try {
      context.putImageData(
        new ImageData(
          new Uint8ClampedArray(output.surface.pixels),
          output.surface.width,
          output.surface.height,
        ),
        0,
        0,
      );
    } catch {
      context.clearRect(0, 0, output.surface.width, output.surface.height);
    }
  }, [output]);

  return (
    <button
      type="button"
      aria-label={`Slice ${output.index + 1}, ${output.surface.width} by ${output.surface.height}${output.contentBounds === null ? ", empty" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
      className={[
        "group flex w-[82px] shrink-0 flex-col gap-1 rounded-lg border p-1.5 text-left transition",
        selected
          ? "border-accent bg-accent/10 ring-2 ring-accent/30"
          : "border-white/10 bg-surface/70 hover:border-white/25 hover:bg-white/5",
      ].join(" ")}
    >
      <span className="relative block aspect-square overflow-hidden rounded-md border border-white/10 bg-[conic-gradient(from_90deg_at_1px_1px,#20232b_90deg,#171920_0)] bg-[length:10px_10px]">
        <canvas ref={canvasRef} className="block h-full w-full [image-rendering:pixelated]" aria-hidden="true" />
        {output.contentBounds === null ? (
          <span className="absolute inset-x-0 bottom-0 bg-black/65 px-1 py-0.5 text-center text-[8px] font-bold uppercase tracking-wide text-textMuted">
            Empty
          </span>
        ) : null}
      </span>
      <span className="truncate font-mono text-[9px] font-bold text-textMuted">#{output.index + 1}</span>
    </button>
  );
}

function StatusIcon({ status }: { readonly status: string }): ReactNode {
  if (status === "succeeded") return <CheckCircle2 size={14} aria-hidden="true" className="text-emerald-300" />;
  if (status === "failed" || status === "cancelled") return <AlertTriangle size={14} aria-hidden="true" className="text-amber-300" />;
  if (status === "processing") return <RefreshCw size={14} aria-hidden="true" className="animate-spin text-accent" />;
  return <Info size={14} aria-hidden="true" className="text-textMuted" />;
}

export function SliceResultsTray({ controller }: SliceResultsTrayProps) {
  const { state } = controller;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(state.outputs.length / STAGED_OUTPUT_PAGE_SIZE));
  useEffect(() => {
    const selectedPage = state.selectedIndex === null
      ? null
      : Math.floor(state.selectedIndex / STAGED_OUTPUT_PAGE_SIZE);
    setPage((current) => {
      const next = selectedPage ?? Math.min(current, pageCount - 1);
      return Math.max(0, Math.min(next, pageCount - 1));
    });
  }, [pageCount, state.selectedIndex]);
  const selected = state.selectedIndex === null ? null : state.outputs[state.selectedIndex] ?? null;
  const warnings = state.summary?.warnings ?? [];
  const isProcessing = state.status === "processing";
  const canRetry = (state.status === "failed" || state.status === "cancelled") &&
    (state.error?.retryable ?? true) && controller.canProcess;
  const pageStart = page * STAGED_OUTPUT_PAGE_SIZE;
  const visibleOutputs = state.outputs.slice(pageStart, pageStart + STAGED_OUTPUT_PAGE_SIZE);
  const pageEnd = Math.min(state.outputs.length, pageStart + visibleOutputs.length);

  return (
    <section
      aria-label="Staged slice results"
      data-slice-results-tray=""
      className="shrink-0 border-t border-white/10 bg-panel/95 px-3 py-2.5 shadow-[0_-12px_28px_rgba(0,0,0,0.16)]"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusIcon status={state.status} />
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-textMuted">Slices</p>
            <p role="status" aria-live="polite" className="truncate text-xs font-semibold text-textMain">{statusLabel(controller)}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {isProcessing ? (
            <button
              type="button"
              aria-label="Cancel"
              onClick={controller.cancel}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-amber-300/25 bg-amber-300/5 px-2.5 py-1.5 text-[10px] font-bold text-amber-200 hover:bg-amber-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              <Square size={11} aria-hidden="true" />
              Cancel
            </button>
          ) : canRetry ? (
            <button
              type="button"
              aria-label="Retry"
              onClick={() => void controller.retry()}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-white/10 bg-surface px-2.5 py-1.5 text-[10px] font-bold text-textMain hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <RefreshCw size={11} aria-hidden="true" />
              Retry
            </button>
          ) : null}
          <button
            type="button"
            aria-label={state.status === "succeeded" ? "Process again" : "Process slices"}
            disabled={!controller.canProcess || isProcessing}
            onClick={() => void controller.process()}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-accent/35 bg-accent/15 px-2.5 py-1.5 text-[10px] font-bold text-accent hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Play size={11} aria-hidden="true" />
            {state.status === "succeeded" ? "Process again" : "Process slices"}
          </button>
          {state.outputs.length > 0 ? (
            <button
              type="button"
              aria-label="Clear"
              onClick={controller.clear}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-[10px] font-bold text-textMuted hover:bg-white/5 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Trash2 size={11} aria-hidden="true" />
              Clear
            </button>
          ) : null}
        </div>
      </div>
      {state.error && !isProcessing ? (
        <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-[10px] text-amber-300">
          <AlertTriangle size={11} aria-hidden="true" />
          {state.error.message}
        </p>
      ) : null}
      {state.outputs.length > 0 ? (
        <>
          <div className="mt-2 flex min-w-0 gap-2 overflow-x-auto pb-1" aria-label="Staged slice outputs" data-visible-output-count={visibleOutputs.length}>
            {visibleOutputs.map((output) => (
              <OutputPreview
                key={output.index}
                output={output}
                selected={output.index === state.selectedIndex}
                onSelect={() => controller.select(output.index)}
              />
            ))}
          </div>
          {pageCount > 1 ? (
            <div className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[9px] text-textMuted" aria-label="Staged output pages">
              <span>Showing {pageStart + 1}–{pageEnd} of {state.outputs.length}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous output page"
                  disabled={page === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  className="inline-flex min-h-6 items-center rounded border border-white/10 px-1.5 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <ChevronLeft size={11} aria-hidden="true" />
                </button>
                <span aria-live="polite">Page {page + 1} of {pageCount}</span>
                <button
                  type="button"
                  aria-label="Next output page"
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                  className="inline-flex min-h-6 items-center rounded border border-white/10 px-1.5 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <ChevronRight size={11} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] text-textMuted">
            <span>{state.summary?.outputCount ?? 0} outputs</span>
            <span>{state.summary?.outputPixelCount ?? 0} pixels</span>
            <span>{Math.round((state.summary?.cropReductionRatio ?? 0) * 100)}% crop reduction</span>
            {selected ? <span>Selected #{selected.index + 1} · {selected.surface.width}×{selected.surface.height}</span> : null}
          </div>
          {warnings.length > 0 ? (
            <ul className="mt-1.5 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[9px] text-amber-200" aria-label="Processing tips">
              {warnings.map((warning) => <li key={warning}>{warningLabel(warning)}</li>)}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export default SliceResultsTray;
