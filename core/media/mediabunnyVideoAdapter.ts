import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  EncodedPacketSink,
  Input,
  InputDisposedError,
  UnsupportedInputFormatError,
  type InputVideoTrack,
  type WrappedCanvas,
} from "mediabunny";
import {
  VIDEO_IMPORT_LIMITS,
  VideoMediaError,
  type VideoExtractedFrame,
  type VideoExtractOptions,
  type VideoPreflight,
} from "./videoContracts";
import {
  detectVariableFrameRate,
  normalizeVideoTimeline,
  secondsToMicroseconds,
  selectVideoFrameTimestamps,
  validateVideoSelection,
} from "./videoSampling";

interface OpenVideo {
  input: Input<BlobSource>;
  track: InputVideoTrack;
  preflight: VideoPreflight;
  actualSecondsByTimestampUs: ReadonlyMap<number, number>;
}

function cancelledError(cause?: unknown): VideoMediaError {
  return new VideoMediaError("VIDEO_CANCELLED", "Video extraction was cancelled.", { cause });
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledError(signal.reason);
}

function assertBlob(blob: Blob): void {
  if (!(blob instanceof Blob) || blob.size <= 0) {
    throw new VideoMediaError("VIDEO_INVALID_INPUT", "Choose a non-empty video file.");
  }
  if (blob.size > VIDEO_IMPORT_LIMITS.maxFileBytes) {
    throw new VideoMediaError("VIDEO_LIMIT_EXCEEDED", "The video file exceeds the allowed size.", {
      details: { byteSize: blob.size, maxFileBytes: VIDEO_IMPORT_LIMITS.maxFileBytes },
    });
  }
}

function safeMimeType(blob: Blob): string {
  return blob.type.toLowerCase().startsWith("video/") ? blob.type.toLowerCase() : "video/unknown";
}

function mapReadError(error: unknown, signal?: AbortSignal): VideoMediaError {
  if (error instanceof VideoMediaError) return error;
  if (signal?.aborted || error instanceof InputDisposedError) return cancelledError(error);
  if (error instanceof UnsupportedInputFormatError) {
    return new VideoMediaError("VIDEO_UNSUPPORTED_FORMAT", "The file format cannot be read.", {
      cause: error,
    });
  }
  return new VideoMediaError("VIDEO_DECODE_FAILED", "The video could not be read.", { cause: error });
}

async function encodeCanvasAsPng(canvas: WrappedCanvas["canvas"]): Promise<Blob> {
  try {
    if ("convertToBlob" in canvas && typeof canvas.convertToBlob === "function") {
      return await canvas.convertToBlob({ type: "image/png" });
    }
    if ("toBlob" in canvas && typeof canvas.toBlob === "function") {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob) return blob;
    }
  } catch (error) {
    throw new VideoMediaError("VIDEO_ENCODE_FAILED", "The frame could not be encoded as PNG.", {
      cause: error,
    });
  }
  throw new VideoMediaError("VIDEO_ENCODE_FAILED", "The browser cannot encode this frame.");
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new VideoMediaError("VIDEO_INVALID_INPUT", "The video track has invalid dimensions.");
  }
  const pixels = width * height;
  if (
    width > VIDEO_IMPORT_LIMITS.maxDimension ||
    height > VIDEO_IMPORT_LIMITS.maxDimension ||
    pixels > VIDEO_IMPORT_LIMITS.maxFramePixels
  ) {
    throw new VideoMediaError("VIDEO_LIMIT_EXCEEDED", "The video dimensions exceed the allowed limit.", {
      details: { width, height, maxDimension: VIDEO_IMPORT_LIMITS.maxDimension },
    });
  }
}

export class MediabunnyVideoAdapter {
  async preflight(blob: Blob, options: { trackIndex?: number; signal?: AbortSignal } = {}) {
    const opened = await this.open(blob, options.trackIndex ?? 0, options.signal);
    opened.input.dispose();
    return opened.preflight;
  }

  async extractFrames(blob: Blob, options: VideoExtractOptions): Promise<VideoExtractedFrame[]> {
    validateVideoSelection(options.range, options.sampling);
    const opened = await this.open(blob, options.trackIndex, options.signal);
    const onAbort = () => opened.input.dispose();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      assertNotAborted(options.signal);
      if (!opened.preflight.decodable) {
        throw new VideoMediaError(
          "VIDEO_CODEC_UNSUPPORTED",
          `The browser cannot decode the ${opened.preflight.track.codec} codec.`,
          { details: { codec: opened.preflight.track.codec } },
        );
      }
      if (options.range.endUs > opened.preflight.durationUs) {
        throw new VideoMediaError("VIDEO_INVALID_INPUT", "The range exceeds the video duration.");
      }

      const timestampsUs = selectVideoFrameTimestamps(
        opened.preflight.sampleTimestampsUs,
        options.range,
        options.sampling,
      );
      const outputPixels =
        timestampsUs.length * opened.preflight.track.displayWidth * opened.preflight.track.displayHeight;
      if (
        timestampsUs.length > VIDEO_IMPORT_LIMITS.maxOutputFrames ||
        outputPixels > VIDEO_IMPORT_LIMITS.maxOutputPixels
      ) {
        throw new VideoMediaError("VIDEO_LIMIT_EXCEEDED", "The extraction would produce too many frames.", {
          details: {
            frameCount: timestampsUs.length,
            maxOutputFrames: VIDEO_IMPORT_LIMITS.maxOutputFrames,
          },
        });
      }

      options.onProgress?.({ completed: 0, total: timestampsUs.length, ratio: 0 });
      if (timestampsUs.length === 0) return [];

      const actualTimestamps = timestampsUs.map((timestampUs) => {
        const seconds = opened.actualSecondsByTimestampUs.get(timestampUs);
        if (seconds === undefined) {
          throw new VideoMediaError("VIDEO_FRAME_UNAVAILABLE", "The frame timestamp is unavailable.");
        }
        return seconds;
      });
      const sink = new CanvasSink(opened.track, { alpha: true, poolSize: 2 });
      const frames: VideoExtractedFrame[] = [];
      let index = 0;

      for await (const wrapped of sink.canvasesAtTimestamps(actualTimestamps)) {
        assertNotAborted(options.signal);
        if (!wrapped) {
          throw new VideoMediaError("VIDEO_FRAME_UNAVAILABLE", "One of the frames could not be decoded.");
        }
        const blob = await encodeCanvasAsPng(wrapped.canvas);
        assertNotAborted(options.signal);
        if (blob.size <= 0 || blob.type !== "image/png") {
          throw new VideoMediaError("VIDEO_ENCODE_FAILED", "The frame PNG is empty or invalid.");
        }
        const timestampUs = timestampsUs[index];
        frames.push({
          blob,
          mimeType: "image/png",
          timestampUs,
          durationUs: Math.max(0, secondsToMicroseconds(wrapped.duration)),
          width: wrapped.canvas.width,
          height: wrapped.canvas.height,
        });
        index += 1;
        options.onProgress?.({
          completed: index,
          total: timestampsUs.length,
          ratio: index / timestampsUs.length,
        });
      }

      if (frames.length !== timestampsUs.length) {
        throw new VideoMediaError("VIDEO_FRAME_UNAVAILABLE", "The extraction returned fewer frames than requested.");
      }
      return frames;
    } catch (error) {
      throw mapReadError(error, options.signal);
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      opened.input.dispose();
    }
  }

  private async open(blob: Blob, trackIndex: number, signal?: AbortSignal): Promise<OpenVideo> {
    assertNotAborted(signal);
    assertBlob(blob);
    if (!Number.isSafeInteger(trackIndex) || trackIndex < 0) {
      throw new VideoMediaError("VIDEO_TRACK_NOT_FOUND", "The track index is invalid.");
    }

    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const onAbort = () => input.dispose();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      if (!(await input.canRead())) {
        throw new VideoMediaError("VIDEO_UNSUPPORTED_FORMAT", "The file format cannot be read.");
      }
      const tracks = await input.getVideoTracks();
      if (tracks.length === 0) {
        throw new VideoMediaError("VIDEO_TRACK_MISSING", "The file does not contain a video track.");
      }
      const track = tracks[trackIndex];
      if (!track) {
        throw new VideoMediaError("VIDEO_TRACK_NOT_FOUND", "The selected video track does not exist.", {
          details: { trackIndex, trackCount: tracks.length },
        });
      }

      const [codecParameter, codec, codedWidth, codedHeight, displayWidth, displayHeight, rotation, first, end] =
        await Promise.all([
          track.getCodecParameterString(),
          track.getCodec(),
          track.getCodedWidth(),
          track.getCodedHeight(),
          track.getDisplayWidth(),
          track.getDisplayHeight(),
          track.getRotation(),
          track.getFirstTimestamp(),
          track.computeDuration(),
        ]);
      validateDimensions(displayWidth, displayHeight);
      validateDimensions(codedWidth, codedHeight);

      const { durationUs, timelineOffsetUs } = normalizeVideoTimeline(
        secondsToMicroseconds(first),
        secondsToMicroseconds(end),
      );
      if (durationUs > VIDEO_IMPORT_LIMITS.maxDurationUs) {
        throw new VideoMediaError("VIDEO_LIMIT_EXCEEDED", "The video duration exceeds the allowed limit.", {
          details: { durationUs, maxDurationUs: VIDEO_IMPORT_LIMITS.maxDurationUs },
        });
      }

      const packetSink = new EncodedPacketSink(track);
      const sampleTimestampsUs: number[] = [];
      const actualSecondsByTimestampUs = new Map<number, number>();
      for await (const packet of packetSink.packets(undefined, undefined, { metadataOnly: true })) {
        assertNotAborted(signal);
        if (packet.timestamp < 0) continue;
        const timestampUs = secondsToMicroseconds(packet.timestamp) - timelineOffsetUs;
        if (timestampUs < 0 || timestampUs >= durationUs || actualSecondsByTimestampUs.has(timestampUs)) continue;
        sampleTimestampsUs.push(timestampUs);
        actualSecondsByTimestampUs.set(timestampUs, packet.timestamp);
        if (sampleTimestampsUs.length > VIDEO_IMPORT_LIMITS.maxMetadataFrames) {
          throw new VideoMediaError("VIDEO_LIMIT_EXCEEDED", "The video contains too many frames.", {
            details: { maxMetadataFrames: VIDEO_IMPORT_LIMITS.maxMetadataFrames },
          });
        }
      }
      sampleTimestampsUs.sort((left, right) => left - right);
      if (sampleTimestampsUs.length === 0) {
        throw new VideoMediaError("VIDEO_TRACK_MISSING", "The video track contains no visible frames.");
      }

      let decodable = false;
      try {
        decodable = await track.canDecode();
      } catch {
        decodable = false;
      }
      const codecName = codecParameter ?? codec ?? "desconocido";
      const frameRate = (sampleTimestampsUs.length * 1_000_000) / durationUs;
      const frozenTimestamps = Object.freeze([...sampleTimestampsUs]);
      const preflight: VideoPreflight = Object.freeze({
        byteSize: blob.size,
        mimeType: safeMimeType(blob),
        durationUs,
        timelineOffsetUs,
        trackCount: tracks.length,
        track: {
          index: trackIndex,
          codec: codecName,
          codedWidth,
          codedHeight,
          displayWidth,
          displayHeight,
          rotationDegrees: rotation,
          frameRate,
          sampleCount: sampleTimestampsUs.length,
        },
        decodable,
        variableFrameRate: detectVariableFrameRate(sampleTimestampsUs),
        sampleTimestampsUs: frozenTimestamps,
      });
      return { input, track, preflight, actualSecondsByTimestampUs };
    } catch (error) {
      input.dispose();
      throw mapReadError(error, signal);
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }
}
