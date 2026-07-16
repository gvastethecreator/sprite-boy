import { AlertTriangle, RefreshCw, RotateCcw, Upload } from "lucide-react";
import type { RefObject } from "react";

import type { SourceSessionError } from "./sourceSession";

export interface SliceSourceActionsProps {
  readonly busy?: boolean;
  readonly error?: SourceSessionError | null;
  readonly replaceButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly resetButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly onReplace: () => void;
  readonly onRequestReset: () => void;
  readonly onRetry?: () => void | Promise<void>;
}

/** Persistent source controls composed above the existing interactive canvas. */
export function SliceSourceActions({
  busy = false,
  error = null,
  replaceButtonRef,
  resetButtonRef,
  onReplace,
  onRequestReset,
  onRetry,
}: SliceSourceActionsProps) {
  const invokeRetry = (): void => {
    try {
      void Promise.resolve(onRetry?.()).catch(() => undefined);
    } catch {
      // Session state remains authoritative when an adapter rejects synchronously.
    }
  };

  return (
    <div className="flex min-w-0 flex-col items-end gap-1.5">
      <div role="toolbar" aria-label="Slice source actions" className="flex flex-wrap justify-end gap-2">
        <button
          ref={replaceButtonRef}
          type="button"
          disabled={busy}
          onClick={onReplace}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-surface px-3 py-2 text-xs font-bold text-textMain hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-45"
        >
          <Upload size={14} aria-hidden="true" />
          {busy ? "Replacing…" : "Replace source"}
        </button>
        <button
          ref={resetButtonRef}
          type="button"
          onClick={onRequestReset}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs font-bold text-amber-200 hover:bg-amber-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        >
          <RotateCcw size={14} aria-hidden="true" />
          Reset source
        </button>
      </div>
      {busy ? (
        <span role="status" className="text-[10px] text-textMuted">
          Validating the replacement while the current source stays active…
        </span>
      ) : error ? (
        <div role="alert" className="flex max-w-md flex-wrap items-center justify-end gap-2 text-right text-[10px] text-amber-300">
          <AlertTriangle size={12} aria-hidden="true" />
          <span>{error.message} The current source was kept.</span>
          {error.retryable && onRetry ? (
            <button
              type="button"
              onClick={invokeRetry}
              className="inline-flex min-h-8 items-center gap-1 rounded-md border border-amber-300/25 px-2 py-1 font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              <RefreshCw size={11} aria-hidden="true" />
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default SliceSourceActions;
