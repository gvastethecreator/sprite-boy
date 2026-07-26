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
  return new VideoMediaError("VIDEO_CANCELLED", "La extracción de video fue cancelada.", { cause });
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledError(signal.reason);
}

function assertBlob(blob: Blob): void {
  if (!(blob instanceof Blob) || blob.size <= 0) {
    throw new VideoMediaError("VIDEO_INVALID_INPUT", "Selecciona un archivo de video con contenido.");
  }
  if (blob.size > VIDEO_IMPORT_LIMITS.maxFileBytes) {
    throw new VideoMediaError("VIDEO_LIMIT_EXCEEDED", "El archivo de video excede el límite permitido.", {
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
    return new VideoMediaError("VIDEO_UNSUPPORTED_FORMAT", "El formato del archivo no se puede leer.", {
      cause: error,
    });
  }
  return new VideoMediaError("VIDEO_DECODE_FAILED", "No se pudo leer el video.", { cause: error });
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
    throw new VideoMediaError("VIDEO_ENCODE_FAILED", "No se pudo codificar el frame como PNG.", {
      cause: error,
    });
  }
  throw new VideoMediaError("VIDEO_ENCODE_FAILED", "El navegador no puede codificar este frame.");
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new VideoMediaError("VIDEO_INVALID_INPUT", "La pista de video tiene dimensiones inválidas.");
  }
  const pixels = width * height;
  if (
    width > VIDEO_IMPORT_LIMITS.maxDimension ||
    height > VIDEO_IMPORT_LIMITS.maxDimension ||
    pixels > VIDEO_IMPORT_LIMITS.maxFramePixels
  ) {
    throw new VideoMediaError("VIDEO_LIMIT_EXCEEDED", "Las dimensiones del video exceden el límite.", {
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
          `El navegador no puede decodificar el códec ${opened.preflight.track.codec}.`,
          { details: { codec: opened.preflight.track.codec } },
        );
      }
      if (options.range.endUs > opened.preflight.durationUs) {
        throw new VideoMediaError("VIDEO_INVALID_INPUT", "El rango supera la duración del video.");
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
        throw new VideoMediaError("VIDEO_LIMIT_EXCEEDED", "La extracción produciría demasiados frames.", {
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
          throw new VideoMediaError("VIDEO_FRAME_UNAVAILABLE", "No se encontró el tiempo del frame.");
        }
        return seconds;
      });
      const sink = new CanvasSink(opened.track, { alpha: true, poolSize: 2 });
      const frames: VideoExtractedFrame[] = [];
      let index = 0;

      for await (const wrapped of sink.canvasesAtTimestamps(actualTimestamps)) {
        assertNotAborted(options.signal);
        if (!wrapped) {
          throw new VideoMediaError("VIDEO_FRAME_UNAVAILABLE", "No se pudo decodificar uno de los frames.");
        }
        const blob = await encodeCanvasAsPng(wrapped.canvas);
        assertNotAborted(options.signal);
        if (blob.size <= 0 || blob.type !== "image/png") {
          throw new VideoMediaError("VIDEO_ENCODE_FAILED", "El PNG del frame está vacío o es inválido.");
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
        throw new VideoMediaError("VIDEO_FRAME_UNAVAILABLE", "La extracción devolvió menos frames de los pedidos.");
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
      throw new VideoMediaError("VIDEO_TRACK_NOT_FOUND", "El índice de pista no es válido.");
    }

    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const onAbort = () => input.dispose();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      if (!(await input.canRead())) {
        throw new VideoMediaError("VIDEO_UNSUPPORTED_FORMAT", "El formato del archivo no se puede leer.");
      }
      const tracks = await input.getVideoTracks();
      if (tracks.length === 0) {
        throw new VideoMediaError("VIDEO_TRACK_MISSING", "El archivo no contiene una pista de video.");
      }
      const track = tracks[trackIndex];
      if (!track) {
        throw new VideoMediaError("VIDEO_TRACK_NOT_FOUND", "La pista de video elegida no existe.", {
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
        throw new VideoMediaError("VIDEO_LIMIT_EXCEEDED", "La duración del video excede el límite.", {
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
          throw new VideoMediaError("VIDEO_LIMIT_EXCEEDED", "El video contiene demasiados frames.", {
            details: { maxMetadataFrames: VIDEO_IMPORT_LIMITS.maxMetadataFrames },
          });
        }
      }
      sampleTimestampsUs.sort((left, right) => left - right);
      if (sampleTimestampsUs.length === 0) {
        throw new VideoMediaError("VIDEO_TRACK_MISSING", "La pista de video no contiene frames visibles.");
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
