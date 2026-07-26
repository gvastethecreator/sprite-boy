import { useEffect, useId, useRef, useState } from "react";
import {
  createControlHistoryGroupId,
  type ControlChangeMeta,
  type ControlValueChangeHandler,
} from "./controlTypes";
import { ColorPickerPopover } from "./ColorPickerPopover";

export interface ColorControlValue {
  readonly hex: string;
}

export interface ColorControlProps {
  readonly allowShortHex?: boolean;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly hex?: string;
  readonly invalidMessage?: string;
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
  allowShortHex = true,
  className = "",
  disabled = false,
  hex = "#000000",
  invalidMessage = "Use a six-digit hex color, for example #00FF00.",
  name,
  onValueChange,
  onValueCommit,
  showLabel = true,
}: ColorControlProps) {
  const errorId = useId();
  const normalizeInput = (value: string): string | null => {
    if (!allowShortHex && !/^#[\da-f]{6}$/iu.test(value.trim())) return null;
    return normalizeHexColor(value);
  };
  const controlledColor = normalizeHexColor(hex) ?? "#000000";
  const [draft, setDraft] = useState(controlledColor);
  const [preview, setPreview] = useState(controlledColor);
  const [error, setError] = useState<string | null>(null);
  const historyGroupRef = useRef<string | null>(null);
  const interactionStartRef = useRef(controlledColor);
  const latestValidRef = useRef(controlledColor);

  useEffect(() => {
    const ownLiveUpdate = controlledColor === latestValidRef.current;
    setDraft(controlledColor);
    setPreview(controlledColor);
    if (!ownLiveUpdate) {
      historyGroupRef.current = null;
      interactionStartRef.current = controlledColor;
    }
    latestValidRef.current = controlledColor;
    setError(null);
  }, [controlledColor]);

  function liveMeta(): ControlChangeMeta {
    if (historyGroupRef.current === null) {
      interactionStartRef.current = controlledColor;
      historyGroupRef.current = createControlHistoryGroupId(`color:${name}`);
    }
    return { history: "merge", historyGroup: historyGroupRef.current };
  }

  function emitLive(color: string, updateDraft = true): void {
    if (disabled) return;
    if (updateDraft) setDraft(color);
    setPreview(color);
    latestValidRef.current = color;
    setError(null);
    onValueChange?.({ hex: color }, liveMeta());
  }

  function finish(): void {
    if (disabled || historyGroupRef.current === null) return;
    historyGroupRef.current = null;
    interactionStartRef.current = latestValidRef.current;
    setError(null);
    onValueCommit?.({ hex: latestValidRef.current });
  }

  function cancelInteraction(): void {
    const historyGroup = historyGroupRef.current;
    const start = historyGroup === null ? controlledColor : interactionStartRef.current;
    setDraft(start);
    setPreview(start);
    if (historyGroup !== null && latestValidRef.current !== start) {
      onValueChange?.({ hex: start }, { history: "merge", historyGroup });
    }
    latestValidRef.current = start;
    historyGroupRef.current = null;
    setError(null);
  }

  function commitDraft(nextDraft = draft): void {
    const color = normalizeInput(nextDraft);
    if (!color) {
      cancelInteraction();
      setError(invalidMessage);
      return;
    }
    if (color !== latestValidRef.current) emitLive(color);
    else setDraft(color);
    finish();
  }

  const draftValid = normalizeInput(draft);

  return (
    <div
      className={`min-w-0 space-y-2 ${className}`}
      data-disabled={disabled ? "true" : undefined}
      data-toolcraft-control="color"
    >
      {showLabel ? (
        <span className="block text-[10px] font-bold uppercase tracking-wider text-textMuted">
          {name}
        </span>
      ) : null}
      <div className="grid min-w-0 grid-cols-[2.75rem_1fr] overflow-hidden rounded-lg border border-white/10 bg-input focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40">
        <ColorPickerPopover
          color={preview}
          disabled={disabled}
          name={name}
          onCancel={cancelInteraction}
          onColorChange={(color) => emitLive(color)}
          onCommit={finish}
        />
        <input
          type="text"
          aria-label={`${name} hex`}
          aria-invalid={draftValid === null ? "true" : undefined}
          aria-describedby={error ? errorId : undefined}
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
            setError(null);
            const color = normalizeInput(nextDraft);
            const bareHex = nextDraft.trim().replace(/^#/, "");
            if (color && bareHex.length === 6) emitLive(color, false);
          }}
          onBlur={(event) => commitDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft(event.currentTarget.value);
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelInteraction();
              event.currentTarget.blur();
            }
          }}
        />
      </div>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-[10px] leading-4 text-red-300"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
