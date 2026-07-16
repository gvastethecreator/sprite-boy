import { AlertTriangle, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import type { SourceSessionError } from "./sourceSession";

export interface SliceSourceActionsProps {
  readonly busy?: boolean;
  readonly error?: SourceSessionError | null;
  readonly replaceButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly resetButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly retryButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly onReplace: () => void | Promise<void>;
  readonly onRequestReset: () => void | Promise<void>;
  readonly onRetry?: () => void | Promise<void>;
}

/** Persistent source controls composed above the existing interactive canvas. */
export function SliceSourceActions({
  busy = false,
  error = null,
  replaceButtonRef,
  resetButtonRef,
  retryButtonRef,
  onReplace,
  onRequestReset,
  onRetry,
}: SliceSourceActionsProps) {
  const [boundaryError, setBoundaryError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const localReplaceButtonRef = useRef<HTMLButtonElement>(null);
  const localRetryButtonRef = useRef<HTMLButtonElement>(null);
  const localResetButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // StrictMode replays effects in development. Re-arm the boundary on every
    // setup so the synthetic cleanup cannot permanently disable feedback.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!error) {
      setBoundaryError(null);
      return;
    }
    const target = error.retryable && onRetry
      ? localRetryButtonRef.current
      : localReplaceButtonRef.current;
    target?.focus({ preventScroll: true });
  }, [error, onRetry]);

  const containBoundaryFailure = (
    message = "Retry could not start. The current source was kept; choose another image or try again.",
    target: "replace" | "retry" | "reset" = "retry",
  ): void => {
    if (!mountedRef.current) return;
    setBoundaryError(message);
    queueMicrotask(() => {
      const button = target === "retry"
        ? localRetryButtonRef.current
        : target === "reset"
          ? localResetButtonRef.current
          : localReplaceButtonRef.current;
      button?.focus({ preventScroll: true });
    });
  };
  const invokeReplace = (): void => {
    setBoundaryError(null);
    try {
      void Promise.resolve(onReplace()).catch(() => containBoundaryFailure(
        "The source picker could not open. The current source was kept; try Replace source again.",
        "replace",
      ));
    } catch {
      containBoundaryFailure(
        "The source picker could not open. The current source was kept; try Replace source again.",
        "replace",
      );
    }
  };
  const invokeRequestReset = (): void => {
    setBoundaryError(null);
    try {
      void Promise.resolve(onRequestReset()).catch(() => containBoundaryFailure(
        "Reset could not start. The current source was kept; try Reset source again.",
        "reset",
      ));
    } catch {
      containBoundaryFailure(
        "Reset could not start. The current source was kept; try Reset source again.",
        "reset",
      );
    }
  };
  const invokeRetry = (): void => {
    setBoundaryError(null);
    try {
      // Keep the user-facing recovery message deterministic.  Rejection
      // payloads may be arbitrary browser/adapter objects and must not enter
      // the rendered boundary state directly.
      void Promise.resolve(onRetry?.()).catch(() => containBoundaryFailure());
    } catch {
      containBoundaryFailure();
    }
  };

  return (
    <div className="flex min-w-0 flex-col items-end gap-1.5">
      <div role="toolbar" aria-label="Slice source actions" className="flex flex-wrap justify-end gap-2">
        <button
          ref={(node) => {
            localReplaceButtonRef.current = node;
            if (replaceButtonRef) replaceButtonRef.current = node;
          }}
          type="button"
          disabled={busy}
          onClick={invokeReplace}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-surface px-3 py-2 text-xs font-bold text-textMain hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-45"
        >
          <Upload size={14} aria-hidden="true" />
          {busy ? "Replacing…" : "Replace source"}
        </button>
        <button
          ref={(node) => {
            localResetButtonRef.current = node;
            if (resetButtonRef) resetButtonRef.current = node;
          }}
          type="button"
          onClick={invokeRequestReset}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs font-bold text-amber-200 hover:bg-amber-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        >
          <RotateCcw size={14} aria-hidden="true" />
          Reset source
        </button>
      </div>
      {boundaryError || (!busy && error) ? (
        <div role="alert" className="flex max-w-md flex-wrap items-center justify-end gap-2 text-right text-[10px] text-amber-300">
          <AlertTriangle size={12} aria-hidden="true" />
          <span>{boundaryError ?? `${error?.message ?? "Source replacement failed."} The current source was kept.`}</span>
          {error?.retryable && onRetry ? (
            <button
              ref={(node) => {
                localRetryButtonRef.current = node;
                if (retryButtonRef) retryButtonRef.current = node;
              }}
              type="button"
              disabled={busy}
              onClick={invokeRetry}
              className="inline-flex min-h-8 items-center gap-1 rounded-md border border-amber-300/25 px-2 py-1 font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              <RefreshCw size={11} aria-hidden="true" />
              Retry
            </button>
          ) : null}
        </div>
      ) : busy ? (
        <span role="status" className="text-[10px] text-textMuted">
          Validating the replacement while the current source stays active…
        </span>
      ) : null}
    </div>
  );
}

export default SliceSourceActions;
