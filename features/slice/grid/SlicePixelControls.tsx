import React, { useEffect, useId, useState } from "react";
import { Grid3X3, Palette, RotateCcw } from "lucide-react";
import { SliderControl } from "../../../components/toolcraft";

import type { SliceGridController } from "./useSliceGridController";
import {
  GRID_PALETTE_PRESETS,
  palettePresetForColors,
} from "./palettePresets";

interface SlicePixelControlsProps {
  readonly controller: SliceGridController;
}

type PixelDraft = SliceGridController["pixel"];

const DEFAULT_PIXEL: PixelDraft = {
  enabled: false,
  size: 16,
  quantize: false,
  colors: 16,
};

const TARGET_SIZES = [8, 16, 32, 64, 128, 256] as const;

function samePixel(left: PixelDraft, right: PixelDraft): boolean {
  return left.enabled === right.enabled && left.size === right.size &&
    left.quantize === right.quantize && left.colors === right.colors &&
    JSON.stringify(left.palette) === JSON.stringify(right.palette);
}

export const SlicePixelControls: React.FC<SlicePixelControlsProps> = ({ controller }) => {
  const id = useId();
  const [draft, setDraft] = useState<PixelDraft>(controller.pixel);
  const [sizeDraft, setSizeDraft] = useState(String(controller.pixel.size));
  const disabled = controller.sourceDimensions === null;
  const canReset = !samePixel(draft, DEFAULT_PIXEL);
  const fixedPreset = palettePresetForColors(draft.palette);
  const paletteMode = draft.palette ? "fixed" : "auto";

  useEffect(() => {
    setDraft(controller.pixel);
    setSizeDraft(String(controller.pixel.size));
  }, [controller.pixel.colors, controller.pixel.enabled, controller.pixel.quantize, controller.pixel.palette, controller.pixel.size]);

  const commit = <K extends "enabled" | "size" | "quantize" | "colors">(
    key: K,
    value: PixelDraft[K],
  ): void => {
    const setter = {
      enabled: controller.setPixelEnabled,
      size: controller.setPixelSize,
      quantize: controller.setPixelQuantize,
      colors: controller.setPixelColors,
    }[key] as (nextValue: PixelDraft[K]) => boolean;
    if (setter(value)) {
      setDraft((current) => ({ ...current, [key]: value }));
      if (key === "size") setSizeDraft(String(value));
    } else {
      setDraft(controller.pixel);
    }
  };

  const commitMode = (mode: "auto" | "fixed"): void => {
    const accepted = mode === "auto"
      ? controller.setPixelAutoPalette()
      : controller.setPixelFixedPalette(fixedPreset?.colors ?? GRID_PALETTE_PRESETS[0]!.colors);
    if (accepted) {
      setDraft(mode === "auto"
        ? { ...draft, quantize: true, palette: undefined }
        : { ...draft, quantize: false, palette: [...(fixedPreset?.colors ?? GRID_PALETTE_PRESETS[0]!.colors)] });
    } else {
      setDraft(controller.pixel);
    }
  };

  const selectPreset = (value: string): void => {
    if (value === "auto") {
      commitMode("auto");
      return;
    }
    const selected = GRID_PALETTE_PRESETS.find((entry) => entry.id === value);
    if (!selected) return;
    if (controller.setPixelFixedPalette(selected.colors)) {
      setDraft((current) => ({ ...current, quantize: false, palette: [...selected.colors] }));
    } else {
      setDraft(controller.pixel);
    }
  };

  const summary = !draft.enabled
    ? "Pixel stage off"
    : draft.palette
      ? `Fixed ${fixedPreset?.label ?? "custom"} · ${draft.palette.length} colors · ${draft.size}px`
      : draft.quantize
        ? `Auto · ≤${draft.colors} colors · ${draft.size}px`
        : `Resize ${draft.size}px · no quantize`;

  return (
    <fieldset
      className="space-y-3 border-t border-white/6 pt-3"
      disabled={disabled}
      data-slice-pixel-controls=""
      data-pixel-enabled={draft.enabled ? "true" : "false"}
      data-pixel-size={draft.size}
      data-pixel-colors={draft.colors}
      data-pixel-mode={paletteMode}
    >
      <legend className="sr-only">Pixel processing</legend>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Grid3X3 size={13} className="shrink-0 text-textMuted" aria-hidden="true" />
          <h3 className="studio-section-label">Pixel</h3>
        </div>
        <button
          type="button"
          disabled={disabled || !canReset}
          aria-label="Reset pixel settings"
          onClick={() => {
            if (controller.resetPixel()) setDraft(DEFAULT_PIXEL);
          }}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 text-[9px] font-semibold text-textMuted transition-colors hover:bg-white/10 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-35"
        >
          <RotateCcw size={11} aria-hidden="true" /> Reset
        </button>
      </div>

      <label className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/20 px-3 py-2.5 text-[10px] font-bold text-textMuted">
        <span>Enable pixel stage</span>
        <input
          type="checkbox"
          aria-label="Enable pixel stage"
          checked={draft.enabled}
          onChange={(event) => commit("enabled", event.currentTarget.checked)}
          className="size-4 accent-accent"
        />
      </label>

      <label className="block space-y-2 text-[10px] font-bold text-textMuted" htmlFor={`${id}-size`}>
        <span className="flex items-center justify-between gap-3">
          <span>Target size</span>
          <span className="font-mono text-textMain" aria-hidden="true">{draft.size}px</span>
        </span>
        <select
          id={`${id}-size`}
          aria-label="Pixel target size"
          value={String(draft.size)}
          onChange={(event) => commit("size", Number(event.currentTarget.value))}
          className="w-full rounded-lg border border-white/10 bg-input px-3 py-2 font-mono text-xs text-textMain outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {TARGET_SIZES.map((size) => <option key={size} value={size}>{size}px</option>)}
          {!TARGET_SIZES.includes(draft.size as (typeof TARGET_SIZES)[number]) && (
            <option value={draft.size}>{draft.size}px custom</option>
          )}
        </select>
        <input
          type="number"
          min={1}
          max={4096}
          step={1}
          inputMode="numeric"
          aria-label="Custom pixel target size"
          title="Custom size 1–4096"
          value={sizeDraft}
          onChange={(event) => setSizeDraft(event.currentTarget.value)}
          onBlur={() => {
            const value = Number(sizeDraft);
            if (!Number.isSafeInteger(value) || value < 1 || value > 4096 || !controller.setPixelSize(value)) {
              setSizeDraft(String(controller.pixel.size));
              return;
            }
            setDraft((current) => ({ ...current, size: value }));
          }}
          className="w-full rounded-lg border border-white/10 bg-input px-3 py-2 font-mono text-xs text-textMain outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
        />
      </label>

      <div className="space-y-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-textMuted">Palette mode</span>
        <div role="radiogroup" aria-label="Pixel palette mode" className="grid grid-cols-2 gap-2 rounded-xl border border-white/5 bg-black/20 p-1.5">
          {(["auto", "fixed"] as const).map((mode) => (
            <label
              key={mode}
              className={`cursor-pointer rounded-lg px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wider transition-colors focus-within:ring-2 focus-within:ring-accent ${
                paletteMode === mode ? "bg-accent text-white shadow-glow-sm" : "text-textMuted hover:bg-white/5 hover:text-textMain"
              }`}
            >
              <input
                type="radio"
                name={`${id}-mode`}
                value={mode}
                checked={paletteMode === mode}
                onChange={() => commitMode(mode)}
                className="sr-only"
              />
              {mode === "auto" ? "Auto palette" : "Fixed palette"}
            </label>
          ))}
        </div>
      </div>

      {paletteMode === "fixed" ? (
        <label className="block space-y-2 text-[10px] font-bold text-textMuted" htmlFor={`${id}-preset`}>
          <span className="flex items-center gap-2"><Palette size={12} aria-hidden="true" /> Fixed palette preset</span>
          <select
            id={`${id}-preset`}
            aria-label="Fixed palette preset"
            value={fixedPreset?.id ?? ""}
            onChange={(event) => selectPreset(event.currentTarget.value)}
            className="w-full rounded-lg border border-white/10 bg-input px-3 py-2 text-xs text-textMain outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {fixedPreset === null && <option value="">Custom palette</option>}
            {GRID_PALETTE_PRESETS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
          <span className="flex flex-wrap gap-1.5" aria-label="Active palette colors">
            {draft.palette?.map((color) => (
              <span key={color} className="size-5 rounded border border-white/20" title={color} style={{ backgroundColor: color }} />
            ))}
          </span>
        </label>
      ) : (
        <label className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/20 px-3 py-2.5 text-[10px] font-bold text-textMuted">
          <span>Quantize to auto palette</span>
          <input
            type="checkbox"
            aria-label="Quantize to auto palette"
            checked={draft.quantize}
            onChange={(event) => commit("quantize", event.currentTarget.checked)}
            className="size-4 accent-accent"
          />
        </label>
      )}

      {paletteMode === "auto" && draft.quantize && (
        <SliderControl
          id={`${id}-colors`}
          name="Palette color count"
          min={2}
          max={256}
          step={1}
          value={draft.colors}
          valueLabel={`${draft.colors} colors`}
          disabled={disabled}
          variant="discrete"
          markerCount={9}
          onValueChange={(colors) => setDraft((current) => ({ ...current, colors }))}
          onValueCommit={(colors) => commit("colors", colors)}
        />
      )}

      <div id={`${id}-summary`} aria-label="Pixel processing summary" aria-live="polite" aria-atomic="true" className="rounded-md border border-white/6 bg-black/20 px-2.5 py-2 font-mono text-[10px] text-textMuted">
        {disabled ? "No source" : summary}
      </div>
    </fieldset>
  );
};

export default SlicePixelControls;
