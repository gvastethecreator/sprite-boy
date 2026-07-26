import { AlertTriangle, Film, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  MICROSECONDS_PER_SECOND,
  VIDEO_IMPORT_LIMITS,
  VideoMediaError,
  microsecondsToSeconds,
  secondsToMicroseconds,
  selectVideoFrameTimestamps,
  type VideoPreflight,
} from "../../../core/media";
import {
  RangeSliderControl,
  SegmentedControl,
  SliderControl,
} from "../../../components/toolcraft";
import type { VideoImportAdapter, VideoImportSelection } from "./videoImportJobTask";

export interface SliceVideoImportPanelProps {
  readonly adapter: VideoImportAdapter;
  readonly disabled?: boolean;
  readonly file: File;
  readonly onClose: () => void;
  readonly onChooseAnother: () => void;
  readonly onStart: (file: File, selection: VideoImportSelection) => boolean | Promise<boolean>;
}

type InspectionState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly preflight: VideoPreflight };

function inspectErrorMessage(error: unknown): string {
  if (error instanceof VideoMediaError) {
    switch (error.code) {
      case "VIDEO_UNSUPPORTED_FORMAT": return "This video container is not supported.";
      case "VIDEO_TRACK_MISSING": return "The file has no video track.";
      case "VIDEO_TRACK_NOT_FOUND": return "The selected video track is unavailable.";
      case "VIDEO_CODEC_UNSUPPORTED": return "This browser cannot decode the video codec.";
      case "VIDEO_LIMIT_EXCEEDED": return "The video exceeds the current import limits.";
      case "VIDEO_CANCELLED": return "Video inspection was cancelled.";
      case "VIDEO_INVALID_INPUT":
      case "VIDEO_DECODE_FAILED":
      case "VIDEO_ENCODE_FAILED":
      case "VIDEO_FRAME_UNAVAILABLE":
        return "The video could not be inspected.";
    }
  }
  return "The video could not be inspected.";
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function SliceVideoImportPanel({
  adapter,
  disabled = false,
  file,
  onClose,
  onChooseAnother,
  onStart,
}: SliceVideoImportPanelProps) {
  const [inspection, setInspection] = useState<InspectionState>({ status: "loading" });
  const [rangeUs, setRangeUs] = useState<readonly [number, number]>([0, 1]);
  const [samplingMode, setSamplingMode] = useState<"all" | "fps">("all");
  const [fps, setFps] = useState(12);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const startButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setInspection({ status: "loading" });
    setSubmitError(null);
    void Promise.resolve(adapter.preflight(file, { trackIndex: 0, signal: controller.signal }))
      .then((preflight) => {
        if (controller.signal.aborted) return;
        if (!preflight.decodable) {
          setInspection({ status: "error", message: "This browser cannot decode the video codec." });
          return;
        }
        setInspection({ status: "ready", preflight });
        setRangeUs([0, preflight.durationUs]);
        setFps(Math.min(
          VIDEO_IMPORT_LIMITS.maxSamplingFps,
          Math.max(1, Math.round(preflight.track.frameRate ?? 12)),
        ));
        queueMicrotask(() => startButtonRef.current?.focus({ preventScroll: true }));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setInspection({ status: "error", message: inspectErrorMessage(error) });
        }
      });
    return () => controller.abort("Video import panel closed.");
  }, [adapter, file]);

  const selection = useMemo<VideoImportSelection>(() => ({
    trackIndex: inspection.status === "ready" ? inspection.preflight.track.index : 0,
    range: { startUs: rangeUs[0], endUs: rangeUs[1] },
    sampling: samplingMode === "all" ? { mode: "all" } : { mode: "fps", fps },
  }), [fps, inspection, rangeUs, samplingMode]);

  const selectedTimestamps = useMemo(() => {
    if (inspection.status !== "ready") return [];
    try {
      return selectVideoFrameTimestamps(
        inspection.preflight.sampleTimestampsUs,
        selection.range,
        selection.sampling,
      );
    } catch {
      return [];
    }
  }, [inspection, selection]);
  const selectionPixelCount = inspection.status === "ready"
    ? selectedTimestamps.length
      * inspection.preflight.track.displayWidth
      * inspection.preflight.track.displayHeight
    : 0;
  const selectionWithinLimits = selectedTimestamps.length > 0
    && selectedTimestamps.length <= VIDEO_IMPORT_LIMITS.maxOutputFrames
    && selectionPixelCount <= VIDEO_IMPORT_LIMITS.maxOutputPixels;

  const start = (): void => {
    if (disabled || submitting || inspection.status !== "ready" || !selectionWithinLimits) return;
    setSubmitting(true);
    setSubmitError(null);
    let startResult: boolean | Promise<boolean>;
    try {
      startResult = onStart(file, selection);
    } catch {
      setSubmitError("The import job could not be queued.");
      setSubmitting(false);
      return;
    }
    void Promise.resolve(startResult)
      .then((accepted) => {
        if (!accepted) setSubmitError("The import job could not be queued.");
      })
      .catch(() => setSubmitError("The import job could not be queued."))
      .finally(() => setSubmitting(false));
  };

  return (
    <section aria-labelledby="slice-video-import-title" className="flex min-h-0 flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Film size={17} className="text-accent" aria-hidden="true" />
            <h2 id="slice-video-import-title" className="text-sm font-semibold text-textMain">
              Extract video frames
            </h2>
          </div>
          <p className="mt-1 truncate text-[11px] text-textMuted">
            {file.name} · {(file.size / (1024 * 1024)).toFixed(2)} MiB
          </p>
        </div>
        <button
          type="button"
          aria-label="Close video import"
          onClick={onClose}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-textMuted hover:bg-white/5 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {inspection.status === "loading" ? (
          <div role="status" className="flex min-h-48 flex-col items-center justify-center gap-3 text-xs text-textMuted">
            <LoaderCircle size={22} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Inspecting tracks and timestamps…
          </div>
        ) : inspection.status === "error" ? (
          <div role="alert" className="rounded-lg border border-amber-300/25 bg-amber-300/10 p-4 text-xs text-amber-100">
            <div className="flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p>{inspection.message}</p>
            </div>
            <button
              type="button"
              onClick={onChooseAnother}
              className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-md border border-amber-200/25 px-3 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
            >
              <RefreshCw size={13} aria-hidden="true" />
              Choose another file
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-black/20 p-3 text-[11px]">
              <div><dt className="text-textMuted">Duration</dt><dd className="mt-0.5 font-mono text-textMain">{formatDuration(microsecondsToSeconds(inspection.preflight.durationUs))}</dd></div>
              <div><dt className="text-textMuted">Size</dt><dd className="mt-0.5 font-mono text-textMain">{inspection.preflight.track.displayWidth}×{inspection.preflight.track.displayHeight}</dd></div>
              <div><dt className="text-textMuted">Codec</dt><dd className="mt-0.5 truncate font-mono text-textMain">{inspection.preflight.track.codec}</dd></div>
              <div><dt className="text-textMuted">Timing</dt><dd className="mt-0.5 text-textMain">{inspection.preflight.variableFrameRate ? "Variable rate" : "Constant rate"}</dd></div>
            </dl>

            <RangeSliderControl
              name="Time range"
              min={0}
              max={microsecondsToSeconds(inspection.preflight.durationUs)}
              step={inspection.preflight.durationUs < MICROSECONDS_PER_SECOND ? 0.001 : 0.01}
              unit="s"
              value={[microsecondsToSeconds(rangeUs[0]), microsecondsToSeconds(rangeUs[1])]}
              disabled={disabled || submitting}
              onValueChange={(value) => {
                const startUs = secondsToMicroseconds(value[0]);
                const endUs = Math.max(startUs + 1, secondsToMicroseconds(value[1]));
                setRangeUs([startUs, Math.min(endUs, inspection.preflight.durationUs)]);
              }}
            />

            <SegmentedControl
              name="Sampling"
              value={samplingMode}
              disabled={disabled || submitting}
              options={[
                { value: "all", label: "Every frame" },
                { value: "fps", label: "Target FPS" },
              ]}
              onValueChange={(value) => setSamplingMode(value === "fps" ? "fps" : "all")}
            />

            {samplingMode === "fps" ? (
              <SliderControl
                name="Target FPS"
                min={1}
                max={VIDEO_IMPORT_LIMITS.maxSamplingFps}
                step={1}
                value={fps}
                disabled={disabled || submitting}
                onValueChange={(value) => setFps(value)}
              />
            ) : null}

            <p role="status" aria-live="polite" className="rounded-lg border border-white/10 bg-surface/60 px-3 py-2 text-[11px] text-textMuted">
              {selectedTimestamps.length === 0
                ? "This range contains no decodable frames."
                : selectedTimestamps.length > VIDEO_IMPORT_LIMITS.maxOutputFrames
                  ? `This selection exceeds the ${VIDEO_IMPORT_LIMITS.maxOutputFrames}-frame limit.`
                  : selectionPixelCount > VIDEO_IMPORT_LIMITS.maxOutputPixels
                    ? "This selection exceeds the decoded-pixel limit."
                    : `${selectedTimestamps.length} frame${selectedTimestamps.length === 1 ? "" : "s"} will be stored as PNG assets.`}
            </p>
            {submitError ? <p role="alert" className="text-xs text-rose-300">{submitError}</p> : null}
          </div>
        )}
      </div>

      {inspection.status === "ready" ? (
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-5 py-4">
          <button
            type="button"
            disabled={submitting}
            onClick={onChooseAnother}
            className="min-h-9 rounded-md border border-white/10 px-3 py-2 text-xs font-semibold text-textMuted hover:bg-white/5 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-45"
          >
            Choose another
          </button>
          <button
            ref={startButtonRef}
            type="button"
            disabled={disabled || submitting || !selectionWithinLimits}
            onClick={start}
            className="inline-flex min-h-9 items-center gap-2 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accentHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            {submitting ? <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Film size={13} aria-hidden="true" />}
            {submitting ? "Queueing…" : `Import ${selectedTimestamps.length} frame${selectedTimestamps.length === 1 ? "" : "s"}`}
          </button>
        </footer>
      ) : null}
    </section>
  );
}

export default SliceVideoImportPanel;
