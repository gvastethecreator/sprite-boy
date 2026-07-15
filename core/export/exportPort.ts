import { isEntityId } from "../project";
import {
  ExportPortError,
  type ArtifactWriteRequest,
  type ArtifactWriter,
  type ExportArtifact,
  type ExportFormatDescriptor,
  type ExportFormatRegistry,
  type ExportPort,
  type ExportProviderRequest,
  type ExportRequest,
  type ExportResult,
} from "./contracts";
import {
  captureArtifactWriter,
  createExportFileName,
  normalizeMaxArtifactBytes,
  validateArtifactBlob,
  validateWriteReceipt,
} from "./artifactWriter";
import { normalizeExportFormatDescriptor } from "./formatRegistry";

export interface CreateExportPortOptions {
  readonly registry: ExportFormatRegistry;
  readonly writer: ArtifactWriter;
  readonly maxArtifactBytes?: number;
  readonly now?: () => string;
}

interface CapturedExportProvider {
  readonly format: ExportFormatDescriptor;
  readonly encode: ReturnType<ExportFormatRegistry["resolve"]>["encode"];
}

interface CapturedExportRegistry {
  readonly formats: readonly ExportFormatDescriptor[];
  readonly providers: ReadonlyMap<string, CapturedExportProvider>;
}

const ABORTED_GETTER =
  Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const ADD_EVENT_LISTENER = AbortSignal.prototype.addEventListener;
const REMOVE_EVENT_LISTENER = AbortSignal.prototype.removeEventListener;
const DOM_EXCEPTION_NAME_GETTER = typeof DOMException === "function"
  ? Object.getOwnPropertyDescriptor(DOMException.prototype, "name")?.get
  : undefined;

function invalidRequest(message: string): ExportPortError {
  return new ExportPortError("EXPORT_INVALID_REQUEST", message);
}

function hasAbortSignalBrand(value: unknown): value is AbortSignal {
  if (!value || typeof value !== "object" || !ABORTED_GETTER) return false;
  try {
    return typeof Reflect.apply(ABORTED_GETTER, value, []) === "boolean";
  } catch {
    return false;
  }
}

function nativeSignalAborted(signal: AbortSignal): boolean {
  try {
    if (!ABORTED_GETTER) throw new TypeError("AbortSignal getter unavailable.");
    return Reflect.apply(ABORTED_GETTER, signal, []);
  } catch {
    throw invalidRequest("Export signal could not be read.");
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal && nativeSignalAborted(signal)) {
    throw new ExportPortError("EXPORT_ABORTED", "Export was cancelled.");
  }
}

function isNativeQuotaExceededError(value: unknown): boolean {
  if (!value || typeof value !== "object" || !DOM_EXCEPTION_NAME_GETTER) return false;
  try {
    return Reflect.apply(DOM_EXCEPTION_NAME_GETTER, value, []) === "QuotaExceededError";
  } catch {
    return false;
  }
}

async function awaitAbortable<T>(
  operation: () => T | PromiseLike<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  const result = Promise.resolve().then(operation);
  if (!signal) return result;

  let rejectAbort!: (error: ExportPortError) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const handleAbort = () => {
    rejectAbort(new ExportPortError("EXPORT_ABORTED", "Export was cancelled."));
  };
  try {
    Reflect.apply(ADD_EVENT_LISTENER, signal, [
      "abort",
      handleAbort,
      { once: true },
    ]);
  } catch {
    throw invalidRequest("Export signal could not be observed.");
  }
  try {
    throwIfAborted(signal);
    return await Promise.race([result, aborted]);
  } finally {
    try {
      Reflect.apply(REMOVE_EVENT_LISTENER, signal, ["abort", handleAbort]);
    } catch {
      // A branded signal should always be removable; the operation result is
      // still authoritative if a host violates that platform contract.
    }
  }
}

function sameFormat(
  left: ExportFormatDescriptor,
  right: ExportFormatDescriptor,
): boolean {
  return left.id === right.id &&
    left.label === right.label &&
    left.category === right.category &&
    left.fileExtension === right.fileExtension &&
    left.mimeType === right.mimeType;
}

function captureRegistry(value: unknown): CapturedExportRegistry {
  let list: ExportFormatRegistry["list"];
  let resolve: ExportFormatRegistry["resolve"];
  try {
    if (!value || typeof value !== "object") throw new TypeError("Registry missing.");
    const registry = value as Partial<ExportFormatRegistry>;
    if (typeof registry.list !== "function" || typeof registry.resolve !== "function") {
      throw new TypeError("Registry methods missing.");
    }
    list = registry.list.bind(value);
    resolve = registry.resolve.bind(value);
  } catch {
    throw invalidRequest("Export format registry could not be read.");
  }

  let candidates: readonly ExportFormatDescriptor[];
  try {
    const listed = list();
    if (!Array.isArray(listed)) throw new TypeError("Registry list is not an array.");
    candidates = Object.freeze(Array.from(listed));
  } catch {
    throw invalidRequest("Export format registry could not be listed.");
  }

  const formats: ExportFormatDescriptor[] = [];
  const providers = new Map<string, CapturedExportProvider>();
  for (const candidate of candidates) {
    const descriptor = normalizeExportFormatDescriptor(candidate);
    if (providers.has(descriptor.id)) {
      throw new ExportPortError(
        "EXPORT_FORMAT_CONFLICT",
        `Export format ID "${descriptor.id}" is listed more than once.`,
      );
    }
    let provider: ReturnType<ExportFormatRegistry["resolve"]>;
    let providerDescriptor: ExportFormatDescriptor;
    let encode: CapturedExportProvider["encode"];
    try {
      provider = resolve(descriptor.id);
      if (
        !provider ||
        typeof provider !== "object" ||
        typeof provider.encode !== "function"
      ) {
        throw new TypeError("Provider is incomplete.");
      }
      providerDescriptor = normalizeExportFormatDescriptor(provider.format);
      encode = provider.encode.bind(provider);
    } catch {
      throw new ExportPortError(
        "EXPORT_FORMAT_INVALID",
        `Listed export format "${descriptor.id}" has no valid provider.`,
      );
    }
    if (!sameFormat(descriptor, providerDescriptor)) {
      throw new ExportPortError(
        "EXPORT_FORMAT_CONFLICT",
        `Listed export format "${descriptor.id}" does not match its provider.`,
      );
    }
    formats.push(descriptor);
    providers.set(descriptor.id, Object.freeze({ format: descriptor, encode }));
  }
  return Object.freeze({
    formats: Object.freeze(formats),
    providers,
  });
}

function normalizeRequest<TSource>(
  request: ExportRequest<TSource>,
  providers: ReadonlyMap<string, CapturedExportProvider>,
): {
  readonly providerRequest: ExportProviderRequest;
  readonly artifactBase: Omit<ExportArtifact, "byteSize" | "blob">;
  readonly signal?: AbortSignal;
  readonly encode: ReturnType<ExportFormatRegistry["resolve"]>["encode"];
} {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw invalidRequest("Export request must be an object.");
  }
  let snapshot: ExportRequest<TSource>;
  try {
    const signal = request.signal;
    snapshot = {
      requestId: request.requestId,
      artifactId: request.artifactId,
      projectId: request.projectId,
      revision: request.revision,
      formatId: request.formatId,
      baseName: request.baseName,
      source: request.source,
      ...(signal === undefined ? {} : { signal }),
    };
  } catch {
    throw invalidRequest("Export request could not be read.");
  }
  if (
    !isEntityId(snapshot.requestId) ||
    !isEntityId(snapshot.artifactId) ||
    !isEntityId(snapshot.projectId)
  ) {
    throw invalidRequest("Export request identities are invalid.");
  }
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
    throw invalidRequest("Export project revision must be a non-negative safe integer.");
  }
  if (typeof snapshot.formatId !== "string" || snapshot.formatId.length === 0) {
    throw invalidRequest("Export format ID is required.");
  }
  if (snapshot.signal !== undefined && !hasAbortSignalBrand(snapshot.signal)) {
    throw invalidRequest("Export signal must be a native AbortSignal.");
  }
  const provider = providers.get(snapshot.formatId);
  if (!provider) {
    throw new ExportPortError(
      "EXPORT_UNSUPPORTED_FORMAT",
      "The requested export format is not available.",
    );
  }
  const { format, encode } = provider;
  const fileName = createExportFileName(snapshot.baseName, format.fileExtension);
  const providerRequest: ExportProviderRequest = Object.freeze({
    requestId: snapshot.requestId,
    artifactId: snapshot.artifactId,
    projectId: snapshot.projectId,
    revision: snapshot.revision,
    format,
    fileName,
    source: snapshot.source,
    ...(snapshot.signal ? { signal: snapshot.signal } : {}),
  });
  const artifactBase = Object.freeze({
    requestId: snapshot.requestId,
    artifactId: snapshot.artifactId,
    projectId: snapshot.projectId,
    revision: snapshot.revision,
    formatId: format.id,
    category: format.category,
    fileName,
    fileExtension: format.fileExtension,
    mimeType: format.mimeType,
  });
  return Object.freeze({
    providerRequest,
    artifactBase,
    ...(snapshot.signal ? { signal: snapshot.signal } : {}),
    encode,
  });
}

export function createExportPort(options: CreateExportPortOptions): ExportPort {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw invalidRequest("Export port options are required.");
  }
  let registryValue: unknown;
  let writerValue: unknown;
  let maxArtifactBytesValue: unknown;
  let nowValue: unknown;
  try {
    registryValue = options.registry;
    writerValue = options.writer;
    maxArtifactBytesValue = options.maxArtifactBytes;
    nowValue = options.now;
  } catch {
    throw invalidRequest("Export port options could not be read.");
  }
  const registry = captureRegistry(registryValue);
  const writer = captureArtifactWriter(writerValue);
  const maxArtifactBytes = normalizeMaxArtifactBytes(maxArtifactBytesValue);
  if (nowValue !== undefined && typeof nowValue !== "function") {
    throw invalidRequest("Export clock must be a function.");
  }
  const now = (nowValue as (() => string) | undefined) ??
    (() => new Date().toISOString());

  return Object.freeze({
    maxArtifactBytes,
    listFormats: () => registry.formats,
    run: async <TSource>(request: ExportRequest<TSource>): Promise<ExportResult> => {
      const normalized = normalizeRequest(request, registry.providers);
      throwIfAborted(normalized.signal);

      let blob: Blob;
      try {
        blob = await awaitAbortable(
          () => normalized.encode(normalized.providerRequest),
          normalized.signal,
        );
      } catch (error) {
        if (normalized.signal && nativeSignalAborted(normalized.signal)) {
          throwIfAborted(normalized.signal);
        }
        void error;
        throw new ExportPortError(
          "EXPORT_PROVIDER_FAILED",
          "The export provider could not generate the artifact.",
        );
      }
      throwIfAborted(normalized.signal);
      const artifact = validateArtifactBlob(
        blob,
        normalized.artifactBase,
        maxArtifactBytes,
      );
      const writeRequest: ArtifactWriteRequest = Object.freeze({
        artifact,
        ...(normalized.signal ? { signal: normalized.signal } : {}),
      });

      let receipt: unknown;
      try {
        receipt = await awaitAbortable(
          () => writer.write(writeRequest),
          normalized.signal,
        );
      } catch (error) {
        if (normalized.signal && nativeSignalAborted(normalized.signal)) {
          throwIfAborted(normalized.signal);
        }
        if (isNativeQuotaExceededError(error)) {
          throw new ExportPortError(
            "EXPORT_QUOTA_EXCEEDED",
            "The export destination has insufficient storage quota.",
          );
        }
        throw new ExportPortError(
          "EXPORT_WRITER_FAILED",
          "The artifact writer could not complete the export.",
        );
      }
      throwIfAborted(normalized.signal);

      let completedAt: unknown;
      try {
        completedAt = now();
      } catch {
        throw new ExportPortError(
          "EXPORT_RECEIPT_INVALID",
          "The export completion timestamp is invalid.",
        );
      }
      const validatedReceipt = validateWriteReceipt(
        receipt,
        writer.id,
        artifact,
        completedAt,
      );
      return Object.freeze({ artifact, receipt: validatedReceipt });
    },
  });
}
