import { lstat, open, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

export const HOST_FILE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const HOST_FILE_VIDEO_MAX_BYTES = 256 * 1024 * 1024;

export type HostFileKind = "image" | "video";

export const HOST_FILE_BROKER_ERROR_CODES = Object.freeze([
  "invalid-request",
  "outside-root",
  "not-found",
  "not-file",
  "unsupported-type",
  "too-large",
  "busy",
  "changed",
  "cancelled",
  "read-failed",
] as const);

export type HostFileBrokerErrorCode = (typeof HOST_FILE_BROKER_ERROR_CODES)[number];

export class HostFileBrokerError extends Error {
  readonly code: HostFileBrokerErrorCode;
  readonly status: number;

  constructor(code: HostFileBrokerErrorCode, message: string, status: number) {
    super(message);
    this.name = "HostFileBrokerError";
    this.code = code;
    this.status = status;
  }
}

export interface HostFileBrokerOptions {
  readonly roots: readonly string[];
  readonly imageMaxBytes?: number;
  readonly videoMaxBytes?: number;
}

export interface HostFileReadResult {
  readonly bytes: Uint8Array;
  readonly name: string;
  readonly byteSize: number;
  readonly mimeType: string;
  /** Release the single-transfer lease after the response body closes or is cancelled. */
  readonly release: () => void;
}

export interface HostFileBroker {
  readonly roots: readonly string[];
  read(path: string, kind: HostFileKind, signal?: AbortSignal): Promise<HostFileReadResult>;
}

function fail(code: HostFileBrokerErrorCode, message: string, status: number): never {
  throw new HostFileBrokerError(code, message, status);
}

function assertLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} is invalid.`);
  return value;
}

function insideRoot(root: string, path: string): boolean {
  const segment = relative(root, path);
  return segment === "" || (!segment.startsWith(`..${sep}`) && segment !== ".." && !isAbsolute(segment));
}

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) fail("cancelled", "Host file read was cancelled.", 499);
}

function errorCode(value: unknown): string | undefined {
  try {
    return value !== null && typeof value === "object" && "code" in value
      ? String((value as { readonly code?: unknown }).code)
      : undefined;
  } catch {
    return undefined;
  }
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function sniffMime(bytes: Uint8Array, kind: HostFileKind): string | null {
  if (kind === "image") {
    if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG"
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
      return "image/png";
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return "image/jpeg";
    }
    if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
      return "image/webp";
    }
    return null;
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    return ascii(bytes, 8, 4) === "qt  " ? "video/quicktime" : "video/mp4";
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45
    && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return ascii(bytes, 0, bytes.length).includes("webm") ? "video/webm" : "video/x-matroska";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "AVI ") {
    return "video/x-msvideo";
  }
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === "OggS") return "video/ogg";
  if (bytes.length >= 3 && ascii(bytes, 0, 3) === "FLV") return "video/x-flv";
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00
    && bytes[2] === 0x01 && bytes[3] === 0xba) return "video/mpeg";
  if (bytes.length >= 377 && bytes[0] === 0x47 && bytes[188] === 0x47 && bytes[376] === 0x47) {
    return "video/mp2t";
  }
  return null;
}

export async function createHostFileBroker(options: HostFileBrokerOptions): Promise<HostFileBroker> {
  if (!options || typeof options !== "object" || Array.isArray(options) || !Array.isArray(options.roots)) {
    throw new TypeError("Host file broker options are invalid.");
  }
  const requestedRoots = [...new Set(options.roots.map((root) => resolve(root)))];
  if (requestedRoots.length === 0) throw new TypeError("At least one host file root is required.");
  const roots = Object.freeze(await Promise.all(requestedRoots.map(async (root) => {
    const canonicalRoot = await realpath(root);
    const info = await stat(canonicalRoot);
    if (!info.isDirectory()) throw new TypeError("Host file roots must be directories.");
    return canonicalRoot;
  })));
  const limits = Object.freeze({
    image: assertLimit(options.imageMaxBytes ?? HOST_FILE_IMAGE_MAX_BYTES, "Image limit"),
    video: assertLimit(options.videoMaxBytes ?? HOST_FILE_VIDEO_MAX_BYTES, "Video limit"),
  });
  let activeReads = 0;

  const read = async (
    path: string,
    kind: HostFileKind,
    signal?: AbortSignal,
  ): Promise<HostFileReadResult> => {
    if (typeof path !== "string" || path.length === 0 || path.length > 4096
      || path.includes("\0") || !isAbsolute(path)) {
      fail("invalid-request", "An absolute host file path is required.", 400);
    }
    if (kind !== "image" && kind !== "video") {
      fail("invalid-request", "Host file kind is invalid.", 400);
    }
    cancelled(signal);
    if (activeReads >= 1) fail("busy", "Another host file read is active.", 429);
    activeReads += 1;

    let leaseReleased = false;
    const release = (): void => {
      if (leaseReleased) return;
      leaseReleased = true;
      activeReads -= 1;
    };
    let transferred = false;
    try {
      let canonicalPath: string;
      try {
        const requested = await lstat(path);
        if (requested.isSymbolicLink()) fail("not-file", "Host file must not be a symbolic link.", 400);
        canonicalPath = await realpath(path);
      } catch (error) {
        if (error instanceof HostFileBrokerError) throw error;
        if (errorCode(error) === "ENOENT") fail("not-found", "Host file was not found.", 404);
        fail("read-failed", "Host file could not be resolved.", 500);
      }
      if (!roots.some((root) => insideRoot(root, canonicalPath))) {
        fail("outside-root", "Host file is outside the allowed roots.", 403);
      }

      let handle;
      try {
        handle = await open(canonicalPath, "r");
        const before = await handle.stat();
        if (!before.isFile()) fail("not-file", "Host file must be a regular file.", 400);
        if (before.size < 1) fail("invalid-request", "Host file is empty.", 400);
        if (before.size > limits[kind]) fail("too-large", "Host file exceeds the allowed size.", 413);
        cancelled(signal);

        const header = new Uint8Array(Math.min(512, before.size));
        const headerRead = await handle.read(header, 0, header.byteLength, 0);
        if (headerRead.bytesRead !== header.byteLength) {
          fail("changed", "Host file changed while it was read.", 409);
        }
        const mimeType = sniffMime(header, kind);
        if (!mimeType) fail("unsupported-type", "Host file type is not supported.", 415);

        const bytes = new Uint8Array(before.size);
        let offset = 0;
        while (offset < bytes.byteLength) {
          cancelled(signal);
          const chunk = await handle.read(bytes, offset, Math.min(1024 * 1024, bytes.byteLength - offset), offset);
          if (chunk.bytesRead < 1) fail("changed", "Host file changed while it was read.", 409);
          offset += chunk.bytesRead;
        }
        const after = await handle.stat();
        const finalPath = await realpath(canonicalPath);
        const finalInfo = await stat(finalPath);
        if (!roots.some((root) => insideRoot(root, finalPath))
          || after.size !== before.size || after.mtimeMs !== before.mtimeMs
          || after.ctimeMs !== before.ctimeMs || after.dev !== before.dev || after.ino !== before.ino
          || finalInfo.dev !== after.dev || finalInfo.ino !== after.ino) {
          fail("changed", "Host file changed while it was read.", 409);
        }
        cancelled(signal);
        transferred = true;
        return Object.freeze({
          bytes,
          name: basename(canonicalPath),
          byteSize: bytes.byteLength,
          mimeType,
          release,
        });
      } catch (error) {
        if (error instanceof HostFileBrokerError) throw error;
        if (errorCode(error) === "ENOENT") fail("not-found", "Host file was not found.", 404);
        fail("read-failed", "Host file could not be read.", 500);
      } finally {
        await handle?.close().catch(() => undefined);
      }
    } finally {
      if (!transferred) release();
    }
  };

  return Object.freeze({ roots, read });
}
