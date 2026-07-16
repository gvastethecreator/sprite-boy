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
  /** Deterministic override for tests/export previews; live browser DPR is the default. */
  readonly devicePixelRatio?: number;
  readonly className?: string;
}

interface SurfaceSnapshot {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

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
 * Non-interactive grid layer. Mount as an absolute sibling of the source canvas and feed it
 * the same source-space viewport transform. It owns no pointer or keyboard interaction.
 */
export const SliceGridOverlay: React.FC<SliceGridOverlayProps> = ({
  sourceDimensions,
  effectiveLayout,
  transform,
  paintStyle,
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
      aria-hidden="true"
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
        data-slice-grid-overlay-canvas=""
        className="block"
        style={{ display: "block", pointerEvents: "none" }}
      />
    </div>
  );
};
