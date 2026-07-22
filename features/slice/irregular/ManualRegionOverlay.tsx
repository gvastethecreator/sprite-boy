import React, { useEffect, useRef, useState } from "react";

import type { EntityId, Rect } from "../../../core/project";
import type { GridOverlayTransform } from "../grid/gridOverlayGeometry";
import {
  moveManualRegionBounds,
  resizeManualRegionBounds,
  sameManualRegionBounds,
  type ManualRegionResizeHandle,
  type ManualRegionSourceDimensions,
} from "./manualRegionGeometry";

export interface ManualRegionOverlayRegion {
  readonly id: EntityId;
  readonly name?: string;
  readonly bounds: Readonly<Rect>;
  readonly hidden?: boolean;
}

export interface ManualRegionOverlayProps {
  readonly sourceDimensions: ManualRegionSourceDimensions;
  readonly regions: readonly ManualRegionOverlayRegion[];
  readonly selectedRegionId: EntityId | null;
  readonly transform: GridOverlayTransform;
  readonly onSelectRegion: (regionId: EntityId) => void;
  readonly onCommitBounds: (regionId: EntityId, bounds: Readonly<Rect>) => void;
}

interface ActiveInteraction {
  readonly pointerId: number;
  readonly regionId: EntityId;
  readonly action: "move" | ManualRegionResizeHandle;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startBounds: Readonly<Rect>;
  bounds: Readonly<Rect>;
}

const RESIZE_HANDLES: readonly ManualRegionResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const HANDLE_STYLE: Readonly<Record<ManualRegionResizeHandle, React.CSSProperties>> = {
  nw: { left: 0, top: 0, cursor: "nwse-resize" },
  n: { left: "50%", top: 0, cursor: "ns-resize" },
  ne: { left: "100%", top: 0, cursor: "nesw-resize" },
  e: { left: "100%", top: "50%", cursor: "ew-resize" },
  se: { left: "100%", top: "100%", cursor: "nwse-resize" },
  s: { left: "50%", top: "100%", cursor: "ns-resize" },
  sw: { left: 0, top: "100%", cursor: "nesw-resize" },
  w: { left: 0, top: "50%", cursor: "ew-resize" },
};

function boundsForKeyboard(
  bounds: Readonly<Rect>,
  action: "move" | ManualRegionResizeHandle,
  key: string,
  step: number,
  source: ManualRegionSourceDimensions,
): Readonly<Rect> | null {
  const deltaX = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
  const deltaY = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
  if (deltaX === 0 && deltaY === 0) return null;
  return action === "move"
    ? moveManualRegionBounds(bounds, deltaX, deltaY, source)
    : resizeManualRegionBounds(bounds, action, deltaX, deltaY, source);
}

export function ManualRegionOverlay({
  sourceDimensions,
  regions,
  selectedRegionId,
  transform,
  onSelectRegion,
  onCommitBounds,
}: ManualRegionOverlayProps) {
  const activeRef = useRef<ActiveInteraction | null>(null);
  const [draft, setDraft] = useState<{ readonly regionId: EntityId; readonly bounds: Readonly<Rect> } | null>(null);

  useEffect(() => {
    const cancel = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !activeRef.current) return;
      activeRef.current = null;
      setDraft(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);

  const startInteraction = (
    event: React.PointerEvent<HTMLButtonElement>,
    region: ManualRegionOverlayRegion,
    action: "move" | ManualRegionResizeHandle,
  ): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectRegion(region.id);
    activeRef.current = {
      pointerId: event.pointerId,
      regionId: region.id,
      action,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startBounds: region.bounds,
      bounds: region.bounds,
    };
    setDraft({ regionId: region.id, bounds: region.bounds });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Direct pointer events still work when capture is unavailable.
    }
  };

  const updateInteraction = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const active = activeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const scale = Math.max(transform.scale, Number.EPSILON);
    const deltaX = Math.round((event.clientX - active.startClientX) / scale);
    const deltaY = Math.round((event.clientY - active.startClientY) / scale);
    active.bounds = active.action === "move"
      ? moveManualRegionBounds(active.startBounds, deltaX, deltaY, sourceDimensions)
      : resizeManualRegionBounds(active.startBounds, active.action, deltaX, deltaY, sourceDimensions);
    setDraft({ regionId: active.regionId, bounds: active.bounds });
  };

  const finishInteraction = (event: React.PointerEvent<HTMLButtonElement>, commit: boolean): void => {
    const active = activeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (commit) updateInteraction(event);
    activeRef.current = null;
    setDraft(null);
    if (commit && !sameManualRegionBounds(active.startBounds, active.bounds)) {
      onCommitBounds(active.regionId, active.bounds);
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Browser may release capture before this handler.
    }
  };

  const handleKeyboard = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    region: ManualRegionOverlayRegion,
    action: "move" | ManualRegionResizeHandle,
  ): void => {
    const next = boundsForKeyboard(region.bounds, action, event.key, event.shiftKey ? 10 : 1, sourceDimensions);
    if (!next || sameManualRegionBounds(region.bounds, next)) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectRegion(region.id);
    onCommitBounds(region.id, next);
  };
  const stopLegacyMousePropagation = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div data-manual-region-overlay="" className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {regions.map((region, index) => {
        const bounds = draft?.regionId === region.id ? draft.bounds : region.bounds;
        const selected = selectedRegionId === region.id;
        const label = region.name ?? `Slice ${index + 1}`;
        return (
          <div
            key={region.id}
            data-manual-region-id={region.id}
            data-manual-region-bounds={`${bounds.x},${bounds.y},${bounds.width},${bounds.height}`}
            className="pointer-events-none absolute"
            style={{
              left: transform.offset.x + bounds.x * transform.scale,
              top: transform.offset.y + bounds.y * transform.scale,
              width: bounds.width * transform.scale,
              height: bounds.height * transform.scale,
            }}
          >
            <button
              type="button"
              aria-label={`${label}, x ${bounds.x}, y ${bounds.y}, width ${bounds.width}, height ${bounds.height}`}
              aria-pressed={selected}
              data-manual-region-move={region.id}
              onFocus={() => onSelectRegion(region.id)}
              onMouseDown={stopLegacyMousePropagation}
              onPointerDown={(event) => startInteraction(event, region, "move")}
              onPointerMove={updateInteraction}
              onPointerUp={(event) => finishInteraction(event, true)}
              onPointerCancel={(event) => finishInteraction(event, false)}
              onKeyDown={(event) => handleKeyboard(event, region, "move")}
              className={`pointer-events-auto absolute inset-0 overflow-hidden border-2 text-left outline-none transition-colors ${selected ? "border-amber-300 bg-amber-300/10 shadow-[0_0_0_1px_rgba(0,0,0,0.75),0_0_12px_rgba(252,211,77,0.35)]" : "border-cyan-300/85 bg-cyan-300/5 hover:bg-cyan-300/10"} ${region.hidden ? "border-dashed opacity-50" : ""}`}
              style={{ cursor: "move", touchAction: "none" }}
            >
              <span className={`absolute left-0 top-0 max-w-full truncate px-1 py-0.5 font-mono text-[9px] font-bold ${selected ? "bg-amber-300 text-black" : "bg-cyan-300 text-black"}`}>
                {index + 1} · {bounds.width}×{bounds.height}
              </span>
            </button>
            {selected ? RESIZE_HANDLES.map((handle) => (
              <button
                key={handle}
                type="button"
                aria-label={`Resize ${label} from ${handle}`}
                data-manual-region-resize={handle}
                onMouseDown={stopLegacyMousePropagation}
                onPointerDown={(event) => startInteraction(event, region, handle)}
                onPointerMove={updateInteraction}
                onPointerUp={(event) => finishInteraction(event, true)}
                onPointerCancel={(event) => finishInteraction(event, false)}
                onKeyDown={(event) => handleKeyboard(event, region, handle)}
                className="pointer-events-auto absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-black bg-amber-300 shadow-[0_0_0_1px_rgba(252,211,77,0.9)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                style={{ ...HANDLE_STYLE[handle], touchAction: "none" }}
              />
            )) : null}
          </div>
        );
      })}
    </div>
  );
}

export default ManualRegionOverlay;
