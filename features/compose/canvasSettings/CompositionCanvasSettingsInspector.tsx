import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, Maximize2, RefreshCw, SwatchBook } from "lucide-react";
import { useProjectStoreSelector } from "../../../hooks/useStudioStoreSelector";
import { isEntityId, isISO8601Timestamp, type EntityId } from "../../../core/project";
import type { ProjectStore } from "../../../core/stores";
import {
  COMPOSITION_ASPECT_RATIOS,
  applyCompositionAspectRatio,
  applyCompositionCanvasSettings,
  createCompositionCanvasBaseline,
  createCompositionCanvasDraft,
  detectCompositionAspectRatio,
  validateCompositionCanvasDraft,
  type CompositionAspectRatioId,
  type CompositionCanvasBaseline,
  type CompositionCanvasDraft,
} from "./compositionCanvasSettings";

export interface CompositionCanvasSettingsInspectorProps {
  readonly store: ProjectStore;
  readonly compositionId: EntityId;
  readonly className?: string;
  readonly now?: () => string;
  readonly createCommandId?: (revision: number) => EntityId;
}

type Feedback = { readonly kind: "success" | "error"; readonly message: string } | null;

const fieldClass = "w-full rounded-lg border border-white/10 bg-input px-2.5 py-2 text-xs text-textMain outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50";

function sameDraft(left: CompositionCanvasDraft, right: CompositionCanvasDraft): boolean {
  return left.width === right.width && left.height === right.height &&
    left.backgroundMode === right.backgroundMode && left.backgroundColor === right.backgroundColor;
}

function colorInputValue(color: string): string {
  if (/^#[\da-f]{3,4}$/i.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  }
  return /^#[\da-f]{6,8}$/i.test(color) ? color.slice(0, 7) : "#ffffff";
}

export function CompositionCanvasSettingsInspector({
  store,
  compositionId,
  className = "",
  now = () => new Date().toISOString(),
  createCommandId,
}: CompositionCanvasSettingsInspectorProps) {
  const selected = useProjectStoreSelector(store, (state) => Object.freeze({
    revision: state.revision,
    composition: state.project.compositions[compositionId] ?? null,
  }), (left, right) => left.revision === right.revision && left.composition === right.composition);
  const initialDraft = selected.composition
    ? createCompositionCanvasDraft(selected.composition)
    : Object.freeze({ width: "", height: "", backgroundMode: "transparent" as const, backgroundColor: "#ffffff" });
  const [draft, setDraft] = useState<CompositionCanvasDraft>(initialDraft);
  const [baseline, setBaseline] = useState<CompositionCanvasBaseline | null>(
    selected.composition ? createCompositionCanvasBaseline(selected.revision, selected.composition) : null,
  );
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [externalChange, setExternalChange] = useState(false);
  const commandSequence = useRef(0);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const focusFeedbackSafely = () => {
    const focus = () => {
      try {
        feedbackRef.current?.focus({ preventScroll: true });
        return;
      } catch {
        // Fall through to a stable form control when a host focus implementation fails.
      }
      try {
        formRef.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")
          ?.focus({ preventScroll: true });
      } catch {
        // Feedback remains visible and announced even when the host cannot move focus.
      }
    };
    try {
      requestAnimationFrame(focus);
    } catch {
      try {
        queueMicrotask(focus);
      } catch {
        focus();
      }
    }
  };

  const canonicalDraft = useMemo(
    () => selected.composition ? createCompositionCanvasDraft(selected.composition) : null,
    [selected.composition],
  );
  const dirty = canonicalDraft ? !sameDraft(draft, canonicalDraft) : false;
  const validation = useMemo(() => validateCompositionCanvasDraft(draft), [draft]);
  const ratio = validation.value
    ? detectCompositionAspectRatio(validation.value.width, validation.value.height)
    : "custom";

  useEffect(() => {
    if (!selected.composition || !canonicalDraft) return;
    if (!baseline) {
      setDraft(canonicalDraft);
      setBaseline(createCompositionCanvasBaseline(selected.revision, selected.composition));
      setExternalChange(false);
      return;
    }
    const canonicalChanged = baseline.width !== selected.composition.width ||
      baseline.height !== selected.composition.height ||
      baseline.background !== (selected.composition.background ?? null);
    if (!dirty) {
      if (canonicalChanged) {
        setDraft(canonicalDraft);
        setBaseline(createCompositionCanvasBaseline(selected.revision, selected.composition));
      }
      setExternalChange(false);
      return;
    }
    setExternalChange(canonicalChanged);
  }, [baseline, canonicalDraft, dirty, selected.composition, selected.revision]);

  const reloadLatest = () => {
    if (!selected.composition || !canonicalDraft) return;
    setDraft(canonicalDraft);
    setBaseline(createCompositionCanvasBaseline(selected.revision, selected.composition));
    setExternalChange(false);
    setFeedback({ kind: "success", message: "Latest canvas settings loaded." });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!baseline) return;
    commandSequence.current += 1;
    let commandId: EntityId;
    let issuedAt: string;
    try {
      commandId = createCommandId?.(selected.revision) ??
        `composition-canvas-${selected.revision}-${commandSequence.current}`;
      issuedAt = now();
    } catch {
      setFeedback({ kind: "error", message: "Canvas settings could not be prepared. Try again." });
      focusFeedbackSafely();
      return;
    }
    if (!isEntityId(commandId) || !isISO8601Timestamp(issuedAt)) {
      setFeedback({ kind: "error", message: "Canvas settings could not be prepared. Try again." });
      focusFeedbackSafely();
      return;
    }
    const result = applyCompositionCanvasSettings(store, {
      compositionId,
      draft,
      baseline,
      commandId,
      issuedAt,
    });
    if (!result.ok) {
      setFeedback({ kind: "error", message: result.message });
      if (result.code === "STALE_DRAFT") setExternalChange(true);
    } else {
      setDraft(createCompositionCanvasDraft(result.value));
      setBaseline(createCompositionCanvasBaseline(result.revision, result.value));
      setExternalChange(false);
      setFeedback({
        kind: "success",
        message: result.outcome === "updated" ? "Canvas settings applied." : "Canvas settings are already current.",
      });
    }
    focusFeedbackSafely();
  };

  if (!selected.composition) {
    return (
      <section aria-label="Canvas settings" className={`p-4 text-xs text-textMuted ${className}`}>
        Select a composition to edit its canvas.
      </section>
    );
  }

  const previewStyle = validation.value
    ? {
        aspectRatio: `${validation.value.width} / ${validation.value.height}`,
        backgroundColor: validation.value.background ?? undefined,
        maxWidth: validation.value.width >= validation.value.height ? "100%" : "52%",
      }
    : { aspectRatio: "1 / 1", maxWidth: "70%" };

  return (
    <form
      ref={formRef}
      aria-label="Canvas settings"
      className={`flex min-h-0 flex-col gap-4 overflow-y-auto p-4 text-textMain ${className}`}
      onSubmit={submit}
      onReset={(event) => {
        event.preventDefault();
        reloadLatest();
      }}
    >
      <div className="flex items-center gap-2">
        <Maximize2 size={15} className="text-accent" aria-hidden="true" />
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider">Canvas</h3>
          <p className="mt-0.5 text-[10px] text-textMuted">Dimensions and export background</p>
        </div>
      </div>

      <div className="flex min-h-28 items-center justify-center rounded-xl border border-white/10 bg-black/20 p-3" aria-label="Canvas preview">
        <div
          data-canvas-preview
          className={`relative w-full overflow-hidden rounded-md border border-white/20 shadow-lg ${validation.value?.background === null ? "bg-checkered" : ""}`}
          style={previewStyle}
        >
          <div className="absolute inset-0 flex items-end justify-end p-2">
            <span className="rounded bg-black/65 px-1.5 py-1 font-mono text-[9px] text-white">
              {validation.value ? `${validation.value.width} × ${validation.value.height}` : "Invalid size"}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor={`composition-ratio-${compositionId}`} className="text-[10px] font-bold uppercase tracking-wider text-textMuted">
          Aspect ratio
        </label>
        <select
          id={`composition-ratio-${compositionId}`}
          value={ratio}
          className={fieldClass}
          onChange={(event) => {
            if (event.target.value === "custom") return;
            setDraft((current) => applyCompositionAspectRatio(current, event.target.value as CompositionAspectRatioId));
            setFeedback(null);
          }}
        >
          {COMPOSITION_ASPECT_RATIOS.map((item) => (
            <option key={item.id} value={item.id}>{item.id} · {item.label}</option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </div>

      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="sr-only">Canvas dimensions</legend>
        <label className="space-y-1.5 text-[10px] font-bold uppercase tracking-wider text-textMuted">
          Width
          <input
            name="canvasWidth"
            inputMode="numeric"
            autoComplete="off"
            value={draft.width}
            aria-invalid={Boolean(validation.errors.width)}
            aria-describedby={validation.errors.width ? `composition-width-error-${compositionId}` : undefined}
            className={fieldClass}
            onChange={(event) => {
              setDraft((current) => Object.freeze({ ...current, width: event.target.value }));
              setFeedback(null);
            }}
          />
          {validation.errors.width ? <span id={`composition-width-error-${compositionId}`} className="block normal-case text-red-300">{validation.errors.width}</span> : null}
        </label>
        <label className="space-y-1.5 text-[10px] font-bold uppercase tracking-wider text-textMuted">
          Height
          <input
            name="canvasHeight"
            inputMode="numeric"
            autoComplete="off"
            value={draft.height}
            aria-invalid={Boolean(validation.errors.height)}
            aria-describedby={validation.errors.height ? `composition-height-error-${compositionId}` : undefined}
            className={fieldClass}
            onChange={(event) => {
              setDraft((current) => Object.freeze({ ...current, height: event.target.value }));
              setFeedback(null);
            }}
          />
          {validation.errors.height ? <span id={`composition-height-error-${compositionId}`} className="block normal-case text-red-300">{validation.errors.height}</span> : null}
        </label>
      </fieldset>
      {validation.errors.canvas ? <p role="alert" className="text-[10px] text-red-300">{validation.errors.canvas}</p> : null}

      <fieldset className="space-y-2 border-t border-white/10 pt-4">
        <legend className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-textMuted">
          <SwatchBook size={13} aria-hidden="true" /> Background
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {(["transparent", "color"] as const).map((mode) => (
            <label key={mode} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-[10px] font-bold capitalize ${draft.backgroundMode === mode ? "border-accent bg-accent/15 text-textMain" : "border-white/10 text-textMuted"}`}>
              <input
                type="radio"
                name="canvasBackground"
                value={mode}
                checked={draft.backgroundMode === mode}
                onChange={() => {
                  setDraft((current) => Object.freeze({ ...current, backgroundMode: mode }));
                  setFeedback(null);
                }}
              />
              {mode}
            </label>
          ))}
        </div>
        {draft.backgroundMode === "color" ? (
          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-input p-2 text-[10px] font-bold uppercase tracking-wider text-textMuted">
            Color
            <input
              aria-label="Canvas background color"
              type="color"
              value={colorInputValue(draft.backgroundColor)}
              className="h-8 min-w-10 flex-1 cursor-pointer rounded border-0 bg-transparent"
              onChange={(event) => {
                setDraft((current) => Object.freeze({ ...current, backgroundColor: event.target.value }));
                setFeedback(null);
              }}
            />
            <span className="font-mono text-textMain">{draft.backgroundColor.toUpperCase()}</span>
          </label>
        ) : null}
      </fieldset>

      {externalChange ? (
        <div role="alert" className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5 text-[10px] text-amber-100">
          Canvas settings changed elsewhere. Reload before applying this draft.
        </div>
      ) : null}
      {feedback ? (
        <div
          ref={feedbackRef}
          tabIndex={-1}
          role={feedback.kind === "error" ? "alert" : "status"}
          className={`rounded-lg border p-2.5 text-[10px] ${feedback.kind === "error" ? "border-red-400/30 bg-red-400/10 text-red-200" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"}`}
        >
          {feedback.message}
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-1 mt-auto grid grid-cols-2 gap-2 bg-panel/95 p-1 pt-3 backdrop-blur">
        <button
          type="reset"
          disabled={!dirty && !externalChange}
          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-white/10 bg-surface px-3 text-[10px] font-bold text-textMuted transition-colors hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RefreshCw size={13} aria-hidden="true" /> Reset
        </button>
        <button
          type="submit"
          disabled={!dirty || !validation.valid || externalChange}
          className="btn-primary inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Check size={13} aria-hidden="true" /> Apply
        </button>
      </div>
    </form>
  );
}

export default CompositionCanvasSettingsInspector;
