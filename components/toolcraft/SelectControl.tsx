import { useId } from "react";
import type { ControlOption } from "./controlTypes";

export interface SelectControlProps {
  readonly className?: string;
  readonly disabled?: boolean;
  readonly name: string;
  readonly onValueChange?: (value: string) => void;
  readonly options: readonly ControlOption[];
  readonly showLabel?: boolean;
  readonly value: string;
}

function resolveSelectValue(value: string, options: readonly ControlOption[]): string {
  if (options.some((option) => option.value === value && !option.disabled)) {
    return value;
  }
  return options.find((option) => !option.disabled)?.value ?? "";
}

export function SelectControl({
  className = "",
  disabled = false,
  name,
  onValueChange,
  options,
  showLabel = true,
  value,
}: SelectControlProps) {
  const id = useId();
  const selectedValue = resolveSelectValue(value, options);

  return (
    <div className={`min-w-0 space-y-2 ${className}`} data-disabled={disabled ? "true" : undefined}>
      {showLabel ? (
        <label htmlFor={id} className="block text-[10px] font-bold uppercase tracking-wider text-textMuted">
          {name}
        </label>
      ) : null}
      <select
        id={id}
        aria-label={showLabel ? undefined : name}
        disabled={disabled}
        value={selectedValue}
        className="min-h-9 w-full rounded-lg border border-white/10 bg-input px-2.5 text-xs text-textMain outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
        onChange={(event) => {
          if (!disabled) onValueChange?.(event.currentTarget.value);
        }}
      >
        {options.length === 0 ? <option value="" disabled>No options</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
