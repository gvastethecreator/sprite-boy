import type { VideoExtractRecipeV1, VideoTrackMetadata } from "@/core/project/schema";

export const VIDEO_IMPORT_LIMITS = Object.freeze({
  maxFileBytes: 2 * 1024 * 1024 * 1024,
  maxDurationUs: 60 * 60 * 1_000_000,
  maxDimension: 16_384,
  maxFramePixels: 67_108_864,
  maxMetadataFrames: 100_000,
  maxOutputFrames: 4_096,
  maxOutputPixels: 536_870_912,
  maxSamplingFps: 240,
});

export type VideoMediaErrorCode =
  | "VIDEO_INVALID_INPUT"
  | "VIDEO_UNSUPPORTED_FORMAT"
  | "VIDEO_TRACK_MISSING"
  | "VIDEO_TRACK_NOT_FOUND"
  | "VIDEO_CODEC_UNSUPPORTED"
  | "VIDEO_LIMIT_EXCEEDED"
  | "VIDEO_CANCELLED"
  | "VIDEO_DECODE_FAILED"
  | "VIDEO_ENCODE_FAILED"
  | "VIDEO_FRAME_UNAVAILABLE";

export interface VideoMediaDiagnostic {
  code: VideoMediaErrorCode;
  message: string;
  details?: Readonly<Record<string, string | number | boolean>>;
}

export class VideoMediaError extends Error {
  readonly code: VideoMediaErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean>>;

  constructor(
    code: VideoMediaErrorCode,
    message: string,
    options: {
      cause?: unknown;
      details?: Readonly<Record<string, string | number | boolean>>;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "VideoMediaError";
    this.code = code;
    this.details = options.details;
  }

  toDiagnostic(): VideoMediaDiagnostic {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export interface VideoPreflight {
  byteSize: number;
  mimeType: string;
  durationUs: number;
  timelineOffsetUs: number;
  trackCount: number;
  track: VideoTrackMetadata;
  decodable: boolean;
  variableFrameRate: boolean;
  sampleTimestampsUs: readonly number[];
}

export type VideoSampling = VideoExtractRecipeV1["sampling"];
export type VideoTimeRange = VideoExtractRecipeV1["range"];

export interface VideoExtractOptions {
  trackIndex: number;
  range: VideoTimeRange;
  sampling: VideoSampling;
  signal?: AbortSignal;
  onProgress?: (progress: VideoExtractProgress) => void;
}

export interface VideoExtractProgress {
  completed: number;
  total: number;
  ratio: number;
}

export interface VideoExtractedFrame {
  blob: Blob;
  mimeType: "image/png";
  timestampUs: number;
  durationUs: number;
  width: number;
  height: number;
}
