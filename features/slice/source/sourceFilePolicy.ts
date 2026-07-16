/**
 * Source-file boundary for Slice.
 *
 * The picker/drop UI is deliberately not part of this module.  This boundary
 * captures the bytes and the data-only metadata that the feature session owns
 * so a caller cannot mutate a File object while validation or decoding is in
 * flight.
 */

export const SOURCE_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const SOURCE_ALLOWED_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
] as const);

export type SourceMimeType = (typeof SOURCE_ALLOWED_MIME_TYPES)[number];
export type SourceImageFormat = "jpeg" | "png" | "webp";

export const SOURCE_MULTI_FILE_POLICY = "first" as const;
export const SOURCE_MULTI_FILE_POLICIES = Object.freeze(["first", "reject"] as const);
export type SourceMultiFilePolicy = (typeof SOURCE_MULTI_FILE_POLICIES)[number];

export const SOURCE_FILE_ERROR_CODES = Object.freeze([
  "invalid-input",
  "unsupported-mime",
  "magic-mismatch",
  "too-large",
  "multiple-files",
  "read-failed",
  "aborted",
] as const);
export type SourceFileErrorCode = (typeof SOURCE_FILE_ERROR_CODES)[number];

/** Public failures intentionally contain no Error/stack/cause/path fields. */
export interface SourceFileError {
  readonly code: SourceFileErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export interface SourceFileMetadata {
  /** A portable, path-free filename suitable for UI and future exports. */
  readonly name: string;
  /** MIME declared by the input File, normalized to lowercase. */
  readonly declaredMimeType: string;
  /** MIME confirmed by the magic-byte signature. */
  readonly mimeType: SourceMimeType;
  readonly format: SourceImageFormat;
  readonly size: number;
  readonly lastModified: number | null;
}

/** File-like input keeps tests and non-DOM drop adapters injectable. */
export interface SourceFileInput {
  readonly name?: string;
  readonly type?: string;
  readonly size?: number;
  readonly lastModified?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface PreparedSourceFile {
  readonly blob: Blob;
  readonly metadata: SourceFileMetadata;
  /** Each access returns a detached copy; callers cannot mutate policy-owned bytes. */
  readonly bytes: Readonly<Uint8Array>;
}

export type SourceFileValidation =
  | { readonly valid: true; readonly source: PreparedSourceFile }
  | { readonly valid: false; readonly error: SourceFileError };

export interface SourceFilePolicyOptions {
  readonly signal?: AbortSignal;
  readonly maxBytes?: number;
}

interface SourceSignature {
  readonly format: SourceImageFormat;
  readonly mimeType: SourceMimeType;
  readonly matches: (bytes: Uint8Array) => boolean;
}

const SIGNATURES: readonly SourceSignature[] = Object.freeze([
  Object.freeze({
    format: "png" as const,
    mimeType: "image/png" as const,
    matches: (bytes: Uint8Array): boolean => bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a,
  }),
  Object.freeze({
    format: "jpeg" as const,
    mimeType: "image/jpeg" as const,
    matches: (bytes: Uint8Array): boolean => bytes.length >= 3 &&
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  }),
  Object.freeze({
    format: "webp" as const,
    mimeType: "image/webp" as const,
    matches: (bytes: Uint8Array): boolean => bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50,
  }),
]);

const INVALID_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\p{Cc}\p{Cf}\p{Cs}]/gu;
const RESERVED_WINDOWS_FILE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const FORMAT_EXTENSIONS: Record<SourceImageFormat, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};

const SOURCE_FILE_ERROR_DEFINITIONS: Readonly<
  Record<SourceFileErrorCode, Readonly<{ message: string; retryable: boolean }>>
> = Object.freeze({
  "invalid-input": Object.freeze({ message: "Image source input is invalid.", retryable: false }),
  "unsupported-mime": Object.freeze({ message: "Image source MIME type is not supported.", retryable: false }),
  "magic-mismatch": Object.freeze({ message: "Image source bytes do not match its MIME type.", retryable: false }),
  "too-large": Object.freeze({ message: "Image source exceeds the 10 MiB limit.", retryable: false }),
  "multiple-files": Object.freeze({ message: "Select one image source at a time.", retryable: false }),
  "read-failed": Object.freeze({ message: "Image source bytes could not be read.", retryable: false }),
  "aborted": Object.freeze({ message: "Image source operation was aborted.", retryable: false }),
});

const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const ARRAY_BUFFER_RESIZABLE_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "resizable",
)?.get;

function fixedArrayBufferByteLength(value: unknown): number | null {
  try {
    if (!ARRAY_BUFFER_BYTE_LENGTH_GETTER || value === null || typeof value !== "object") return null;
    const byteLength = Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, value, []) as number;
    if (
      ARRAY_BUFFER_RESIZABLE_GETTER &&
      Reflect.apply(ARRAY_BUFFER_RESIZABLE_GETTER, value, []) !== false
    ) {
      return null;
    }
    return Number.isSafeInteger(byteLength) && byteLength >= 0 ? byteLength : null;
  } catch {
    return null;
  }
}

function createError(code: SourceFileErrorCode): SourceFileError {
  const definition = SOURCE_FILE_ERROR_DEFINITIONS[code];
  return Object.freeze({ code, message: definition.message, retryable: definition.retryable });
}

function captureSourceFileError(value: unknown): SourceFileError | null {
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
      !(SOURCE_FILE_ERROR_CODES as readonly string[]).includes(codeDescriptor.value) ||
      typeof messageDescriptor.value !== "string" ||
      typeof retryableDescriptor.value !== "boolean"
    ) {
      return null;
    }
    return createError(codeDescriptor.value as SourceFileErrorCode);
  } catch {
    return null;
  }
}

export function isSourceFileError(value: unknown): value is SourceFileError {
  return captureSourceFileError(value) !== null;
}

/** Remove paths, control/bidi/surrogate characters and unsafe Windows names. */
export function sanitizeSourceFileName(input: unknown, format: SourceImageFormat): string {
  const extension = FORMAT_EXTENSIONS[format];
  let value = typeof input === "string" ? input : "";
  try {
    value = value.normalize("NFKC");
  } catch {
    value = "";
  }
  // A File name is not a path, but drag/drop shims sometimes preserve one.
  value = value.replace(/^.*[\\/]/u, "");
  value = value
    .replace(INVALID_FILE_NAME_CHARACTERS, "-")
    .replace(/^\.+/u, "")
    .replace(/[. ]+$/u, "")
    .replace(/\s+/gu, " ")
    .replace(/-+/gu, "-")
    .trim();

  const suffix = `.${extension}`;
  if (value.toLowerCase().endsWith(suffix)) {
    value = value.slice(0, -suffix.length).replace(/[. ]+$/u, "");
  } else {
    // Keep a user-friendly base name while ensuring the extension reflects the
    // bytes that passed the magic check rather than a spoofed filename.
    value = value.replace(/\.[a-z0-9]{1,8}$/iu, "").replace(/[. ]+$/u, "");
  }
  const characters = Array.from(value);
  if (characters.length > 120) value = characters.slice(0, 120).join("");
  if (RESERVED_WINDOWS_FILE_NAME.test(value)) value = `_${value}`;
  if (value.length === 0) value = "image";
  return `${value}${suffix}`;
}

function readInputProperty<T>(input: SourceFileInput, key: string): T | undefined {
  try {
    return (input as unknown as Record<string, unknown>)[key] as T | undefined;
  } catch {
    return undefined;
  }
}

function inputLooksUsable(input: unknown): input is SourceFileInput {
  if (input === null || typeof input !== "object") return false;
  try {
    return typeof (input as { arrayBuffer?: unknown }).arrayBuffer === "function";
  } catch {
    return false;
  }
}

function normalizeMimeType(input: unknown): string {
  return typeof input === "string" ? input.trim().toLowerCase() : "";
}

function findSignature(bytes: Uint8Array): SourceSignature | undefined {
  return SIGNATURES.find((signature) => signature.matches(bytes));
}

function abortError(): SourceFileError {
  return createError("aborted");
}

async function awaitAbortable<T>(work: PromiseLike<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return Promise.resolve(work);
  if (signal.aborted) throw abortError();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = (): void => finish(() => reject(abortError()));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(work).then(
      (value) => finish(() => resolve(value)),
      () => finish(() => reject(createError("read-failed"))),
    );
    if (signal.aborted) onAbort();
  });
}

/**
 * Read, validate and detach a source File.  The returned Blob is owned by the
 * caller of this function and always has the confirmed MIME type.
 */
export async function prepareSourceFile(
  input: SourceFileInput,
  options: SourceFilePolicyOptions = {},
): Promise<SourceFileValidation> {
  const maxBytes = options.maxBytes ?? SOURCE_MAX_FILE_SIZE_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    return { valid: false, error: createError("invalid-input") };
  }
  if (!inputLooksUsable(input)) {
    return { valid: false, error: createError("invalid-input") };
  }

  let declaredMimeType = "";
  let name: unknown;
  let lastModified: unknown;
  let declaredSize: unknown;
  try {
    declaredMimeType = normalizeMimeType(readInputProperty<unknown>(input, "type"));
    name = readInputProperty<unknown>(input, "name");
    lastModified = readInputProperty<unknown>(input, "lastModified");
    declaredSize = readInputProperty<unknown>(input, "size");
  } catch {
    return { valid: false, error: createError("invalid-input") };
  }
  if (!(SOURCE_ALLOWED_MIME_TYPES as readonly string[]).includes(declaredMimeType)) {
    return { valid: false, error: createError("unsupported-mime") };
  }
  if (
    declaredSize !== undefined &&
    (!Number.isSafeInteger(declaredSize) || (declaredSize as number) < 0)
  ) {
    return { valid: false, error: createError("invalid-input") };
  }
  if (typeof declaredSize === "number" && declaredSize > maxBytes) {
    return { valid: false, error: createError("too-large") };
  }
  if (options.signal?.aborted) return { valid: false, error: abortError() };

  let bytes: Uint8Array;
  try {
    const buffer = await awaitAbortable(input.arrayBuffer(), options.signal);
    const byteLength = fixedArrayBufferByteLength(buffer);
    if (byteLength === null) {
      return { valid: false, error: createError("read-failed") };
    }
    if (byteLength > maxBytes) {
      return { valid: false, error: createError("too-large") };
    }
    bytes = new Uint8Array(buffer).slice();
  } catch (error) {
    return {
      valid: false,
      error: captureSourceFileError(error) ?? createError("read-failed"),
    };
  }
  const signature = findSignature(bytes);
  if (!signature || signature.mimeType !== declaredMimeType) {
    return { valid: false, error: createError("magic-mismatch") };
  }

  const normalizedLastModified = typeof lastModified === "number" &&
      Number.isFinite(lastModified) && lastModified >= 0
    ? Math.trunc(lastModified)
    : null;
  const metadata: SourceFileMetadata = Object.freeze({
    name: sanitizeSourceFileName(name, signature.format),
    declaredMimeType,
    mimeType: signature.mimeType,
    format: signature.format,
    size: bytes.byteLength,
    lastModified: normalizedLastModified,
  });
  const detachedBytes = bytes.slice();
  const blob = new Blob([detachedBytes], { type: signature.mimeType });
  const source: PreparedSourceFile = {
    blob,
    metadata,
    get bytes(): Readonly<Uint8Array> {
      return detachedBytes.slice();
    },
  };
  return Object.freeze({
    valid: true as const,
    source: Object.freeze(source),
  });
}

/** Return the first item from a picker/drop payload according to explicit policy. */
export function selectSourceFileInput(
  input: SourceFileInput | readonly SourceFileInput[] | FileList | null | undefined,
  policy: SourceMultiFilePolicy = SOURCE_MULTI_FILE_POLICY,
): { readonly input: SourceFileInput | null; readonly error: SourceFileError | null } {
  if (policy !== "first" && policy !== "reject") {
    return { input: null, error: createError("invalid-input") };
  }
  if (input === null || input === undefined) {
    return { input: null, error: createError("invalid-input") };
  }
  try {
    const isArray = Array.isArray(input);
    const isNativeFileList = !isArray &&
      typeof FileList !== "undefined" && input instanceof FileList;
    let item: unknown;
    let length: unknown;
    let isFileListLike = isNativeFileList;
    if (isArray) {
      length = input.length;
    } else if (input !== null && typeof input === "object") {
      item = (input as { item?: unknown }).item;
      if (isNativeFileList || typeof item === "function") {
        isFileListLike = true;
        length = (input as { length?: unknown }).length;
      }
    }
    if (!isArray && !isFileListLike) {
      return { input: input as SourceFileInput, error: null };
    }
    if (!Number.isSafeInteger(length) || (length as number) < 0) {
      return { input: null, error: createError("invalid-input") };
    }
    if (policy === "reject" && (length as number) > 1) {
      return { input: null, error: createError("multiple-files") };
    }
    if ((length as number) === 0) {
      return { input: null, error: createError("invalid-input") };
    }
    const first = isArray
      ? input[0]
      : Reflect.apply(item as (...args: unknown[]) => unknown, input, [0]);
    return first
      ? { input: first as SourceFileInput, error: null }
      : { input: null, error: createError("invalid-input") };
  } catch {
    return { input: null, error: createError("invalid-input") };
  }
}
