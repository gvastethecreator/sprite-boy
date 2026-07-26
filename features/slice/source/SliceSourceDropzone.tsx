import { useEffect, useRef, useState, type DragEvent, type RefObject } from "react";
import { AlertTriangle, FileImage, LoaderCircle, UploadCloud } from "lucide-react";

import type { SourceSelectionInput, SourceSessionSnapshot } from "./sourceSession";

export interface SliceSourceDropzoneProps {
  readonly snapshot: SourceSessionSnapshot;
  readonly disabled?: boolean;
  readonly committing?: boolean;
  readonly browseButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly onBrowse: () => void | Promise<void>;
  readonly onSelect: (input: SourceSelectionInput) => void | Promise<void>;
  readonly onRetry?: () => void | Promise<void>;
}

function isBusy(snapshot: SourceSessionSnapshot): boolean {
  return snapshot.status === "validating" || snapshot.status === "decoding";
}

function statusCopy(snapshot: SourceSessionSnapshot, committing: boolean): string {
  if (committing) return "Opening the validated source…";
  switch (snapshot.status) {
    case "validating": return "Checking file type, signature and size…";
    case "decoding": return "Decoding pixels…";
    case "ready": return "Source validated. Preparing workspace…";
    case "error": return `${snapshot.error.message} ${snapshot.error.retryable
      ? "Try again, or choose another file."
      : "Choose another file to continue."}`;
    case "idle": return "PNG, JPEG, WebP, MP4, WebM, MOV or MKV";
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
  const localBrowseButtonRef = useRef<HTMLButtonElement>(null);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const busy = isBusy(snapshot) || committing;
  const inactive = disabled || busy;
  const dragActive = dragDepth > 0 && !inactive;
  const titleId = "slice-source-dropzone-title";
  const statusId = "slice-source-dropzone-status";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (inactive) setDragDepth(0);
  }, [inactive]);

  useEffect(() => {
    if (boundaryError) {
      localBrowseButtonRef.current?.focus({ preventScroll: true });
      return;
    }
    if (snapshot.status !== "error") return;
    const target = snapshot.error.retryable && onRetry
      ? retryButtonRef.current
      : localBrowseButtonRef.current;
    target?.focus({ preventScroll: true });
  }, [boundaryError, onRetry, snapshot.generation, snapshot.status]);

  const containBoundaryFailure = (): void => {
    if (mountedRef.current) {
      setBoundaryError("The source selection could not be read. Choose the file again.");
    }
  };
  const invokeSelection = (input: SourceSelectionInput): void => {
    setBoundaryError(null);
    try {
      Promise.resolve(onSelect(input)).catch(() => containBoundaryFailure());
    } catch {
      containBoundaryFailure();
    }
  };
  const invokeBrowse = (): void => {
    setBoundaryError(null);
    try {
      Promise.resolve(onBrowse()).catch(() => containBoundaryFailure());
    } catch {
      containBoundaryFailure();
    }
  };
  const invokeRetry = (): void => {
    setBoundaryError(null);
    try {
      Promise.resolve(onRetry?.()).catch(() => containBoundaryFailure());
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
      aria-describedby={statusId}
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
      className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-workspace p-4 sm:p-6"
    >
      <div
        onClick={(event) => {
          if (inactive) return;
          if ((event.target as HTMLElement).closest("button")) return;
          invokeBrowse();
        }}
        className={[
          "studio-empty-card max-w-lg cursor-pointer transition-colors hover:border-white/16",
          dragActive
            ? "border-accent bg-accent/10 shadow-glow"
            : snapshot.status === "error"
              ? "border-amber-400/45"
              : "",
        ].join(" ")}
      >
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-white/10 bg-surface text-textMain">
          {busy ? (
            <LoaderCircle className="motion-safe:animate-spin text-textMuted" size={24} aria-hidden="true" />
          ) : snapshot.status === "error" ? (
            <AlertTriangle className="text-amber-400" size={24} aria-hidden="true" />
          ) : dragActive ? (
            <FileImage size={24} aria-hidden="true" />
          ) : (
            <UploadCloud size={24} aria-hidden="true" />
          )}
        </div>

        <h1 id={titleId} className="text-lg font-semibold tracking-tight text-textMain sm:text-xl">
          {dragActive ? "Drop the image or video here" : "Bring in an image or video"}
        </h1>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            ref={(node) => {
              localBrowseButtonRef.current = node;
              if (browseButtonRef) browseButtonRef.current = node;
            }}
            type="button"
            disabled={inactive}
            onClick={invokeBrowse}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white shadow-glow hover:bg-accentHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            <FileImage size={14} aria-hidden="true" />
            Choose image or video
          </button>
          {snapshot.status === "error" && snapshot.error.retryable && onRetry ? (
            <button
              ref={retryButtonRef}
              type="button"
              disabled={inactive}
              onClick={invokeRetry}
              className="min-h-10 rounded-md border border-white/10 bg-surface px-4 py-2 text-xs font-semibold text-textMain hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-45"
            >
              Try again
            </button>
          ) : null}
        </div>

        <p
          id={statusId}
          role={snapshot.status === "error" || boundaryError ? "alert" : "status"}
          aria-live={snapshot.status === "error" || boundaryError ? "assertive" : "polite"}
          className={[
            "mx-auto mt-4 min-h-5 max-w-sm text-[11px]",
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
