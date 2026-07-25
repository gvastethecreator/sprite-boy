import { useEffect, useRef, useState } from "react";
import {
  createControlHistoryGroupId,
  type ControlChangeMeta,
  type ControlValueChangeHandler,
} from "./controlTypes";

export interface ColorControlValue {
  readonly hex: string;
}

export interface ColorControlProps {
  readonly className?: string;
  readonly disabled?: boolean;
  readonly hex?: string;
  readonly name: string;
  readonly onValueChange?: ControlValueChangeHandler<ColorControlValue>;
  readonly onValueCommit?: (value: ColorControlValue) => void;
  readonly showLabel?: boolean;
}

export function normalizeHexColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(hex)) {
    return `#${hex.split("").map((channel) => channel.repeat(2)).join("")}`.toUpperCase();
  }
  return /^[\da-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}

export function ColorControl({
  className = "",
  disabled = false,
  hex = "#000000",
  name,
  onValueChange,
  onValueCommit,
  showLabel = true,
}: ColorControlProps) {
  const controlledColor = normalizeHexColor(hex) ?? "#000000";
  const [draft, setDraft] = useState(controlledColor);
  const [preview, setPreview] = useState(controlledColor);
  const historyGroupRef = useRef<string | null>(null);
  const latestValidRef = useRef(controlledColor);

  useEffect(() => {
    setDraft(controlledColor);
    setPreview(controlledColor);
    latestValidRef.current = controlledColor;
    historyGroupRef.current = null;
  }, [controlledColor]);

  function liveMeta(): ControlChangeMeta {
    historyGroupRef.current ??= createControlHistoryGroupId(`color:${name}`);
    return { history: "merge", historyGroup: historyGroupRef.current };
  }

  function emitLive(color: string, updateDraft = true): void {
    if (disabled) return;
    if (updateDraft) setDraft(color);
    setPreview(color);
    latestValidRef.current = color;
    onValueChange?.({ hex: color }, liveMeta());
  }

  function finish(): void {
    if (disabled || historyGroupRef.current === null) return;
    historyGroupRef.current = null;
    onValueCommit?.({ hex: latestValidRef.current });
  }

  function restoreControlled(): void {
    setDraft(controlledColor);
    setPreview(controlledColor);
    latestValidRef.current = controlledColor;
    historyGroupRef.current = null;
  }

  function commitDraft(nextDraft = draft): void {
    const color = normalizeHexColor(nextDraft);
    if (!color) {
      restoreControlled();
      return;
    }
    if (color !== latestValidRef.current) emitLive(color);
    else setDraft(color);
    finish();
  }

  const draftValid = normalizeHexColor(draft);

  return (
    <div className={`min-w-0 space-y-2 ${className}`} data-disabled={disabled ? "true" : undefined}>
      {showLabel ? (
        <span className="block text-[10px] font-bold uppercase tracking-wider text-textMuted">
          {name}
        </span>
      ) : null}
      <div className="grid min-w-0 grid-cols-[2.75rem_1fr] overflow-hidden rounded-lg border border-white/10 bg-input focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40">
        <label className="relative min-h-9 cursor-pointer border-r border-white/10" title={`Choose ${name}`}>
          <span aria-hidden="true" className="absolute inset-1 rounded" style={{ backgroundColor: preview }} />
          <input
            type="color"
            aria-label={`${name} swatch`}
            name={`${name}-swatch`}
            value={preview}
            disabled={disabled}
            className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            onChange={(event) => {
              const color = normalizeHexColor(event.currentTarget.value);
              if (color) emitLive(color);
            }}
            onBlur={finish}
          />
        </label>
        <input
          type="text"
          aria-label={`${name} hex`}
          aria-invalid={draftValid === null ? "true" : undefined}
          name={`${name}-hex`}
          value={draft}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 bg-transparent px-2.5 font-mono text-xs uppercase text-textMain outline-none disabled:cursor-not-allowed disabled:opacity-45"
          onChange={(event) => {
            if (disabled) return;
            const nextDraft = event.currentTarget.value.toUpperCase();
            setDraft(nextDraft);
            const color = normalizeHexColor(nextDraft);
            const bareHex = nextDraft.trim().replace(/^#/, "");
            if (color && bareHex.length === 6) emitLive(color, false);
          }}
          onBlur={() => commitDraft()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft(event.currentTarget.value);
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              restoreControlled();
              event.currentTarget.blur();
            }
          }}
        />
      </div>
    </div>
  );
}
