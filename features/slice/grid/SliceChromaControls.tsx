import React, { useEffect, useId, useState } from "react";
import { Pipette, RotateCcw, Sparkles } from "lucide-react";
import { ColorControl, SliderControl } from "../../../components/toolcraft";

import type { SliceGridController } from "./useSliceGridController";

interface SliceChromaControlsProps {
  readonly controller: SliceGridController;
  readonly eyedropperActive?: boolean;
  readonly onEyedropperActiveChange?: (active: boolean) => void;
}

type ChromaDraft = SliceGridController["chroma"];

function sameChroma(left: ChromaDraft, right: ChromaDraft): boolean {
  return left.enabled === right.enabled && left.color === right.color &&
    left.tolerance === right.tolerance && left.smoothness === right.smoothness &&
    left.spill === right.spill;
}

export const SliceChromaControls: React.FC<SliceChromaControlsProps> = ({
  controller,
  eyedropperActive = false,
  onEyedropperActiveChange,
}) => {
  const id = useId();
  const [draft, setDraft] = useState<ChromaDraft>(controller.chroma);
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
    commit("color", value.toLowerCase());
  };

  const updateSlider = (key: "tolerance" | "smoothness" | "spill", value: number): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const commitSlider = (key: "tolerance" | "smoothness" | "spill", value: number): void => {
    commit(key, value);
  };

  const summary = draft.enabled
    ? `On · ${draft.color} · tolerance ${draft.tolerance}% · smooth ${draft.smoothness}% · spill ${draft.spill}%`
    : "Chroma key off";

  return (
    <fieldset
      className="space-y-3 border-t border-white/6 pt-3"
      disabled={disabled}
      data-slice-chroma-controls=""
      data-chroma-enabled={draft.enabled ? "true" : "false"}
      data-chroma-color={draft.color}
      data-chroma-tolerance={draft.tolerance}
      data-chroma-smoothness={draft.smoothness}
      data-chroma-spill={draft.spill}
    >
      <legend className="sr-only">Chroma key</legend>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles size={13} className="shrink-0 text-textMuted" aria-hidden="true" />
          <h3 className="studio-section-label">Chroma key</h3>
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
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 text-[9px] font-semibold text-textMuted transition-colors hover:bg-white/10 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-35"
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

      <ColorControl
        allowShortHex={false}
        name="Chroma key color"
        hex={draft.color}
        disabled={disabled}
        invalidMessage="Use a six-digit hex color, for example #00FF00."
        onValueChange={({ hex }) => {
          setDraft((current) => ({ ...current, color: hex.toLowerCase() }));
        }}
        onValueCommit={({ hex }) => commitColor(hex)}
      />

      <button
        type="button"
        disabled={disabled || !onEyedropperActiveChange}
        aria-label={eyedropperActive ? "Cancel canvas color picker" : "Pick color from canvas"}
        aria-pressed={eyedropperActive}
        onClick={() => onEyedropperActiveChange?.(!eyedropperActive)}
        className={`inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-md border text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40 ${eyedropperActive ? "border-accent bg-accent text-white" : "border-white/10 bg-white/5 text-textMuted hover:bg-white/10 hover:text-textMain"}`}
      >
        <Pipette size={13} aria-hidden="true" /> {eyedropperActive ? "Cancel picker" : "Pick from canvas"}
      </button>
      {eyedropperActive ? (
        <p role="status" className="text-[10px] leading-4 text-accent" data-eyedropper-status="active">
          Click a source pixel to sample its color. Press Escape to cancel.
        </p>
      ) : null}

      {([
        ["tolerance", "Tolerance", draft.tolerance],
        ["smoothness", "Smoothness", draft.smoothness],
        ["spill", "Spill suppression", draft.spill],
      ] as const).map(([key, label, value]) => (
        <SliderControl
          key={key}
          id={`${id}-${key}`}
          ariaDescribedBy={`${id}-summary`}
          name={label}
          min={0}
          max={100}
          step={1}
          unit="%"
          baseValue={0}
          value={value}
          disabled={disabled}
          onValueChange={(next) => updateSlider(key, next)}
          onValueCommit={(next) => commitSlider(key, next)}
        />
      ))}

      <div
        id={`${id}-summary`}
        aria-label="Chroma preview summary"
        aria-live="polite"
        aria-atomic="true"
        className="rounded-md border border-white/6 bg-black/20 px-2.5 py-2 font-mono text-[10px] text-textMuted"
      >
        {disabled ? "No source" : summary}
      </div>
    </fieldset>
  );
};

export default SliceChromaControls;
