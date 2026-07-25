import { useEffect, useId, useState } from "react";
import type { ControlOption } from "./controlTypes";

export type SegmentedControlOption = ControlOption & {
  readonly indicatorColor?: string;
};

export interface SegmentedControlProps {
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly name: string;
  readonly onValueChange?: (value: string) => void;
  readonly options: readonly SegmentedControlOption[];
  readonly value?: string;
  readonly variant?: "default" | "dots";
}

function firstEnabledValue(options: readonly SegmentedControlOption[]): string {
  return options.find((option) => !option.disabled)?.value ?? "";
}

function resolveValue(
  value: string | undefined,
  options: readonly SegmentedControlOption[],
): string {
  if (value !== undefined && options.some((option) => option.value === value && !option.disabled)) {
    return value;
  }
  return firstEnabledValue(options);
}

export function SegmentedControl({
  ariaLabel,
  className = "",
  disabled = false,
  name,
  onValueChange,
  options,
  value,
  variant = "default",
}: SegmentedControlProps) {
  const id = useId();
  const [internalValue, setInternalValue] = useState(() => resolveValue(value, options));
  const selectedValue = value === undefined
    ? resolveValue(internalValue, options)
    : resolveValue(value, options);

  useEffect(() => {
    if (value !== undefined) {
      setInternalValue(resolveValue(value, options));
      return;
    }
    setInternalValue((current) => resolveValue(current, options));
  }, [options, value]);

  return (
    <fieldset
      className={`min-w-0 ${className}`}
      data-disabled={disabled ? "true" : undefined}
      disabled={disabled}
    >
      <legend className="mb-2 text-[10px] font-bold uppercase tracking-wider text-textMuted">
        {name}
      </legend>
      <div
        role="radiogroup"
        aria-label={ariaLabel ?? name}
        className="grid min-w-0 grid-flow-col auto-cols-fr overflow-hidden rounded-lg border border-white/10 bg-black/20 p-0.5"
      >
        {options.map((option, index) => {
          const optionId = `${id}-${index}`;
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className="relative flex min-h-8 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 text-[10px] font-semibold text-textMuted transition-colors has-[:checked]:bg-accent/20 has-[:checked]:text-textMain has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40 hover:bg-white/5 focus-within:ring-2 focus-within:ring-accent"
            >
              <input
                id={optionId}
                type="radio"
                name={`${id}-${name}`}
                value={option.value}
                checked={selectedValue === option.value}
                disabled={disabled || option.disabled}
                className="sr-only"
                onChange={() => {
                  if (disabled || option.disabled) return;
                  setInternalValue(option.value);
                  onValueChange?.(option.value);
                }}
              />
              {variant === "dots" ? (
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: option.indicatorColor ?? "currentColor" }}
                />
              ) : null}
              <span className="truncate">{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
