import React, { useEffect, useId, useState } from "react";
import { Pipette, RotateCcw, Sparkles } from "lucide-react";

import type { SliceGridController } from "./useSliceGridController";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/u;

interface SliceChromaControlsProps {
  readonly controller: SliceGridController;
}

type ChromaDraft = SliceGridController["chroma"];

function sameChroma(left: ChromaDraft, right: ChromaDraft): boolean {
  return left.enabled === right.enabled && left.color === right.color &&
    left.tolerance === right.tolerance && left.smoothness === right.smoothness &&
    left.spill === right.spill;
}

export const SliceChromaControls: React.FC<SliceChromaControlsProps> = ({ controller }) => {
  const id = useId();
  const [draft, setDraft] = useState<ChromaDraft>(controller.chroma);
  const [colorError, setColorError] = useState<string | null>(null);
  const disabled = controller.sourceDimensions === null;
  const canReset = !sameChroma(draft, {
    enabled: false,
    color: "#00ff00",
    tolerance: 0,
    smoothness: 0,
    spill: 0,
  });

  useEffect(() => {
    setDraft(controller.chroma);
    setColorError(null);
  }, [
    controller.chroma.color,
    controller.chroma.enabled,
    controller.chroma.smoothness,
    controller.chroma.spill,
    controller.chroma.tolerance,
  ]);

  const commit = <K extends keyof ChromaDraft>(key: K, value: ChromaDraft[K]): void => {
    const next = { ...draft, [key]: value } as ChromaDraft;
    const setter = {
      enabled: controller.setChromaEnabled,
      color: controller.setChromaColor,
      tolerance: controller.setChromaTolerance,
      smoothness: controller.setChromaSmoothness,
      spill: controller.setChromaSpill,
    }[key] as (nextValue: ChromaDraft[K]) => boolean;
    if (setter(value)) {
      setDraft(next);
      return;
    }
    setDraft(controller.chroma);
  };

  const commitColor = (value: string): void => {
    if (!HEX_COLOR.test(value)) {
      setColorError("Use a six-digit hex color, for example #00ff00.");
      setDraft((current) => ({ ...current, color: value }));
      return;
    }
    setColorError(null);
    commit("color", value.toLowerCase());
  };

  const updateSlider = (key: "tolerance" | "smoothness" | "spill", value: number): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const commitSlider = (key: "tolerance" | "smoothness" | "spill", value: number): void => {
    commit(key, value);
  };

  const summary = draft.enabled
    ? `Chroma key on: ${draft.color}, tolerance ${draft.tolerance}%, smoothness ${draft.smoothness}%, spill ${draft.spill}%.`
    : "Chroma key off. Source pixels remain unchanged by this stage.";

  return (
    <fieldset
      className="space-y-4 border-t border-white/5 pt-4"
      disabled={disabled}
      data-slice-chroma-controls=""
      data-chroma-enabled={draft.enabled ? "true" : "false"}
      data-chroma-color={draft.color}
      data-chroma-tolerance={draft.tolerance}
      data-chroma-smoothness={draft.smoothness}
      data-chroma-spill={draft.spill}
    >
      <legend className="sr-only">Chroma key</legend>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-textMuted">
              Chroma key
            </h3>
            <p className="mt-1 text-[9px] leading-relaxed text-textMuted/70">
              Remove a keyed background before crop and pixel processing.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={disabled || !canReset}
          aria-label="Reset chroma settings"
          onClick={() => {
            if (controller.resetChroma()) setDraft({
              enabled: false,
              color: "#00ff00",
              tolerance: 0,
              smoothness: 0,
              spill: 0,
            });
          }}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-[9px] font-bold text-textMuted transition-colors hover:bg-white/10 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-35"
        >
          <RotateCcw size={11} aria-hidden="true" /> Reset
        </button>
      </div>

      <label className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/20 px-3 py-2.5 text-[10px] font-bold text-textMuted">
        <span>Enable chroma removal</span>
        <input
          type="checkbox"
          aria-label="Enable chroma removal"
          checked={draft.enabled}
          onChange={(event) => commit("enabled", event.currentTarget.checked)}
          className="size-4 accent-accent"
        />
      </label>

      <div className="grid grid-cols-[3rem_1fr] items-center gap-2">
        <label
          htmlFor={`${id}-color-picker`}
          className="relative h-10 overflow-hidden rounded-lg border border-white/10 shadow-sm"
          title="Choose chroma key color"
        >
          <input
            id={`${id}-color-picker`}
            type="color"
            aria-label="Chroma key color swatch"
            value={HEX_COLOR.test(draft.color) ? draft.color : "#00ff00"}
            onChange={(event) => commitColor(event.currentTarget.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
          <span className="absolute inset-0 pointer-events-none" style={{ backgroundColor: HEX_COLOR.test(draft.color) ? draft.color : "#00ff00" }} />
        </label>
        <label className="space-y-1 text-[10px] font-bold text-textMuted" htmlFor={`${id}-color-text`}>
          <span>Key color</span>
          <span className="relative flex items-center">
            <Pipette size={12} className="pointer-events-none absolute left-2 text-textMuted/60" aria-hidden="true" />
            <input
              id={`${id}-color-text`}
              type="text"
              inputMode="text"
              spellCheck={false}
              value={draft.color}
              aria-label="Chroma key hex color"
              aria-invalid={colorError ? "true" : undefined}
              aria-describedby={colorError ? `${id}-color-error` : `${id}-summary`}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setColorError(null);
                setDraft((current) => ({ ...current, color: value }));
              }}
              onBlur={(event) => commitColor(event.currentTarget.value)}
              className="w-full rounded-md border border-white/10 bg-input py-2 pl-7 pr-2 font-mono text-xs uppercase text-textMain outline-none transition-colors focus:border-accent aria-[invalid=true]:border-red-400"
            />
          </span>
          {colorError && <span id={`${id}-color-error`} className="block font-normal text-red-300">{colorError}</span>}
        </label>
      </div>

      {([
        ["tolerance", "Tolerance", draft.tolerance],
        ["smoothness", "Smoothness", draft.smoothness],
        ["spill", "Spill suppression", draft.spill],
      ] as const).map(([key, label, value]) => (
        <label key={key} className="block space-y-2 text-[10px] font-bold text-textMuted" htmlFor={`${id}-${key}`}>
          <span className="flex items-center justify-between gap-3">
            <span>{label}</span>
            <span className="font-mono text-textMain" aria-hidden="true">{value}%</span>
          </span>
          <input
            id={`${id}-${key}`}
            type="range"
            min={0}
            max={100}
            step={1}
            value={value}
            aria-label={label}
            aria-valuetext={`${value}%`}
            aria-describedby={`${id}-summary`}
            onChange={(event) => updateSlider(key, event.currentTarget.valueAsNumber)}
            onPointerUp={(event) => commitSlider(key, event.currentTarget.valueAsNumber)}
            onPointerCancel={(event) => commitSlider(key, event.currentTarget.valueAsNumber)}
            onKeyUp={(event) => commitSlider(key, event.currentTarget.valueAsNumber)}
            onBlur={(event) => commitSlider(key, event.currentTarget.valueAsNumber)}
            className="w-full accent-accent disabled:cursor-not-allowed disabled:opacity-45"
          />
        </label>
      ))}

      <div
        id={`${id}-summary`}
        aria-label="Chroma preview summary"
        aria-live="polite"
        aria-atomic="true"
        className="rounded-xl border border-white/5 bg-black/20 p-3 text-[10px] leading-relaxed text-textMuted"
      >
        {disabled ? "Chroma settings are available when the source grid is ready." : summary}
      </div>
    </fieldset>
  );
};

export default SliceChromaControls;
