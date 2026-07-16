import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Grid3X3,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Scissors,
} from "lucide-react";

import type { GridLayoutValidationIssue } from "./gridLayoutDraft";
import type { SliceGridController } from "./useSliceGridController";
import SliceChromaControls from "./SliceChromaControls";

export interface SliceGridInspectorProps {
  readonly controller: SliceGridController;
}

function issueFor(
  issues: readonly GridLayoutValidationIssue[],
  path: "layout.manual.rows" | "layout.manual.cols",
): GridLayoutValidationIssue | null {
  return issues.find((issue) => issue.path === path || issue.path === "layout.manual") ?? null;
}

export const SliceGridInspector: React.FC<SliceGridInspectorProps> = ({ controller }) => {
  const id = useId();
  const rowsError = issueFor(controller.validationIssues, "layout.manual.rows");
  const colsError = issueFor(controller.validationIssues, "layout.manual.cols");
  const retryRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const restoreRetryFocusRef = useRef(false);
  const [cropDraft, setCropDraft] = useState(() => ({
    threshold: controller.cropPreview.threshold,
    padding: controller.cropPreview.padding,
  }));

  useEffect(() => {
    setCropDraft({
      threshold: controller.cropPreview.threshold,
      padding: controller.cropPreview.padding,
    });
  }, [controller.cropPreview.padding, controller.cropPreview.threshold]);

  useLayoutEffect(() => {
    if (controller.status === "error") {
      retryRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!restoreRetryFocusRef.current) return;
    statusRef.current?.focus({ preventScroll: true });
    if (controller.status === "detected" || controller.status === "fallback") {
      restoreRetryFocusRef.current = false;
    }
  }, [controller.status]);

  const detected = controller.detectedLayout;
  const cells = detected ? detected.rows * detected.cols : 0;
  const cropDisabled = controller.sourceDimensions === null;
  const cropCanReset = cropDraft.threshold !== 0 || cropDraft.padding !== 0;
  const commitCropThreshold = (value: number): void => {
    setCropDraft(controller.setCropThreshold(value)
      ? (current) => ({ ...current, threshold: value })
      : {
          threshold: controller.cropPreview.threshold,
          padding: controller.cropPreview.padding,
        });
  };
  const commitCropPadding = (value: number): void => {
    setCropDraft(controller.setCropPadding(value)
      ? (current) => ({ ...current, padding: value })
      : {
          threshold: controller.cropPreview.threshold,
          padding: controller.cropPreview.padding,
        });
  };

  return (
    <aside
      className="flex h-full min-h-0 flex-col overflow-hidden bg-panel-gradient"
      aria-label="Slice grid inspector"
      data-slice-grid-inspector=""
      data-grid-inference-origin={controller.detectedLayout?.origin ?? "none"}
      data-grid-recipe-mode={controller.recipe.layout.mode}
      data-grid-manual-draft={`${controller.recipeState.manual.rows}x${controller.recipeState.manual.cols}`}
      data-grid-recipe-layout={controller.recipe.layout.mode === "manual"
        ? `${controller.recipe.layout.rows}x${controller.recipe.layout.cols}`
        : "auto"}
      data-grid-crop-threshold={cropDraft.threshold}
      data-grid-crop-padding={cropDraft.padding}
      data-grid-crop-enabled={cropDraft.threshold > 0 ? "true" : "false"}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/5 bg-white/5 px-4">
        <Grid3X3 size={17} className="text-accent" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-sm font-bold tracking-wide text-textMain">Grid</h2>
          <p className="truncate text-[9px] uppercase tracking-wider text-textMuted">
            Slice layout
          </p>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 custom-scrollbar">
        <fieldset className="space-y-3">
          <legend className="text-[10px] font-bold uppercase tracking-widest text-textMuted">
            Layout mode
          </legend>
          <div
            role="radiogroup"
            aria-label="Grid layout mode"
            className="grid grid-cols-2 gap-2 rounded-xl border border-white/5 bg-black/20 p-1.5"
          >
            {(["auto", "manual"] as const).map((mode) => (
              <label
                key={mode}
                className={`cursor-pointer rounded-lg px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wider transition-colors focus-within:ring-2 focus-within:ring-accent ${
                  controller.draft.mode === mode
                    ? "bg-accent text-white shadow-glow-sm"
                    : "text-textMuted hover:bg-white/5 hover:text-textMain"
                }`}
              >
                <input
                  type="radio"
                  name={`${id}-mode`}
                  value={mode}
                  checked={controller.draft.mode === mode}
                  onChange={() => controller.setMode(mode)}
                  className="sr-only"
                />
                {mode === "auto" ? "Auto" : "Manual"}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-3 border-t border-white/5 pt-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-textMuted">
              Manual layout
            </h3>
            {controller.sourceDimensions && (
              <span className="font-mono text-[9px] text-textMuted/70">
                {controller.sourceDimensions.width} × {controller.sourceDimensions.height}px
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5 text-[10px] font-bold text-textMuted" htmlFor={`${id}-rows`}>
              Rows
              <input
                id={`${id}-rows`}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={controller.manualRowsInput}
                disabled={controller.draft.mode !== "manual"}
                aria-invalid={rowsError ? "true" : undefined}
                aria-describedby={rowsError ? `${id}-rows-error` : undefined}
                onChange={(event) => controller.setManualRowsInput(event.currentTarget.value)}
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-input px-3 py-2 font-mono text-xs text-textMain outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-45 aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:border-red-400"
              />
              {rowsError && (
                <span id={`${id}-rows-error`} className="block font-normal leading-snug text-red-300">
                  {rowsError.message}
                </span>
              )}
            </label>
            <label className="space-y-1.5 text-[10px] font-bold text-textMuted" htmlFor={`${id}-cols`}>
              Columns
              <input
                id={`${id}-cols`}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={controller.manualColsInput}
                disabled={controller.draft.mode !== "manual"}
                aria-invalid={colsError ? "true" : undefined}
                aria-describedby={colsError ? `${id}-cols-error` : undefined}
                onChange={(event) => controller.setManualColsInput(event.currentTarget.value)}
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-input px-3 py-2 font-mono text-xs text-textMain outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-45 aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:border-red-400"
              />
              {colsError && (
                <span id={`${id}-cols-error`} className="block font-normal leading-snug text-red-300">
                  {colsError.message}
                </span>
              )}
            </label>
          </div>
          <p className="text-[10px] leading-relaxed text-textMuted/75">
            Manual values stay saved when Auto is selected.
          </p>
        </div>

        <fieldset className="space-y-4 border-t border-white/5 pt-4" disabled={cropDisabled}>
          <legend className="sr-only">Crop</legend>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Scissors size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-textMuted">
                  Crop
                </h3>
                <p className="mt-1 text-[9px] leading-relaxed text-textMuted/70">
                  Trim transparent borders inside each cell.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={cropDisabled || !cropCanReset}
              onClick={() => {
                setCropDraft(controller.resetCrop()
                  ? { threshold: 0, padding: 0 }
                  : {
                      threshold: controller.cropPreview.threshold,
                      padding: controller.cropPreview.padding,
                    });
              }}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-[9px] font-bold text-textMuted transition-colors hover:bg-white/10 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-35"
            >
              <RotateCcw size={11} aria-hidden="true" /> Reset
            </button>
          </div>

          <label className="block space-y-2 text-[10px] font-bold text-textMuted" htmlFor={`${id}-crop-threshold`}>
            <span className="flex items-center justify-between gap-3">
              <span>Alpha threshold</span>
              <span className="font-mono text-textMain" aria-hidden="true">
                {cropDraft.threshold === 0 ? "Off" : `${cropDraft.threshold}%`}
              </span>
            </span>
            <input
              id={`${id}-crop-threshold`}
              type="range"
              min={0}
              max={100}
              step={1}
              value={cropDraft.threshold}
              aria-valuetext={cropDraft.threshold === 0
                ? "Off"
                : `${cropDraft.threshold}%`}
              aria-describedby={`${id}-crop-summary`}
              onChange={(event) => {
                const threshold = event.currentTarget.valueAsNumber;
                setCropDraft((current) => ({ ...current, threshold }));
              }}
              onPointerUp={(event) => commitCropThreshold(event.currentTarget.valueAsNumber)}
              onPointerCancel={(event) => commitCropThreshold(event.currentTarget.valueAsNumber)}
              onKeyUp={(event) => commitCropThreshold(event.currentTarget.valueAsNumber)}
              onBlur={(event) => commitCropThreshold(event.currentTarget.valueAsNumber)}
              className="w-full accent-accent disabled:cursor-not-allowed disabled:opacity-45"
            />
          </label>

          <label className="block space-y-2 text-[10px] font-bold text-textMuted" htmlFor={`${id}-crop-padding`}>
            <span className="flex items-center justify-between gap-3">
              <span>Padding</span>
              <span className="font-mono text-textMain" aria-hidden="true">
                {cropDraft.padding}px
              </span>
            </span>
            <input
              id={`${id}-crop-padding`}
              type="range"
              min={0}
              max={100}
              step={1}
              value={cropDraft.padding}
              aria-valuetext={`${cropDraft.padding}px`}
              aria-describedby={`${id}-crop-summary`}
              onChange={(event) => {
                const padding = event.currentTarget.valueAsNumber;
                setCropDraft((current) => ({ ...current, padding }));
              }}
              onPointerUp={(event) => commitCropPadding(event.currentTarget.valueAsNumber)}
              onPointerCancel={(event) => commitCropPadding(event.currentTarget.valueAsNumber)}
              onKeyUp={(event) => commitCropPadding(event.currentTarget.valueAsNumber)}
              onBlur={(event) => commitCropPadding(event.currentTarget.valueAsNumber)}
              className="w-full accent-accent disabled:cursor-not-allowed disabled:opacity-45"
            />
          </label>

          <div
            id={`${id}-crop-summary`}
            aria-label="Crop preview summary"
            aria-live="polite"
            aria-atomic="true"
            className="rounded-xl border border-white/5 bg-black/20 p-3 text-[10px] leading-relaxed text-textMuted"
          >
            {controller.cropPreview.cellCount === 0
              ? "Crop preview is available when the source grid is ready."
              : cropDraft.threshold > 0
                ? `Preview: ${controller.cropPreview.cellCount} ${controller.cropPreview.cellCount === 1 ? "cell" : "cells"} use ${cropDraft.threshold}% alpha threshold and ${cropDraft.padding}px padding. Reduction is measured after processing.`
                : `Auto crop is off. ${controller.cropPreview.cellCount} ${controller.cropPreview.cellCount === 1 ? "cell keeps" : "cells keep"} the original bounds.`}
          </div>
        </fieldset>

        <SliceChromaControls controller={controller} />

        <div
          ref={statusRef}
          role={controller.status === "error" ? "alert" : "status"}
          aria-label={controller.status === "error" ? "Grid detection error" : "Grid detection status"}
          tabIndex={-1}
          aria-live={controller.status === "error" ? "assertive" : "polite"}
          aria-atomic="true"
          data-grid-inference-origin={controller.detectedLayout?.origin ?? "none"}
          className={`rounded-xl border p-3 outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            controller.status === "error"
              ? "space-y-3 border-red-400/30 bg-red-500/10"
              : controller.status === "fallback"
                ? "border-amber-300/25 bg-amber-400/10"
                : "border-white/5 bg-black/20"
          }`}
        >
          {controller.status === "error" ? (
            <>
            <div className="flex gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-300" aria-hidden="true" />
              <p className="text-[10px] leading-relaxed text-red-100">{controller.errorMessage}</p>
            </div>
            <button
              ref={retryRef}
              type="button"
              onClick={() => {
                restoreRetryFocusRef.current = true;
                controller.retry();
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200/20 bg-white/5 px-3 py-2 text-[10px] font-bold text-red-100 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
            >
              <RefreshCw size={12} aria-hidden="true" /> Retry detection
            </button>
            </>
          ) : (
            <>
            {controller.status === "detecting" ? (
              <div className="flex items-center gap-2 text-[10px] text-textMuted">
                <LoaderCircle size={14} className="animate-spin text-accent" aria-hidden="true" />
                Detecting grid… Manual mode remains available.
              </div>
            ) : controller.status === "fallback" ? (
              <div className="flex gap-2 text-[10px] leading-relaxed text-amber-100">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
                No repeated grid was detected. Auto will use the safe 1 × 1 fallback.
              </div>
            ) : controller.status === "detected" && detected ? (
              <div className="flex gap-2 text-[10px] leading-relaxed text-textMain">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden="true" />
                <span>
                  Detected <strong>{detected.rows} rows × {detected.cols} columns</strong>
                  {` (${cells} cells).`}
                </span>
              </div>
            ) : (
              <p className="text-[10px] text-textMuted">Choose a source to detect its grid.</p>
            )}
            </>
          )}
        </div>
      </div>
    </aside>
  );
};

export default SliceGridInspector;
