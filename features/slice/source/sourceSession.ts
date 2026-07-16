import {
  closeDecodedSourceImage,
  createBrowserSourceDecoder,
  DEFAULT_SOURCE_MAX_HEIGHT,
  DEFAULT_SOURCE_MAX_PIXELS,
  DEFAULT_SOURCE_MAX_WIDTH,
  normalizeDecodedSourceImage,
  type BrowserSourceDecoderOptions,
  type DecodedSourceImage,
  type SourceDecodeError,
  type SourceDecoder,
} from "./browserSourceDecoder";
import {
  SOURCE_MAX_FILE_SIZE_BYTES,
  SOURCE_MULTI_FILE_POLICY,
  prepareSourceFile,
  selectSourceFileInput,
  type PreparedSourceFile,
  type SourceFileError,
  type SourceFileInput,
  type SourceFileMetadata,
  type SourceMultiFilePolicy,
} from "./sourceFilePolicy";

export type { SourceDecoder };

export const SOURCE_SESSION_STATUSES = Object.freeze([
  "idle",
  "validating",
  "decoding",
  "ready",
  "error",
] as const);
export type SourceSessionStatus = (typeof SOURCE_SESSION_STATUSES)[number];

export type SourceSessionErrorCode = SourceFileError["code"] | SourceDecodeError["code"];

export interface SourceSessionError {
  readonly code: SourceSessionErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export interface SourceReadyMetadata extends SourceFileMetadata {
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
}

export interface SourceSessionResource {
  /** Opaque decoded value (normally an ImageBitmap) for the future preview adapter. */
  readonly image: unknown;
  readonly width: number;
  readonly height: number;
}

interface SourceSessionBaseSnapshot {
  readonly generation: number;
  readonly disposed: boolean;
}

export type SourceSessionSnapshot =
  | (SourceSessionBaseSnapshot & {
    readonly status: "idle";
    readonly metadata: null;
    readonly candidateMetadata?: null;
    readonly source: null;
    readonly error: null;
  })
  | (SourceSessionBaseSnapshot & {
    readonly status: "validating" | "decoding";
    readonly metadata: SourceReadyMetadata | null;
    readonly candidateMetadata?: SourceFileMetadata | null;
    readonly source: SourceSessionResource | null;
    readonly error: null;
  })
  | (SourceSessionBaseSnapshot & {
    readonly status: "ready";
    readonly metadata: SourceReadyMetadata;
    readonly candidateMetadata?: null;
    readonly source: SourceSessionResource;
    readonly error: null;
  })
  | (SourceSessionBaseSnapshot & {
    readonly status: "error";
    readonly metadata: SourceReadyMetadata | null;
    readonly candidateMetadata?: SourceFileMetadata | null;
    readonly source: SourceSessionResource | null;
    readonly error: SourceSessionError;
  });

export type SourceSessionListener = () => void;

export interface SourceSessionOptions {
  readonly decoder?: SourceDecoder;
  readonly decoderOptions?: BrowserSourceDecoderOptions;
  readonly multiFilePolicy?: SourceMultiFilePolicy;
  readonly maxFileBytes?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly maxPixels?: number;
}

export interface SourceSelectOptions {
  readonly signal?: AbortSignal;
}

export type SourceSelectionInput =
  | SourceFileInput
  | readonly SourceFileInput[]
  | FileList
  | null
  | undefined;

const INITIAL_SNAPSHOT: SourceSessionSnapshot = Object.freeze({
  status: "idle",
  generation: 0,
  disposed: false,
  metadata: null,
  candidateMetadata: null,
  source: null,
  error: null,
});

const SOURCE_SESSION_ERROR_CODES = Object.freeze([
  "invalid-input",
  "unsupported-mime",
  "magic-mismatch",
  "too-large",
  "multiple-files",
  "read-failed",
  "aborted",
  "decode",
  "memory",
  "cancelled",
] as const satisfies readonly SourceSessionErrorCode[]);

const SOURCE_SESSION_ERROR_DEFINITIONS: Readonly<
  Record<SourceSessionErrorCode, Readonly<{ message: string; retryable: boolean }>>
> = Object.freeze({
  "decode": Object.freeze({ message: "Image source could not be decoded.", retryable: true }),
  "memory": Object.freeze({ message: "Image source dimensions exceed the safe decode limits.", retryable: false }),
  "cancelled": Object.freeze({ message: "Image source decode was cancelled.", retryable: true }),
  "aborted": Object.freeze({ message: "Image source operation was aborted.", retryable: false }),
  "read-failed": Object.freeze({ message: "Image source bytes could not be read.", retryable: false }),
  "invalid-input": Object.freeze({ message: "Image source input is invalid.", retryable: false }),
  "unsupported-mime": Object.freeze({ message: "Image source MIME type is not supported.", retryable: false }),
  "magic-mismatch": Object.freeze({ message: "Image source bytes do not match its MIME type.", retryable: false }),
  "too-large": Object.freeze({ message: "Image source exceeds the 10 MiB limit.", retryable: false }),
  "multiple-files": Object.freeze({ message: "Select one image source at a time.", retryable: false }),
});

function createSessionError(code: SourceSessionErrorCode): SourceSessionError {
  const definition = SOURCE_SESSION_ERROR_DEFINITIONS[code];
  return Object.freeze({ code, message: definition.message, retryable: definition.retryable });
}

function captureSessionError(value: unknown): SourceSessionError | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const codeDescriptor = descriptors.code;
    const messageDescriptor = descriptors.message;
    const retryableDescriptor = descriptors.retryable;
    if (
      !codeDescriptor?.enumerable || !("value" in codeDescriptor) ||
      !messageDescriptor?.enumerable || !("value" in messageDescriptor) ||
      !retryableDescriptor?.enumerable || !("value" in retryableDescriptor) ||
      typeof codeDescriptor.value !== "string" ||
      !(SOURCE_SESSION_ERROR_CODES as readonly string[]).includes(codeDescriptor.value) ||
      typeof messageDescriptor.value !== "string" ||
      typeof retryableDescriptor.value !== "boolean"
    ) {
      return null;
    }
    return createSessionError(codeDescriptor.value as SourceSessionErrorCode);
  } catch {
    return null;
  }
}

function mapError(error: unknown): SourceSessionError {
  return captureSessionError(error) ?? createSessionError("decode");
}

function freezeMetadata(metadata: SourceFileMetadata): SourceFileMetadata {
  return Object.freeze({
    name: metadata.name,
    declaredMimeType: metadata.declaredMimeType,
    mimeType: metadata.mimeType,
    format: metadata.format,
    size: metadata.size,
    lastModified: metadata.lastModified,
  });
}

function freezeReadyMetadata(metadata: SourceFileMetadata, width: number, height: number): SourceReadyMetadata {
  return Object.freeze({
    ...freezeMetadata(metadata),
    width,
    height,
    pixelCount: width * height,
  });
}

function freezeResource(decoded: DecodedSourceImage): SourceSessionResource {
  return Object.freeze({
    image: decoded.image,
    width: decoded.width,
    height: decoded.height,
  });
}

function detachPreparedSource(source: PreparedSourceFile): PreparedSourceFile {
  // The policy already detached bytes.  Keep a second byte copy for retry so
  // a hostile caller cannot retain and alter the same typed-array reference.
  const bytes = new Uint8Array(source.bytes).slice();
  const blob = new Blob([bytes], { type: source.metadata.mimeType });
  const detached: PreparedSourceFile = {
    blob,
    metadata: freezeMetadata(source.metadata),
    get bytes(): Readonly<Uint8Array> {
      return bytes.slice();
    },
  };
  return Object.freeze(detached);
}

function validateSessionDecoded(
  decoded: DecodedSourceImage,
  maxWidth: number,
  maxHeight: number,
  maxPixels: number,
): SourceSessionError | null {
  const { width, height, image } = decoded;
  if (
    image === null || image === undefined ||
    !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
    width <= 0 || height <= 0
  ) {
    closeDecodedSourceImage(decoded);
    return createSessionError("decode");
  }
  if (width > maxWidth || height > maxHeight || width > Math.floor(maxPixels / height)) {
    closeDecodedSourceImage(decoded);
    return createSessionError("memory");
  }
  return null;
}

/**
 * A feature-local, ephemeral source state machine.  It owns only the selected
 * bytes and decoded resource; durable project state remains in AssetRepository.
 */
export class SourceSession {
  private readonly decoder: SourceDecoder;
  private readonly multiFilePolicy: SourceMultiFilePolicy;
  private readonly maxFileBytes: number;
  private readonly maxWidth: number;
  private readonly maxHeight: number;
  private readonly maxPixels: number;
  private readonly listeners = new Set<SourceSessionListener>();
  private snapshot: SourceSessionSnapshot = INITIAL_SNAPSHOT;
  private generation = 0;
  private disposed = false;
  private activeController: AbortController | null = null;
  private activeExternalAbortCleanup: (() => void) | null = null;
  private ownedBlob: Blob | null = null;
  private ownedResource: DecodedSourceImage | null = null;
  private ownedMetadata: SourceReadyMetadata | null = null;
  private ownedPublicSource: SourceSessionResource | null = null;
  private retrySource: PreparedSourceFile | null = null;
  private retryGeneration: number | null = null;

  constructor(options: SourceSessionOptions = {}) {
    this.decoder = options.decoder ?? createBrowserSourceDecoder(options.decoderOptions);
    this.multiFilePolicy = options.multiFilePolicy ?? SOURCE_MULTI_FILE_POLICY;
    if (this.multiFilePolicy !== "first" && this.multiFilePolicy !== "reject") {
      throw new TypeError("Image source multi-file policy is invalid.");
    }
    this.maxFileBytes = options.maxFileBytes ?? SOURCE_MAX_FILE_SIZE_BYTES;
    if (!Number.isSafeInteger(this.maxFileBytes) || this.maxFileBytes < 1) {
      throw new TypeError("Image source byte limit is invalid.");
    }
    this.maxWidth = options.maxWidth ?? options.decoderOptions?.maxWidth ?? DEFAULT_SOURCE_MAX_WIDTH;
    this.maxHeight = options.maxHeight ?? options.decoderOptions?.maxHeight ?? DEFAULT_SOURCE_MAX_HEIGHT;
    this.maxPixels = options.maxPixels ?? options.decoderOptions?.maxPixels ?? DEFAULT_SOURCE_MAX_PIXELS;
    if (!Number.isSafeInteger(this.maxWidth) || this.maxWidth < 1) {
      throw new TypeError("Image source width limit is invalid.");
    }
    if (!Number.isSafeInteger(this.maxHeight) || this.maxHeight < 1) {
      throw new TypeError("Image source height limit is invalid.");
    }
    if (!Number.isSafeInteger(this.maxPixels) || this.maxPixels < 1) {
      throw new TypeError("Image source pixel limit is invalid.");
    }
  }

  getSnapshot(): SourceSessionSnapshot {
    return this.snapshot;
  }

  subscribe(listener: SourceSessionListener): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("Source session subscriber must be a function.");
    }
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    let subscribed = true;
    return (): void => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  /** Return a detached Blob copy; runtime URLs are intentionally not exposed. */
  getBlob(): Blob | null {
    if (this.ownedBlob === null) return null;
    return this.ownedBlob.slice(0, this.ownedBlob.size, this.ownedBlob.type);
  }

  async select(
    input: SourceSelectionInput,
    options: SourceSelectOptions = {},
  ): Promise<SourceSessionSnapshot> {
    if (this.disposed) return this.snapshot;
    // Picker cancel is a no-op, matching the donor and preserving the current source.
    if (input === null || input === undefined) return this.snapshot;
    const selection = selectSourceFileInput(input, this.multiFilePolicy);
    const retainedSource = this.ownedPublicSource;
    const retainedMetadata = this.ownedMetadata;
    const generation = this.beginOperation(options.signal);
    this.clearRetrySource();
    const controller = this.activeController;
    if (selection.error || selection.input === null) {
      const error = selection.error ? mapError(selection.error) : createSessionError("invalid-input");
      this.publish({
        status: "error",
        generation,
        disposed: false,
        metadata: retainedMetadata,
        candidateMetadata: null,
        source: retainedSource,
        error,
      });
      this.finishOperation(controller);
      return this.snapshot;
    }

    this.publish({
      status: "validating",
      generation,
      disposed: false,
      metadata: retainedMetadata,
      candidateMetadata: null,
      source: retainedSource,
      error: null,
    });
    let prepared: Awaited<ReturnType<typeof prepareSourceFile>>;
    try {
      prepared = await prepareSourceFile(selection.input, {
        signal: controller?.signal,
        maxBytes: this.maxFileBytes,
      });
    } catch (error) {
      if (!this.isCurrent(generation, controller)) return this.snapshot;
      this.publish({
        status: "error",
        generation,
        disposed: false,
        metadata: retainedMetadata,
        candidateMetadata: null,
        source: retainedSource,
        error: mapError(error),
      });
      this.finishOperation(controller);
      return this.snapshot;
    }
    if (!this.isCurrent(generation, controller)) return this.snapshot;
    if (!prepared.valid) {
      this.publish({
        status: "error",
        generation,
        disposed: false,
        metadata: retainedMetadata,
        candidateMetadata: null,
        source: retainedSource,
        error: mapError(prepared.error),
      });
      this.finishOperation(controller);
      return this.snapshot;
    }

    const detached = detachPreparedSource(prepared.source);
    this.retrySource = detached;
    this.retryGeneration = generation;
    this.publish({
      status: "decoding",
      generation,
      disposed: false,
      metadata: retainedMetadata,
      candidateMetadata: detached.metadata,
      source: retainedSource,
      error: null,
    });
    try {
      const rawDecoded: unknown = await this.decoder.decode(detached.blob, { signal: controller?.signal });
      if (!this.isCurrent(generation, controller) || (controller?.signal.aborted ?? false)) {
        closeDecodedSourceImage(rawDecoded);
        if (this.isCurrent(generation, controller)) {
          this.publishCandidateError(
            generation,
            retainedMetadata,
            detached.metadata,
            retainedSource,
            createSessionError("cancelled"),
          );
          this.finishOperation(controller);
        }
        return this.snapshot;
      }
      const normalized = normalizeDecodedSourceImage(rawDecoded);
      if (!normalized.ok) {
        this.publishCandidateError(
          generation,
          retainedMetadata,
          detached.metadata,
          retainedSource,
          mapError(normalized.error),
        );
        this.finishOperation(controller);
        return this.snapshot;
      }
      const decoded = normalized.decoded;
      const decodedError = validateSessionDecoded(
        decoded,
        this.maxWidth,
        this.maxHeight,
        this.maxPixels,
      );
      if (decodedError) {
        this.publish({
          status: "error",
          generation,
          disposed: false,
          metadata: retainedMetadata,
          candidateMetadata: detached.metadata,
          source: retainedSource,
          error: decodedError,
        });
        if (!decodedError.retryable) this.clearRetrySource();
        this.finishOperation(controller);
        return this.snapshot;
      }
      const metadata = freezeReadyMetadata(detached.metadata, decoded.width, decoded.height);
      // Swap atomically only after validation and decode have succeeded.  A
      // bad replacement therefore cannot destroy a ready source.
      this.releaseOwnedSource();
      this.ownedBlob = detached.blob;
      this.ownedResource = decoded;
      this.ownedMetadata = metadata;
      this.ownedPublicSource = freezeResource(decoded);
      this.clearRetrySource();
      this.publish({
        status: "ready",
        generation,
        disposed: false,
        metadata,
        candidateMetadata: null,
        source: this.ownedPublicSource,
        error: null,
      });
      this.finishOperation(controller);
      return this.snapshot;
    } catch (error) {
      if (!this.isCurrent(generation, controller)) return this.snapshot;
      this.publishCandidateError(
        generation,
        retainedMetadata,
        detached.metadata,
        retainedSource,
        mapError(error),
      );
      this.finishOperation(controller);
      return this.snapshot;
    }
  }

  async retry(options: SourceSelectOptions = {}): Promise<SourceSessionSnapshot> {
    if (
      this.disposed || this.retrySource === null || this.retryGeneration !== this.snapshot.generation ||
      this.snapshot.status !== "error" || !this.snapshot.error.retryable
    ) {
      return this.snapshot;
    }
    const source = detachPreparedSource(this.retrySource);
    const retainedSource = this.ownedPublicSource;
    const retainedMetadata = this.ownedMetadata;
    const generation = this.beginOperation(options.signal);
    this.retrySource = source;
    this.retryGeneration = generation;
    this.publish({
      status: "validating",
      generation,
      disposed: false,
      metadata: retainedMetadata,
      candidateMetadata: source.metadata,
      source: retainedSource,
      error: null,
    });
    const controller = this.activeController;
    if (controller?.signal.aborted) {
      this.publish({
        status: "error",
        generation,
        disposed: false,
        metadata: retainedMetadata,
        candidateMetadata: source.metadata,
        source: retainedSource,
        error: createSessionError("cancelled"),
      });
      this.finishOperation(controller);
      return this.snapshot;
    }
    this.publish({
      status: "decoding",
      generation,
      disposed: false,
      metadata: retainedMetadata,
      candidateMetadata: source.metadata,
      source: retainedSource,
      error: null,
    });
    try {
      const rawDecoded: unknown = await this.decoder.decode(source.blob, { signal: controller?.signal });
      if (!this.isCurrent(generation, controller) || (controller?.signal.aborted ?? false)) {
        closeDecodedSourceImage(rawDecoded);
        if (this.isCurrent(generation, controller)) {
          this.publishCandidateError(
            generation,
            retainedMetadata,
            source.metadata,
            retainedSource,
            createSessionError("cancelled"),
          );
          this.finishOperation(controller);
        }
        return this.snapshot;
      }
      const normalized = normalizeDecodedSourceImage(rawDecoded);
      if (!normalized.ok) {
        this.publishCandidateError(
          generation,
          retainedMetadata,
          source.metadata,
          retainedSource,
          mapError(normalized.error),
        );
        this.finishOperation(controller);
        return this.snapshot;
      }
      const decoded = normalized.decoded;
      const decodedError = validateSessionDecoded(
        decoded,
        this.maxWidth,
        this.maxHeight,
        this.maxPixels,
      );
      if (decodedError) {
        this.publish({
          status: "error",
          generation,
          disposed: false,
          metadata: retainedMetadata,
          candidateMetadata: source.metadata,
          source: retainedSource,
          error: decodedError,
        });
        if (!decodedError.retryable) this.clearRetrySource();
        this.finishOperation(controller);
        return this.snapshot;
      }
      this.releaseOwnedSource();
      this.ownedBlob = source.blob;
      this.ownedResource = decoded;
      this.ownedMetadata = freezeReadyMetadata(source.metadata, decoded.width, decoded.height);
      this.ownedPublicSource = freezeResource(decoded);
      this.clearRetrySource();
      this.publish({
        status: "ready",
        generation,
        disposed: false,
        metadata: this.ownedMetadata,
        candidateMetadata: null,
        source: this.ownedPublicSource,
        error: null,
      });
      this.finishOperation(controller);
      return this.snapshot;
    } catch (error) {
      if (!this.isCurrent(generation, controller)) return this.snapshot;
      this.publishCandidateError(
        generation,
        retainedMetadata,
        source.metadata,
        retainedSource,
        mapError(error),
      );
      this.finishOperation(controller);
      return this.snapshot;
    }
  }

  reset(): void {
    if (this.disposed) return;
    this.abortOperation();
    this.releaseOwnedSource();
    this.clearRetrySource();
    const generation = ++this.generation;
    this.publish({
      status: "idle",
      generation,
      disposed: false,
      metadata: null,
      candidateMetadata: null,
      source: null,
      error: null,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    // Abort first.  A late decoder result must never observe released state.
    this.abortOperation();
    this.releaseOwnedSource();
    this.clearRetrySource();
    this.disposed = true;
    const generation = ++this.generation;
    this.publish({
      status: "idle",
      generation,
      disposed: true,
      metadata: null,
      candidateMetadata: null,
      source: null,
      error: null,
    });
    this.listeners.clear();
  }

  private beginOperation(externalSignal: AbortSignal | undefined): number {
    this.abortOperation();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.activeController = controller;
    if (externalSignal) {
      const abort = (): void => controller.abort();
      externalSignal.addEventListener("abort", abort, { once: true });
      this.activeExternalAbortCleanup = (): void => externalSignal.removeEventListener("abort", abort);
      if (externalSignal.aborted) controller.abort();
    }
    return generation;
  }

  private finishOperation(controller: AbortController | null): void {
    if (this.activeController !== controller) return;
    this.activeController = null;
    this.activeExternalAbortCleanup?.();
    this.activeExternalAbortCleanup = null;
  }

  private abortOperation(): void {
    const controller = this.activeController;
    this.activeController = null;
    this.activeExternalAbortCleanup?.();
    this.activeExternalAbortCleanup = null;
    try {
      controller?.abort();
    } catch {
      // Native AbortController is expected not to throw; state remains authoritative.
    }
  }

  private releaseOwnedSource(): void {
    const resource = this.ownedResource;
    this.ownedResource = null;
    this.ownedBlob = null;
    this.ownedMetadata = null;
    this.ownedPublicSource = null;
    if (resource !== null) closeDecodedSourceImage(resource);
  }

  private clearRetrySource(): void {
    this.retrySource = null;
    this.retryGeneration = null;
  }

  private publishCandidateError(
    generation: number,
    metadata: SourceReadyMetadata | null,
    candidateMetadata: SourceFileMetadata,
    source: SourceSessionResource | null,
    error: SourceSessionError,
  ): void {
    if (!error.retryable) this.clearRetrySource();
    this.publish({
      status: "error",
      generation,
      disposed: false,
      metadata,
      candidateMetadata,
      source,
      error,
    });
  }

  private isCurrent(generation: number, controller: AbortController | null): boolean {
    return !this.disposed && this.generation === generation && this.activeController === controller;
  }

  private publish(next: Omit<SourceSessionSnapshot, "disposed"> & { readonly disposed?: boolean }): void {
    const snapshot = Object.freeze({
      ...next,
      disposed: next.disposed ?? this.disposed,
    }) as SourceSessionSnapshot;
    this.snapshot = snapshot;
    for (const listener of Array.from(this.listeners)) {
      if (!this.listeners.has(listener)) continue;
      try {
        listener();
      } catch {
        // A subscriber cannot corrupt the session state or block other listeners.
      }
    }
  }
}

export function createSourceSession(options: SourceSessionOptions = {}): SourceSession {
  return new SourceSession(options);
}
