import { Grid3X3, ImagePlus, Maximize2, MousePointer2 } from "lucide-react";
import { useRef, useState } from "react";

import type { Composition, CompositionLayout, EntityId } from "../../../core/project";
import type { DeepReadonly, ProjectStore } from "../../../core/stores";
import { DEFAULT_GRID_LAYOUT, resolveCompositionLayout } from "./compositionLayout";
import { applyCompositionLayout } from "./compositionLayoutEditor";

export interface ComposeLayoutToolbarProps {
  readonly store: ProjectStore;
  readonly composition: DeepReadonly<Composition>;
  readonly selectedCell: number;
  readonly busy?: boolean;
  readonly onSelectedCellChange: (cell: number) => void;
  readonly onImport: () => void;
  readonly onOpenCanvasSettings?: () => void;
}

let commandIdentity = 0;

function commandId(): EntityId {
  commandIdentity += 1;
  return `compose-layout-${Date.now().toString(36)}-${commandIdentity.toString(36)}`;
}

export function ComposeLayoutToolbar({
  store,
  composition,
  selectedCell,
  busy = false,
  onSelectedCellChange,
  onImport,
  onOpenCanvasSettings,
}: ComposeLayoutToolbarProps) {
  const layout = resolveCompositionLayout(composition);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const update = (next: CompositionLayout) => {
    const result = applyCompositionLayout(store, {
      compositionId: composition.id,
      layout: next,
      commandId: commandId(),
      issuedAt: new Date().toISOString(),
    });
    if (!result.ok) {
      setError(result.message);
      queueMicrotask(() => errorRef.current?.focus({ preventScroll: true }));
      return;
    }
    setError(null);
    if (next.mode === "grid") {
      onSelectedCellChange(Math.min(selectedCell, next.rows * next.columns - 1));
    }
  };

  return (
    <div className="shrink-0 border-b border-white/10 bg-panel/92" data-compose-layout-mode={layout.mode}>
      <div className="flex min-h-11 flex-wrap items-center gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 pr-1">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/20 text-textMuted">
            <Maximize2 size={13} aria-hidden="true" />
          </span>
          <span className="font-mono text-[10px] text-textMuted">
            {composition.width} × {composition.height}
          </span>
        </div>

        <div role="radiogroup" aria-label="Canvas layout" className="flex rounded-md border border-white/10 bg-black/20 p-0.5">
          <button
            type="button"
            role="radio"
            aria-checked={layout.mode === "free"}
            disabled={busy}
            onClick={() => update({ mode: "free" })}
            className={`inline-flex min-h-7 items-center gap-1.5 rounded px-2.5 text-[10px] font-semibold ${layout.mode === "free" ? "bg-accent text-white" : "text-textMuted hover:bg-white/5 hover:text-textMain"}`}
          >
            <MousePointer2 size={12} aria-hidden="true" /> Free
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={layout.mode === "grid"}
            disabled={busy}
            onClick={() => update(layout.mode === "grid" ? layout : DEFAULT_GRID_LAYOUT)}
            className={`inline-flex min-h-7 items-center gap-1.5 rounded px-2.5 text-[10px] font-semibold ${layout.mode === "grid" ? "bg-accent text-white" : "text-textMuted hover:bg-white/5 hover:text-textMain"}`}
          >
            <Grid3X3 size={12} aria-hidden="true" /> Grid
          </button>
        </div>

        {layout.mode === "grid" ? (
          <fieldset className="flex flex-wrap items-center gap-2" disabled={busy}>
            <legend className="sr-only">Grid dimensions</legend>
            <label className="flex items-center gap-1.5 text-[10px] font-semibold text-textMuted">
              Rows
              <select
                aria-label="Grid rows"
                value={layout.rows}
                onChange={(event) => update({ ...layout, rows: Number(event.target.value) })}
                className="min-h-7 rounded-md border border-white/10 bg-input px-2 font-mono text-[10px] text-textMain"
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[10px] font-semibold text-textMuted">
              Columns
              <select
                aria-label="Grid columns"
                value={layout.columns}
                onChange={(event) => update({ ...layout, columns: Number(event.target.value) })}
                className="min-h-7 rounded-md border border-white/10 bg-input px-2 font-mono text-[10px] text-textMain"
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[10px] font-semibold text-textMuted">
              Gap
              <select
                aria-label="Grid gap"
                value={layout.gap}
                onChange={(event) => update({ ...layout, gap: Number(event.target.value) })}
                className="min-h-7 rounded-md border border-white/10 bg-input px-2 font-mono text-[10px] text-textMain"
              >
                {[0, 1, 2, 4, 8, 16, 24, 32].map((value) => <option key={value} value={value}>{value}px</option>)}
              </select>
            </label>
            <span className="rounded bg-accent/10 px-2 py-1 font-mono text-[9px] text-accent">
              Cell {selectedCell + 1}/{layout.rows * layout.columns}
            </span>
          </fieldset>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {onOpenCanvasSettings ? (
            <button
              type="button"
              onClick={onOpenCanvasSettings}
              className="inline-flex min-h-8 items-center rounded-md border border-white/10 bg-white/5 px-3 text-[10px] font-semibold text-textMuted hover:bg-white/10 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent xl:hidden"
            >
              Canvas settings
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={onImport}
            className="btn-primary inline-flex min-h-8 items-center gap-1.5 rounded-md px-3 text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-55"
          >
            <ImagePlus size={13} aria-hidden="true" /> {busy ? "Importing…" : layout.mode === "grid" ? "Add to cell" : "Add image"}
          </button>
        </div>
      </div>
      {error ? <p ref={errorRef} tabIndex={-1} role="alert" className="border-t border-red-400/20 bg-red-400/10 px-3 py-1.5 text-[10px] text-red-100">{error}</p> : null}
    </div>
  );
}

export default ComposeLayoutToolbar;
