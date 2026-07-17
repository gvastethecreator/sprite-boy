import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, FileArchive, LoaderCircle, X } from "lucide-react";
import type { AssetRepository } from "../../../core/assets";
import type { DeepReadonly } from "../../../core/stores";
import type { EntityId, StudioProjectV1 } from "../../../core/project";
import {
  createBrowserDownloadWriter,
  createGridExportPort,
  createGridExportRequest,
  GRID_EXPORT_FORMATS,
  resolveGridExportBundle,
  resolveGridRegionBlob,
} from "./gridExport";

export interface GridExportCenterProps {
  readonly project: DeepReadonly<StudioProjectV1>;
  readonly revision: number;
  readonly repository: AssetRepository;
  readonly onOpenCompose: (regionId: EntityId) => void;
  readonly onToast: (message: string, type?: "success" | "error" | "info") => void;
}

function identity(prefix: string): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return `${prefix}-${globalThis.crypto.randomUUID()}`;
    }
  } catch {
    // Timestamp fallback remains unique enough for one export interaction.
  }
  return `${prefix}-${Date.now().toString(36)}`;
}

export function GridExportCenter({ project, revision, repository, onOpenCompose, onToast }: GridExportCenterProps) {
  const controllerRef = useRef<AbortController | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<EntityId | null>(
    () => project.rootOrder.regionIds[0] ?? null,
  );
  const [busy, setBusy] = useState<"one" | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => {
    controllerRef.current?.abort();
  }, []);
  useEffect(() => {
    // The export route can survive a project replacement. Abort work tied to
    // the previous graph/repository before the new props become interactive.
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(null);
    setError(null);
  }, [project.id, repository]);
  const regions = useMemo(
    () => project.rootOrder.regionIds.map((id) => project.regions[id]).filter((region): region is NonNullable<typeof region> => Boolean(region)),
    [project.regions, project.rootOrder.regionIds],
  );
  useEffect(() => {
    setSelectedRegionId((current) => current && project.regions[current]
      ? current
      : project.rootOrder.regionIds[0] ?? null);
  }, [project.regions, project.rootOrder.regionIds]);
  const selected = selectedRegionId ? project.regions[selectedRegionId] : undefined;

  const cancel = () => controllerRef.current?.abort();

  const exportOne = async () => {
    if (!selected || busy) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy("one");
    setError(null);
    try {
      const region = await resolveGridRegionBlob(project, repository, selected.id, controller.signal);
      const port = createGridExportPort(createBrowserDownloadWriter());
      await port.run(createGridExportRequest(
        project,
        revision,
        GRID_EXPORT_FORMATS.png,
        region.name ?? "Slice",
        { kind: "single", region },
        { requestId: identity("export"), artifactId: identity("artifact") },
        controller.signal,
      ));
      onToast(`${region.name} exported as PNG.`, "success");
    } catch (cause) {
      if (!controller.signal.aborted && controllerRef.current === controller) {
        const message = cause instanceof Error ? cause.message : "The selected region could not be exported.";
        setError(message);
        onToast(message, "error");
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setBusy(null);
      }
    }
  };

  const exportAll = async () => {
    if (regions.length === 0 || busy) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy("all");
    setError(null);
    try {
      const bundle = await resolveGridExportBundle(project, repository, revision, controller.signal);
      const port = createGridExportPort(createBrowserDownloadWriter());
      await port.run(createGridExportRequest(
        project,
        revision,
        GRID_EXPORT_FORMATS.zip,
        project.name || "grid-slices",
        { kind: "bundle", bundle },
        { requestId: identity("export"), artifactId: identity("artifact") },
        controller.signal,
      ));
      onToast(`${bundle.regions.length} slices exported with manifest.`, "success");
    } catch (cause) {
      if (!controller.signal.aborted && controllerRef.current === controller) {
        const message = cause instanceof Error ? cause.message : "The Grid package could not be exported.";
        setError(message);
        onToast(message, "error");
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setBusy(null);
      }
    }
  };

  return (
    <section data-grid-export-center aria-labelledby="grid-export-title" className="flex h-full min-h-0 flex-col bg-workspace p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-5xl min-h-0 flex-1 flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-textMuted">Export Center</p>
            <h1 id="grid-export-title" className="mt-1 text-xl font-bold tracking-tight text-textMain">Grid slices</h1>
            <p className="mt-1 text-xs leading-5 text-textMuted">Download one PNG or a ZIP with manifest and provenance.</p>
          </div>
          <div className="flex items-center gap-2">
            {busy ? (
              <button type="button" onClick={cancel} aria-label="Cancel export" className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-rose-300/30 bg-rose-300/10 px-3 text-xs font-bold text-rose-100 hover:bg-rose-300/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">
                <X size={13} aria-hidden="true" /> Cancel
              </button>
            ) : null}
            <button type="button" aria-label="Export ZIP" onClick={() => void exportAll()} disabled={regions.length === 0 || busy !== null} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-3 text-xs font-bold text-accent hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              {busy === "all" ? <LoaderCircle size={13} className="animate-spin" aria-hidden="true" /> : <FileArchive size={13} aria-hidden="true" />}
              Export ZIP
            </button>
          </div>
        </header>

        {regions.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 bg-panel/40 p-8 text-center text-sm text-textMuted">
            Commit Grid slices in Slice before exporting.
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-h-0 overflow-auto rounded-xl border border-white/10 bg-panel/50 p-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {regions.map((region, index) => {
                  const active = selectedRegionId === region.id;
                  return (
                    <button
                      type="button"
                      key={region.id}
                      aria-label={`Export region ${index + 1}: ${region.name}`}
                      aria-pressed={active}
                      onClick={() => setSelectedRegionId(region.id)}
                      className={["rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent", active ? "border-accent/60 bg-accent/10" : "border-white/10 bg-surface/60 hover:border-white/20"].join(" ")}
                    >
                      <span className="flex aspect-square items-center justify-center rounded-md border border-white/10 bg-black/30 text-xs font-bold text-textMuted">#{String(index + 1).padStart(2, "0")}</span>
                      <span className="mt-2 block truncate text-xs font-semibold text-textMain">{region.name}</span>
                      <span className="mt-1 block font-mono text-[9px] text-textMuted">{region.bounds.width}×{region.bounds.height}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <aside className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-panel/70 p-4">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-textMuted">Selected region</p>
              <h2 className="mt-2 truncate text-base font-bold text-textMain">{selected?.name ?? "None"}</h2>
              <p className="mt-1 text-xs text-textMuted">{selected ? `${selected.bounds.width}×${selected.bounds.height}px` : "Choose a tile"}</p>
              <div className="mt-auto grid gap-2 pt-6">
                <button type="button" aria-label="Download PNG" onClick={() => void exportOne()} disabled={!selected || busy !== null} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-white/15 bg-surface px-3 text-xs font-bold text-textMain hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  {busy === "one" ? <LoaderCircle size={13} className="animate-spin" aria-hidden="true" /> : <Download size={13} aria-hidden="true" />}
                  Download PNG
                </button>
                <button type="button" aria-label="Open in Compose" onClick={() => selected && onOpenCompose(selected.id)} disabled={!selected || busy !== null} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-3 text-xs font-bold text-emerald-100 hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
                  <ExternalLink size={13} aria-hidden="true" /> Open in Compose
                </button>
              </div>
              {error ? <p role="alert" className="mt-3 text-[10px] leading-4 text-rose-200">{error}</p> : null}
            </aside>
          </div>
        )}
      </div>
    </section>
  );
}

export default GridExportCenter;
