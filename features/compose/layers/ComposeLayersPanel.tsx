import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Lock,
  Plus,
  RotateCcw,
  Trash2,
  Unlock,
} from "lucide-react";
import { SelectControl, SliderControl, type ControlChangeMeta } from "../../../components/toolcraft";
import type { EntityId, LayerTransform } from "../../../core/project";
import type { ProjectStore } from "../../../core/stores";
import { useProjectStoreSelector } from "../../../hooks/useStudioStoreSelector";
import { createComposeLayerEditor, type LayerEditResult } from "./layerEditor";

export interface ComposeLayersPanelProps {
  readonly store: ProjectStore;
  readonly disabled?: boolean;
}

let identity = 0;

function nextId(kind: "command" | "layer"): EntityId {
  identity += 1;
  try {
    const random = globalThis.crypto?.randomUUID?.();
    if (random) return `${kind}-${random}`;
  } catch {
    // The document-local fallback still changes for each call.
  }
  return `${kind}-${Date.now().toString(36)}-${identity.toString(36)}`;
}

function timestamp(): string {
  return new Date().toISOString();
}

function history(meta: ControlChangeMeta) {
  return meta.history === "merge" && meta.historyGroup
    ? { mode: "coalesce" as const, transactionId: meta.historyGroup }
    : { mode: "record" as const };
}

function NumericField({
  disabled,
  label,
  max,
  min,
  onCommit,
  step,
  value,
}: {
  readonly disabled: boolean;
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly onCommit: (value: number) => void;
  readonly step: number;
  readonly value: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (raw = draft) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    onCommit(clamped);
  };
  return (
    <label className="min-w-0 space-y-1 text-[10px] font-bold uppercase tracking-wider text-textMuted">
      {label}
      <input
        aria-label={label}
        className="mt-1 min-h-8 w-full rounded-md border border-white/10 bg-input px-2 font-mono text-xs font-normal tracking-normal text-textMain outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-45"
        disabled={disabled}
        max={max}
        min={min}
        step={step}
        type="number"
        value={draft}
        onBlur={(event) => commit(event.currentTarget.value)}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

export function ComposeLayersPanel({ store, disabled = false }: ComposeLayersPanelProps) {
  const project = useProjectStoreSelector(store, (state) => state.project);
  const compositionId = project.workspace.selectedCompositionId;
  const composition = compositionId ? project.compositions[compositionId] : undefined;
  const selectedLayerId = project.workspace.selectedLayerId;
  const selectedLayer = selectedLayerId ? project.layers[selectedLayerId] : undefined;
  const editor = useMemo(() => createComposeLayerEditor({ store, nextId, now: timestamp }), [store]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sourceKey, setSourceKey] = useState("");
  const [nameDraft, setNameDraft] = useState(selectedLayer?.name ?? "Layer");
  const feedbackRef = useRef<HTMLDivElement>(null);

  const availableSources = useMemo(() => [
    ...project.rootOrder.assetIds.flatMap((id) => {
      const asset = project.assets[id];
      return asset?.media.type === "image"
        ? [{ key: `asset:${id}`, source: { type: "asset" as const, id }, label: `Asset · ${asset.name}` }]
        : [];
    }),
    ...project.rootOrder.regionIds.flatMap((id) => {
      const region = project.regions[id];
      const asset = region ? project.assets[region.assetId] : undefined;
      return region && asset?.media.type === "image"
        ? [{
            key: `region:${id}`,
            source: { type: "region" as const, id },
            label: `Region · ${region.name?.trim() || id}`,
          }]
        : [];
    }),
  ], [project]);
  const resolvedSourceKey = availableSources.some((item) => item.key === sourceKey)
    ? sourceKey
    : availableSources[0]?.key ?? "";

  useEffect(() => {
    setNameDraft(selectedLayer?.name ?? "Layer");
  }, [selectedLayer?.id, selectedLayer?.name]);

  useEffect(() => {
    if (feedback) feedbackRef.current?.focus({ preventScroll: true });
  }, [feedback]);

  const apply = (result: LayerEditResult, success?: string): boolean => {
    if (!result.ok) {
      setFeedback(result.message);
      return false;
    }
    setFeedback(success ?? null);
    return true;
  };

  const setTransform = (
    patch: Partial<LayerTransform>,
    meta?: ControlChangeMeta,
  ) => {
    if (!selectedLayer) return;
    apply(editor.setTransform(
      selectedLayer.id,
      patch,
      meta ? history(meta) : { mode: "record" },
    ));
  };

  if (!composition) return null;
  const orderedLayers = composition.layerIds
    .flatMap((id) => project.layers[id] ? [project.layers[id]] : [])
    .reverse();
  const selectedIndex = selectedLayer
    ? composition.layerIds.indexOf(selectedLayer.id)
    : -1;
  const locked = disabled || Boolean(selectedLayer?.locked);

  return (
    <aside
      aria-label="Composition layers"
      data-compose-layers
      className="custom-scrollbar flex min-h-0 flex-col overflow-y-auto border-t border-white/10 bg-panel/80 text-textMain lg:border-l lg:border-t-0"
    >
      <div className="space-y-2 border-b border-white/10 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold">Layers</h2>
          <span className="font-mono text-[10px] text-textMuted">{orderedLayers.length}</span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <SelectControl
            disabled={disabled || availableSources.length === 0}
            name="Layer source"
            options={availableSources.map((item) => ({ value: item.key, label: item.label }))}
            value={resolvedSourceKey}
            onValueChange={setSourceKey}
          />
          <button
            type="button"
            aria-label="Add layer"
            disabled={disabled || !resolvedSourceKey}
            className="mb-0.5 flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-surface text-textMain hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
            onClick={() => {
              const source = availableSources.find((item) => item.key === resolvedSourceKey)?.source;
              if (source) apply(editor.add(composition.id, source), "Layer added.");
            }}
          >
            <Plus size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      <ol className="space-y-1 border-b border-white/10 p-2" aria-label="Layer order">
        {orderedLayers.map((layer) => {
          const selected = layer.id === selectedLayerId;
          const sourceName = layer.source.type === "asset"
            ? project.assets[layer.source.id]?.name
            : project.regions[layer.source.id]?.name;
          return (
            <li key={layer.id}>
              <div className={`flex items-center gap-1 rounded-md border p-1 ${selected ? "border-accent/60 bg-accent/10" : "border-transparent hover:bg-white/5"}`}>
                <button
                  type="button"
                  aria-label={`Select ${layer.name?.trim() || "Layer"}`}
                  aria-pressed={selected}
                  className="min-w-0 flex-1 rounded px-1.5 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  disabled={disabled}
                  onClick={() => apply(editor.select(layer.id))}
                >
                  <span className="block truncate text-[11px] font-semibold">{layer.name?.trim() || "Layer"}</span>
                  <span className="block truncate font-mono text-[9px] text-textMuted">{sourceName?.trim() || layer.source.id}</span>
                </button>
                <button
                  type="button"
                  aria-label={layer.visible === false ? `Show ${layer.name ?? "layer"}` : `Hide ${layer.name ?? "layer"}`}
                  className="rounded p-1.5 text-textMuted hover:bg-white/10 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  disabled={disabled}
                  onClick={() => apply(editor.setVisible(layer.id, layer.visible === false))}
                >
                  {layer.visible === false ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  aria-label={layer.locked ? `Unlock ${layer.name ?? "layer"}` : `Lock ${layer.name ?? "layer"}`}
                  className="rounded p-1.5 text-textMuted hover:bg-white/10 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  disabled={disabled}
                  onClick={() => apply(editor.setLocked(layer.id, !layer.locked))}
                >
                  {layer.locked ? <Lock size={13} aria-hidden="true" /> : <Unlock size={13} aria-hidden="true" />}
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      {selectedLayer ? (
        <div className="space-y-3 p-3">
          {selectedLayer.cellIndex !== undefined ? (
            <p className="rounded-md border border-accent/20 bg-accent/10 px-2.5 py-2 text-[10px] text-textMuted">
              Cell {selectedLayer.cellIndex + 1}. A position or scale change detaches this layer from the cell.
            </p>
          ) : null}
          <label className="block space-y-1 text-[10px] font-bold uppercase tracking-wider text-textMuted">
            Name
            <input
              aria-label="Layer name"
              className="mt-1 min-h-8 w-full rounded-md border border-white/10 bg-input px-2 text-xs font-normal tracking-normal text-textMain outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-45"
              disabled={locked}
              maxLength={128}
              value={nameDraft}
              onBlur={() => {
                if (nameDraft.trim() && nameDraft.trim() !== selectedLayer.name) {
                  if (!apply(editor.rename(selectedLayer.id, nameDraft))) setNameDraft(selectedLayer.name ?? "Layer");
                }
              }}
              onChange={(event) => setNameDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setNameDraft(selectedLayer.name ?? "Layer");
                  event.currentTarget.blur();
                }
              }}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <NumericField disabled={locked} label="Layer X" min={-1_000_000} max={1_000_000} step={1} value={selectedLayer.transform.x} onCommit={(value) => setTransform({ x: value })} />
            <NumericField disabled={locked} label="Layer Y" min={-1_000_000} max={1_000_000} step={1} value={selectedLayer.transform.y} onCommit={(value) => setTransform({ y: value })} />
            <NumericField disabled={locked} label="Layer scale X" min={0.01} max={32} step={0.01} value={selectedLayer.transform.scaleX} onCommit={(value) => setTransform({ scaleX: value })} />
            <NumericField disabled={locked} label="Layer scale Y" min={0.01} max={32} step={0.01} value={selectedLayer.transform.scaleY} onCommit={(value) => setTransform({ scaleY: value })} />
            <NumericField disabled={locked} label="Layer rotation" min={-180} max={180} step={1} value={selectedLayer.transform.rotation} onCommit={(value) => setTransform({ rotation: value })} />
          </div>

          <SliderControl
            baseValue={100}
            disabled={locked}
            max={100}
            min={0}
            name="Layer opacity"
            step={1}
            unit="%"
            value={Math.round(selectedLayer.transform.opacity * 100)}
            onValueChange={(value, meta) => setTransform({ opacity: value / 100 }, meta)}
          />

          <div className="grid grid-cols-4 gap-1.5">
            <button type="button" aria-label="Move layer up" title="Move up" disabled={locked || selectedIndex >= composition.layerIds.length - 1} className="flex min-h-8 items-center justify-center rounded-md border border-white/10 bg-surface hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-35" onClick={() => apply(editor.move(selectedLayer.id, "forward"))}><ArrowUp size={14} aria-hidden="true" /></button>
            <button type="button" aria-label="Move layer down" title="Move down" disabled={locked || selectedIndex <= 0} className="flex min-h-8 items-center justify-center rounded-md border border-white/10 bg-surface hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-35" onClick={() => apply(editor.move(selectedLayer.id, "backward"))}><ArrowDown size={14} aria-hidden="true" /></button>
            <button type="button" aria-label="Duplicate layer" title="Duplicate" disabled={locked} className="flex min-h-8 items-center justify-center rounded-md border border-white/10 bg-surface hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-35" onClick={() => apply(editor.duplicate(selectedLayer.id), "Layer duplicated.")}><Copy size={14} aria-hidden="true" /></button>
            <button type="button" aria-label="Delete layer" title="Delete" disabled={locked} className="flex min-h-8 items-center justify-center rounded-md border border-red-400/20 bg-red-400/5 text-red-200 hover:bg-red-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:opacity-35" onClick={() => apply(editor.remove(selectedLayer.id), "Layer removed.")}><Trash2 size={14} aria-hidden="true" /></button>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <button type="button" aria-pressed={selectedLayer.transform.flipX} disabled={locked} className="flex min-h-8 items-center justify-center gap-1 rounded-md border border-white/10 bg-surface text-[10px] hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-35" onClick={() => setTransform({ flipX: !selectedLayer.transform.flipX })}><FlipHorizontal2 size={13} aria-hidden="true" />Flip X</button>
            <button type="button" aria-pressed={selectedLayer.transform.flipY} disabled={locked} className="flex min-h-8 items-center justify-center gap-1 rounded-md border border-white/10 bg-surface text-[10px] hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-35" onClick={() => setTransform({ flipY: !selectedLayer.transform.flipY })}><FlipVertical2 size={13} aria-hidden="true" />Flip Y</button>
            <button type="button" aria-label="Reset layer transform" disabled={locked} className="flex min-h-8 items-center justify-center gap-1 rounded-md border border-white/10 bg-surface text-[10px] hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-35" onClick={() => apply(editor.resetTransform(selectedLayer.id), "Transform reset.")}><RotateCcw size={13} aria-hidden="true" />Reset</button>
          </div>
        </div>
      ) : (
        <p className="p-3 text-xs text-textMuted">Select a layer to edit it.</p>
      )}

      {feedback ? (
        <div ref={feedbackRef} tabIndex={-1} role={feedback.includes("could not") ? "alert" : "status"} className="m-3 mt-auto rounded-md border border-white/10 bg-surface px-2.5 py-2 text-[11px] text-textMain">
          {feedback}
        </div>
      ) : null}
    </aside>
  );
}

export default ComposeLayersPanel;
