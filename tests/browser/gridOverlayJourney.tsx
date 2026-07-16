import React, { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { buildManualGrid } from "../../core/processing/gridProcessingGeometry";
import { SliceGridOverlay } from "../../features/slice/grid/SliceGridOverlay";
import type { GridOverlayTransform } from "../../features/slice/grid/gridOverlayGeometry";
import type { EffectiveGridLayout } from "../../features/slice/grid/useSliceGridController";

const SOURCE_WIDTH = 7;
const SOURCE_HEIGHT = 5;
const CELLS = buildManualGrid(SOURCE_WIDTH, SOURCE_HEIGHT, 2, 3);
const LAYOUT: EffectiveGridLayout = Object.freeze({
  origin: "manual",
  rows: 2,
  cols: 3,
  cells: CELLS,
  warnings: Object.freeze([]),
  recipeLayout: Object.freeze({ mode: "manual", rows: 2, cols: 3 }),
});

interface GridOverlayHarnessSnapshot {
  readonly dpr: number;
  readonly backing: string;
  readonly cells: number;
  readonly drawCount: number;
  readonly scale: number;
  readonly offset: string;
  readonly stageWidth: number;
  readonly stageHeight: number;
  readonly pointerTarget: string;
  readonly sampledAlpha: number;
}

interface GridOverlayHarnessApi {
  readonly ready: boolean;
  setTransform(transform: GridOverlayTransform): void;
  setStageSize(width: number, height: number): void;
  snapshot(): GridOverlayHarnessSnapshot;
  unmount(): readonly [number, number];
}

declare global {
  interface Window {
    __gridOverlayHarness?: GridOverlayHarnessApi;
  }
}

function requireCanvas(): HTMLCanvasElement {
  const canvas = document.querySelector<HTMLCanvasElement>("[data-slice-grid-overlay-canvas]");
  if (!canvas) throw new Error("G2-04 overlay canvas is unavailable.");
  return canvas;
}

function Harness() {
  const [transform, setTransform] = useState<GridOverlayTransform>(() => Object.freeze({
    scale: 36,
    offset: Object.freeze({ x: 90, y: 70 }),
  }));
  const [stageSize, setStageSize] = useState(() => ({ width: 640, height: 360 }));
  const [displayDpr, setDisplayDpr] = useState(() => window.devicePixelRatio);
  const sourceRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointerTargetRef = useRef("none");

  useLayoutEffect(() => {
    const updateDpr = () => setDisplayDpr(window.devicePixelRatio);
    window.addEventListener("resize", updateDpr, { passive: true });
    return () => window.removeEventListener("resize", updateDpr);
  }, []);

  useLayoutEffect(() => {
    const source = sourceRef.current;
    const context = source?.getContext("2d");
    if (!source || !context) throw new Error("G2-04 source canvas is unavailable.");
    source.width = SOURCE_WIDTH;
    source.height = SOURCE_HEIGHT;
    const colors = ["#f43f5e", "#22c55e", "#38bdf8", "#f59e0b", "#a78bfa", "#fb7185"];
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const cell = CELLS[row * 3 + col]!;
        context.fillStyle = colors[row * 3 + col]!;
        context.fillRect(cell.x, cell.y, cell.width, cell.height);
      }
    }
  }, []);

  useLayoutEffect(() => {
    window.__gridOverlayHarness = {
      ready: true,
      setTransform: (next) => setTransform(Object.freeze({
        scale: next.scale,
        offset: Object.freeze({ x: next.offset.x, y: next.offset.y }),
      })),
      setStageSize: (width, height) => setStageSize({ width, height }),
      snapshot: () => {
        const canvas = requireCanvas();
        const stage = stageRef.current;
        if (!stage) throw new Error("G2-04 stage is unavailable.");
        const context = canvas.getContext("2d");
        if (!context) throw new Error("G2-04 overlay context is unavailable.");
        const sampleX = Math.max(0, Math.min(canvas.width - 1, Math.round((transform.offset.x + SOURCE_WIDTH * transform.scale) * window.devicePixelRatio)));
        const sampleY = Math.max(0, Math.min(canvas.height - 1, Math.round((transform.offset.y + transform.scale) * window.devicePixelRatio)));
        const alpha = canvas.width > 0 && canvas.height > 0
          ? context.getImageData(sampleX, sampleY, 1, 1).data[3] ?? 0
          : 0;
        return {
          dpr: Number(canvas.dataset.gridOverlayDpr),
          backing: canvas.dataset.gridOverlayBacking ?? "",
          cells: Number(canvas.dataset.gridOverlayCells),
          drawCount: Number(canvas.dataset.gridOverlayDrawCount),
          scale: Number(canvas.dataset.gridOverlayScale),
          offset: canvas.dataset.gridOverlayOffset ?? "",
          stageWidth: stage.getBoundingClientRect().width,
          stageHeight: stage.getBoundingClientRect().height,
          pointerTarget: pointerTargetRef.current,
          sampledAlpha: alpha,
        };
      },
      unmount: () => {
        const canvas = requireCanvas();
        root.unmount();
        return [canvas.width, canvas.height] as const;
      },
    };
  }, [transform]);

  return (
    <main className="shell">
      <div className="heading">
        <div><h1>Slice grid overlay</h1><p>Canonical source geometry · CSS viewport · DPR backing</p></div>
        <div className="badge">G2-04 · 2 × 3</div>
      </div>
      <div className="stage-shell">
        <div
          ref={stageRef}
          className="stage"
          data-grid-overlay-stage=""
          style={{ width: stageSize.width, height: stageSize.height }}
          onPointerDown={(event) => { pointerTargetRef.current = (event.target as HTMLElement).dataset.gridOverlayStage !== undefined ? "stage" : "source"; }}
        >
          <canvas
            ref={sourceRef}
            className="source"
            data-grid-overlay-source=""
            style={{
              left: transform.offset.x,
              top: transform.offset.y,
              width: SOURCE_WIDTH,
              height: SOURCE_HEIGHT,
              transform: `scale(${transform.scale})`,
            }}
          />
          <SliceGridOverlay
            sourceDimensions={Object.freeze({ width: SOURCE_WIDTH, height: SOURCE_HEIGHT })}
            effectiveLayout={LAYOUT}
            transform={transform}
          />
        </div>
        <div className="readout" aria-hidden="true">
          <div className="metric"><b>{SOURCE_WIDTH} × {SOURCE_HEIGHT}</b><span>source pixels</span></div>
          <div className="metric"><b>2 × 3</b><span>row-major cells</span></div>
          <div className="metric"><b>{transform.scale}×</b><span>viewport zoom</span></div>
          <div className="metric"><b>{displayDpr} DPR</b><span>backing ratio</span></div>
        </div>
      </div>
    </main>
  );
}

const rootElement = document.querySelector("#root");
if (!rootElement) throw new Error("G2-04 harness root is unavailable.");
const root = createRoot(rootElement);
root.render(<Harness />);
