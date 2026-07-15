import type { EntityId, ISO8601Timestamp, ProjectRevision } from "../project";

export const EXPORT_FORMAT_CATEGORIES = Object.freeze([
  "raster-image",
  "archive",
  "animation",
  "video",
  "data",
] as const);

export type ExportFormatCategory = (typeof EXPORT_FORMAT_CATEGORIES)[number];
export type ExportFormatId = string;

export interface ExportFormatDescriptor {
  readonly id: ExportFormatId;
  readonly label: string;
  readonly category: ExportFormatCategory;
  readonly fileExtension: string;
  readonly mimeType: string;
}

export interface ExportProviderRequest {
  readonly requestId: EntityId;
  readonly artifactId: EntityId;
  readonly projectId: EntityId;
  readonly revision: ProjectRevision;
  readonly format: ExportFormatDescriptor;
  readonly fileName: string;
  readonly source: unknown;
  readonly signal?: AbortSignal;
}

export interface ExportFormatProvider {
  readonly format: ExportFormatDescriptor;
  encode(request: ExportProviderRequest): Blob | PromiseLike<Blob>;
}

export interface ExportRequest<TSource = unknown> {
  readonly requestId: EntityId;
  readonly artifactId: EntityId;
  readonly projectId: EntityId;
  readonly revision: ProjectRevision;
  readonly formatId: ExportFormatId;
  readonly baseName: string;
  readonly source: TSource;
  readonly signal?: AbortSignal;
}

export interface ExportArtifact {
  readonly requestId: EntityId;
  readonly artifactId: EntityId;
  readonly projectId: EntityId;
  readonly revision: ProjectRevision;
  readonly formatId: ExportFormatId;
  readonly category: ExportFormatCategory;
  readonly fileName: string;
  readonly fileExtension: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly blob: Blob;
}

export interface ArtifactWriteRequest {
  readonly artifact: ExportArtifact;
  readonly signal?: AbortSignal;
}

export interface ArtifactWriteReceipt {
  readonly requestId: EntityId;
  readonly artifactId: EntityId;
  readonly fileName: string;
  readonly bytesWritten: number;
}

export interface ArtifactWriter {
  readonly id: string;
  write(
    request: ArtifactWriteRequest,
  ): ArtifactWriteReceipt | PromiseLike<ArtifactWriteReceipt>;
}

export interface ExportReceipt {
  readonly writerId: string;
  readonly requestId: EntityId;
  readonly artifactId: EntityId;
  readonly fileName: string;
  readonly bytesWritten: number;
  readonly completedAt: ISO8601Timestamp;
}

export interface ExportResult {
  readonly artifact: ExportArtifact;
  readonly receipt: ExportReceipt;
}

export const EXPORT_PORT_ERROR_CODES = Object.freeze([
  "EXPORT_FORMAT_INVALID",
  "EXPORT_FORMAT_CONFLICT",
  "EXPORT_INVALID_REQUEST",
  "EXPORT_UNSUPPORTED_FORMAT",
  "EXPORT_PROVIDER_FAILED",
  "EXPORT_ARTIFACT_INVALID",
  "EXPORT_ARTIFACT_TOO_LARGE",
  "EXPORT_QUOTA_EXCEEDED",
  "EXPORT_WRITER_FAILED",
  "EXPORT_RECEIPT_INVALID",
  "EXPORT_ABORTED",
] as const);

export type ExportPortErrorCode = (typeof EXPORT_PORT_ERROR_CODES)[number];

const RETRYABLE_EXPORT_ERRORS: ReadonlySet<ExportPortErrorCode> = new Set([
  "EXPORT_PROVIDER_FAILED",
  "EXPORT_QUOTA_EXCEEDED",
  "EXPORT_WRITER_FAILED",
]);

const EXPORT_PORT_ERROR_BRAND = new WeakSet<object>();

export class ExportPortError extends Error {
  readonly code: ExportPortErrorCode;
  readonly retryable: boolean;

  constructor(code: ExportPortErrorCode, message: string) {
    if (!EXPORT_PORT_ERROR_CODES.includes(code)) {
      throw new TypeError("Export error code is invalid.");
    }
    if (typeof message !== "string" || message.trim().length === 0) {
      throw new TypeError("Export error message must be non-empty.");
    }
    super(message);
    this.name = "ExportPortError";
    this.code = code;
    this.retryable = RETRYABLE_EXPORT_ERRORS.has(code);
    EXPORT_PORT_ERROR_BRAND.add(this);
    Object.freeze(this);
  }
}

export function isExportPortError(value: unknown): value is ExportPortError {
  return !!value && typeof value === "object" &&
    EXPORT_PORT_ERROR_BRAND.has(value) &&
    Object.getPrototypeOf(value) === ExportPortError.prototype;
}

export interface ExportFormatRegistry {
  list(): readonly ExportFormatDescriptor[];
  has(formatId: ExportFormatId): boolean;
  get(formatId: ExportFormatId): ExportFormatDescriptor | undefined;
  resolve(formatId: ExportFormatId): ExportFormatProvider;
}

export interface ExportPort {
  readonly maxArtifactBytes: number;
  listFormats(): readonly ExportFormatDescriptor[];
  run<TSource>(request: ExportRequest<TSource>): Promise<ExportResult>;
}
