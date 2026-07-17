import React from "react";
import { Box, Copy, Eye, EyeOff, Hand, MousePointer2, Plus, Trash2, Wand2 } from "lucide-react";
import type { DeepReadonly } from "../../../core/stores";
import type { EntityId, StudioProjectV1 } from "../../../core/project";
import { WandSelectionProbe } from "./WandSelectionProbe";
import type { WandSelectionMode, WandSelectionSnapshot } from "./wandSelection";

export type IrregularToolMode = "wand" | "manual";

export interface ManualRegionDraft {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface IrregularSliceToolsProps {
  readonly project: DeepReadonly<StudioProjectV1>;
  readonly sourceAssetId: EntityId | null;
  readonly selection: WandSelectionSnapshot;
  readonly toolMode: IrregularToolMode;
  readonly wandMode: WandSelectionMode;
  readonly wandAlphaThreshold: number;
  readonly wandConnectivity: 4 | 8;
  readonly manualDraft: ManualRegionDraft;
  readonly selectedRegionId: EntityId | null;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onToolModeChange: (mode: IrregularToolMode) => void;
  readonly onWandModeChange: (mode: WandSelectionMode) => void;
  readonly onWandAlphaThresholdChange: (value: number) => void;
  readonly onWandConnectivityChange: (value: 4 | 8) => void;
  readonly onCancelSelection: () => void;
  readonly onManualDraftChange: (patch: Partial<ManualRegionDraft>) => void;
  readonly onCreateManual: () => void;
  readonly onApplyManual: () => void;
  readonly onDeleteRegion: () => void;
  readonly onDuplicateRegion: () => void;
  readonly onToggleHidden: () => void;
  readonly onConvertToAsset: () => void;
  readonly onSelectRegion: (regionId: EntityId) => void;
}

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function IrregularSliceTools({
  project,
  sourceAssetId,
  selection,
  toolMode,
  wandMode,
  wandAlphaThreshold,
  wandConnectivity,
  manualDraft,
  selectedRegionId,
  busy = false,
  error = null,
  onToolModeChange,
  onWandModeChange,
  onWandAlphaThresholdChange,
  onWandConnectivityChange,
  onCancelSelection,
  onManualDraftChange,
  onCreateManual,
  onApplyManual,
  onDeleteRegion,
  onDuplicateRegion,
  onToggleHidden,
  onConvertToAsset,
  onSelectRegion,
}: IrregularSliceToolsProps) {
  const regions = project.rootOrder.regionIds
    .map((id) => project.regions[id])
    .filter((region): region is NonNullable<typeof region> => Boolean(region));
  const selectedRegion = selectedRegionId ? project.regions[selectedRegionId] : undefined;
  const hasSource = sourceAssetId !== null;

  return (
    <section aria-labelledby="irregular-slice-tools-title" className="border-t border-white/10 bg-panel/70">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-textMuted">S1 tools</p>
          <h2 id="irregular-slice-tools-title" className="mt-1 text-xs font-bold text-textMain">Irregular regions</h2>
        </div>
        <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[9px] text-textMuted">{regions.length} regions</span>
      </div>

      <div className="space-y-3 p-4">
        <div role="tablist" aria-label="Irregular region tool" className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-black/20 p-1">
          <button type="button" role="tab" aria-selected={toolMode === "wand"} onClick={() => onToolModeChange("wand")} className={`inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md text-[10px] font-bold uppercase ${toolMode === "wand" ? "bg-accent text-white" : "text-textMuted hover:bg-white/5"}`}>
            <Wand2 size={12} aria-hidden="true" /> Wand
          </button>
          <button type="button" role="tab" aria-selected={toolMode === "manual"} onClick={() => onToolModeChange("manual")} className={`inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md text-[10px] font-bold uppercase ${toolMode === "manual" ? "bg-accent text-white" : "text-textMuted hover:bg-white/5"}`}>
            <MousePointer2 size={12} aria-hidden="true" /> Manual
          </button>
        </div>

        {!hasSource ? <p className="text-[10px] leading-4 text-textMuted">Import a canonical source to activate region tools.</p> : null}

        {toolMode === "wand" ? (
          <div className="space-y-3" role="tabpanel" aria-label="Magic wand controls">
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-white/10 bg-black/20 p-1">
              {(["replace", "add", "subtract"] as const).map((mode) => (
                <button key={mode} type="button" aria-pressed={wandMode === mode} disabled={!hasSource} onClick={() => onWandModeChange(mode)} className={`min-h-8 rounded-md text-[9px] font-bold uppercase ${wandMode === mode ? "bg-accent/20 text-accent" : "text-textMuted hover:bg-white/5"}`}>
                  {mode}
                </button>
              ))}
            </div>
            <label className="block text-[10px] font-semibold text-textMuted">
              Alpha threshold <span className="font-mono text-textMain">{wandAlphaThreshold}</span>
              <input aria-label="Wand alpha threshold" type="range" min={0} max={255} value={wandAlphaThreshold} onChange={(event) => onWandAlphaThresholdChange(Number(event.target.value))} className="mt-1 w-full accent-accent" />
            </label>
            <label className="block text-[10px] font-semibold text-textMuted">
              Connectivity
              <select aria-label="Wand connectivity" value={wandConnectivity} onChange={(event) => onWandConnectivityChange(Number(event.target.value) as 4 | 8)} className="mt-1 w-full rounded-md border border-white/10 bg-input px-2 py-2 text-xs text-textMain">
                <option value={4}>4-neighbor</option>
                <option value={8}>8-neighbor</option>
              </select>
            </label>
            <div className="rounded-lg border border-white/10 bg-black/20 p-2">
              {selection.components.length > 0 ? <WandSelectionProbe selection={selection} title="Current wand selection" /> : <p className="py-6 text-center text-[10px] text-textMuted">Click the source canvas to select a component.</p>}
              <div className="mt-2 flex items-center justify-between text-[9px] text-textMuted">
                <span>{selection.components.length} selected · {selection.mask?.pixelCount ?? 0} px</span>
                <button type="button" onClick={onCancelSelection} disabled={selection.components.length === 0} className="rounded-md px-2 py-1 font-bold text-textMuted hover:bg-white/10 hover:text-textMain disabled:opacity-40">Clear</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3" role="tabpanel" aria-label="Manual region controls">
            <div className="grid grid-cols-2 gap-2">
              {(["x", "y", "width", "height"] as const).map((field) => (
                <label key={field} className="text-[9px] font-bold uppercase tracking-wider text-textMuted">
                  {field}
                  <input aria-label={`Region ${field}`} type="number" min={field === "width" || field === "height" ? 1 : 0} value={manualDraft[field]} onChange={(event) => onManualDraftChange({ [field]: numberValue(event.target.value, manualDraft[field]) })} className="mt-1 w-full rounded-md border border-white/10 bg-input px-2 py-2 text-xs text-textMain" />
                </label>
              ))}
            </div>
            <button type="button" disabled={!hasSource || busy} onClick={onCreateManual} className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 text-[10px] font-bold text-accent hover:bg-accent/15 disabled:opacity-40"><Plus size={13} aria-hidden="true" /> Create from bounds / canvas</button>
            <p className="text-[9px] leading-4 text-textMuted">Drag on the source canvas or edit exact source-space bounds.</p>
            {selectedRegion ? (
              <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-2">
                <p className="truncate text-[10px] font-bold text-textMain">{selectedRegion.name ?? selectedRegion.id}</p>
                <div className="grid grid-cols-2 gap-1">
                  <button type="button" disabled={busy} onClick={onApplyManual} className="inline-flex min-h-8 items-center justify-center gap-1 rounded-md border border-white/10 text-[9px] font-bold text-textMuted hover:bg-white/10 disabled:opacity-40"><Box size={11} aria-hidden="true" /> Apply</button>
                  <button type="button" disabled={busy} onClick={onDuplicateRegion} className="inline-flex min-h-8 items-center justify-center gap-1 rounded-md border border-white/10 text-[9px] font-bold text-textMuted hover:bg-white/10 disabled:opacity-40"><Copy size={11} aria-hidden="true" /> Duplicate</button>
                  <button type="button" disabled={busy} onClick={onToggleHidden} className="inline-flex min-h-8 items-center justify-center gap-1 rounded-md border border-white/10 text-[9px] font-bold text-textMuted hover:bg-white/10 disabled:opacity-40">{selectedRegion.hidden ? <Eye size={11} aria-hidden="true" /> : <EyeOff size={11} aria-hidden="true" />} {selectedRegion.hidden ? "Show" : "Hide"}</button>
                  <button type="button" disabled={busy} onClick={onDeleteRegion} className="inline-flex min-h-8 items-center justify-center gap-1 rounded-md border border-rose-300/20 text-[9px] font-bold text-rose-200 hover:bg-rose-300/10 disabled:opacity-40"><Trash2 size={11} aria-hidden="true" /> Delete</button>
                </div>
                <button type="button" disabled={busy} onClick={onConvertToAsset} className="inline-flex min-h-8 w-full items-center justify-center gap-1 rounded-md border border-emerald-300/20 text-[9px] font-bold text-emerald-100 hover:bg-emerald-300/10 disabled:opacity-40"><Hand size={11} aria-hidden="true" /> Convert to Asset</button>
              </div>
            ) : null}
            <div className="max-h-28 space-y-1 overflow-auto" aria-label="Region list">
              {regions.map((region) => <button key={region.id} type="button" aria-pressed={selectedRegionId === region.id} onClick={() => onSelectRegion(region.id)} className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[9px] ${selectedRegionId === region.id ? "bg-accent/15 text-accent" : "text-textMuted hover:bg-white/5"}`}><span className="truncate">{region.name ?? region.id}</span><span className="font-mono">{region.bounds.width}×{region.bounds.height}</span></button>)}
            </div>
          </div>
        )}
        {error ? <p role="alert" className="text-[10px] leading-4 text-rose-200">{error}</p> : null}
      </div>
    </section>
  );
}

export default IrregularSliceTools;
