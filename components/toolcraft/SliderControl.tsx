import { useEffect, useRef, useState } from "react";
import {
  createControlHistoryGroupId,
  type ControlValueChangeHandler,
} from "./controlTypes";
import {
  formatSliderValueWithUnit,
  normalizeSliderRange,
  snapSliderValue,
} from "./sliderValue";
import { ToolcraftSliderPrimitive } from "./SliderPrimitive";

export type SliderControlProps = {
  ariaDescribedBy?: string;
  baseValue?: number;
  className?: string;
  disabled?: boolean;
  id?: string;
  markerCount?: number;
  max?: number;
  min?: number;
  name: string;
  onValueChange?: ControlValueChangeHandler<number>;
  onValueCommit?: (value: number) => boolean | void;
  showFill?: boolean;
  step?: number;
  showHeader?: boolean;
  unit?: string;
  value: number;
  valueLabel?: string;
  variant?: "continuous" | "discrete";
};

export function SliderControl({
  ariaDescribedBy,
  baseValue,
  className,
  disabled = false,
  id,
  markerCount,
  max = 100,
  min = 0,
  name,
  onValueChange,
  onValueCommit,
  showFill = true,
  step = 1,
  showHeader = true,
  unit,
  value,
  valueLabel,
  variant = "continuous",
}: SliderControlProps) {
  const range = normalizeSliderRange(min, max, step);
  const snappedProp = snapSliderValue(value, range);
  const [rendered, setRendered] = useState(snappedProp);
  const [editing, setEditing] = useState(false);
  const [editorDraft, setEditorDraft] = useState("");
  const latestRef = useRef(snappedProp);
  const historyGroupRef = useRef<string | null>(null);
  const editorStartRef = useRef(snappedProp);

  useEffect(() => {
    setRendered(snappedProp);
    latestRef.current = snappedProp;
  }, [snappedProp]);

  const liveFormatted = formatSliderValueWithUnit(rendered, range.step, unit);
  const matchesControlledProp = rendered === snappedProp;
  const displayText =
    matchesControlledProp && valueLabel !== undefined
      ? valueLabel
      : liveFormatted;

  const emitLive = (next: number) => {
    if (disabled) return;
    latestRef.current = next;
    setRendered(next);
    if (historyGroupRef.current === null) {
      historyGroupRef.current = createControlHistoryGroupId(name);
    }
    onValueChange?.(next, {
      history: "merge",
      historyGroup: historyGroupRef.current,
    });
  };

  const finishInteraction = () => {
    if (disabled) return;
    if (historyGroupRef.current === null) return;
    historyGroupRef.current = null;
    const accepted = onValueCommit?.(latestRef.current);
    if (accepted === false) {
      latestRef.current = snappedProp;
      setRendered(snappedProp);
    }
  };

  const handleChange = (raw: string) => {
    if (disabled) return;
    const next = snapSliderValue(Number(raw), range);
    emitLive(next);
  };

  const handleReset = () => {
    if (disabled || baseValue === undefined) return;
    const next = snapSliderValue(baseValue, range);
    historyGroupRef.current = null;
    latestRef.current = next;
    setRendered(next);
    onValueChange?.(next, { history: "record" });
    const accepted = onValueCommit?.(next);
    if (accepted === false) {
      latestRef.current = snappedProp;
      setRendered(snappedProp);
    }
  };

  const beginEditing = () => {
    if (disabled) return;
    editorStartRef.current = rendered;
    setEditorDraft(displayText);
    setEditing(true);
  };

  const cancelEditing = () => {
    const historyGroup = historyGroupRef.current;
    const startValue = editorStartRef.current;
    if (historyGroup !== null && latestRef.current !== startValue) {
      latestRef.current = startValue;
      setRendered(startValue);
      onValueChange?.(startValue, { history: "merge", historyGroup });
    }
    historyGroupRef.current = null;
    setEditorDraft("");
    setEditing(false);
  };

  const commitEditor = () => {
    const match = editorDraft.match(/-?\d+(?:\.\d+)?/u);
    const parsed = match ? Number.parseFloat(match[0]) : Number.NaN;
    if (Number.isFinite(parsed)) {
      const next = snapSliderValue(parsed, range);
      if (next !== latestRef.current) emitLive(next);
      finishInteraction();
    }
    cancelEditing();
  };

  const rootClass = [
    "flex flex-col gap-1",
    disabled ? "opacity-50" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={rootClass}
      data-disabled={disabled ? "true" : undefined}
      data-toolcraft-control="slider"
    >
      {showHeader ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-textMuted">{name}</span>
          {editing ? (
            <input
              autoFocus
              type="text"
              inputMode="decimal"
              aria-label={`${name} value`}
              value={editorDraft}
              onChange={(event) => setEditorDraft(event.currentTarget.value)}
              onBlur={commitEditor}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitEditor();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancelEditing();
                } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  const direction = event.key === "ArrowUp" ? 1 : -1;
                  const match = editorDraft.match(/-?\d+(?:\.\d+)?/u);
                  const base = match ? Number.parseFloat(match[0]) : rendered;
                  const next = snapSliderValue(base + direction * range.step, range);
                  emitLive(next);
                  setEditorDraft(formatSliderValueWithUnit(next, range.step, unit));
                }
              }}
              className="h-5 w-16 rounded border border-accent/35 bg-input px-1.5 text-right font-mono text-xs tabular-nums text-textMain outline-none"
            />
          ) : (
            <button
              type="button"
              disabled={disabled}
              aria-label={`Edit ${name} value`}
              onClick={beginEditing}
              className="h-5 min-w-10 cursor-text bg-transparent p-0 text-right font-mono text-xs tabular-nums text-textMuted transition-colors hover:text-textMain disabled:cursor-default"
            >
              {displayText}
            </button>
          )}
        </div>
      ) : null}
      <ToolcraftSliderPrimitive
        id={id}
        ariaDescribedBy={ariaDescribedBy}
        disabled={disabled}
        markerCount={markerCount}
        max={range.max}
        min={range.min}
        names={[name]}
        onReset={handleReset}
        onValueChange={(values) => handleChange(String(values[0] ?? rendered))}
        onValueCommit={finishInteraction}
        showFill={showFill}
        step={range.step}
        values={[rendered]}
        valueTexts={[displayText]}
        variant={variant}
      />
    </div>
  );
}
