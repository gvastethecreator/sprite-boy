import {
  VIDEO_IMPORT_LIMITS,
  VideoMediaError,
  type VideoSampling,
  type VideoTimeRange,
} from "./videoContracts";

export const MICROSECONDS_PER_SECOND = 1_000_000;

export function secondsToMicroseconds(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    throw new VideoMediaError("VIDEO_INVALID_INPUT", "The video time must be finite.");
  }

  const microseconds = Math.round(seconds * MICROSECONDS_PER_SECOND);
  if (!Number.isSafeInteger(microseconds)) {
    throw new VideoMediaError("VIDEO_LIMIT_EXCEEDED", "The video time exceeds the safe range.");
  }
  return microseconds;
}

export function microsecondsToSeconds(microseconds: number): number {
  if (!Number.isSafeInteger(microseconds)) {
    throw new VideoMediaError("VIDEO_INVALID_INPUT", "The video time must be a safe integer.");
  }
  return microseconds / MICROSECONDS_PER_SECOND;
}

export function normalizeVideoTimeline(firstTimestampUs: number, endTimestampUs: number) {
  if (!Number.isSafeInteger(firstTimestampUs) || !Number.isSafeInteger(endTimestampUs)) {
    throw new VideoMediaError("VIDEO_INVALID_INPUT", "The video timeline is invalid.");
  }

  const timelineOffsetUs = Math.max(0, firstTimestampUs);
  const durationUs = endTimestampUs - timelineOffsetUs;
  if (durationUs <= 0) {
    throw new VideoMediaError("VIDEO_INVALID_INPUT", "The video has no visible duration.");
  }
  return { durationUs, timelineOffsetUs };
}

function normalizedUniqueTimestamps(timestampsUs: readonly number[]): number[] {
  const values = timestampsUs.filter(
    (value) => Number.isSafeInteger(value) && value >= 0,
  );
  values.sort((left, right) => left - right);
  return values.filter((value, index) => index === 0 || value !== values[index - 1]);
}

export function validateVideoSelection(range: VideoTimeRange, sampling: VideoSampling): void {
  if (
    !Number.isSafeInteger(range.startUs) ||
    !Number.isSafeInteger(range.endUs) ||
    range.startUs < 0 ||
    range.endUs <= range.startUs
  ) {
    throw new VideoMediaError("VIDEO_INVALID_INPUT", "The extraction range is invalid.");
  }

  if (
    sampling.mode === "fps" &&
    (!Number.isFinite(sampling.fps) ||
      sampling.fps <= 0 ||
      sampling.fps > VIDEO_IMPORT_LIMITS.maxSamplingFps)
  ) {
    throw new VideoMediaError("VIDEO_LIMIT_EXCEEDED", "The sampling rate is outside the allowed range.", {
      details: { maxSamplingFps: VIDEO_IMPORT_LIMITS.maxSamplingFps },
    });
  }
}

/** Selects real presentation timestamps. FPS targets resolve to the nearest frame; ties use the earlier frame. */
export function selectVideoFrameTimestamps(
  timestampsUs: readonly number[],
  range: VideoTimeRange,
  sampling: VideoSampling,
): number[] {
  validateVideoSelection(range, sampling);
  const available = normalizedUniqueTimestamps(timestampsUs).filter(
    (timestampUs) => timestampUs >= range.startUs && timestampUs < range.endUs,
  );
  if (sampling.mode === "all" || available.length <= 1) return available;

  const intervalUs = MICROSECONDS_PER_SECOND / sampling.fps;
  const selected: number[] = [];
  let cursor = 0;

  for (let targetUs = range.startUs; targetUs < range.endUs; targetUs += intervalUs) {
    while (
      cursor + 1 < available.length &&
      Math.abs(available[cursor + 1] - targetUs) < Math.abs(available[cursor] - targetUs)
    ) {
      cursor += 1;
    }
    const timestampUs = available[cursor];
    if (selected.at(-1) !== timestampUs) selected.push(timestampUs);
  }

  return selected;
}

export function detectVariableFrameRate(timestampsUs: readonly number[]): boolean {
  const values = normalizedUniqueTimestamps(timestampsUs);
  if (values.length < 3) return false;

  const deltas = values.slice(1).map((value, index) => value - values[index]);
  const sorted = [...deltas].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  const toleranceUs = Math.max(2, median * 0.02);
  return deltas.some((delta) => Math.abs(delta - median) > toleranceUs);
}
