import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CheckCircle2,
  CircleX,
  Clock3,
  Loader2,
  RefreshCw,
  Square,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  isTerminalJob,
  type JobRunner,
  type JobSnapshot,
  type JobStatus,
  type TerminalJobSnapshot,
} from "../../core/processing";
import {
  createJobCenterEntriesSelector,
  createJobCenterSummarySelector,
  type JobStore,
} from "../../core/stores";
import { useJobStoreSelector } from "../../hooks/useStudioStoreSelector";
import type { StudioJobRetryAction } from "../../contexts/StudioStoreContext";

export interface JobCenterProps {
  readonly store: JobStore;
  readonly runner: Pick<JobRunner, "cancel">;
  readonly retryJob?: StudioJobRetryAction | null;
}

interface StatusPresentation {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly className: string;
}

const STATUS_PRESENTATION: Readonly<Record<JobStatus, StatusPresentation>> = Object.freeze({
  queued: Object.freeze({ label: "Queued", icon: Clock3, className: "text-sky-300" }),
  running: Object.freeze({ label: "Running", icon: Loader2, className: "text-accent" }),
  succeeded: Object.freeze({ label: "Completed", icon: CheckCircle2, className: "text-emerald-300" }),
  failed: Object.freeze({ label: "Failed", icon: TriangleAlert, className: "text-rose-300" }),
  cancelled: Object.freeze({ label: "Cancelled", icon: CircleX, className: "text-textMuted" }),
  "timed-out": Object.freeze({ label: "Timed out", icon: Clock3, className: "text-amber-300" }),
});

function progressPercent(job: JobSnapshot): number {
  return Math.round(job.progress.ratio * 100);
}

function liveSummary(active: number, terminal: number, total: number): string {
  if (total === 0) return "Job Center is empty.";
  const history = terminal === 1 ? "1 job in history" : `${terminal} jobs in history`;
  if (active === 1) return `1 job active. ${history}.`;
  if (active > 1) return `${active} jobs active. ${history}.`;
  return `No active jobs. ${history}.`;
}

function JobStatusBadge({ job }: { readonly job: JobSnapshot }) {
  const presentation = STATUS_PRESENTATION[job.status];
  const Icon = presentation.icon;
  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`${job.label}, attempt ${job.attempt}: ${presentation.label}`}
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${presentation.className}`}
    >
      <Icon
        size={13}
        strokeWidth={1.9}
        aria-hidden="true"
        className={job.status === "running" ? "animate-spin motion-reduce:animate-none" : ""}
      />
      {presentation.label}
    </span>
  );
}

export function JobCenter({ store, runner, retryJob = null }: JobCenterProps) {
  const selectEntries = useMemo(createJobCenterEntriesSelector, []);
  const selectSummary = useMemo(createJobCenterSummarySelector, []);
  const entries = useJobStoreSelector(store, selectEntries);
  const summary = useJobStoreSelector(store, selectSummary);
  const consumedRetrySources = useJobStoreSelector(
    store,
    (state) => state.consumedRetrySourceIds,
  );
  const mounted = useRef(true);
  const [pendingActionJobId, setPendingActionJobId] = useState<string | null>(null);
  const [actionFailure, setActionFailure] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const cancelJob = (job: JobSnapshot) => {
    setActionFailure(null);
    if (!runner.cancel(job.id, "Cancelled from Job Center.")) {
      setActionFailure(`${job.label} already finished and could not be cancelled.`);
    }
  };

  const retry = (job: TerminalJobSnapshot) => {
    if (!retryJob || pendingActionJobId !== null) return;
    setActionFailure(null);
    setPendingActionJobId(job.id);
    void Promise.resolve()
      .then(() => retryJob(job))
      .then((accepted) => {
        if (!mounted.current) return;
        if (!accepted) setActionFailure(`${job.label} is no longer available to retry.`);
      })
      .catch(() => {
        if (mounted.current) setActionFailure(`Could not retry ${job.label}.`);
      })
      .finally(() => {
        if (mounted.current) setPendingActionJobId(null);
      });
  };

  return (
    <section aria-label="Job activity" className="flex min-h-full flex-col">
      <div
        role="status"
        aria-label="Job Center summary"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveSummary(summary.active, summary.terminal, summary.total)}
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-white/10 p-3">
        <div className="rounded-lg border border-white/10 bg-surface/70 px-3 py-2">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-textMuted">
            Active
          </span>
          <strong className="mt-1 block font-mono text-lg text-textMain">{summary.active}</strong>
        </div>
        <div className="rounded-lg border border-white/10 bg-surface/70 px-3 py-2">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-textMuted">
            History
          </span>
          <strong className="mt-1 block font-mono text-lg text-textMain">{summary.terminal}</strong>
        </div>
      </div>

      {actionFailure ? (
        <div role="alert" className="mx-3 mt-3 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
          {actionFailure}
        </div>
      ) : null}

      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-surface text-textMuted">
            <Activity size={21} strokeWidth={1.7} aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-textMain">No jobs yet</h3>
            <p className="mt-1 max-w-64 text-xs leading-5 text-textMuted">
              Processing, generation and export activity will appear here.
            </p>
          </div>
        </div>
      ) : (
        <ol aria-label="Recent jobs" className="space-y-2 p-3">
          {entries.map((job) => {
            const terminal = isTerminalJob(job);
            const canRetry = terminal && !!job.error?.retryable &&
              !consumedRetrySources.includes(job.id) && retryJob !== null;
            const percent = progressPercent(job);
            const actionPending = pendingActionJobId === job.id;
            return (
              <li
                key={job.id}
                data-job-id={job.id}
                data-job-status={job.status}
                className="rounded-xl border border-white/10 bg-surface/55 p-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-xs font-semibold text-textMain">{job.label}</h3>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-textMuted/80">
                      {job.kind} · attempt {job.attempt}
                    </p>
                  </div>
                  <JobStatusBadge job={job} />
                </div>

                {!terminal ? (
                  <div className="mt-3">
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-[10px] text-textMuted">
                      <span className="truncate">{job.progress.message ?? job.progress.phase}</span>
                      <span className="shrink-0 font-mono text-textMain">{percent}%</span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={`${job.label} progress`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                      className="h-1.5 overflow-hidden rounded-full bg-white/10"
                    >
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-200 motion-reduce:transition-none"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                ) : null}

                {job.error ? (
                  <details className="mt-3 rounded-lg border border-white/10 bg-panel/60 px-2.5 py-2 text-[11px] text-textMuted">
                    <summary
                      aria-label={`Show details for ${job.label}, attempt ${job.attempt}`}
                      className="cursor-pointer font-medium text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      Details
                    </summary>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 leading-4">
                      <dt>Code</dt>
                      <dd className="break-all font-mono text-textMain">{job.error.code}</dd>
                      <dt>Message</dt>
                      <dd className="break-words text-textMain">{job.error.message}</dd>
                    </dl>
                  </details>
                ) : null}

                <div className="mt-3 flex items-center justify-end gap-2">
                  {!terminal ? (
                    <button
                      type="button"
                      aria-label={`Cancel ${job.label}, attempt ${job.attempt}`}
                      onClick={() => cancelJob(job)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-textMuted hover:bg-white/5 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Square size={11} fill="currentColor" aria-hidden="true" />
                      Cancel
                    </button>
                  ) : null}
                  {canRetry ? (
                    <button
                      type="button"
                      aria-label={`Retry ${job.label}, attempt ${job.attempt}`}
                      disabled={pendingActionJobId !== null}
                      onClick={() => retry(job)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-accent/90 disabled:cursor-wait disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
                    >
                      <RefreshCw
                        size={12}
                        aria-hidden="true"
                        className={actionPending ? "animate-spin motion-reduce:animate-none" : ""}
                      />
                      {actionPending ? "Retrying…" : "Retry"}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export default JobCenter;
