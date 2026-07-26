import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { SelectControl } from "../../../components/toolcraft";
import type { JobSnapshot } from "../../../core/processing";
import type { LocalModelId } from "../../../core/models";
import { LocalModelServiceError, type LocalModelServiceSnapshot } from "../../../core/models";
import { useStudioControlBridge } from "../../control/StudioControlBridgeProvider";

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 MB";
  return `${(value / 1_048_576).toFixed(value >= 104_857_600 ? 0 : 1)} MB`;
}

function safeMessage(error: unknown): string {
  return error instanceof LocalModelServiceError
    ? error.message
    : "Local model status could not be read.";
}

function terminal(job: JobSnapshot): boolean {
  return job.status !== "queued" && job.status !== "running";
}

export function LocalModelPanel() {
  const bridge = useStudioControlBridge();
  const [snapshot, setSnapshot] = useState<LocalModelServiceSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<LocalModelId>("birefnet-lite-512");
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    { value: "rmbg-2.0", label: "RMBG 2.0" },
  ], [snapshot]);
  const connected = bridge.snapshot.status === "connected" && bridge.models !== null;
  const running = Boolean(job && !terminal(job));

  const startSetup = async () => {
    if (!bridge.models || running) return;
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
              disabled={loading || running}
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

            <div className="flex flex-wrap gap-2">
              {running ? (
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
          </>
        )}
      </div>
    </section>
  );
}

export default LocalModelPanel;
