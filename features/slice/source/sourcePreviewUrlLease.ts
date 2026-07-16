export const SOURCE_PREVIEW_URL_ERROR_CODES = Object.freeze([
  "host-unavailable",
  "create-failed",
  "invalid-url",
] as const);

export type SourcePreviewUrlErrorCode = (typeof SOURCE_PREVIEW_URL_ERROR_CODES)[number];

export interface SourcePreviewUrlError {
  readonly code: SourcePreviewUrlErrorCode;
  readonly message: string;
}

export interface SourcePreviewUrlHost {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export interface SourcePreviewUrlLease {
  readonly url: string;
  readonly released: boolean;
  /** Idempotent and terminal even if a hostile host throws while revoking. */
  release(): void;
}

export interface SourcePreviewUrlLeaseOptions {
  readonly host?: SourcePreviewUrlHost | null;
  readonly onReleaseError?: (error: unknown, url: string) => void;
}

export type SourcePreviewUrlLeaseResult =
  | { readonly ok: true; readonly lease: SourcePreviewUrlLease }
  | { readonly ok: false; readonly error: SourcePreviewUrlError };

const ERROR_MESSAGES: Readonly<Record<SourcePreviewUrlErrorCode, string>> = Object.freeze({
  "host-unavailable": "This browser cannot create a source preview URL.",
  "create-failed": "The source preview URL could not be created.",
  "invalid-url": "The browser returned an invalid source preview URL.",
});

function createError(code: SourcePreviewUrlErrorCode): SourcePreviewUrlError {
  return Object.freeze({ code, message: ERROR_MESSAGES[code] });
}

function resolveDefaultHost(): SourcePreviewUrlHost | null {
  try {
    const owner = globalThis.URL;
    const create = owner?.createObjectURL;
    const revoke = owner?.revokeObjectURL;
    if (typeof create !== "function" || typeof revoke !== "function") return null;
    return Object.freeze({
      createObjectURL: (blob: Blob): string => Reflect.apply(create, owner, [blob]) as string,
      revokeObjectURL: (url: string): void => Reflect.apply(revoke, owner, [url]),
    });
  } catch {
    return null;
  }
}

function captureHost(
  configuredHost: SourcePreviewUrlHost | null | undefined,
): SourcePreviewUrlHost | null {
  if (configuredHost === null) return null;
  if (configuredHost === undefined) return resolveDefaultHost();
  try {
    const create = configuredHost.createObjectURL;
    const revoke = configuredHost.revokeObjectURL;
    if (typeof create !== "function" || typeof revoke !== "function") return null;
    return Object.freeze({
      createObjectURL: (blob: Blob): string => Reflect.apply(create, configuredHost, [blob]) as string,
      revokeObjectURL: (url: string): void => Reflect.apply(revoke, configuredHost, [url]),
    });
  } catch {
    return null;
  }
}

function safelyRevoke(host: SourcePreviewUrlHost, url: string): void {
  try {
    host.revokeObjectURL(url);
  } catch {
    // The allocation is already rejected. There is no safe retry contract for
    // a host method that throws, so cleanup remains terminal.
  }
}

/**
 * Allocate one ephemeral URL and return the only object that owns its revoke.
 * Invalid host output is revoked before the failure crosses the boundary.
 */
export function createSourcePreviewUrlLease(
  blob: Blob,
  options: SourcePreviewUrlLeaseOptions = {},
): SourcePreviewUrlLeaseResult {
  const host = captureHost(options.host);
  if (host === null) {
    return Object.freeze({ ok: false, error: createError("host-unavailable") });
  }

  let url: unknown;
  try {
    url = host.createObjectURL(blob);
  } catch {
    return Object.freeze({ ok: false, error: createError("create-failed") });
  }
  if (typeof url !== "string" || !url.startsWith("blob:") || url.length <= 5) {
    if (typeof url === "string") safelyRevoke(host, url);
    return Object.freeze({ ok: false, error: createError("invalid-url") });
  }

  let released = false;
  const lease = {
    get url(): string { return url as string; },
    get released(): boolean { return released; },
    release(): void {
      if (released) return;
      released = true;
      try {
        host.revokeObjectURL(url as string);
      } catch (error) {
        try {
          options.onReleaseError?.(error, url as string);
        } catch {
          // Diagnostics are observer-only and cannot alter ownership state.
        }
      }
    },
  } satisfies SourcePreviewUrlLease;
  return Object.freeze({ ok: true, lease: Object.freeze(lease) });
}
