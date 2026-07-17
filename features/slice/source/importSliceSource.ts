import {
  isAssetRepositoryError,
  withAssetRepositoryMutation,
  type AssetMetadata,
  type AssetRepository,
} from "../../../core/assets";
import type { AssetRecord, EntityId, ISO8601Timestamp, StudioProjectV1 } from "../../../core/project";
import type { ProjectStore, ProjectStoreDispatchResult } from "../../../core/stores";

export const SLICE_SOURCE_IMPORT_ERROR_CODES = Object.freeze([
  "invalid-input",
  "cancelled",
  "project-changed",
  "repository-mismatch",
  "id-conflict",
  "repository-failed",
  "project-dispatch-failed",
  "cleanup-failed",
  "ownership-uncertain",
] as const);

export type SliceSourceImportErrorCode = (typeof SLICE_SOURCE_IMPORT_ERROR_CODES)[number];

export class SliceSourceImportError extends Error {
  readonly code: SliceSourceImportErrorCode;
  readonly assetIds: readonly EntityId[];
  readonly cleanupAssetIds: readonly EntityId[];

  constructor(
    code: SliceSourceImportErrorCode,
    message: string,
    options: { readonly assetIds?: readonly EntityId[]; readonly cleanupAssetIds?: readonly EntityId[] } = {},
  ) {
    super(message);
    this.name = "SliceSourceImportError";
    this.code = code;
    this.assetIds = Object.freeze([...(options.assetIds ?? [])]);
    this.cleanupAssetIds = Object.freeze([...(options.cleanupAssetIds ?? [])]);
  }
}

export interface ImportSliceSourceOptions {
  readonly store: ProjectStore;
  readonly repository: AssetRepository;
  readonly blob: Blob;
  readonly name: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly now?: () => ISO8601Timestamp;
  readonly nextId?: () => EntityId;
  readonly signal?: AbortSignal;
}

export interface ImportSliceSourceResult {
  readonly revision: number;
  readonly asset: AssetRecord;
}

export interface RestoreCanonicalSliceSourceOptions {
  readonly store: ProjectStore;
  readonly repository: AssetRepository;
  readonly assetId: EntityId;
  readonly signal?: AbortSignal;
}

export interface RestoreCanonicalSliceSourceResult {
  readonly asset: AssetRecord;
  readonly blob: Blob;
}

let identitySequence = 0;

function defaultId(): EntityId {
  try {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID === "function") return `slice-source-${randomUUID.call(globalThis.crypto)}`;
  } catch {
    // The monotonic fallback remains unique for this document lifetime.
  }
  identitySequence += 1;
  return `slice-source-${Date.now().toString(36)}-${identitySequence.toString(36)}`;
}

function fail(code: SliceSourceImportErrorCode, message: string, options?: { readonly assetIds?: readonly EntityId[]; readonly cleanupAssetIds?: readonly EntityId[] }): never {
  throw new SliceSourceImportError(code, message, options);
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) fail("cancelled", "Slice source import was cancelled.");
}

function validTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value);
}

function safeName(value: string): string {
  const normalized = value.replace(/[\\/:*?"<>|\p{Cc}]/gu, "-").trim();
  return normalized.length > 0 ? normalized.slice(0, 160) : "slice-source";
}

function isNotFound(error: unknown): boolean {
  if (isAssetRepositoryError(error)) return error.code === "ASSET_NOT_FOUND";
  try {
    if (typeof DOMException !== "undefined" && error instanceof DOMException) return error.name === "NotFoundError";
    return error !== null && typeof error === "object" && "name" in error
      && (error as { readonly name?: unknown }).name === "NotFoundError";
  } catch {
    return false;
  }
}

function matchesAttempt(record: AssetRecord, expected: AssetMetadata): boolean {
  return record.id === expected.id
    && record.name === expected.name
    && record.width === expected.width
    && record.height === expected.height
    && record.provenance.source === "import"
    && record.provenance.importedAt === expected.provenance.importedAt;
}

async function cleanupAttempt(
  options: Pick<ImportSliceSourceOptions, "store" | "repository">,
  initialRevision: number,
  expected: AssetMetadata,
): Promise<readonly EntityId[]> {
  const assetId = expected.id;
  try {
    const current = options.store.getSnapshot();
    if (current.revision !== initialRevision || current.project.assets[assetId]) return Object.freeze([assetId]);
    const record = await options.repository.getMetadata(assetId);
    if (!matchesAttempt(record, expected)) return Object.freeze([assetId]);
    // Metadata lookup yields. Re-read the canonical graph immediately before
    // removal so a concurrent dispatch cannot turn this late write into an
    // owned source between the first check and cleanup.
    const latest = options.store.getSnapshot();
    if (latest.revision !== initialRevision || latest.project.id !== options.repository.projectId || latest.project.assets[assetId]) {
      return Object.freeze([assetId]);
    }
    await options.repository.remove(assetId, "release-and-remove");
    try {
      await options.repository.getMetadata(assetId);
      return Object.freeze([assetId]);
    } catch (error) {
      return isNotFound(error) ? Object.freeze([]) : Object.freeze([assetId]);
    }
  } catch (error) {
    return isNotFound(error) ? Object.freeze([]) : Object.freeze([assetId]);
  }
}

async function assertDestinationAbsent(repository: AssetRepository, assetId: EntityId): Promise<void> {
  try {
    const record = await repository.getMetadata(assetId);
    if (record) fail("id-conflict", `Source Asset destination ${assetId} already exists.`);
    fail("repository-failed", `Source Asset preflight returned no metadata for ${assetId}.`);
  } catch (error) {
    if (error instanceof SliceSourceImportError) throw error;
    if (isNotFound(error)) return;
    fail("repository-failed", "Source Asset repository preflight failed.");
  }
}

function dispatchFailureMessage(result: ProjectStoreDispatchResult): string {
  return result.result.ok
    ? ""
    : result.result.diagnostics[0]?.message ?? "Source Asset import was rejected by the canonical project.";
}

async function importSliceSourceUnlocked(options: ImportSliceSourceOptions): Promise<ImportSliceSourceResult> {
  const initialState = options.store.getSnapshot();
  const project = initialState.project as StudioProjectV1;
  if (options.repository.projectId !== project.id) fail("repository-mismatch", "The AssetRepository belongs to a different active project.");
  if (typeof Blob === "undefined" || !(options.blob instanceof Blob) || options.blob.size < 1) {
    fail("invalid-input", "A non-empty source Blob is required.");
  }
  if (!Number.isSafeInteger(options.width) || options.width < 1 || !Number.isSafeInteger(options.height) || options.height < 1) {
    fail("invalid-input", "Source dimensions must be positive safe integers.");
  }
  const assetId = options.nextId?.() ?? defaultId();
  if (typeof assetId !== "string" || assetId.trim().length === 0) fail("invalid-input", "Source Asset ID is invalid.");
  if (project.assets[assetId]) fail("id-conflict", `Source Asset ID ${assetId} already belongs to the active project.`);
  await assertDestinationAbsent(options.repository, assetId);
  abortIfNeeded(options.signal);
  const timestamp = options.now?.() ?? new Date().toISOString();
  if (!validTimestamp(timestamp)) fail("invalid-input", "Source import timestamp is invalid.");
  const metadata: AssetMetadata = {
    id: assetId,
    name: safeName(options.name),
    width: options.width,
    height: options.height,
    createdAt: timestamp,
    updatedAt: timestamp,
    provenance: {
      source: "import",
      importedAt: timestamp,
    },
    declaredMimeType: options.mimeType || "application/octet-stream",
  };
  let storedRecord: AssetRecord | undefined;
  try {
    storedRecord = await options.repository.put(
      options.blob,
      metadata,
      options.signal ? { signal: options.signal } : undefined,
    );
    abortIfNeeded(options.signal);
    if (storedRecord.id !== assetId) fail("repository-failed", "Source repository returned a mismatched Asset ID.");
    const latest = options.store.getSnapshot();
    if (latest.revision !== initialState.revision || latest.project.id !== project.id || options.repository.projectId !== latest.project.id) {
      fail("project-changed", "The active project changed while importing the Slice source.");
    }
    const dispatch = options.store.dispatch({
      command: {
        type: "command.batch",
        commands: [
          { type: "asset.import", asset: storedRecord, atIndex: latest.project.rootOrder.assetIds.length },
          { type: "workspace.update", patch: { selectedAssetId: assetId, activeWorkspace: "slice" } },
        ],
      },
      metadata: {
        commandId: `slice-source-import:${assetId}`,
        origin: "user",
        history: "record",
        issuedAt: timestamp,
      },
    });
    if (!dispatch.result.ok) {
      const cleanupAssetIds = await cleanupAttempt(options, initialState.revision, metadata);
      if (cleanupAssetIds.length > 0) fail("cleanup-failed", "Source import was rejected and cleanup is pending.", { assetIds: [assetId], cleanupAssetIds });
      fail("project-dispatch-failed", dispatchFailureMessage(dispatch), { assetIds: [assetId] });
    }
    return Object.freeze({ revision: dispatch.revision, asset: storedRecord });
  } catch (error) {
    if (error instanceof SliceSourceImportError && (error.code === "project-dispatch-failed" || error.code === "cleanup-failed")) throw error;
    const cleanupAssetIds = await cleanupAttempt(options, initialState.revision, metadata);
    if (cleanupAssetIds.length > 0) {
      throw new SliceSourceImportError("cleanup-failed", "Source import failed and cleanup is pending.", {
        assetIds: [assetId],
        cleanupAssetIds,
      });
    }
    if (error instanceof SliceSourceImportError) throw error;
    throw new SliceSourceImportError("repository-failed", "Source Asset could not be persisted.", { assetIds: [assetId] });
  }
}

export function importSliceSource(options: ImportSliceSourceOptions): Promise<ImportSliceSourceResult> {
  return withAssetRepositoryMutation(options.repository, () => importSliceSourceUnlocked(options));
}

/** Read the durable source without creating a runtime URL or mutating the graph. */
export async function restoreCanonicalSliceSource(
  options: RestoreCanonicalSliceSourceOptions,
): Promise<RestoreCanonicalSliceSourceResult> {
  abortIfNeeded(options.signal);
  const snapshot = options.store.getSnapshot();
  const project = snapshot.project as StudioProjectV1;
  if (options.repository.projectId !== project.id) fail("repository-mismatch", "The AssetRepository belongs to a different active project.");
  const asset = project.assets[options.assetId];
  if (!asset) fail("invalid-input", "The selected canonical source Asset is missing.");
  let blob: Blob;
  try {
    blob = await options.repository.getBlob(asset.id, options.signal ? { signal: options.signal } : undefined);
  } catch (error) {
    if (isNotFound(error)) fail("invalid-input", "The canonical source binary is missing from storage.");
    throw new SliceSourceImportError("repository-failed", "The canonical source binary could not be read.");
  }
  abortIfNeeded(options.signal);
  if (typeof Blob === "undefined" || !(blob instanceof Blob) || blob.size < 1) {
    fail("invalid-input", "The canonical source binary is empty.");
  }
  return Object.freeze({ asset, blob });
}
