import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  createControlHistoryGroupId,
  type ControlValueChangeHandler,
} from "./controlTypes";
import {
  formatSliderValueWithUnit,
  normalizeSliderRange,
  snapSliderValue,
} from "./sliderValue";

export type RangeSliderControlProps = {
  baseValue?: readonly [number, number];
  className?: string;
  disabled?: boolean;
  max?: number;
  min?: number;
  name: string;
  onValueChange?: ControlValueChangeHandler<readonly [number, number]>;
  onValueCommit?: (value: readonly [number, number]) => void;
  step?: number;
  unit?: string;
  value: readonly [number, number];
  valueLabel?: string;
};

function normalizePair(
  value: readonly [number, number],
  range: { min: number; max: number; step: number },
): readonly [number, number] {
  let start = snapSliderValue(value[0], range);
  let end = snapSliderValue(value[1], range);
  if (start > end) {
    const swap = start;
    start = end;
    end = swap;
  }
  return [start, end];
}
function formatPair(
  value: readonly [number, number],
  step: number,
  unit?: string,
): string {
  const a = formatSliderValueWithUnit(value[0], step, unit);
  const b = formatSliderValueWithUnit(value[1], step, unit);
  return `${a} – ${b}`;
}

export function RangeSliderControl({
  baseValue,
  className,
  disabled = false,
  max = 100,
  min = 0,
  name,
  onValueChange,
  onValueCommit,
  step = 1,
  unit,
  value,
  valueLabel,
}: RangeSliderControlProps) {
  const range = normalizeSliderRange(min, max, step);
  const snappedProp = normalizePair(value, range);
  const [rendered, setRendered] = useState<readonly [number, number]>(snappedProp);
  const latestRef = useRef<readonly [number, number]>(snappedProp);
  const historyGroupRef = useRef<string | null>(null);

  useEffect(() => {
    setRendered(snappedProp);
    latestRef.current = snappedProp;
  }, [snappedProp[0], snappedProp[1]]);

  const liveFormatted = formatPair(rendered, range.step, unit);
  const matchesControlledProp =
    rendered[0] === snappedProp[0] && rendered[1] === snappedProp[1];
  const displayText =
    matchesControlledProp && valueLabel !== undefined
      ? valueLabel
      : liveFormatted;
  const startName = `${name} start`;
  const endName = `${name} end`;

  const emitLive = (next: readonly [number, number]) => {
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
    onValueCommit?.(latestRef.current);
  };

  const handleStartChange = (raw: string) => {
    if (disabled) return;
    let start = snapSliderValue(Number(raw), range);
    const end = rendered[1];
    if (start > end) start = end;
    emitLive([start, end]);
  };

  const handleEndChange = (raw: string) => {
    if (disabled) return;
    const start = rendered[0];
    let end = snapSliderValue(Number(raw), range);
    if (end < start) end = start;
    emitLive([start, end]);
  };

  const handleReset = () => {
    if (disabled || baseValue === undefined) return;
    const next = normalizePair(baseValue, range);
    historyGroupRef.current = null;
    latestRef.current = next;
    setRendered(next);
    onValueChange?.(next, { history: "record" });
    onValueCommit?.(next);
  };

  const rootClass = [
    "flex flex-col gap-1",
    disabled ? "opacity-50" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const inputClass =
    "w-full accent-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";

  return (
    <fieldset
      className={rootClass}
      data-disabled={disabled ? "true" : undefined}
      disabled={disabled}
    >
      <legend className="sr-only">{name}</legend>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-textMuted" aria-hidden="true">
          {name}
        </span>
        <span className="text-xs tabular-nums text-textMain">{displayText}</span>
      </div>
      <div className="flex flex-col gap-1">
        <input
          type="range"
          name={startName}
          aria-label={startName}
          aria-valuemin={range.min}
          aria-valuemax={range.max}
          aria-valuenow={rendered[0]}
          aria-valuetext={formatSliderValueWithUnit(rendered[0], range.step, unit)}
          min={range.min}
          max={range.max}
          step={range.step}
          value={rendered[0]}
          disabled={disabled}
          className={inputClass}
          style={{ accentColor: "var(--color-accent)" } as CSSProperties}
          onChange={(event) => handleStartChange(event.target.value)}
          onPointerUp={finishInteraction}
          onPointerCancel={finishInteraction}
          onKeyUp={finishInteraction}
          onBlur={finishInteraction}
          onDoubleClick={handleReset}
        />
        <input
          type="range"
          name={endName}
          aria-label={endName}
          aria-valuemin={range.min}
          aria-valuemax={range.max}
          aria-valuenow={rendered[1]}
          aria-valuetext={formatSliderValueWithUnit(rendered[1], range.step, unit)}
          min={range.min}
          max={range.max}
          step={range.step}
          value={rendered[1]}
          disabled={disabled}
          className={inputClass}
          style={{ accentColor: "var(--color-accent)" } as CSSProperties}
          onChange={(event) => handleEndChange(event.target.value)}
          onPointerUp={finishInteraction}
          onPointerCancel={finishInteraction}
          onKeyUp={finishInteraction}
          onBlur={finishInteraction}
          onDoubleClick={handleReset}
        />
      </div>
    </fieldset>
  );
}
