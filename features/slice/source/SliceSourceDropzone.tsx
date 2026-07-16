import { useEffect, useRef, useState, type DragEvent, type RefObject } from "react";
import { AlertTriangle, FileImage, LoaderCircle, UploadCloud } from "lucide-react";

import type { SourceSelectionInput, SourceSessionSnapshot } from "./sourceSession";

export interface SliceSourceDropzoneProps {
  readonly snapshot: SourceSessionSnapshot;
  readonly disabled?: boolean;
  readonly committing?: boolean;
  readonly browseButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly onBrowse: () => void;
  readonly onSelect: (input: SourceSelectionInput) => void | Promise<void>;
  readonly onRetry?: () => void | Promise<void>;
}

function isBusy(snapshot: SourceSessionSnapshot): boolean {
  return snapshot.status === "validating" || snapshot.status === "decoding";
}

function statusCopy(snapshot: SourceSessionSnapshot, committing: boolean): string {
  if (committing) return "Opening the validated source in Slice…";
  switch (snapshot.status) {
    case "validating": return "Checking file type, signature and size…";
    case "decoding": return "Decoding source pixels safely…";
    case "ready": return "Source validated. Preparing the Slice workspace…";
    case "error": return snapshot.error.message;
    case "idle": return "PNG, JPEG or WebP · maximum 10 MiB";
  }
}

export function SliceSourceDropzone({
  snapshot,
  disabled = false,
  committing = false,
  browseButtonRef,
  onBrowse,
  onSelect,
  onRetry,
}: SliceSourceDropzoneProps) {
  const [dragDepth, setDragDepth] = useState(0);
  const [boundaryError, setBoundaryError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const busy = isBusy(snapshot) || committing;
  const inactive = disabled || busy;
  const dragActive = dragDepth > 0 && !inactive;
  const titleId = "slice-source-dropzone-title";
  const descriptionId = "slice-source-dropzone-description";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const containBoundaryFailure = (): void => {
    if (mountedRef.current) {
      setBoundaryError("The source selection could not be read. Choose the file again.");
    }
  };
  const invokeSelection = (input: SourceSelectionInput): void => {
    setBoundaryError(null);
    try {
      Promise.resolve(onSelect(input)).catch(containBoundaryFailure);
    } catch {
      containBoundaryFailure();
    }
  };
  const clearDrag = (): void => setDragDepth(0);
  const handleDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    clearDrag();
    if (inactive) return;
    try {
      const files = event.dataTransfer.files;
      if (files.length === 0) return;
      invokeSelection(files);
    } catch {
      containBoundaryFailure();
    }
  };

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={busy || undefined}
      data-slice-source-dropzone=""
      data-drop-active={dragActive || undefined}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!inactive) setDragDepth((depth) => depth + 1);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!inactive) event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setDragDepth((depth) => Math.max(0, depth - 1));
      }}
      onDrop={handleDrop}
      className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-workspace p-5 sm:p-8"
    >
      <div
        className={[
          "w-full max-w-2xl rounded-2xl border bg-panel/90 p-6 text-center shadow-modal backdrop-blur-md transition-colors sm:p-9",
          dragActive
            ? "border-accent bg-accent/10 shadow-glow"
            : snapshot.status === "error"
              ? "border-amber-400/45"
              : "border-white/10",
        ].join(" ")}
      >
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-surface text-accent">
          {busy ? (
            <LoaderCircle className="motion-safe:animate-spin" size={30} aria-hidden="true" />
          ) : snapshot.status === "error" ? (
            <AlertTriangle className="text-amber-400" size={30} aria-hidden="true" />
          ) : dragActive ? (
            <FileImage size={30} aria-hidden="true" />
          ) : (
            <UploadCloud size={30} aria-hidden="true" />
          )}
        </div>

        <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-textMuted">
          Slice workspace
        </p>
        <h1 id={titleId} className="text-xl font-bold tracking-tight text-textMain sm:text-2xl">
          {dragActive ? "Drop the spritesheet here" : "Bring in a spritesheet"}
        </h1>
        <p id={descriptionId} className="mx-auto mt-3 max-w-lg text-sm leading-6 text-textMuted">
          Import source art once, then detect, refine and commit sprite regions without leaving Studio.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            ref={browseButtonRef}
            type="button"
            disabled={inactive}
            onClick={() => {
              setBoundaryError(null);
              try {
                onBrowse();
              } catch {
                containBoundaryFailure();
              }
            }}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-xs font-bold text-white shadow-glow hover:bg-accentHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            <FileImage size={15} aria-hidden="true" />
            Choose source image
          </button>
          {snapshot.status === "error" && snapshot.error.retryable && onRetry ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setBoundaryError(null);
                try {
                  Promise.resolve(onRetry()).catch(containBoundaryFailure);
                } catch {
                  containBoundaryFailure();
                }
              }}
              className="min-h-11 rounded-lg border border-white/10 bg-surface px-5 py-2.5 text-xs font-bold text-textMain hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-45"
            >
              Try again
            </button>
          ) : null}
        </div>

        <p
          role={snapshot.status === "error" || boundaryError ? "alert" : "status"}
          aria-live={snapshot.status === "error" || boundaryError ? "assertive" : "polite"}
          className={[
            "mx-auto mt-5 min-h-5 max-w-lg text-xs",
            snapshot.status === "error" || boundaryError ? "text-amber-300" : "text-textMuted",
          ].join(" ")}
        >
          {boundaryError ?? statusCopy(snapshot, committing)}
        </p>
      </div>
    </section>
  );
}

export default SliceSourceDropzone;
