import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
} from "lucide-react";

import type { AssetRepository } from "../../../core/assets";
import type { EntityId } from "../../../core/project";
import type { ProjectStore } from "../../../core/stores";
import { useProjectStoreSelector } from "../../../hooks/useStudioStoreSelector";
import { ComposeLayersPanel } from "../layers/ComposeLayersPanel";
import {
  ComposeCanvasStage,
  ComposeLayoutToolbar,
  resolveCompositionLayout,
} from "../layout";
import { createBlankComposition } from "./blankComposition";
import {
  importComposeAsset,
  retryComposeAssetCleanup,
  type ComposeAssetImportFailure,
} from "./importComposeAsset";

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
  readonly onOpenCanvasSettings?: () => void;
  readonly importRequestToken?: number;
  readonly disabled?: boolean;
}

type IdentityKind = "asset" | "command" | "composition" | "layer";

let identityCounter = 0;

function nextId(kind: IdentityKind): EntityId {
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

function fileList(input: FileList | null): readonly File[] {
  return input ? Array.from(input) : [];
}

function dropCell(target: EventTarget | null): number | undefined {
  if (!(target instanceof Element)) return undefined;
  const raw = target.closest<HTMLElement>("[data-compose-grid-cell]")?.dataset.composeGridCell;
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function ComposeBootstrapWorkspace({
  store,
  assets,
  onCompositionReady,
  onBusyChange,
  onCleanupDebtChange,
  onOpenCanvasSettings,
  importRequestToken = 0,
  disabled = false,
}: ComposeBootstrapWorkspaceProps) {
  const project = useProjectStoreSelector(store, (state) => state.project);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingCellRef = useRef<number | undefined>(undefined);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const importControllerRef = useRef<AbortController | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const dragDepthRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [selectedCell, setSelectedCell] = useState(0);
  const [feedback, setFeedback] = useState<{
    readonly kind: "success" | "error";
    readonly message: string;
    readonly cleanupAssetId?: EntityId;
  } | null>(null);
  const interactionDisabled = busy || disabled;

  const composition = project.workspace.selectedCompositionId
    ? project.compositions[project.workspace.selectedCompositionId]
    : undefined;
  const layers = composition
    ? composition.layerIds.flatMap((id) => {
        const layer = project.layers[id];
        return layer ? [layer] : [];
      })
    : [];

  useEffect(() => {
    if (disabled) return;
    const current = store.getSnapshot().project;
    const selectedId = current.workspace.selectedCompositionId;
    if (selectedId && current.compositions[selectedId]) return;
    const existingId = current.rootOrder.compositionIds[0];
    const issuedAt = timestamp();
    if (existingId) {
      store.dispatch({
        command: {
          type: "workspace.update",
          patch: {
            activeWorkspace: "compose",
            selectedCompositionId: existingId,
            selectedLayerId: undefined,
          },
        },
        metadata: {
          commandId: nextId("command"),
          origin: "migration",
          history: "ignore",
          issuedAt,
        },
      });
      return;
    }
    createBlankComposition(store, {
      compositionId: nextId("composition"),
      commandId: nextId("command"),
      issuedAt,
      origin: "migration",
      history: "ignore",
    });
  }, [disabled, project.rootOrder.compositionIds.length, project.workspace.selectedCompositionId, store]);

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  useEffect(() => () => {
    importControllerRef.current?.abort();
  }, [store, assets]);

  const openPicker = (cell?: number): void => {
    if (interactionDisabled) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    pendingCellRef.current = cell;
    fileInputRef.current?.click();
  };

  const handledImportRequestRef = useRef(importRequestToken);
  useEffect(() => {
    if (importRequestToken === handledImportRequestRef.current) return;
    handledImportRequestRef.current = importRequestToken;
    if (!disabled) openPicker();
  // openPicker intentionally resolves the live disabled/busy state for an external request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, importRequestToken]);

  useEffect(() => {
    if (feedback?.kind !== "error") return;
    feedbackRef.current?.focus({ preventScroll: true });
  }, [feedback]);

  useEffect(() => {
    if (feedback?.kind !== "success") return;
    const timeoutId = window.setTimeout(() => setFeedback(null), 4_000);
    return () => window.clearTimeout(timeoutId);
  }, [feedback]);

  useEffect(() => {
    if (busy || feedback?.kind !== "success") return;
    const target = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (!target?.isConnected) return;
    target.focus({ preventScroll: true });
  }, [busy, feedback]);

  const importFiles = async (files: readonly File[], requestedCell?: number): Promise<void> => {
    if (disabled || files.length === 0) return;
    importControllerRef.current?.abort();
    const controller = new AbortController();
    importControllerRef.current = controller;
    setBusy(true);
    setFeedback(null);
    let cell = requestedCell ?? selectedCell;
    let imported = 0;
    try {
      for (const file of files) {
        const snapshot = store.getSnapshot().project;
        const compositionId = snapshot.workspace.selectedCompositionId;
        const targetComposition = compositionId ? snapshot.compositions[compositionId] : undefined;
        if (!targetComposition) {
          setFeedback({ kind: "error", message: "The canvas is not ready yet. Try again." });
          return;
        }
        const layout = resolveCompositionLayout(targetComposition);
        const targetCell = layout.mode === "grid"
          ? Math.min(cell, layout.rows * layout.columns - 1)
          : undefined;
        const result = await importComposeAsset(file, {
          store,
          assets,
          nextId,
          now: timestamp,
        }, {
          signal: controller.signal,
          target: {
            compositionId: targetComposition.id,
            ...(targetCell === undefined ? {} : { cellIndex: targetCell }),
          },
        }).catch((): ComposeAssetImportFailure => ({
          ok: false,
          code: "STORAGE_FAILED",
          message: "Image import could not be completed.",
        }));
        if (controller.signal.aborted) {
          if (!result.ok && result.cleanup) {
            onCleanupDebtChange?.(assets.projectId, result.cleanup.assetId, true);
          }
          return;
        }
        if (!result.ok) {
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
        imported += 1;
        if (layout.mode === "grid") {
          cell = (targetCell! + 1) % (layout.rows * layout.columns);
          setSelectedCell(cell);
        }
        onCompositionReady?.();
      }
      if (imported > 0 && !controller.signal.aborted) {
        setFeedback({
          kind: "success",
          message: `${imported} ${imported === 1 ? "image" : "images"} added to the canvas.`,
        });
      }
    } finally {
      if (importControllerRef.current === controller) {
        importControllerRef.current = null;
        setBusy(false);
      }
      pendingCellRef.current = undefined;
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const retryCleanup = async (assetId: EntityId): Promise<void> => {
    setBusy(true);
    try {
      const result = await retryComposeAssetCleanup(assets, assetId);
      onCleanupDebtChange?.(assets.projectId, assetId, !result.ok);
      setFeedback(result.ok
        ? { kind: "success", message: "Temporary image data was removed." }
        : { kind: "error", message: result.message, cleanupAssetId: assetId });
    } finally {
      setBusy(false);
    }
  };

  const resetDrag = (): void => {
    dragDepthRef.current = 0;
    setDragActive(false);
  };

  return (
    <section
      aria-labelledby="compose-canvas-title"
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-workspace p-2 sm:p-3 md:overflow-hidden"
      data-compose-canvas-first
      onDragEnter={(event) => {
        if (interactionDisabled || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setDragActive(true);
      }}
      onDragOver={(event) => {
        if (interactionDisabled || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        const cell = dropCell(event.target);
        if (cell !== undefined) setSelectedCell(cell);
        const files = fileList(event.dataTransfer.files);
        resetDrag();
        if (!interactionDisabled) void importFiles(files, cell);
      }}
    >
      <div className="mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 flex-col overflow-hidden rounded-lg border border-white/10 bg-panel/70 shadow-xl">
        <header className="flex min-h-12 shrink-0 items-center gap-3 border-b border-white/10 px-3">
          <div className="min-w-0">
            <h1 id="compose-canvas-title" className="truncate text-sm font-semibold tracking-tight text-textMain">
              {composition?.name ?? "Preparing canvas…"}
            </h1>
            <p className="font-mono text-[9px] text-textMuted">
              {composition ? `${composition.layerIds.length} ${composition.layerIds.length === 1 ? "layer" : "layers"}` : "Local project"}
            </p>
          </div>
          <span className="ml-auto hidden text-[10px] text-textMuted sm:block">Drop images anywhere on the canvas</span>
          {interactionDisabled ? <LoaderCircle size={14} className="animate-spin text-textMuted" aria-label="Importing image" /> : null}
        </header>

        {composition ? (
          <ComposeLayoutToolbar
            store={store}
            composition={composition}
            selectedCell={selectedCell}
            busy={interactionDisabled}
            onSelectedCellChange={setSelectedCell}
            onImport={() => openPicker(selectedCell)}
            onOpenCanvasSettings={onOpenCanvasSettings}
          />
        ) : null}

        {feedback ? (
          <div
            ref={feedbackRef}
            tabIndex={feedback.kind === "error" ? -1 : undefined}
            role={feedback.kind === "error" ? "alert" : "status"}
            aria-live={feedback.kind === "error" ? "assertive" : "polite"}
            aria-label={feedback.message}
            className={`flex shrink-0 items-center gap-2 border-b px-3 py-2 text-[10px] ${feedback.kind === "error" ? "border-red-400/25 bg-red-400/10 text-red-100" : "border-emerald-400/25 bg-emerald-400/10 text-emerald-100"}`}
          >
            {feedback.kind === "error" ? <AlertTriangle size={13} aria-hidden="true" /> : <CheckCircle2 size={13} aria-hidden="true" />}
            <span className="min-w-0 flex-1">{feedback.message}</span>
            {feedback.cleanupAssetId ? (
              <button
                type="button"
                disabled={interactionDisabled}
                onClick={() => void retryCleanup(feedback.cleanupAssetId as EntityId)}
                className="rounded-md border border-current/30 px-2 py-1 font-semibold hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current disabled:opacity-50"
              >
                Retry cleanup
              </button>
            ) : null}
            {feedback.kind === "error" ? (
              <button
                type="button"
                disabled={interactionDisabled}
                onClick={() => openPicker(selectedCell)}
                className="rounded-md border border-current/30 px-2 py-1 font-semibold hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current disabled:opacity-50"
              >
                Choose another
              </button>
            ) : null}
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label="Import images into Compose"
          disabled={interactionDisabled}
          onChange={(event) => void importFiles(fileList(event.currentTarget.files), pendingCellRef.current)}
        />

        {composition ? (
          <div data-compose-canvas className="grid min-h-[420px] flex-1 overflow-hidden md:min-h-0 md:grid-cols-[minmax(0,1fr)_17rem]">
            <ComposeCanvasStage
              store={store}
              assets={assets}
              composition={composition}
              layers={layers}
              selectedCell={selectedCell}
              dragActive={dragActive}
              disabled={interactionDisabled}
              onSelectedCellChange={setSelectedCell}
              onImport={openPicker}
            />
            <ComposeLayersPanel store={store} disabled={interactionDisabled} />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-textMuted" role="status">Preparing blank canvas…</div>
        )}
      </div>
    </section>
  );
}

export default ComposeBootstrapWorkspace;
