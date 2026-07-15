import { isEntityId, isISO8601Timestamp } from "../project";
import { isPlatformBlob } from "../render/sceneEncoding";
import {
  ExportPortError,
  type ArtifactWriteReceipt,
  type ArtifactWriter,
  type ExportArtifact,
  type ExportReceipt,
} from "./contracts";

export const DEFAULT_MAX_EXPORT_ARTIFACT_BYTES = 512 * 1024 * 1024;
export const MAX_EXPORT_ARTIFACT_BYTES = 2_147_483_647;
export const MAX_EXPORT_BASE_NAME_LENGTH = 128;

const INVALID_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\p{Cc}\p{Cf}\p{Cs}]/gu;
const RESERVED_WINDOWS_FILE_NAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const SAFE_FILE_EXTENSION = /^[a-z0-9][a-z0-9-]{0,15}$/;
const WRITER_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const BLOB_SIZE_GETTER = Object.getOwnPropertyDescriptor(Blob.prototype, "size")?.get;
const BLOB_TYPE_GETTER = Object.getOwnPropertyDescriptor(Blob.prototype, "type")?.get;

export interface CapturedArtifactWriter {
  readonly id: string;
  write: ArtifactWriter["write"];
}

function invalidRequest(message: string): ExportPortError {
  return new ExportPortError("EXPORT_INVALID_REQUEST", message);
}

export function normalizeMaxArtifactBytes(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_EXPORT_ARTIFACT_BYTES;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_EXPORT_ARTIFACT_BYTES
  ) {
    throw invalidRequest(
      `Export artifact limit must be a safe integer from 1 to ${MAX_EXPORT_ARTIFACT_BYTES}.`,
    );
  }
  return value as number;
}

export function createExportFileName(baseName: unknown, fileExtension: string): string {
  if (
    typeof fileExtension !== "string" ||
    !SAFE_FILE_EXTENSION.test(fileExtension)
  ) {
    throw invalidRequest("Export file extension is invalid.");
  }
  if (typeof baseName !== "string") {
    throw invalidRequest("Export base name must be a string.");
  }
  let safe = baseName
    .normalize("NFKC")
    .trim()
    .replace(INVALID_FILE_NAME_CHARACTERS, "-")
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-");
  const extensionSuffix = `.${fileExtension}`;
  if (safe.toLowerCase().endsWith(extensionSuffix.toLowerCase())) {
    safe = safe.slice(0, -extensionSuffix.length).replace(/[. ]+$/, "");
  }
  const safeCharacters = Array.from(safe);
  if (safeCharacters.length > MAX_EXPORT_BASE_NAME_LENGTH) {
    safe = safeCharacters
      .slice(0, MAX_EXPORT_BASE_NAME_LENGTH)
      .join("")
      .replace(/[. ]+$/, "");
  }
  if (safe.length === 0) {
    throw invalidRequest("Export base name has no safe filename characters.");
  }
  if (RESERVED_WINDOWS_FILE_NAME.test(safe)) safe = `_${safe}`;
  return `${safe}.${fileExtension}`;
}

export function captureArtifactWriter(value: unknown): CapturedArtifactWriter {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidRequest("Artifact writer must be an object.");
  }
  let writer: Partial<ArtifactWriter>;
  try {
    const source = value as Partial<ArtifactWriter>;
    writer = { id: source.id, write: source.write };
  } catch {
    throw invalidRequest("Artifact writer could not be read.");
  }
  if (
    typeof writer.id !== "string" ||
    writer.id.length > 80 ||
    !WRITER_ID.test(writer.id)
  ) {
    throw invalidRequest("Artifact writer ID is invalid.");
  }
  if (typeof writer.write !== "function") {
    throw invalidRequest("Artifact writer requires a write function.");
  }
  try {
    return Object.freeze({
      id: writer.id,
      write: writer.write.bind(value),
    });
  } catch {
    throw invalidRequest("Artifact writer function could not be captured.");
  }
}

export function validateArtifactBlob(
  blob: unknown,
  artifact: Omit<ExportArtifact, "byteSize" | "blob">,
  maxArtifactBytes: number,
): ExportArtifact {
  let byteSize: number | undefined;
  let mimeType: string | undefined;
  try {
    if (!isPlatformBlob(blob) || !BLOB_SIZE_GETTER || !BLOB_TYPE_GETTER) {
      throw new TypeError("Blob brand unavailable.");
    }
    byteSize = Reflect.apply(BLOB_SIZE_GETTER, blob, []);
    mimeType = Reflect.apply(BLOB_TYPE_GETTER, blob, []);
  } catch {
    // The safe public error below deliberately hides hostile getter details.
  }
  if (
    !Number.isSafeInteger(byteSize) ||
    (byteSize as number) < 1 ||
    mimeType !== artifact.mimeType
  ) {
    throw new ExportPortError(
      "EXPORT_ARTIFACT_INVALID",
      "The export provider returned an invalid artifact.",
    );
  }
  if ((byteSize as number) > maxArtifactBytes) {
    throw new ExportPortError(
      "EXPORT_ARTIFACT_TOO_LARGE",
      `The export artifact exceeds the ${maxArtifactBytes}-byte limit.`,
    );
  }
  return Object.freeze({
    ...artifact,
    byteSize: byteSize as number,
    blob: blob as Blob,
  });
}

export function validateWriteReceipt(
  value: unknown,
  writerId: string,
  artifact: ExportArtifact,
  completedAt: unknown,
): ExportReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExportPortError(
      "EXPORT_RECEIPT_INVALID",
      "Artifact writer returned an invalid receipt.",
    );
  }
  let receipt: Partial<ArtifactWriteReceipt>;
  try {
    const source = value as Partial<ArtifactWriteReceipt>;
    receipt = {
      requestId: source.requestId,
      artifactId: source.artifactId,
      fileName: source.fileName,
      bytesWritten: source.bytesWritten,
    };
  } catch {
    throw new ExportPortError(
      "EXPORT_RECEIPT_INVALID",
      "Artifact writer returned an invalid receipt.",
    );
  }
  if (
    receipt.requestId !== artifact.requestId ||
    receipt.artifactId !== artifact.artifactId ||
    receipt.fileName !== artifact.fileName ||
    receipt.bytesWritten !== artifact.byteSize ||
    !isEntityId(receipt.requestId) ||
    !isEntityId(receipt.artifactId) ||
    !Number.isSafeInteger(receipt.bytesWritten) ||
    !isISO8601Timestamp(completedAt)
  ) {
    throw new ExportPortError(
      "EXPORT_RECEIPT_INVALID",
      "Artifact writer receipt does not match the exported artifact.",
    );
  }
  return Object.freeze({
    writerId,
    requestId: artifact.requestId,
    artifactId: artifact.artifactId,
    fileName: artifact.fileName,
    bytesWritten: artifact.byteSize,
    completedAt,
  });
}
