import { useEffect, useRef, useState } from "react";
import { Slider as BaseSlider } from "@base-ui/react/slider";
import { snapSliderValue } from "./sliderValue";

export interface ToolcraftSliderPrimitiveProps {
  readonly ariaDescribedBy?: string;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly markerCount?: number;
  readonly max: number;
  readonly min: number;
  readonly names: readonly string[];
  readonly onReset?: (index: number) => void;
  readonly onValueChange: (values: readonly number[]) => void;
  readonly onValueCommit: (values: readonly number[]) => void;
  readonly showFill?: boolean;
  readonly step: number;
  readonly values: readonly number[];
  readonly valueTexts?: readonly string[];
  readonly variant?: "continuous" | "discrete";
}

export function ToolcraftSliderPrimitive({
  ariaDescribedBy,
  disabled = false,
  id,
  markerCount,
  max,
  min,
  names,
  onReset,
  onValueChange,
  onValueCommit,
  showFill = true,
  step,
  values,
  valueTexts,
  variant = "continuous",
}: ToolcraftSliderPrimitiveProps) {
  const [discreteValues, setDiscreteValues] = useState<readonly number[] | null>(null);
  const latestValuesRef = useRef<readonly number[]>(values);
  const commitPendingRef = useRef(false);
  const lastEmittedKeyRef = useRef("");
  const controlledKey = values.join("|");
  const snapValues = (next: readonly number[]) => next.map((value) => (
    snapSliderValue(value, { min, max, step })
  ));
  const activeValues = variant === "discrete" && discreteValues !== null
    ? discreteValues
    : values;
  const rootStep = variant === "discrete"
    ? Math.max((max - min) / 1000, 0.000001)
    : step;
  const resolvedMarkerCount = variant === "discrete"
    ? Math.max(2, markerCount ?? Math.min(21, Math.round((max - min) / step) + 1))
    : 0;

  useEffect(() => {
    latestValuesRef.current = values;
    if (
      variant === "discrete" && discreteValues !== null
      && controlledKey !== lastEmittedKeyRef.current
    ) setDiscreteValues(null);
  }, [controlledKey, discreteValues, values, variant]);

  const emitChange = (next: readonly number[]) => {
    const resolved = variant === "discrete" ? snapValues(next) : next;
    if (variant === "discrete") setDiscreteValues(next);
    latestValuesRef.current = resolved;
    lastEmittedKeyRef.current = resolved.join("|");
    commitPendingRef.current = true;
    onValueChange(resolved);
  };

  const emitCommit = (next: readonly number[]) => {
    if (!commitPendingRef.current) return;
    const resolved = variant === "discrete" ? snapValues(next) : next;
    commitPendingRef.current = false;
    latestValuesRef.current = resolved;
    lastEmittedKeyRef.current = resolved.join("|");
    if (variant === "discrete") setDiscreteValues(resolved);
    onValueCommit(resolved);
  };

  return (
    <BaseSlider.Root
      min={min}
      max={max}
      step={rootStep}
      largeStep={variant === "discrete" ? step : undefined}
      value={[...activeValues]}
      disabled={disabled}
      onValueChange={(next) => {
        const resolved = Array.isArray(next) ? next : [next];
        emitChange(resolved);
      }}
      onValueCommitted={(next) => {
        const resolved = Array.isArray(next) ? next : [next];
        emitCommit(resolved);
      }}
      className="min-w-0"
      data-toolcraft-slider=""
      data-variant={variant}
    >
      <BaseSlider.Control
        onPointerUp={() => emitCommit(latestValuesRef.current)}
        onPointerCancel={() => emitCommit(latestValuesRef.current)}
        className="group relative flex h-[18px] w-full touch-none items-center select-none data-[disabled]:opacity-20"
      >
        <BaseSlider.Track data-slot="slider-track" className="relative h-px grow rounded-full bg-white/15">
          {showFill ? (
            <BaseSlider.Indicator className="h-full rounded-full bg-accent transition-[width,left] duration-150 motion-reduce:transition-none" />
          ) : null}
          {resolvedMarkerCount > 0 ? Array.from({ length: resolvedMarkerCount }, (_, index) => (
            <span
              key={index}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 size-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/35"
              style={{ left: `${(index / (resolvedMarkerCount - 1)) * 100}%` }}
            />
          )) : null}
        </BaseSlider.Track>
        {activeValues.map((_, index) => (
          <BaseSlider.Thumb
            key={index}
            index={index}
            data-slot="slider-thumb"
            id={index === 0 ? id : id ? `${id}-${index + 1}` : undefined}
            aria-describedby={ariaDescribedBy}
            getAriaLabel={() => names[index] ?? names[0] ?? "Slider"}
            getAriaValueText={() => valueTexts?.[index] ?? String(values[index] ?? "")}
            onDoubleClick={() => onReset?.(index)}
            className="relative block size-[9px] shrink-0 cursor-pointer rounded-[2px] bg-accent shadow-[0_0_0_1px_rgb(255_255_255/0.18)] outline-none before:absolute before:left-1/2 before:top-1/2 before:size-[18px] before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] focus-visible:ring-2 focus-visible:ring-accent/45 data-[dragging]:transition-none disabled:pointer-events-none"
          />
        ))}
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}
