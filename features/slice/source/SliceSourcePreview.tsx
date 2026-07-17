import { AlertTriangle, FileImage, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import type { SourceReadyMetadata, SourceSessionSnapshot } from "./sourceSession";
import type { ImageMeta } from "../../../types";
import type { SourcePreviewUrlLeaseOptions } from "./sourcePreviewUrlLease";
import { useSourcePreviewUrl } from "./useSourcePreviewUrl";

export interface SliceSourcePreviewProps {
  readonly snapshot: SourceSessionSnapshot;
  readonly getBlob: () => Blob | null;
  readonly urlOptions?: SourcePreviewUrlLeaseOptions;
  readonly committing?: boolean;
}

export interface SliceSourceMetadataBarProps {
  readonly snapshot: SourceSessionSnapshot;
  readonly compact?: boolean;
  readonly metadataOverride?: SourceReadyMetadata | null;
  readonly legacyImageMeta?: ImageMeta | null;
  readonly actions?: ReactNode;
}

export interface SliceSourceCanvasFrameProps extends SliceSourceMetadataBarProps {
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

export function formatSourceByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export interface SliceSourceDisplayMetadata {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly formatLabel: string;
  readonly formatConfidence: "validated" | "inferred" | "unknown";
}

function formatSourceFormat(format: string): string {
  switch (format) {
    case "jpeg": return "JPEG";
    case "png": return "PNG";
    case "webp": return "WebP";
    default: return format.toUpperCase();
  }
}

function inferLegacyFormat(image: ImageMeta): Pick<
  SliceSourceDisplayMetadata,
  "formatLabel" | "formatConfidence"
> {
  let source = "";
  let name = "";
  try {
    source = image.src.toLowerCase();
    name = image.name.toLowerCase();
  } catch {
    return { formatLabel: "Unknown", formatConfidence: "unknown" };
  }
  const dataMime = /^data:image\/(png|jpeg|webp)(?:[;,])/u.exec(source)?.[1];
  const extension = /\.([a-z0-9]+)$/u.exec(name)?.[1];
  const inferred = dataMime ?? extension;
  switch (inferred) {
    case "png": return { formatLabel: "PNG · inferred", formatConfidence: "inferred" };
    case "jpg":
    case "jpeg": return { formatLabel: "JPEG · inferred", formatConfidence: "inferred" };
    case "webp": return { formatLabel: "WebP · inferred", formatConfidence: "inferred" };
    default: return { formatLabel: "Unknown", formatConfidence: "unknown" };
  }
}

export function createSliceSourceDisplayMetadata(
  validated: SourceReadyMetadata | null,
  legacy: ImageMeta | null = null,
): SliceSourceDisplayMetadata | null {
  if (validated) {
    return Object.freeze({
      name: validated.name,
      width: validated.width,
      height: validated.height,
      size: validated.size,
      formatLabel: formatSourceFormat(validated.format),
      formatConfidence: "validated" as const,
    });
  }
  if (!legacy) return null;
  const format = inferLegacyFormat(legacy);
  return Object.freeze({
    name: legacy.name,
    width: legacy.width,
    height: legacy.height,
    size: legacy.fileSize,
    ...format,
  });
}

/** Metadata-only variant for composing around the existing interactive canvas. */
export function SliceSourceMetadataBar({
  snapshot,
  compact = false,
  metadataOverride,
  legacyImageMeta = null,
  actions,
}: SliceSourceMetadataBarProps) {
  const validatedMetadata = metadataOverride === undefined ? snapshot.metadata : metadataOverride;
  const metadata = createSliceSourceDisplayMetadata(validatedMetadata, legacyImageMeta);
  if (snapshot.disposed || (metadata === null && !actions)) return null;
  return (
    <header
      aria-label="Slice source metadata"
      data-slice-source-metadata=""
      className={[
        "flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-panel/75 px-4",
        compact ? "py-2" : "py-3",
      ].join(" ")}
    >
      <div className="min-w-0">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-textMuted">
          Source preview
        </p>
        <p className="truncate text-sm font-bold text-textMain">{metadata?.name ?? "Slice source"}</p>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-4">
        {metadata ? (
          <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-textMuted">
            <div className="flex gap-1.5">
              <dt>Dimensions</dt>
              <dd className="font-bold text-textMain">{metadata.width} × {metadata.height}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Size</dt>
              <dd className="font-bold text-textMain">{formatSourceByteSize(metadata.size)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Format</dt>
              <dd
                className="font-bold text-textMain"
                data-format-confidence={metadata.formatConfidence}
              >
                {metadata.formatLabel}
              </dd>
            </div>
          </dl>
        ) : null}
        {actions}
      </div>
    </header>
  );
}

/**
 * Non-destructive integration shell: mount the legacy/interactive CanvasArea
 * as `children`; the metadata is additive and never replaces grid tools.
 */
export function SliceSourceCanvasFrame({
  snapshot,
  compact = true,
  metadataOverride,
  legacyImageMeta,
  actions,
  children,
  footer,
}: SliceSourceCanvasFrameProps) {
  return (
    <section
      aria-label="Slice canvas and source metadata"
      data-slice-source-canvas-frame=""
      className="flex h-full min-h-0 flex-col"
    >
      <SliceSourceMetadataBar
        snapshot={snapshot}
        compact={compact}
        metadataOverride={metadataOverride}
        legacyImageMeta={legacyImageMeta}
        actions={actions}
      />
      <div className="min-h-0 flex-1">{children}</div>
      {footer}
    </section>
  );
}

export function SliceSourcePreview({
  snapshot,
  getBlob,
  urlOptions,
  committing = false,
}: SliceSourcePreviewProps) {
  const preview = useSourcePreviewUrl(snapshot, getBlob, urlOptions);
  const metadata = snapshot.metadata;
  if (preview.source === null || metadata === null) return null;

  return (
    <section
      aria-label={`Source preview: ${metadata.name}`}
      aria-busy={committing || undefined}
      data-slice-source-preview=""
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-workspace"
    >
      <SliceSourceMetadataBar snapshot={snapshot} />
      {committing ? (
        <p role="status" className="border-b border-white/10 bg-accent/10 px-4 py-2 text-center text-xs text-textMuted">
          Opening the validated source in Slice…
        </p>
      ) : null}

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-5 sm:p-8">
        <div
          className="relative flex min-h-48 min-w-48 max-w-full items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[conic-gradient(from_90deg_at_1px_1px,#20232b_90deg,#171920_0)] bg-[length:18px_18px] shadow-modal"
        >
          {preview.url ? (
            <img
              src={preview.url}
              alt={`Source preview: ${metadata.name}`}
              draggable={false}
              className="block max-h-[min(68vh,760px)] max-w-full object-contain [image-rendering:auto]"
            />
          ) : preview.error ? (
            <div role="alert" className="max-w-sm p-7 text-center text-amber-300">
              <AlertTriangle className="mx-auto mb-3" size={28} aria-hidden="true" />
              <p className="text-sm font-semibold">{preview.error.message}</p>
              <button
                type="button"
                onClick={preview.retry}
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/10 bg-surface px-4 py-2 text-xs font-bold text-textMain hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <RefreshCw size={14} aria-hidden="true" />
                Retry preview
              </button>
            </div>
          ) : (
            <div role="status" className="flex items-center gap-2 p-7 text-xs text-textMuted">
              <FileImage size={18} aria-hidden="true" />
              Preparing preview…
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default SliceSourcePreview;
