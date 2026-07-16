/** Browser decode adapter for Slice source bytes.  It never creates an object URL. */

export const DEFAULT_SOURCE_MAX_WIDTH = 16_384;
export const DEFAULT_SOURCE_MAX_HEIGHT = 16_384;
export const DEFAULT_SOURCE_MAX_PIXELS = 64 * 1024 * 1024;

export const SOURCE_DECODE_ERROR_CODES = Object.freeze([
  "decode",
  "memory",
  "cancelled",
  "invalid-input",
] as const);
export type SourceDecodeErrorCode = (typeof SOURCE_DECODE_ERROR_CODES)[number];

export interface SourceDecodeError {
  readonly code: SourceDecodeErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

/** The image value is opaque to the adapter; ImageBitmap is the normal browser value. */
export interface DecodedSourceImage<TImage = unknown> {
  readonly image: TImage;
  readonly width: number;
  readonly height: number;
  readonly close?: () => void;
}

export interface SourceDecodeOptions {
  readonly signal?: AbortSignal;
}

export interface SourceDecoder {
  decode(blob: Blob, options?: SourceDecodeOptions): Promise<DecodedSourceImage>;
}

export interface BrowserSourceDecoderOptions {
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly maxPixels?: number;
  /** Injected browser primitive for tests, workers, and alternate browser hosts. */
  readonly createImageBitmap?: (
    source: ImageBitmapSource,
    options?: ImageBitmapOptions,
  ) => Promise<ImageBitmap>;
  /** Inject a complete decode implementation when ImageBitmap is unavailable. */
  readonly decode?: (
    blob: Blob,
    options?: SourceDecodeOptions,
  ) => Promise<unknown>;
}

const SOURCE_DECODE_ERROR_DEFINITIONS: Readonly<
  Record<SourceDecodeErrorCode, Readonly<{ message: string; retryable: boolean }>>
> = Object.freeze({
  "decode": Object.freeze({ message: "Image source could not be decoded.", retryable: true }),
  "memory": Object.freeze({ message: "Image source dimensions exceed the safe decode limits.", retryable: false }),
  "cancelled": Object.freeze({ message: "Image source decode was cancelled.", retryable: true }),
  "invalid-input": Object.freeze({ message: "Image source decode input is invalid.", retryable: false }),
});

function makeError(code: SourceDecodeErrorCode): SourceDecodeError {
  const definition = SOURCE_DECODE_ERROR_DEFINITIONS[code];
  return Object.freeze({ code, message: definition.message, retryable: definition.retryable });
}

function captureDecodeError(value: unknown): SourceDecodeError | null {
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
      !(SOURCE_DECODE_ERROR_CODES as readonly string[]).includes(codeDescriptor.value) ||
      typeof messageDescriptor.value !== "string" ||
      typeof retryableDescriptor.value !== "boolean"
    ) {
      return null;
    }
    return makeError(codeDescriptor.value as SourceDecodeErrorCode);
  } catch {
    return null;
  }
}

export function isSourceDecodeError(value: unknown): value is SourceDecodeError {
  return captureDecodeError(value) !== null;
}

function cancelledError(): SourceDecodeError {
  return makeError("cancelled");
}

function normalizeLimit(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return value as number;
}

const NORMALIZED_DECODED_IMAGES = new WeakMap<object, DecodedSourceImage>();
const RETIRED_DECODED_VALUES = new WeakSet<object>();

type NormalizeDecodedResult =
  | { readonly ok: true; readonly decoded: DecodedSourceImage }
  | { readonly ok: false; readonly error: SourceDecodeError };

function once(action: (() => void) | null): (() => void) | undefined {
  if (!action) return undefined;
  let closed = false;
  return (): void => {
    if (closed) return;
    closed = true;
    try {
      action();
    } catch {
      // Resource cleanup is terminal even when a host close implementation throws.
    }
  };
}

function boundClose(owner: object, candidate: unknown): (() => void) | null {
  return typeof candidate === "function"
    ? (): void => Reflect.apply(candidate, owner, [])
    : null;
}

/** Capture an adapter result exactly once into a frozen, session-owned envelope. */
export function normalizeDecodedSourceImage(value: unknown): NormalizeDecodedResult {
  if (value === null || typeof value !== "object") {
    return { ok: false, error: makeError("decode") };
  }
  const existing = NORMALIZED_DECODED_IMAGES.get(value);
  if (existing) return { ok: true, decoded: existing };
  if (RETIRED_DECODED_VALUES.has(value)) {
    return { ok: false, error: makeError("decode") };
  }

  let cleanup: (() => void) | undefined;
  try {
    const rawClose = (value as { close?: unknown }).close;
    cleanup = once(boundClose(value, rawClose));
    const image = (value as { image?: unknown }).image;
    if (!cleanup && image !== null && typeof image === "object") {
      const imageClose = (image as { close?: unknown }).close;
      cleanup = once(boundClose(image, imageClose));
    }
    const width = (value as { width?: unknown }).width;
    const height = (value as { height?: unknown }).height;
    if (image === null || image === undefined) {
      cleanup?.();
      RETIRED_DECODED_VALUES.add(value);
      return { ok: false, error: makeError("decode") };
    }
    const owned = Object.freeze({
      image,
      width: width as number,
      height: height as number,
      ...(cleanup ? { close: cleanup } : {}),
    });
    NORMALIZED_DECODED_IMAGES.set(value, owned);
    NORMALIZED_DECODED_IMAGES.set(owned, owned);
    return { ok: true, decoded: owned };
  } catch {
    cleanup?.();
    RETIRED_DECODED_VALUES.add(value);
    return { ok: false, error: makeError("decode") };
  }
}

export function closeDecodedSourceImage(value: unknown): void {
  const normalized = normalizeDecodedSourceImage(value);
  if (normalized.ok) normalized.decoded.close?.();
}

function getGlobalCreateImageBitmap(): BrowserSourceDecoderOptions["createImageBitmap"] {
  try {
    const candidate = (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
    return typeof candidate === "function"
      ? candidate as BrowserSourceDecoderOptions["createImageBitmap"]
      : undefined;
  } catch {
    return undefined;
  }
}

function nativeAbortSignalPrototype(): object | null {
  try {
    const candidate = globalThis.AbortSignal;
    return typeof candidate === "function" && candidate.prototype
      ? candidate.prototype
      : null;
  } catch {
    return null;
  }
}

/**
 * The decoder accepts a native signal lease only.  Do not read properties or
 * call methods from a caller-provided signal: a proxy/getter can throw, leak
 * data or mutate state while a decode is in flight.  An untrusted signal is
 * conservatively treated as already cancelled.
 */
function isTrustedNativeAbortSignal(signal: AbortSignal | undefined): signal is AbortSignal {
  if (!signal) return false;
  const prototype = nativeAbortSignalPrototype();
  if (!prototype) return false;
  try {
    return Object.getPrototypeOf(signal) === prototype;
  } catch {
    return false;
  }
}

function sourceSignalIsAborted(signal: AbortSignal | undefined): boolean {
  if (!signal) return false;
  if (!isTrustedNativeAbortSignal(signal)) return true;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(nativeAbortSignalPrototype()!, "aborted");
    if (typeof descriptor?.get !== "function") return true;
    return Reflect.apply(descriptor.get, signal, []) === true;
  } catch {
    return true;
  }
}

function nativeAbortSignalMethod(name: "addEventListener" | "removeEventListener"): Function | null {
  let prototype = nativeAbortSignalPrototype();
  try {
    while (prototype && prototype !== Object.prototype) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (typeof descriptor?.value === "function") return descriptor.value;
      prototype = Object.getPrototypeOf(prototype);
    }
  } catch {
    return null;
  }
  return null;
}

function addNativeAbortListener(signal: AbortSignal, listener: () => void): boolean {
  try {
    const add = nativeAbortSignalMethod("addEventListener");
    if (!add) return false;
    Reflect.apply(add, signal, ["abort", listener, { once: true }]);
    return true;
  } catch {
    return false;
  }
}

function removeNativeAbortListener(signal: AbortSignal, listener: () => void): void {
  try {
    const remove = nativeAbortSignalMethod("removeEventListener");
    if (remove) Reflect.apply(remove, signal, ["abort", listener]);
  } catch {
    // Listener cleanup is terminal even if the host object was revoked.
  }
}

async function awaitAbortableDecode<T>(
  work: PromiseLike<T>,
  signal: AbortSignal | undefined,
  onLateValue: (value: T) => void,
): Promise<T> {
  if (!signal) return Promise.resolve(work);
  if (sourceSignalIsAborted(signal)) {
    Promise.resolve(work).then(onLateValue, () => undefined);
    throw cancelledError();
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => removeNativeAbortListener(signal, onAbort);
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = (): void => {
      // The browser primitive has no universal cancellation API.  Reject now,
      // then close a late ImageBitmap when its promise resolves.
      finish(() => reject(cancelledError()));
    };
    if (!addNativeAbortListener(signal, onAbort)) {
      settled = true;
      Promise.resolve(work).then(onLateValue, () => undefined);
      reject(cancelledError());
      return;
    }
    Promise.resolve(work).then(
      (value) => {
        if (settled) {
          onLateValue(value);
          return;
        }
        finish(() => resolve(value));
      },
      (error: unknown) => finish(() => reject(error)),
    );
    if (sourceSignalIsAborted(signal)) onAbort();
  });
}

function validateDecodedImage(
  decoded: DecodedSourceImage,
  maxWidth: number,
  maxHeight: number,
  maxPixels: number,
): SourceDecodeError | null {
  const { width, height } = decoded;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    closeDecodedSourceImage(decoded);
    return makeError("decode");
  }
  if (width > maxWidth || height > maxHeight || width > Math.floor(maxPixels / height)) {
    closeDecodedSourceImage(decoded);
    return makeError("memory");
  }
  return null;
}

/**
 * Concrete browser adapter.  `createImageBitmap(blob)` parses the bytes
 * directly, so no object URL is allocated or left to revoke.
 */
export class BrowserSourceDecoder implements SourceDecoder {
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxPixels: number;
  private readonly decodeImplementation: (
    blob: Blob,
    options?: SourceDecodeOptions,
  ) => Promise<unknown>;

  constructor(options: BrowserSourceDecoderOptions = {}) {
    this.maxWidth = normalizeLimit(options.maxWidth, DEFAULT_SOURCE_MAX_WIDTH, "maxWidth");
    this.maxHeight = normalizeLimit(options.maxHeight, DEFAULT_SOURCE_MAX_HEIGHT, "maxHeight");
    this.maxPixels = normalizeLimit(options.maxPixels, DEFAULT_SOURCE_MAX_PIXELS, "maxPixels");
    if (options.decode) {
      this.decodeImplementation = options.decode;
      return;
    }
    const createImageBitmap = options.createImageBitmap ?? getGlobalCreateImageBitmap();
    if (!createImageBitmap) {
      this.decodeImplementation = async () => {
        throw makeError("decode");
      };
      return;
    }
    this.decodeImplementation = async (blob: Blob): Promise<DecodedSourceImage> => {
      const image = await createImageBitmap(blob);
      return Object.freeze({
        image,
        width: image.width,
        height: image.height,
        close: (): void => image.close(),
      });
    };
  }

  async decode(blob: Blob, options: SourceDecodeOptions = {}): Promise<DecodedSourceImage> {
    if (!(blob instanceof Blob)) {
      throw makeError("invalid-input");
    }
    if (sourceSignalIsAborted(options.signal)) throw cancelledError();
    let rawDecoded: unknown;
    try {
      rawDecoded = await awaitAbortableDecode(
        this.decodeImplementation(blob, options),
        options.signal,
        closeDecodedSourceImage,
      );
    } catch (error) {
      const captured = captureDecodeError(error);
      if (captured) throw captured;
      if (sourceSignalIsAborted(options.signal)) throw cancelledError();
      throw makeError("decode");
    }
    if (sourceSignalIsAborted(options.signal)) {
      closeDecodedSourceImage(rawDecoded);
      throw cancelledError();
    }
    const normalized = normalizeDecodedSourceImage(rawDecoded);
    if (!normalized.ok) throw normalized.error;
    const validationError = validateDecodedImage(
      normalized.decoded,
      this.maxWidth,
      this.maxHeight,
      this.maxPixels,
    );
    if (validationError) throw validationError;
    return normalized.decoded;
  }
}

export function createBrowserSourceDecoder(options: BrowserSourceDecoderOptions = {}): BrowserSourceDecoder {
  return new BrowserSourceDecoder(options);
}
