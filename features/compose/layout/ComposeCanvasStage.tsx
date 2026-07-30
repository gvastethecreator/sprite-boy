import { ImagePlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AssetRepository } from "../../../core/assets";
import type { Composition, Layer } from "../../../core/project";
import type { DeepReadonly, ProjectStore } from "../../../core/stores";
import { useWorkspaceStore } from "../../../contexts/StudioStoreContext";
import { useWorkspaceStoreSelector } from "../../../hooks/useStudioStoreSelector";
import { ComposeCanvasWorkspace } from "../canvas/ComposeCanvasWorkspace";
import { resolveFittedSceneViewport } from "../canvas/sceneViewportFit";
import {
  compositionCellForPoint,
  createCompositionGridCells,
  resolveCompositionLayout,
} from "./compositionLayout";

export interface ComposeCanvasStageProps {
  readonly store: ProjectStore;
  readonly assets: AssetRepository;
  readonly composition: DeepReadonly<Composition>;
  readonly layers: readonly DeepReadonly<Layer>[];
  readonly selectedCell: number;
  readonly dragActive?: boolean;
  readonly disabled?: boolean;
  readonly onSelectedCellChange: (cell: number) => void;
  readonly onImport: (cell?: number) => void;
}

interface HostSize {
  readonly width: number;
  readonly height: number;
}

const DEFAULT_VIEWPORT = Object.freeze({
  scale: 1,
  offset: Object.freeze({ x: 0, y: 0 }),
});

export function ComposeCanvasStage({
  store,
  assets,
  composition,
  layers,
  selectedCell,
  dragActive = false,
  disabled = false,
  onSelectedCellChange,
  onImport,
}: ComposeCanvasStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const workspace = useWorkspaceStore();
  const composeViewport = useWorkspaceStoreSelector(
    workspace,
    (state) => state.viewports.compose,
  );
  const [hostSize, setHostSize] = useState<HostSize>({ width: 0, height: 0 });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => setHostSize({ width: host.clientWidth, height: host.clientHeight });
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const viewport = resolveFittedSceneViewport(
    composeViewport ?? DEFAULT_VIEWPORT,
    composition.width,
    composition.height,
    hostSize.width,
    hostSize.height,
  );
  const layout = resolveCompositionLayout(composition);
  const cells = useMemo(
    () => layout.mode === "grid" ? createCompositionGridCells(composition, layout) : [],
    [composition, layout],
  );
  const occupancy = useMemo(() => {
    const counts = new Map<number, number>();
    for (const layer of layers) {
      const cell = layer.cellIndex ?? compositionCellForPoint(composition, layer.transform);
      if (cell !== null) counts.set(cell, (counts.get(cell) ?? 0) + 1);
    }
    return counts;
  }, [composition, layers]);

  const canvasStyle = {
    left: `${viewport.offset.x}px`,
    top: `${viewport.offset.y}px`,
    width: `${composition.width * viewport.scale}px`,
    height: `${composition.height * viewport.scale}px`,
  };

  const overlay = (
    <div
      className="pointer-events-none absolute inset-0 z-10"
      aria-hidden={layout.mode === "free" && layers.length > 0 ? true : undefined}
    >
      <div
        className={`pointer-events-auto absolute overflow-hidden border ${dragActive ? "border-accent shadow-glow" : "border-white/20"}`}
        style={canvasStyle}
        data-compose-drop-surface
      >
        {layout.mode === "grid" ? (
          <div
            role="grid"
            aria-label={`${layout.rows} by ${layout.columns} image grid`}
            className="grid h-full w-full"
            style={{
              gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
              gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
              gap: `${layout.gap * viewport.scale}px`,
            }}
          >
            {cells.map((cell) => {
              const count = occupancy.get(cell.index) ?? 0;
              const active = selectedCell === cell.index;
              return (
                <button
                  key={cell.index}
                  ref={(element) => { cellRefs.current[cell.index] = element; }}
                  type="button"
                  role="gridcell"
                  aria-selected={active}
                  aria-label={`Add image to cell ${cell.index + 1}, ${count === 0 ? "empty" : `${count} ${count === 1 ? "image" : "images"}`}`}
                  disabled={disabled}
                  tabIndex={active ? 0 : -1}
                  data-compose-grid-cell={cell.index}
                  data-compose-cell-occupancy={count}
                  className={`group relative min-h-0 min-w-0 border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${active ? "border-accent bg-accent/10" : "border-white/20 bg-black/5 hover:bg-white/5"}`}
                  onClick={() => {
                    onSelectedCellChange(cell.index);
                    onImport(cell.index);
                  }}
                  onFocus={() => onSelectedCellChange(cell.index)}
                  onKeyDown={(event) => {
                    let target = cell.index;
                    if (event.key === "ArrowLeft") target = Math.max(0, cell.index - 1);
                    else if (event.key === "ArrowRight") target = Math.min(cells.length - 1, cell.index + 1);
                    else if (event.key === "ArrowUp") target = Math.max(0, cell.index - layout.columns);
                    else if (event.key === "ArrowDown") target = Math.min(cells.length - 1, cell.index + layout.columns);
                    else if (event.key === "Home") target = 0;
                    else if (event.key === "End") target = cells.length - 1;
                    else return;
                    event.preventDefault();
                    onSelectedCellChange(target);
                    cellRefs.current[target]?.focus();
                  }}
                >
                  <span className={`pointer-events-none absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 font-mono text-[9px] ${active ? "bg-accent text-white" : "bg-black/55 text-white/75"}`}>
                    {cell.index + 1}
                  </span>
                  <span className={`pointer-events-none absolute bottom-2 right-2 inline-flex min-h-7 items-center gap-1 rounded-md border px-2 text-[9px] font-semibold ${active || count === 0 ? "border-white/20 bg-black/70 text-white" : "border-white/10 bg-black/55 text-white/70 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}>
                    <ImagePlus size={11} aria-hidden="true" /> Add
                  </span>
                </button>
              );
            })}
          </div>
        ) : layers.length === 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onImport()}
            className="flex h-full w-full flex-col items-center justify-center bg-black/5 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          >
            <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-black/55 text-white">
              <ImagePlus size={16} aria-hidden="true" />
            </span>
            <span className="rounded bg-black/65 px-2 py-1 text-[10px] font-semibold text-white">Drop or add an image</span>
          </button>
        ) : null}
      </div>
      {dragActive ? (
        <div className="absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-accent px-3 py-1.5 text-[10px] font-semibold text-white shadow-lg">
          Drop to add image
        </div>
      ) : null}
    </div>
  );

  return (
    <div ref={hostRef} className="relative h-full min-h-[280px] min-w-0" data-compose-canvas-stage>
      {layers.length === 0 ? (
        <div className="relative flex h-full min-h-[240px] w-full overflow-hidden border border-border/20 bg-workspace">
          <div
            aria-hidden="true"
            data-compose-lightweight-canvas
            className="absolute"
            style={{
              ...canvasStyle,
              backgroundColor: composition.background ?? "transparent",
              ...(composition.background === null
                ? {
                    backgroundImage: "linear-gradient(45deg, rgba(255,255,255,.08) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,.08) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,.08) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,.08) 75%)",
                    backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
                    backgroundSize: "16px 16px",
                  }
                : {}),
            }}
          />
          {overlay}
        </div>
      ) : (
        <ComposeCanvasWorkspace store={store} assets={assets} overlay={overlay} />
      )}
    </div>
  );
}

export default ComposeCanvasStage;
