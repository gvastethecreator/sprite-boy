import React, { useLayoutEffect, useRef, useState } from "react";

import type { GridLayoutSourceDimensions } from "./gridLayoutDraft";
import type { EffectiveGridLayout } from "./useSliceGridController";
import {
  paintGridOverlay,
  projectGridOverlay,
  type GridOverlayPaintStyle,
  type GridOverlayTransform,
} from "./gridOverlayGeometry";

export interface SliceGridOverlayProps {
  /** Pass the canonical values exposed by useSliceGridController; no overlay store exists. */
  readonly sourceDimensions: GridLayoutSourceDimensions | null;
  readonly effectiveLayout: EffectiveGridLayout | null;
  readonly transform: GridOverlayTransform;
  readonly paintStyle?: GridOverlayPaintStyle;
  /** Receives a zero-based row divider and its source-pixel position. */
  readonly onResizeRowBoundary?: (index: number, sourceY: number) => boolean;
  /** Receives a zero-based column divider and its source-pixel position. */
  readonly onResizeColumnBoundary?: (index: number, sourceX: number) => boolean;
  /** Deterministic override for tests/export previews; live browser DPR is the default. */
  readonly devicePixelRatio?: number;
  readonly className?: string;
}

interface SurfaceSnapshot {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

type DividerAxis = "row" | "column";

interface ManualDividers {
  readonly rows: readonly number[];
  readonly columns: readonly number[];
}

function manualDividers(layout: EffectiveGridLayout): ManualDividers | null {
  if (layout.origin !== "manual" || layout.cells.length !== layout.rows * layout.cols) return null;
  const rows: number[] = [];
  const columns: number[] = [];
  for (let row = 0; row < layout.rows - 1; row += 1) {
    const cell = layout.cells[row * layout.cols];
    if (!cell) return null;
    rows.push(cell.y + cell.height);
  }
  for (let column = 0; column < layout.cols - 1; column += 1) {
    const cell = layout.cells[column];
    if (!cell) return null;
    columns.push(cell.x + cell.width);
  }
  return Object.freeze({ rows: Object.freeze(rows), columns: Object.freeze(columns) });
}

function clampDivider(
  value: number,
  boundaries: readonly number[],
  index: number,
  limit: number,
): number {
  const previous = index === 0 ? 0 : boundaries[index - 1]!;
  const next = index === boundaries.length - 1 ? limit : boundaries[index + 1]!;
  return Math.min(next - 1, Math.max(previous + 1, value));
}

interface GridResizeControlsProps {
  readonly hostRef: React.RefObject<HTMLDivElement | null>;
  readonly sourceDimensions: GridLayoutSourceDimensions;
  readonly transform: GridOverlayTransform;
  readonly dividers: ManualDividers;
  readonly onResizeRowBoundary: (index: number, sourceY: number) => boolean;
  readonly onResizeColumnBoundary: (index: number, sourceX: number) => boolean;
}

const GridResizeControls: React.FC<GridResizeControlsProps> = ({
  hostRef,
  sourceDimensions,
  transform,
  dividers,
  onResizeRowBoundary,
  onResizeColumnBoundary,
}) => {
  const activePointerRef = useRef<{
    pointerId: number;
    axis: DividerAxis;
    index: number;
  } | null>(null);

  const updateFromPointer = (
    event: React.PointerEvent<HTMLButtonElement>,
    axis: DividerAxis,
    index: number,
  ): void => {
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const sourcePosition = axis === "column"
      ? Math.round((event.clientX - rect.left - transform.offset.x) / transform.scale)
      : Math.round((event.clientY - rect.top - transform.offset.y) / transform.scale);
    const boundaries = axis === "column" ? dividers.columns : dividers.rows;
    const limit = axis === "column" ? sourceDimensions.width : sourceDimensions.height;
    const next = clampDivider(sourcePosition, boundaries, index, limit);
    if (axis === "column") onResizeColumnBoundary(index, next);
    else onResizeRowBoundary(index, next);
  };

  const onPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    axis: DividerAxis,
    index: number,
  ): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    activePointerRef.current = { pointerId: event.pointerId, axis, index };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; direct moves still update the divider.
    }
    updateFromPointer(event, axis, index);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const active = activePointerRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateFromPointer(event, active.axis, active.index);
  };

  const finishPointer = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const active = activePointerRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateFromPointer(event, active.axis, active.index);
    activePointerRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The browser may already have released capture after an interrupted drag.
    }
  };

  const onKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    axis: DividerAxis,
    index: number,
    boundary: number,
  ): void => {
    const decrement = axis === "column" ? "ArrowLeft" : "ArrowUp";
    const increment = axis === "column" ? "ArrowRight" : "ArrowDown";
    if (event.key !== decrement && event.key !== increment) return;
    event.preventDefault();
    const delta = (event.key === increment ? 1 : -1) * (event.shiftKey ? 10 : 1);
    const boundaries = axis === "column" ? dividers.columns : dividers.rows;
    const limit = axis === "column" ? sourceDimensions.width : sourceDimensions.height;
    const next = clampDivider(boundary + delta, boundaries, index, limit);
    if (axis === "column") onResizeColumnBoundary(index, next);
    else onResizeRowBoundary(index, next);
  };

  const sourceTop = transform.offset.y;
  const sourceLeft = transform.offset.x;
  const sourceWidth = sourceDimensions.width * transform.scale;
  const sourceHeight = sourceDimensions.height * transform.scale;
  return (
    <div data-slice-grid-resize-controls="" className="pointer-events-none absolute inset-0">
      {dividers.columns.map((boundary, index) => {
        const x = sourceLeft + boundary * transform.scale;
        return (
          <button
            key={`column-${index}`}
            type="button"
            data-grid-resize-axis="column"
            data-grid-resize-index={index}
            aria-label={`Resize column divider ${index + 1} at ${boundary} pixels`}
            onPointerDown={(event) => onPointerDown(event, "column", index)}
            onPointerMove={onPointerMove}
            onPointerUp={finishPointer}
            onPointerCancel={finishPointer}
            onKeyDown={(event) => onKeyDown(event, "column", index, boundary)}
            className="pointer-events-auto absolute z-20 border-0 bg-transparent p-0 focus-visible:outline-none"
            style={{
              left: x - 8,
              top: sourceTop,
              width: 16,
              height: sourceHeight,
              cursor: "col-resize",
              touchAction: "none",
            }}
          >
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-cyan-300/95 shadow-[0_0_6px_rgba(103,232,249,0.95)]"
            />
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-cyan-100 bg-cyan-500 shadow-[0_0_9px_rgba(34,211,238,0.9)]"
            />
          </button>
        );
      })}
      {dividers.rows.map((boundary, index) => {
        const y = sourceTop + boundary * transform.scale;
        return (
          <button
            key={`row-${index}`}
            type="button"
            data-grid-resize-axis="row"
            data-grid-resize-index={index}
            aria-label={`Resize row divider ${index + 1} at ${boundary} pixels`}
            onPointerDown={(event) => onPointerDown(event, "row", index)}
            onPointerMove={onPointerMove}
            onPointerUp={finishPointer}
            onPointerCancel={finishPointer}
            onKeyDown={(event) => onKeyDown(event, "row", index, boundary)}
            className="pointer-events-auto absolute z-20 border-0 bg-transparent p-0 focus-visible:outline-none"
            style={{
              left: sourceLeft,
              top: y - 8,
              width: sourceWidth,
              height: 16,
              cursor: "row-resize",
              touchAction: "none",
            }}
          >
            <span
              aria-hidden="true"
              className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-cyan-300/95 shadow-[0_0_6px_rgba(103,232,249,0.95)]"
            />
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-cyan-100 bg-cyan-500 shadow-[0_0_9px_rgba(34,211,238,0.9)]"
            />
          </button>
        );
      })}
    </div>
  );
};

function currentDpr(override: number | undefined): number {
  return override ?? (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
}

function sameSurface(left: SurfaceSnapshot, right: SurfaceSnapshot): boolean {
  return left.width === right.width && left.height === right.height && left.dpr === right.dpr;
}

function disconnectNoThrow(observer: ResizeObserver | null): void {
  try {
    observer?.disconnect();
  } catch {
    // Cleanup remains exhaustive even for a hostile injected observer.
  }
}

function removeListenerNoThrow(
  target: Pick<EventTarget, "removeEventListener"> | null,
  listener: EventListener,
): void {
  try {
    target?.removeEventListener("resize", listener);
  } catch {
    // Cleanup remains exhaustive even for hostile browser shims.
  }
}

/**
 * Grid paint layer with manual-divider controls. It shares the source canvas
 * viewport transform so pointer and keyboard edits remain in source pixels.
 */
export const SliceGridOverlay: React.FC<SliceGridOverlayProps> = ({
  sourceDimensions,
  effectiveLayout,
  transform,
  paintStyle,
  onResizeRowBoundary,
  onResizeColumnBoundary,
  devicePixelRatio,
  className = "",
}) => {
  if (sourceDimensions === null || effectiveLayout === null) return null;
  return (
    <SliceGridOverlayCanvas
      sourceDimensions={sourceDimensions}
      effectiveLayout={effectiveLayout}
      transform={transform}
      paintStyle={paintStyle}
      onResizeRowBoundary={onResizeRowBoundary}
      onResizeColumnBoundary={onResizeColumnBoundary}
      devicePixelRatio={devicePixelRatio}
      className={className}
    />
  );
};

type SliceGridOverlayCanvasProps = Omit<SliceGridOverlayProps, "sourceDimensions" | "effectiveLayout"> & {
  readonly sourceDimensions: GridLayoutSourceDimensions;
  readonly effectiveLayout: EffectiveGridLayout;
};

const SliceGridOverlayCanvas: React.FC<SliceGridOverlayCanvasProps> = ({
  sourceDimensions,
  effectiveLayout,
  transform,
  paintStyle,
  onResizeRowBoundary,
  onResizeColumnBoundary,
  devicePixelRatio,
  className = "",
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawCountRef = useRef(0);
  const [surface, setSurface] = useState<SurfaceSnapshot>(() => Object.freeze({
    width: 0,
    height: 0,
    dpr: currentDpr(devicePixelRatio),
  }));
  const dividers = manualDividers(effectiveLayout);
  const resizeControls = dividers && onResizeRowBoundary && onResizeColumnBoundary
    ? Object.freeze({ dividers, onResizeRowBoundary, onResizeColumnBoundary })
    : null;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let alive = true;
    let observer: ResizeObserver | null = null;
    const visualViewport = typeof window === "undefined" ? null : window.visualViewport;
    const measure = (): void => {
      if (!alive) return;
      const bounds = host.getBoundingClientRect();
      const next = Object.freeze({
        width: Math.max(0, bounds.width),
        height: Math.max(0, bounds.height),
        dpr: currentDpr(devicePixelRatio),
      });
      if (!alive) return;
      setSurface((current) => sameSurface(current, next) ? current : next);
    };
    const onResize: EventListener = () => measure();

    measure();
    if (typeof ResizeObserver === "function") {
      try {
        observer = new ResizeObserver(() => measure());
        observer.observe(host);
      } catch {
        disconnectNoThrow(observer);
        observer = null;
      }
    }
    try {
      window.addEventListener("resize", onResize, { passive: true });
    } catch {
      // ResizeObserver remains the primary size signal.
    }
    try {
      visualViewport?.addEventListener("resize", onResize, { passive: true });
    } catch {
      // Window resize and ResizeObserver remain available.
    }

    return () => {
      alive = false;
      disconnectNoThrow(observer);
      removeListenerNoThrow(typeof window === "undefined" ? null : window, onResize);
      removeListenerNoThrow(visualViewport, onResize);
    };
  }, [devicePixelRatio]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const projection = projectGridOverlay(
      effectiveLayout.cells,
      sourceDimensions.width,
      sourceDimensions.height,
      transform,
      {
      width: surface.width,
      height: surface.height,
      devicePixelRatio: surface.dpr,
      },
    );
    canvas.width = projection.backingWidth;
    canvas.height = projection.backingHeight;
    canvas.style.width = `${surface.width}px`;
    canvas.style.height = `${surface.height}px`;
    const context = canvas.getContext("2d");
    if (context) {
      paintGridOverlay(context, projection, paintStyle);
      drawCountRef.current += 1;
    }
    canvas.dataset.gridOverlayDpr = String(surface.dpr);
    canvas.dataset.gridOverlayBacking = `${projection.backingWidth}x${projection.backingHeight}`;
    canvas.dataset.gridOverlayCells = String(projection.cells.length);
    canvas.dataset.gridOverlayScale = String(projection.transform.scale);
    canvas.dataset.gridOverlayOffset = `${projection.transform.offset.x},${projection.transform.offset.y}`;
    canvas.dataset.gridOverlayDrawCount = String(drawCountRef.current);
    canvas.dataset.gridOverlaySourceSize = `${sourceDimensions.width}x${sourceDimensions.height}`;
  }, [effectiveLayout, paintStyle, sourceDimensions, surface, transform]);

  useLayoutEffect(() => () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = 0;
    canvas.height = 0;
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden={resizeControls ? undefined : "true"}
      data-slice-grid-overlay=""
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`.trim()}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-slice-grid-overlay-canvas=""
        className="block"
        style={{ display: "block", pointerEvents: "none" }}
      />
      {resizeControls ? (
        <GridResizeControls
          hostRef={hostRef}
          sourceDimensions={sourceDimensions}
          transform={transform}
          dividers={resizeControls.dividers}
          onResizeRowBoundary={resizeControls.onResizeRowBoundary}
          onResizeColumnBoundary={resizeControls.onResizeColumnBoundary}
        />
      ) : null}
    </div>
  );
};
