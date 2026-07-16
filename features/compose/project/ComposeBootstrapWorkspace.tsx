import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  Upload,
} from "lucide-react";
import type { AssetRepository } from "../../../core/assets";
import type { EntityId } from "../../../core/project";
import type { ProjectStore } from "../../../core/stores";
import { useProjectStoreSelector } from "../../../hooks/useStudioStoreSelector";
import {
  importComposeAsset,
  retryComposeAssetCleanup,
  type ComposeAssetImportFailure,
} from "./importComposeAsset";
import { openCompositionFromSource, type CompositionEntrySource } from "./compositionEntry";

export interface ComposeBootstrapWorkspaceProps {
  readonly store: ProjectStore;
  readonly assets: AssetRepository;
  readonly onCompositionReady?: () => void;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly onCleanupDebtChange?: (
    projectId: EntityId,
    assetId: EntityId,
    pending: boolean,
  ) => void;
  readonly importRequestToken?: number;
  readonly disabled?: boolean;
}

let identityCounter = 0;

function nextId(kind: "asset" | "command"): EntityId {
  identityCounter += 1;
  try {
    const value = globalThis.crypto?.randomUUID?.();
    if (value) return `${kind}-${value}`;
  } catch {
    // The document-local monotonic fallback remains collision resistant.
  }
  return `${kind}-${Date.now().toString(36)}-${identityCounter.toString(36)}`;
}

function timestamp(): string {
  return new Date().toISOString();
}

function sourceLabel(source: CompositionEntrySource): string {
  return source.type === "asset" ? "Asset" : "Region";
}

export function ComposeBootstrapWorkspace({
  store,
  assets,
  onCompositionReady,
  onBusyChange,
  onCleanupDebtChange,
  importRequestToken = 0,
  disabled = false,
}: ComposeBootstrapWorkspaceProps) {
  const project = useProjectStoreSelector(store, (state) => state.project);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const importControllerRef = useRef<AbortController | null>(null);
  const cleanupDebtRef = useRef<EntityId | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [feedback, setFeedback] = useState<{
    readonly kind: "success" | "error";
    readonly message: string;
    readonly cleanupAssetId?: EntityId;
  } | null>(null);
  const interactionDisabled = busy || disabled;

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  const composition = project.workspace.selectedCompositionId
    ? project.compositions[project.workspace.selectedCompositionId]
    : undefined;
  const sources = useMemo<ReadonlyArray<{
    readonly source: CompositionEntrySource;
    readonly name: string;
    readonly dimensions: string;
  }>>(() => [
    ...project.rootOrder.assetIds.flatMap((id) => {
      const asset = project.assets[id];
      return asset ? [{
        source: { type: "asset" as const, id },
        name: asset.name,
        dimensions: `${asset.width} × ${asset.height}`,
      }] : [];
    }),
    ...project.rootOrder.regionIds.flatMap((id) => {
      const region = project.regions[id];
      return region ? [{
        source: { type: "region" as const, id },
        name: region.name?.trim() || `Region ${project.rootOrder.regionIds.indexOf(id) + 1}`,
        dimensions: `${region.bounds.width} × ${region.bounds.height}`,
      }] : [];
    }),
  ], [project]);

  useEffect(() => () => {
    importControllerRef.current?.abort();
  }, [store, assets]);

  const handledImportRequestRef = useRef(importRequestToken);
  useEffect(() => {
    if (importRequestToken === handledImportRequestRef.current) return;
    handledImportRequestRef.current = importRequestToken;
    if (disabled) return;
    fileInputRef.current?.click();
  }, [disabled, importRequestToken]);

  useEffect(() => {
    if (!feedback) return;
    feedbackRef.current?.focus({ preventScroll: true });
  }, [feedback]);

  const importFile = async (file: File): Promise<void> => {
    if (disabled) return;
    importControllerRef.current?.abort();
    const controller = new AbortController();
    importControllerRef.current = controller;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await importComposeAsset(file, {
          store,
          assets,
          nextId,
          now: timestamp,
        }, { signal: controller.signal })
        .catch((): ComposeAssetImportFailure => ({
          ok: false as const,
          code: "STORAGE_FAILED" as const,
          message: "Image import could not be completed.",
        }));
      if (controller.signal.aborted) {
        if (!result.ok && result.cleanup) {
          onCleanupDebtChange?.(assets.projectId, result.cleanup.assetId, true);
        }
        return;
      }
      if (!result.ok) {
        cleanupDebtRef.current = result.cleanup?.assetId ?? null;
        if (result.cleanup) {
          onCleanupDebtChange?.(assets.projectId, result.cleanup.assetId, true);
        }
        setFeedback({
          kind: "error",
          message: result.message,
          ...(result.cleanup ? { cleanupAssetId: result.cleanup.assetId } : {}),
        });
        return;
      }
      setFeedback({
        kind: "success",
        message: `${result.assetName} is ready as a ${result.dimensions.width} × ${result.dimensions.height} composition.`,
      });
      onCompositionReady?.();
    } finally {
      if (importControllerRef.current === controller) {
        importControllerRef.current = null;
        setBusy(false);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const retryCleanup = async (assetId: EntityId): Promise<void> => {
    setBusy(true);
    try {
      const result = await retryComposeAssetCleanup(assets, assetId);
      cleanupDebtRef.current = result.ok ? null : assetId;
      onCleanupDebtChange?.(assets.projectId, assetId, !result.ok);
      setFeedback(result.ok
        ? { kind: "success", message: "Temporary image data was removed." }
        : {
            kind: "error",
            message: result.message,
            cleanupAssetId: assetId,
          });
    } finally {
      setBusy(false);
    }
  };

  const openSource = (source: CompositionEntrySource): void => {
    if (disabled) return;
    setFeedback(null);
    const result = openCompositionFromSource(store, {
      source,
      commandId: nextId("command"),
      issuedAt: timestamp(),
    });
    if (!result.ok) {
      setFeedback({ kind: "error", message: result.message });
      return;
    }
    setFeedback({
      kind: "success",
      message: `${sourceLabel(source)} opened in Compose.`,
    });
    onCompositionReady?.();
  };

  return (
    <section
      aria-labelledby="compose-bootstrap-title"
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-workspace p-4 sm:p-6"
      onDragEnter={(event) => {
        if (interactionDisabled) return;
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => {
        if (interactionDisabled) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        const file = event.dataTransfer.files.item(0);
        if (file && !interactionDisabled) void importFile(file);
      }}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-textMuted">
              Compose workspace
            </p>
            <h1 id="compose-bootstrap-title" className="text-xl font-bold tracking-tight text-textMain">
              {composition ? composition.name : "Start a composition"}
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-textMuted">
              {composition
                ? `${composition.width} × ${composition.height} · ${composition.layerIds.length} ${composition.layerIds.length === 1 ? "layer" : "layers"}`
                : "Import an image or open a canonical Asset or Region. SpriteBoy creates the first layer without duplicating source bytes."}
            </p>
          </div>
          <button
            type="button"
            disabled={interactionDisabled}
            onClick={() => fileInputRef.current?.click()}
            className="btn-primary inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-55"
          >
            {busy || disabled ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}
            {disabled ? "Loading project…" : busy ? "Importing…" : composition ? "Import another image" : "Import image"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label="Import image into Compose"
            disabled={interactionDisabled}
            onChange={(event) => {
              const file = event.currentTarget.files?.item(0);
              if (file) void importFile(file);
            }}
          />
        </div>

        <div
          className={[
            "rounded-2xl border border-dashed p-4 transition-colors sm:p-5",
            dragActive ? "border-accent bg-accent/10" : "border-white/15 bg-panel/55",
          ].join(" ")}
        >
          {sources.length === 0 ? (
            <button
              type="button"
              disabled={interactionDisabled}
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-48 w-full flex-col items-center justify-center rounded-xl text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-surface text-accent">
                <ImageIcon size={25} aria-hidden="true" />
              </span>
              <span className="text-sm font-bold text-textMain">Drop a PNG, JPEG or WebP</span>
              <span className="mt-1 text-[11px] text-textMuted">Up to 10 MB · decoded dimensions are validated</span>
            </button>
          ) : (
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-textMain">
                  <Layers3 size={15} className="text-accent" aria-hidden="true" />
                  Project sources
                </div>
                <span className="font-mono text-[10px] text-textMuted">{sources.length}</span>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {sources.map((item) => (
                  <li key={`${item.source.type}:${item.source.id}`}>
                    <button
                      type="button"
                      disabled={interactionDisabled}
                      onClick={() => openSource(item.source)}
                      className="group flex min-h-20 w-full items-center gap-3 rounded-xl border border-white/10 bg-surface p-3 text-left transition-colors hover:border-accent/50 hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black/25 text-textMuted group-hover:text-accent">
                        <ImageIcon size={17} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-bold text-textMain">{item.name}</span>
                        <span className="mt-1 block font-mono text-[9px] uppercase tracking-wider text-textMuted">
                          {sourceLabel(item.source)} · {item.dimensions}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {composition ? (
          <div className="flex items-start gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-emerald-100">
            <CheckCircle2 size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-xs font-bold">Composition graph ready</p>
              <p className="mt-0.5 text-[10px] leading-4 text-emerald-100/75">
                The selected source, layer order and canvas settings now live in the canonical project.
              </p>
            </div>
          </div>
        ) : null}

        {feedback ? (
          <div
            ref={feedbackRef}
            tabIndex={-1}
            role={feedback.kind === "error" ? "alert" : "status"}
            aria-label={feedback.message}
            className={[
              "flex items-start gap-2 rounded-xl border p-3 text-xs",
              feedback.kind === "error"
                ? "border-red-400/30 bg-red-400/10 text-red-100"
                : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
            ].join(" ")}
          >
            {feedback.kind === "error"
              ? <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              : <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden="true" />}
            <span className="min-w-0 flex-1">{feedback.message}</span>
            {feedback.cleanupAssetId ? (
              <button
                type="button"
                disabled={interactionDisabled}
                onClick={() => void retryCleanup(feedback.cleanupAssetId as EntityId)}
                className="shrink-0 rounded-md border border-current/30 px-2 py-1 text-[10px] font-bold hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current disabled:opacity-50"
              >
                Retry cleanup
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default ComposeBootstrapWorkspace;
