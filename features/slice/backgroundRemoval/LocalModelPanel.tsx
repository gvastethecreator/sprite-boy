import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, Download, LoaderCircle, Play, RefreshCw, Save, X } from "lucide-react";
import { SegmentedControl, SelectControl } from "../../../components/toolcraft";
import type { AssetRepository } from "../../../core/assets";
import { createQueuedJob, JobTaskError, type JobRunHandle, type JobSnapshot } from "../../../core/processing";
import type { LocalModelId, LocalModelServiceSummary } from "../../../core/models";
import { LocalModelServiceError, type LocalModelServiceSnapshot } from "../../../core/models";
import type { ProjectStore } from "../../../core/stores";
import { useStudioJobRunner } from "../../../contexts/StudioStoreContext";
import { useProjectStoreSelector } from "../../../hooks/useStudioStoreSelector";
import { useStudioControlBridge } from "../../control/StudioControlBridgeProvider";
import {
  BackgroundRemovalCommitError,
  commitBackgroundRemoval,
} from "./commitBackgroundRemoval";
import {
  BackgroundRemovalRuntimeError,
  runBackgroundRemoval,
} from "./runBackgroundRemoval";
import {
  getBackgroundRemovalBrowserBackend,
  isRunnableBackgroundRemovalModelId,
  type BackgroundRemovalBrowserBackend,
} from "./backgroundRemovalProtocol";

export interface LocalModelPanelProps {
  readonly store: ProjectStore;
  readonly assets: AssetRepository;
  readonly onCleanupDebtChange?: (projectId: string, assetId: string, pending: boolean) => void;
}

interface BackgroundRemovalPreview {
  readonly sourceAssetId: string;
  readonly sourceName: string;
  readonly expectedRevision: number;
  readonly width: number;
  readonly height: number;
  readonly output: Blob;
  readonly model: LocalModelServiceSummary;
  readonly backend: BackgroundRemovalBrowserBackend;
  readonly urls: {
    readonly source: string;
    readonly mask: string;
    readonly output: string;
  };
}

type BackgroundRemovalReviewView = "source" | "mask" | "output";

const REVIEW_VIEW_OPTIONS = Object.freeze([
  { value: "source", label: "Source" },
  { value: "mask", label: "Mask" },
  { value: "output", label: "Alpha" },
]);

const REVIEW_VIEW_LABELS: Readonly<Record<BackgroundRemovalReviewView, string>> = Object.freeze({
  source: "Source",
  mask: "Mask",
  output: "Alpha",
});

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 MB";
  return `${(value / 1_048_576).toFixed(value >= 104_857_600 ? 0 : 1)} MB`;
}

function safeMessage(error: unknown): string {
  return error instanceof LocalModelServiceError
    || error instanceof BackgroundRemovalRuntimeError
    || error instanceof BackgroundRemovalCommitError
    ? error.message
    : "Background removal failed.";
}

function releasePreview(preview: BackgroundRemovalPreview | null): void {
  if (!preview) return;
  URL.revokeObjectURL(preview.urls.source);
  URL.revokeObjectURL(preview.urls.mask);
  URL.revokeObjectURL(preview.urls.output);
}

function terminal(job: JobSnapshot): boolean {
  return job.status !== "queued" && job.status !== "running";
}

export function LocalModelPanel({ assets, onCleanupDebtChange, store }: LocalModelPanelProps) {
  const bridge = useStudioControlBridge();
  const jobRunner = useStudioJobRunner();
  const selectedAssetId = useProjectStoreSelector(store, (state) => state.project.workspace.selectedAssetId ?? null);
  const selectedAsset = useProjectStoreSelector(store, (state) => (
    selectedAssetId ? state.project.assets[selectedAssetId] ?? null : null
  ));
  const projectRevision = useProjectStoreSelector(store, (state) => state.revision);
  const [snapshot, setSnapshot] = useState<LocalModelServiceSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<LocalModelId>("birefnet-lite-512");
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inferenceProgress, setInferenceProgress] = useState<{ ratio: number; message: string } | null>(null);
  const [preview, setPreview] = useState<BackgroundRemovalPreview | null>(null);
  const [reviewView, setReviewView] = useState<BackgroundRemovalReviewView>("output");
  const [accepting, setAccepting] = useState(false);
  const inferenceRef = useRef<JobRunHandle<{
    readonly source: Blob;
    readonly output: Blob;
    readonly mask: Blob;
    readonly width: number;
    readonly height: number;
    readonly backend: BackgroundRemovalBrowserBackend;
  }> | null>(null);
  const previewRef = useRef<BackgroundRemovalPreview | null>(null);
  const inferenceRevisionRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const discardPreview = useCallback(() => {
    releasePreview(previewRef.current);
    previewRef.current = null;
    if (mountedRef.current) setPreview(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      inferenceRef.current?.cancel("Background removal panel closed.");
      inferenceRef.current = null;
      inferenceRevisionRef.current = null;
      releasePreview(previewRef.current);
      previewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const active = inferenceRef.current;
    if (active) active.cancel("Source image changed.");
    inferenceRef.current = null;
    inferenceRevisionRef.current = null;
    setInferenceProgress(null);
    setNotice(null);
    discardPreview();
  }, [discardPreview, selectedAssetId, selectedId]);

  useEffect(() => {
    if (
      inferenceRef.current
      && inferenceRevisionRef.current !== null
      && inferenceRevisionRef.current !== projectRevision
    ) {
      inferenceRef.current.cancel("The project changed during background removal.");
      inferenceRef.current = null;
      inferenceRevisionRef.current = null;
      setInferenceProgress(null);
      setError("The project changed during background removal. Run it again.");
    }
    const currentPreview = previewRef.current;
    if (currentPreview && currentPreview.expectedRevision !== projectRevision && !accepting) {
      discardPreview();
      setNotice(null);
      setError("The project changed after this preview was made. Run it again.");
    }
  }, [accepting, discardPreview, projectRevision]);

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const models = bridge.models;
    if (!models) {
      setSnapshot(null);
      setJob(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await models.list(signal);
      setSnapshot(next);
      const selected = next.models.find((model) => model.id === selectedId);
      setJob(selected?.job ?? null);
    } catch (reason) {
      if (!signal?.aborted) setError(safeMessage(reason));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [bridge.models, selectedId]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (!bridge.models || !job || terminal(job)) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const next = await bridge.models?.getJob(job.id, controller.signal);
        if (!next || disposed) return;
        setJob(next);
        if (terminal(next)) {
          await refresh(controller.signal);
          return;
        }
        timer = setTimeout(() => void poll(), 500);
      } catch (reason) {
        if (!disposed && !controller.signal.aborted) setError(safeMessage(reason));
      }
    };
    timer = setTimeout(() => void poll(), 250);
    return () => {
      disposed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [bridge.models, job?.id, job?.status, refresh]);

  const selected = snapshot?.models.find((model) => model.id === selectedId) ?? null;
  const options = useMemo(() => snapshot?.models.map((model) => ({
    value: model.id,
    label: model.label,
  })) ?? [
    { value: "birefnet-lite-512", label: "BiRefNet Lite 512" },
    { value: "ben2-base", label: "BEN2 Base" },
    { value: "rmbg-2.0", label: "RMBG 2.0" },
  ], [snapshot]);
  const connected = bridge.snapshot.status === "connected" && bridge.models !== null;
  const setupRunning = Boolean(job && !terminal(job));
  const inferenceRunning = inferenceProgress !== null;
  const sourceReady = selectedAsset?.media.type === "image";
  const selectedBackend = selected && isRunnableBackgroundRemovalModelId(selected.id)
    ? getBackgroundRemovalBrowserBackend(selected.id)
    : null;
  const webGpuReady = selectedBackend !== "webgpu-wasm"
    || (typeof navigator === "object" && "gpu" in navigator && navigator.gpu !== undefined);
  const browserRuntimeReady = typeof Worker === "function"
    && typeof OffscreenCanvas === "function"
    && typeof createImageBitmap === "function"
    && typeof WebAssembly === "object"
    && webGpuReady;
  const capacityBlocksInference = selected?.capacity.problems.some((problem) => (
    problem === "backend-unavailable" || problem === "memory-insufficient"
  )) ?? false;
  const inferenceReady = selected?.status.state === "ready"
    && isRunnableBackgroundRemovalModelId(selected.id)
    && sourceReady
    && browserRuntimeReady
    && !capacityBlocksInference;

  const startSetup = async () => {
    if (!bridge.models || setupRunning) return;
    setLoading(true);
    setError(null);
    try {
      const result = await bridge.models.setup(selectedId);
      setJob(result.job);
      if (result.outcome === "ready") await refresh();
    } catch (reason) {
      setError(safeMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  const cancel = async () => {
    if (!bridge.models || !job || terminal(job)) return;
    setLoading(true);
    try {
      setJob(await bridge.models.cancelJob(job.id));
      await refresh();
    } catch (reason) {
      setError(safeMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  const startInference = async () => {
    if (
      !bridge.models || !selected || !selectedAsset || !selectedAssetId
    ) return;
    const modelId = selected.id;
    if (
      !inferenceReady || !isRunnableBackgroundRemovalModelId(modelId)
      || inferenceRunning || inferenceRef.current || accepting
    ) return;
    const models = bridge.models;
    discardPreview();
    setError(null);
    setNotice(null);
    const requestId = `background-removal-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
    const jobId = `job-${requestId}`;
    const expectedRevision = projectRevision;
    const sourceName = selectedAsset.name;
    const model = selected;
    setInferenceProgress({ ratio: 0, message: "Queued" });
    let handle: JobRunHandle<{
      readonly source: Blob;
      readonly output: Blob;
      readonly mask: Blob;
      readonly width: number;
      readonly height: number;
      readonly backend: BackgroundRemovalBrowserBackend;
    }>;
    try {
      handle = jobRunner.run(createQueuedJob({
        id: jobId,
        requestId,
        kind: "model.background-removal",
        label: `Remove background · ${sourceName}`,
        createdAt: new Date().toISOString(),
        timeoutMs: 6 * 60_000,
      }), async ({ reportProgress, signal }) => {
        try {
          reportProgress({ ratio: 0.02, phase: "source", message: "Reading source image" });
          if (mountedRef.current) setInferenceProgress({ ratio: 0.02, message: "Reading source image" });
          const source = await assets.getBlob(selectedAssetId, { signal });
          reportProgress({ ratio: 0.08, phase: "weights", message: "Reading verified model weights" });
          if (mountedRef.current) setInferenceProgress({ ratio: 0.08, message: "Reading verified model weights" });
          const weights = await models.getWeights(modelId, signal);
          reportProgress({ ratio: 0.15, phase: "runtime", message: "Starting local model" });
          if (mountedRef.current) setInferenceProgress({ ratio: 0.15, message: "Starting local model" });
          const result = await runBackgroundRemoval({
            requestId,
            modelId,
            source,
            weights,
            signal,
            onProgress: (next) => {
              const ratio = Math.min(0.98, 0.15 + next.ratio * 0.83);
              reportProgress({ ratio, phase: next.phase, message: next.message });
              if (mountedRef.current) setInferenceProgress({ ratio, message: next.message });
            },
          });
          return {
            source,
            output: result.output,
            mask: result.mask,
            width: result.width,
            height: result.height,
            backend: result.backend,
          };
        } catch (reason) {
          throw new JobTaskError("runtime-failure", safeMessage(reason), false);
        }
      });
    } catch (reason) {
      setInferenceProgress(null);
      setError(safeMessage(reason));
      return;
    }
    inferenceRef.current = handle;
    inferenceRevisionRef.current = expectedRevision;
    const result = await handle.result;
    if (!mountedRef.current || inferenceRef.current !== handle) return;
    inferenceRef.current = null;
    inferenceRevisionRef.current = null;
    setInferenceProgress(null);
    if (result.status === "succeeded") {
      const urls = {
        source: URL.createObjectURL(result.value.source),
        mask: URL.createObjectURL(result.value.mask),
        output: URL.createObjectURL(result.value.output),
      };
      const nextPreview = {
        sourceAssetId: selectedAssetId,
        sourceName,
        expectedRevision,
        width: result.value.width,
        height: result.value.height,
        output: result.value.output,
        model,
        backend: result.value.backend,
        urls,
      };
      previewRef.current = nextPreview;
      setPreview(nextPreview);
      setReviewView("output");
      setNotice("Review the source, mask and alpha result before saving.");
    } else if (result.status === "failed") {
      setError(result.job.error?.message ?? "Background removal failed.");
    }
  };

  const cancelInference = () => {
    inferenceRef.current?.cancel("Background removal cancelled.");
  };

  const rejectPreview = () => {
    discardPreview();
    setNotice("Result rejected. The project was not changed.");
  };

  const acceptPreview = async () => {
    if (!preview || accepting) return;
    setAccepting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await commitBackgroundRemoval({
        store,
        repository: assets,
        sourceAssetId: preview.sourceAssetId,
        expectedRevision: preview.expectedRevision,
        output: preview.output,
        width: preview.width,
        height: preview.height,
        model: {
          id: preview.model.id,
          repositoryId: preview.model.repositoryId,
          revision: preview.model.revision,
          backend: preview.backend,
          inputWidth: preview.model.runtime.inputWidth,
          inputHeight: preview.model.runtime.inputHeight,
        },
        onCleanupDebtChange,
      });
      discardPreview();
      if (mountedRef.current) setNotice(`Saved ${result.asset.name}.`);
    } catch (reason) {
      if (mountedRef.current) setError(safeMessage(reason));
    } finally {
      if (mountedRef.current) setAccepting(false);
    }
  };

  return (
    <section aria-label="Local background removal models" className="flex h-full min-h-0 flex-col bg-panel-gradient text-textMain">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-white/8 bg-panelHeader/95 px-3">
        <h2 className="text-[11px] font-semibold tracking-wide">Background removal</h2>
        <button type="button" aria-label="Refresh local model status" disabled={!connected || loading} className="rounded p-1.5 text-textMuted hover:bg-white/10 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-35" onClick={() => void refresh()}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} aria-hidden="true" />
        </button>
      </div>
      <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-3">
        {!connected ? (
          <div className="space-y-2 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-[10px] leading-relaxed text-amber-100">
            <p className="flex items-start gap-2"><AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />Connect the local bridge in Settings to inspect or prepare models.</p>
            <code className="block overflow-x-auto rounded bg-black/25 px-2 py-1.5 text-[9px] text-textMuted">bun run control:bridge</code>
          </div>
        ) : (
          <>
            <SelectControl
              disabled={loading || setupRunning || inferenceRunning || accepting}
              name="Local model"
              options={options}
              value={selectedId}
              onValueChange={(value) => {
                setSelectedId(value as LocalModelId);
                setJob(snapshot?.models.find((model) => model.id === value)?.job ?? null);
                setError(null);
              }}
            />

            {selected ? (
              <div className="space-y-2 rounded-lg border border-white/10 bg-black/15 p-3 text-[10px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{selected.label}</span>
                  <span data-model-state={selected.status.state} className={`rounded px-1.5 py-0.5 font-mono ${selected.status.state === "ready" ? "bg-emerald-400/10 text-emerald-200" : selected.status.state === "license-required" || selected.status.state === "error" ? "bg-amber-400/10 text-amber-200" : "bg-white/5 text-textMuted"}`}>{selected.status.state}</span>
                </div>
                <dl className="grid grid-cols-2 gap-1 text-textMuted">
                  <div><dt>Input</dt><dd className="text-textMain">{selected.runtime.inputWidth} × {selected.runtime.inputHeight}</dd></div>
                  <div><dt>Download</dt><dd className="text-textMain">{formatBytes(selected.status.totalBytes)}</dd></div>
                  <div><dt>Type</dt><dd className="text-textMain">{selected.runtime.dtype}</dd></div>
                  <div><dt>License</dt><dd className="text-textMain">{selected.license.name}</dd></div>
                </dl>
                {selected.status.problems.length > 0 ? (
                  <p className="break-words text-amber-200">{selected.status.problems.join(", ")}</p>
                ) : null}
                {selected.gated ? (
                  <a href={selected.license.acceptanceUrl ?? selected.license.url} target="_blank" rel="noreferrer" className="inline-flex text-accent underline underline-offset-2">Review exact license</a>
                ) : null}
              </div>
            ) : null}

            {job ? (
              <div aria-live="polite" className="space-y-2 rounded-lg border border-white/10 bg-surface/50 p-3 text-[10px]">
                <div className="flex items-center justify-between gap-2"><span className="font-semibold">{job.label}</span><span className="font-mono text-textMuted">{Math.round(job.progress.ratio * 100)}%</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-black/30"><div className="h-full bg-accent transition-[width]" style={{ width: `${job.progress.ratio * 100}%` }} /></div>
                <p className="text-textMuted">{job.progress.message ?? job.progress.phase}</p>
                {job.error ? <p role="alert" className="text-amber-200">{job.error.message}</p> : null}
              </div>
            ) : null}

            {error ? <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-300/20 bg-red-300/5 p-3 text-[10px] text-red-100"><AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />{error}</p> : null}
            {notice ? <p aria-live="polite" className="rounded-lg border border-emerald-300/20 bg-emerald-300/5 p-3 text-[10px] text-emerald-100">{notice}</p> : null}

            <div className="flex flex-wrap gap-2">
              {setupRunning ? (
                <button type="button" disabled={loading} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-amber-300/25 px-3 text-[10px] font-semibold text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-40" onClick={() => void cancel()}><Ban size={13} aria-hidden="true" />Cancel setup</button>
              ) : (
                <button
                  type="button"
                  disabled={loading || !selected || selected.status.state === "ready" || selected.status.state === "license-required"}
                  className="inline-flex min-h-9 items-center gap-2 rounded-md bg-accent px-3 text-[10px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                  onClick={() => void startSetup()}
                >
                  {loading ? <LoaderCircle size={13} className="animate-spin" aria-hidden="true" /> : selected?.status.state === "ready" ? <CheckCircle2 size={13} aria-hidden="true" /> : <Download size={13} aria-hidden="true" />}
                  {selected?.status.state === "ready" ? "Ready" : "Prepare model"}
                </button>
              )}
            </div>

            <div className="space-y-3 border-t border-white/8 pt-3">
              <div className="rounded-lg border border-white/10 bg-black/15 p-3 text-[10px]">
                <p className="font-semibold">Selected source</p>
                <p className="mt-1 break-words text-textMuted">
                  {sourceReady && selectedAsset
                    ? `${selectedAsset.name} · ${selectedAsset.width} × ${selectedAsset.height}`
                    : "Select an image asset in Slice."}
                </p>
                {selectedId === "rmbg-2.0" ? (
                  <p className="mt-2 text-amber-200">RMBG execution stays locked until its exact license and WebGPU smoke are complete.</p>
                ) : null}
                {selectedId === "ben2-base" ? (
                  <p className="mt-2 text-textMuted">Experimental 1024 WebGPU model. BiRefNet Lite remains the default.</p>
                ) : null}
                {isRunnableBackgroundRemovalModelId(selectedId) && (!browserRuntimeReady || capacityBlocksInference) ? (
                  <p role="alert" className="mt-2 text-amber-200">This browser cannot run the verified local model with its current runtime or memory.</p>
                ) : null}
              </div>

              {inferenceProgress ? (
                <div
                  role="progressbar"
                  aria-label="Background removal progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(inferenceProgress.ratio * 100)}
                  aria-live="polite"
                  data-background-removal-running="true"
                  className="space-y-2 rounded-lg border border-accent/20 bg-accent/5 p-3 text-[10px]"
                >
                  <div className="flex items-center justify-between gap-2"><span className="font-semibold">Local inference</span><span className="font-mono text-textMuted">{Math.round(inferenceProgress.ratio * 100)}%</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-black/30"><div className="h-full bg-accent transition-[width] motion-reduce:transition-none" style={{ width: `${inferenceProgress.ratio * 100}%` }} /></div>
                  <p className="text-textMuted">{inferenceProgress.message}</p>
                </div>
              ) : null}

              {preview ? (
                <div data-background-removal-review="true" className="space-y-3 rounded-lg border border-white/10 bg-surface/50 p-3">
                  <p className="text-[10px] font-semibold">Review result</p>
                  <SegmentedControl
                    ariaLabel="Background removal preview"
                    name="Preview"
                    options={REVIEW_VIEW_OPTIONS}
                    value={reviewView}
                    onValueChange={(value) => setReviewView(value as BackgroundRemovalReviewView)}
                  />
                  <figure className="space-y-1">
                    <figcaption className="text-[9px] uppercase tracking-wide text-textMuted">{REVIEW_VIEW_LABELS[reviewView]}</figcaption>
                    <div className={reviewView === "output" ? "rounded border border-white/10 bg-[linear-gradient(45deg,#20232a_25%,transparent_25%),linear-gradient(-45deg,#20232a_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#20232a_75%),linear-gradient(-45deg,transparent_75%,#20232a_75%)] bg-[length:12px_12px] bg-[position:0_0,0_6px,6px_-6px,-6px_0px] p-1" : "rounded border border-white/10 bg-black/20 p-1"}>
                      <img src={preview.urls[reviewView]} alt={`${REVIEW_VIEW_LABELS[reviewView]} preview for ${preview.sourceName}`} className="max-h-40 w-full object-contain [image-rendering:auto]" />
                    </div>
                  </figure>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={accepting} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-accent px-3 text-[10px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40" onClick={() => void acceptPreview()}>
                      {accepting ? <LoaderCircle size={13} className="animate-spin" aria-hidden="true" /> : <Save size={13} aria-hidden="true" />}Save result
                    </button>
                    <button type="button" disabled={accepting} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-white/15 px-3 text-[10px] font-semibold text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40" onClick={rejectPreview}><X size={13} aria-hidden="true" />Reject</button>
                  </div>
                </div>
              ) : null}

              {inferenceRunning ? (
                <button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-amber-300/25 px-3 text-[10px] font-semibold text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300" onClick={cancelInference}><Ban size={13} aria-hidden="true" />Cancel inference</button>
              ) : (
                <button
                  type="button"
                  disabled={!inferenceReady || accepting || preview !== null}
                  className="inline-flex min-h-9 items-center gap-2 rounded-md bg-accent px-3 text-[10px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                  onClick={() => void startInference()}
                >
                  <Play size={13} aria-hidden="true" />Remove background
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export default LocalModelPanel;
