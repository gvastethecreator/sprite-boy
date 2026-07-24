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
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-workspace p-4 sm:p-5"
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
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 id="compose-bootstrap-title" className="truncate text-lg font-semibold tracking-tight text-textMain">
              {composition ? composition.name : "Start a composition"}
            </h1>
            {composition ? (
              <p className="mt-0.5 font-mono text-[11px] text-textMuted">
                {composition.width} × {composition.height} · {composition.layerIds.length} {composition.layerIds.length === 1 ? "layer" : "layers"}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={interactionDisabled}
            onClick={() => fileInputRef.current?.click()}
            className="btn-primary inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-md px-3.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-55"
          >
            {busy || disabled ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />}
            {disabled ? "Loading…" : busy ? "Importing…" : composition ? "Import image" : "Import image"}
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
            "rounded-lg border border-dashed p-3 transition-colors sm:p-4",
            dragActive ? "border-accent bg-accent/10" : "border-white/12 bg-panel/70",
          ].join(" ")}
        >
          {sources.length === 0 ? (
            <button
              type="button"
              disabled={interactionDisabled}
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-40 w-full flex-col items-center justify-center rounded-md text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-surface text-textMain">
                <ImageIcon size={20} aria-hidden="true" />
              </span>
              <span className="text-sm font-semibold text-textMain">Drop PNG, JPEG or WebP</span>
            </button>
          ) : (
            <div>
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-textMain">
                  <Layers3 size={14} className="text-textMuted" aria-hidden="true" />
                  Sources
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
                      className="group flex min-h-16 w-full items-center gap-2.5 rounded-md border border-white/10 bg-surface p-2.5 text-left transition-colors hover:border-white/20 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-black/25 text-textMuted group-hover:text-textMain">
                        <ImageIcon size={16} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-textMain">{item.name}</span>
                        <span className="mt-0.5 block font-mono text-[10px] text-textMuted">
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
          <div className="flex items-center gap-2 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-emerald-100">
            <CheckCircle2 size={15} className="shrink-0" aria-hidden="true" />
            <p className="text-xs font-semibold">Composition graph ready</p>
          </div>
        ) : null}

        {feedback ? (
          <div
            ref={feedbackRef}
            tabIndex={-1}
            role={feedback.kind === "error" ? "alert" : "status"}
            aria-label={feedback.message}
            className={[
              "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
              feedback.kind === "error"
                ? "border-red-400/30 bg-red-400/10 text-red-100"
                : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
            ].join(" ")}
          >
            {feedback.kind === "error"
              ? <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              : <CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
            <span className="min-w-0 flex-1">{feedback.message}</span>
            {feedback.cleanupAssetId ? (
              <button
                type="button"
                disabled={interactionDisabled}
                onClick={() => void retryCleanup(feedback.cleanupAssetId as EntityId)}
                className="shrink-0 rounded-md border border-current/30 px-2 py-1 text-[10px] font-semibold hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current disabled:opacity-50"
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
