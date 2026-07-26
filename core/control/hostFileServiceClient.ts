export type HostFileServiceKind = "image" | "video";

export const HOST_FILE_SERVICE_ERROR_CODES = Object.freeze([
  "connection",
  "authentication",
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
  "invalid-response",
] as const);

export type HostFileServiceErrorCode = (typeof HOST_FILE_SERVICE_ERROR_CODES)[number];

export class HostFileServiceError extends Error {
  readonly code: HostFileServiceErrorCode;

  constructor(code: HostFileServiceErrorCode, message: string) {
    super(message);
    this.name = "HostFileServiceError";
    this.code = code;
  }
}

export interface HostFileServiceReadResult {
  readonly blob: Blob;
  readonly name: string;
  readonly byteSize: number;
}

export interface HostFileServiceClient {
  read(path: string, kind: HostFileServiceKind, signal?: AbortSignal): Promise<HostFileServiceReadResult>;
}

export interface HostFileServiceClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch?: typeof globalThis.fetch;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Host file service URL is invalid.");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) throw new TypeError("Host file service URL is invalid.");
  return url.origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function imageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e
    && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a
    && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46
    && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45
    && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function videoMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    return ascii(bytes, 8, 4) === "qt  " ? "video/quicktime" : "video/mp4";
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45
    && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return ascii(bytes, 0, Math.min(bytes.length, 512)).includes("webm")
      ? "video/webm"
      : "video/x-matroska";
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

function parseFailure(value: unknown): HostFileServiceError | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.error)) return null;
  const code = value.error.code;
  const message = value.error.message;
  return typeof code === "string"
    && (HOST_FILE_SERVICE_ERROR_CODES as readonly string[]).includes(code)
    && typeof message === "string" && message.length > 0
    ? new HostFileServiceError(code as HostFileServiceErrorCode, message)
    : null;
}

function safeName(value: string | null): string {
  if (!value) throw new HostFileServiceError("invalid-response", "Host file response has no name.");
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new HostFileServiceError("invalid-response", "Host file response has an invalid name.");
  }
  const hasUnsafeCharacter = Array.from(decoded).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return character === "\\" || character === "/" || code <= 31 || code === 127;
  });
  if (!decoded || decoded.length > 255 || hasUnsafeCharacter) {
    throw new HostFileServiceError("invalid-response", "Host file response has an invalid name.");
  }
  return decoded;
}

export function createHostFileServiceClient(
  options: HostFileServiceClientOptions,
): HostFileServiceClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (typeof options.token !== "string" || options.token.length < 32 || options.token.length > 512) {
    throw new TypeError("Host file service token is invalid.");
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("Fetch is unavailable.");

  return Object.freeze({
    async read(path: string, kind: HostFileServiceKind, signal?: AbortSignal) {
      if (typeof path !== "string" || path.length === 0 || path.length > 4096 || path.includes("\0")) {
        throw new TypeError("Host file path is invalid.");
      }
      if (kind !== "image" && kind !== "video") throw new TypeError("Host file kind is invalid.");
      let response: Response;
      try {
        response = await Reflect.apply(fetchImpl, globalThis, [`${baseUrl}/v1/files/read`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ version: 1, path, kind }),
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal,
        } satisfies RequestInit]);
      } catch {
        if (signal?.aborted) throw new HostFileServiceError("cancelled", "Host file read was cancelled.");
        throw new HostFileServiceError("connection", "Host file service could not be reached.");
      }
      if (response.status === 401) {
        throw new HostFileServiceError("authentication", "Host file service rejected the session token.");
      }
      if (!response.ok) {
        let parsed: unknown;
        try {
          parsed = await response.json();
        } catch {
          parsed = null;
        }
        throw parseFailure(parsed)
          ?? new HostFileServiceError("invalid-response", "Host file service rejected the request.");
      }
      const name = safeName(response.headers.get("x-spriteboy-file-name"));
      const declaredMimeType = response.headers.get("x-spriteboy-mime-type");
      const declaredLength = Number(response.headers.get("x-spriteboy-file-size"));
      if (!Number.isSafeInteger(declaredLength) || declaredLength < 1) {
        throw new HostFileServiceError("invalid-response", "Host file response has an invalid size.");
      }
      let buffer: ArrayBuffer;
      try {
        buffer = await response.arrayBuffer();
      } catch {
        throw new HostFileServiceError("read-failed", "Host file response could not be read.");
      }
      if (buffer.byteLength !== declaredLength) {
        throw new HostFileServiceError("invalid-response", "Host file response size changed.");
      }
      const bytes = new Uint8Array(buffer);
      const mimeType = kind === "image" ? imageMime(bytes) : videoMime(bytes);
      if (!mimeType || declaredMimeType !== mimeType) {
        throw new HostFileServiceError("invalid-response", "Host file type could not be verified.");
      }
      return Object.freeze({
        blob: new Blob([buffer], { type: mimeType }),
        name,
        byteSize: buffer.byteLength,
      });
    },
  });
}
