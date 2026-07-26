import { Popover as BasePopover } from "@base-ui/react/popover";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clampColorChannel, hexToHsv, hexToRgb, hsvToHex, rgbToHex, type HsvColor } from "./colorValue";
import { ToolcraftSliderPrimitive } from "./SliderPrimitive";

interface ColorPickerPopoverProps {
  readonly color: string;
  readonly disabled?: boolean;
  readonly name: string;
  readonly onCancel: () => void;
  readonly onColorChange: (color: string) => void;
  readonly onCommit: () => void;
}

type ColorFormat = "hex" | "rgb" | "hsb";

function sameHsv(left: HsvColor, right: HsvColor): boolean {
  return left.h === right.h && left.s === right.s && left.v === right.v;
}

export function ColorPickerPopover({
  color,
  disabled = false,
  name,
  onCancel,
  onColorChange,
  onCommit,
}: ColorPickerPopoverProps) {
  const instructionsId = useId();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ColorFormat>("hex");
  const [draft, setDraft] = useState<HsvColor>(() => hexToHsv(color));
  const [hexDraft, setHexDraft] = useState(color);

  useEffect(() => {
    if (draggingRef.current) return;
    const next = hexToHsv(color);
    setDraft((current) => sameHsv(current, next) ? current : next);
    setHexDraft(color);
  }, [color]);

  const update = (next: HsvColor, commit = false) => {
    setDraft(next);
    const nextHex = hsvToHex(next);
    setHexDraft(nextHex);
    onColorChange(nextHex);
    if (commit) onCommit();
  };

  const updateSurface = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
    update({
      h: draft.h,
      s: clampColorChannel((event.clientX - bounds.left) / bounds.width, 0, 1),
      v: 1 - clampColorChannel((event.clientY - bounds.top) / bounds.height, 0, 1),
    }, commit);
  };

  const handleSurfaceKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    let next: HsvColor | null = null;
    if (event.key === "ArrowLeft") next = { ...draft, s: clampColorChannel(draft.s - step, 0, 1) };
    else if (event.key === "ArrowRight") next = { ...draft, s: clampColorChannel(draft.s + step, 0, 1) };
    else if (event.key === "ArrowDown") next = { ...draft, v: clampColorChannel(draft.v - step, 0, 1) };
    else if (event.key === "ArrowUp") next = { ...draft, v: clampColorChannel(draft.v + step, 0, 1) };
    else if (event.key === "Home") next = { ...draft, s: 0 };
    else if (event.key === "End") next = { ...draft, s: 1 };
    if (!next) return;
    event.preventDefault();
    update(next, true);
  };

  const rgb = hexToRgb(color);
  const hsb = [Math.round(draft.h), Math.round(draft.s * 100), Math.round(draft.v * 100)] as const;
  const channels = format === "rgb" ? rgb : hsb;
  const channelMax = format === "rgb" ? [255, 255, 255] : [360, 100, 100];

  return (
    <BasePopover.Root
      open={open}
      onOpenChange={(nextOpen, eventDetails) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          if (eventDetails.reason === "escape-key") onCancel();
          else onCommit();
        }
      }}
    >
      <BasePopover.Trigger
        type="button"
        disabled={disabled}
        aria-label={`${name} swatch`}
        className="group relative min-h-9 cursor-pointer border-r border-white/10 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:cursor-not-allowed"
      >
        <span
          aria-hidden="true"
          data-color={color}
          className="absolute inset-1 rounded border border-white/10"
          style={{ backgroundColor: color }}
        />
      </BasePopover.Trigger>
      <BasePopover.Portal>
        <BasePopover.Positioner side="bottom" align="start" sideOffset={6} className="z-[80]">
          <BasePopover.Popup
            aria-label={`${name} color picker`}
            data-toolcraft-color-picker={name}
            className="w-[236px] overflow-hidden rounded-lg border border-white/15 bg-panel text-textMain shadow-2xl outline-none"
          >
            <div
              ref={surfaceRef}
              role="group"
              tabIndex={disabled ? -1 : 0}
              aria-label={`${name} saturation and brightness`}
              aria-describedby={instructionsId}
              className="relative aspect-square w-full touch-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              style={{ backgroundColor: hsvToHex({ h: draft.h, s: 1, v: 1 }) }}
              onKeyDown={handleSurfaceKey}
              onPointerDown={(event) => {
                if (disabled) return;
                draggingRef.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                updateSurface(event, false);
              }}
              onPointerMove={(event) => {
                if (draggingRef.current) updateSurface(event, false);
              }}
              onPointerUp={(event) => {
                if (!draggingRef.current) return;
                draggingRef.current = false;
                updateSurface(event, true);
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => {
                draggingRef.current = false;
                onCancel();
              }}
            >
              <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-white to-transparent" />
              <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
                style={{ left: `${draft.s * 100}%`, top: `${(1 - draft.v) * 100}%`, backgroundColor: color }}
              />
            </div>
            <p id={instructionsId} className="sr-only">
              Arrow keys change saturation and brightness. Hold Shift for larger steps.
            </p>

            <div className="space-y-2 border-t border-white/8 px-3 py-2.5">
              <span className="text-[10px] font-semibold text-textMuted">Hue</span>
              <div className="rounded-full bg-[linear-gradient(to_right,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)] px-0">
                <ToolcraftSliderPrimitive
                  min={0}
                  max={360}
                  step={1}
                  names={[`${name} hue`]}
                  values={[Math.round(draft.h)]}
                  valueTexts={[`${Math.round(draft.h)}°`]}
                  showFill={false}
                  onValueChange={(values) => update({ ...draft, h: values[0] ?? draft.h })}
                  onValueCommit={() => onCommit()}
                />
              </div>
            </div>

            <div className="flex items-center gap-1.5 border-t border-white/8 px-2 py-3">
              <select
                aria-label={`${name} color format`}
                value={format}
                onChange={(event) => setFormat(event.currentTarget.value as ColorFormat)}
                className="h-7 rounded border border-white/10 bg-input px-1.5 text-[10px] text-textMain outline-none focus:border-accent"
              >
                <option value="hex">Hex</option>
                <option value="rgb">RGB</option>
                <option value="hsb">HSB</option>
              </select>
              {format === "hex" ? (
                <input
                  type="text"
                  aria-label={`${name} picker hex`}
                  value={hexDraft}
                  onChange={(event) => setHexDraft(event.currentTarget.value.toUpperCase())}
                  onBlur={() => {
                    const valid = /^#[\da-f]{6}$/iu.test(hexDraft) ? hexDraft.toUpperCase() : color;
                    setHexDraft(valid);
                    if (valid !== color) {
                      setDraft(hexToHsv(valid));
                      onColorChange(valid);
                    }
                    onCommit();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    else if (event.key === "Escape") {
                      setHexDraft(color);
                      event.currentTarget.blur();
                    }
                  }}
                  className="h-7 min-w-0 flex-1 rounded border border-white/10 bg-input px-2 font-mono text-xs text-textMain outline-none focus:border-accent"
                />
              ) : channels.map((value, index) => (
                <input
                  key={index}
                  type="number"
                  aria-label={`${name} ${format.toUpperCase()} channel ${index + 1}`}
                  min={0}
                  max={channelMax[index]}
                  value={value}
                  onChange={(event) => {
                    const next = [...channels] as [number, number, number];
                    next[index] = clampColorChannel(Number(event.currentTarget.value), 0, channelMax[index]!);
                    const nextHex = format === "rgb"
                      ? rgbToHex(next[0], next[1], next[2])
                      : hsvToHex({ h: next[0], s: next[1] / 100, v: next[2] / 100 });
                    setDraft(hexToHsv(nextHex));
                    onColorChange(nextHex);
                  }}
                  onBlur={onCommit}
                  className="h-7 min-w-0 flex-1 rounded border border-white/10 bg-input px-1 text-center font-mono text-[10px] text-textMain outline-none focus:border-accent"
                />
              ))}
            </div>
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
