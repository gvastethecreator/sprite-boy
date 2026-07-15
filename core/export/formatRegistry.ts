import {
  EXPORT_FORMAT_CATEGORIES,
  ExportPortError,
  type ExportFormatCategory,
  type ExportFormatDescriptor,
  type ExportFormatId,
  type ExportFormatProvider,
  type ExportFormatRegistry,
  type ExportProviderRequest,
} from "./contracts";

const FORMAT_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const FILE_EXTENSION = /^[a-z0-9][a-z0-9-]{0,15}$/;
const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const MAX_FORMAT_LABEL_LENGTH = 80;

function formatError(message: string): ExportPortError {
  return new ExportPortError("EXPORT_FORMAT_INVALID", message);
}

function validCategory(value: unknown): value is ExportFormatCategory {
  return typeof value === "string" &&
    (EXPORT_FORMAT_CATEGORIES as readonly string[]).includes(value);
}

export function normalizeExportFormatDescriptor(value: unknown): ExportFormatDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw formatError("Export format descriptor must be an object.");
  }
  let candidate: Partial<ExportFormatDescriptor>;
  try {
    const source = value as Partial<ExportFormatDescriptor>;
    candidate = {
      id: source.id,
      label: source.label,
      category: source.category,
      fileExtension: source.fileExtension,
      mimeType: source.mimeType,
    };
  } catch {
    throw formatError("Export format descriptor could not be read.");
  }
  if (typeof candidate.id !== "string" || !FORMAT_ID.test(candidate.id)) {
    throw formatError("Export format ID is invalid.");
  }
  if (
    typeof candidate.label !== "string" ||
    candidate.label.trim().length === 0 ||
    candidate.label.trim().length > MAX_FORMAT_LABEL_LENGTH
  ) {
    throw formatError("Export format label is invalid.");
  }
  if (!validCategory(candidate.category)) {
    throw formatError("Export format category is invalid.");
  }
  if (
    typeof candidate.fileExtension !== "string" ||
    !FILE_EXTENSION.test(candidate.fileExtension)
  ) {
    throw formatError("Export format file extension is invalid.");
  }
  if (
    typeof candidate.mimeType !== "string" ||
    candidate.mimeType !== candidate.mimeType.toLowerCase() ||
    !MIME_TYPE.test(candidate.mimeType)
  ) {
    throw formatError("Export format MIME type is invalid.");
  }
  return Object.freeze({
    id: candidate.id,
    label: candidate.label.trim(),
    category: candidate.category,
    fileExtension: candidate.fileExtension,
    mimeType: candidate.mimeType,
  });
}

function captureProvider(value: unknown): ExportFormatProvider {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw formatError("Export format provider must be an object.");
  }
  let formatValue: unknown;
  let encodeValue: unknown;
  try {
    const candidate = value as Partial<ExportFormatProvider>;
    formatValue = candidate.format;
    encodeValue = candidate.encode;
  } catch {
    throw formatError("Export format provider could not be read.");
  }
  if (typeof encodeValue !== "function") {
    throw formatError("Export format provider requires an encode function.");
  }
  const format = normalizeExportFormatDescriptor(formatValue);
  let encode: ExportFormatProvider["encode"];
  try {
    encode = encodeValue.bind(value);
  } catch {
    throw formatError("Export format provider encode function could not be captured.");
  }
  return Object.freeze({
    format,
    encode: (request: ExportProviderRequest) => encode(request),
  });
}

export function createExportFormatRegistry(
  providers: readonly ExportFormatProvider[],
): ExportFormatRegistry {
  if (!Array.isArray(providers)) {
    throw formatError("Export format providers must be an array.");
  }
  const byId = new Map<ExportFormatId, ExportFormatProvider>();
  const descriptors: ExportFormatDescriptor[] = [];
  try {
    for (const candidate of providers) {
      const provider = captureProvider(candidate);
      if (byId.has(provider.format.id)) {
        throw new ExportPortError(
          "EXPORT_FORMAT_CONFLICT",
          `Export format ID "${provider.format.id}" is registered more than once.`,
        );
      }
      byId.set(provider.format.id, provider);
      descriptors.push(provider.format);
    }
  } catch (error) {
    if (error instanceof ExportPortError) throw error;
    throw formatError("Export format providers could not be read.");
  }
  const visible = Object.freeze([...descriptors]);

  return Object.freeze({
    list: () => visible,
    has: (formatId: ExportFormatId) => byId.has(formatId),
    get: (formatId: ExportFormatId) => byId.get(formatId)?.format,
    resolve: (formatId: ExportFormatId) => {
      const provider = byId.get(formatId);
      if (!provider) {
        throw new ExportPortError(
          "EXPORT_UNSUPPORTED_FORMAT",
          "The requested export format is not available.",
        );
      }
      return provider;
    },
  });
}
