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

export type SliderControlProps = {
  baseValue?: number;
  className?: string;
  disabled?: boolean;
  max?: number;
  min?: number;
  name: string;
  onValueChange?: ControlValueChangeHandler<number>;
  onValueCommit?: (value: number) => void;
  step?: number;
  unit?: string;
  value: number;
  valueLabel?: string;
};

export function SliderControl({
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
}: SliderControlProps) {
  const range = normalizeSliderRange(min, max, step);
  const snappedProp = snapSliderValue(value, range);
  const [rendered, setRendered] = useState(snappedProp);
  const latestRef = useRef(snappedProp);
  const historyGroupRef = useRef<string | null>(null);

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
    onValueCommit?.(latestRef.current);
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
    onValueCommit?.(next);
  };

  const rootClass = [
    "flex flex-col gap-1",
    disabled ? "opacity-50" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass} data-disabled={disabled ? "true" : undefined}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-textMuted">{name}</span>
        <span className="text-xs tabular-nums text-textMain">{displayText}</span>
      </div>
      <input
        type="range"
        name={name}
        aria-label={name}
        aria-valuemin={range.min}
        aria-valuemax={range.max}
        aria-valuenow={rendered}
        aria-valuetext={displayText}
        min={range.min}
        max={range.max}
        step={range.step}
        value={rendered}
        disabled={disabled}
        className="w-full accent-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        style={{ accentColor: "var(--color-accent)" } as CSSProperties}
        onChange={(event) => handleChange(event.target.value)}
        onPointerUp={finishInteraction}
        onPointerCancel={finishInteraction}
        onKeyUp={finishInteraction}
        onBlur={finishInteraction}
        onDoubleClick={handleReset}
      />
    </div>
  );
}
