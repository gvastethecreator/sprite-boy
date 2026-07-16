import {
  isAssetRepositoryError,
  type AssetRepository,
} from "../../../core/assets";
import {
  applyProjectCommand,
  type EntityId,
  type ISO8601Timestamp,
  type ProjectCommand,
  type ProjectCommandDiagnostic,
  type StudioProjectV1,
} from "../../../core/project";
import type { ProjectStore } from "../../../core/stores";
import {
  createBrowserSourceDecoder,
  type SourceDecoder,
} from "../../slice/source/browserSourceDecoder";
import {
  prepareSourceFile,
  type SourceFileError,
  type SourceFileInput,
} from "../../slice/source/sourceFilePolicy";
import {
  createCompositionEntryIntent,
  type CompositionEntryOpenSuccess,
} from "./compositionEntry";

export type ComposeAssetImportFailureCode =
  | "INVALID_FILE"
  | "DECODE_FAILED"
  | "STORAGE_FAILED"
  | "PROJECT_CHANGED"
  | "IMPORT_REJECTED"
  | "COMPOSITION_REJECTED"
  | "CLEANUP_FAILED"
  | "CANCELLED";

export interface ComposeAssetImportFailure {
  readonly ok: false;
  readonly code: ComposeAssetImportFailureCode;
  readonly message: string;
  readonly diagnostics?: readonly ProjectCommandDiagnostic[];
  readonly cleanup?: { readonly assetId: EntityId };
}

export interface ComposeAssetImportSuccess extends CompositionEntryOpenSuccess {
  readonly assetId: EntityId;
  readonly assetName: string;
}

export type ComposeAssetImportResult = ComposeAssetImportSuccess | ComposeAssetImportFailure;

export interface ComposeAssetImportPorts {
  readonly store: ProjectStore;
  readonly assets: AssetRepository;
  readonly nextId: (kind: "asset" | "command") => EntityId;
  readonly now: () => ISO8601Timestamp;
  readonly decoder?: SourceDecoder;
}

function failure(
  code: ComposeAssetImportFailureCode,
  message: string,
  diagnostics?: readonly ProjectCommandDiagnostic[],
  cleanupAssetId?: EntityId,
): ComposeAssetImportFailure {
  return Object.freeze({
    ok: false,
    code,
    message,
    ...(diagnostics ? { diagnostics: Object.freeze([...diagnostics]) } : {}),
    ...(cleanupAssetId ? { cleanup: Object.freeze({ assetId: cleanupAssetId }) } : {}),
  });
}

function cancelled(signal: AbortSignal | undefined): boolean {
  try {
    return signal?.aborted === true;
  } catch {
    return true;
  }
}

async function removeRepositoryAsset(
  assets: AssetRepository,
  assetId: EntityId,
): Promise<boolean> {
  try {
    await assets.remove(assetId, "release-and-remove");
    return true;
  } catch (error) {
    // Cleanup is idempotent: another owner may have removed the same record
    // while this retry was in flight.
    return isAssetRepositoryError(error) && error.code === "ASSET_NOT_FOUND";
  }
}

function cleanupFailure(
  assetId: EntityId,
  diagnostics?: readonly ProjectCommandDiagnostic[],
): ComposeAssetImportFailure {
  return failure(
    "CLEANUP_FAILED",
    "Temporary image data could not be removed. Retry cleanup after storage access recovers.",
    diagnostics,
    assetId,
  );
}

export async function retryComposeAssetCleanup(
  assets: AssetRepository,
  assetId: EntityId,
): Promise<{ readonly ok: true } | ComposeAssetImportFailure> {
  return await removeRepositoryAsset(assets, assetId)
    ? Object.freeze({ ok: true as const })
    : cleanupFailure(assetId);
}

/**
 * Import one browser image into the canonical AssetRepository and open its
 * first Composition through the preflighted A1-01 intent. Runtime URLs and
 * data URLs never cross this boundary.
 */
export async function importComposeAsset(
  input: SourceFileInput,
  ports: ComposeAssetImportPorts,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ComposeAssetImportResult> {
  const signal = options.signal;
  if (cancelled(signal)) return failure("CANCELLED", "Image import was cancelled.");

  const projectId = ports.store.getSnapshot().project.id;
  if (ports.assets.projectId !== projectId) {
    return failure("PROJECT_CHANGED", "The active project changed before import started.");
  }

  const prepared = await prepareSourceFile(input, signal ? { signal } : {});
  if (!prepared.valid) {
    const sourceError: SourceFileError = prepared.error;
    return failure(
      sourceError.code === "aborted" ? "CANCELLED" : "INVALID_FILE",
      sourceError.message,
    );
  }

  const decoder = ports.decoder ?? createBrowserSourceDecoder();
  let decoded: Awaited<ReturnType<SourceDecoder["decode"]>>;
  try {
    decoded = await decoder.decode(prepared.source.blob, signal ? { signal } : {});
  } catch {
    return failure(
      cancelled(signal) ? "CANCELLED" : "DECODE_FAILED",
      cancelled(signal) ? "Image import was cancelled." : "Image source could not be decoded.",
    );
  }

  const assetId = ports.nextId("asset");
  const timestamp = ports.now();
  let repositoryCommitted = false;
  let phase: "repository" | "project" | "composition" = "repository";
  try {
    if (cancelled(signal)) return failure("CANCELLED", "Image import was cancelled.");
    const record = await ports.assets.put(prepared.source.blob, {
      id: assetId,
      name: prepared.source.metadata.name,
      width: decoded.width,
      height: decoded.height,
      createdAt: timestamp,
      updatedAt: timestamp,
      declaredMimeType: prepared.source.metadata.mimeType,
      provenance: {
        source: "import",
        importedAt: timestamp,
      },
    }, signal ? { signal } : {});
    repositoryCommitted = true;
    phase = "project";

    const latest = ports.store.getSnapshot();
    if (cancelled(signal) || latest.project.id !== projectId || ports.assets.projectId !== projectId) {
      const cleaned = await removeRepositoryAsset(ports.assets, assetId);
      if (!cleaned) return cleanupFailure(assetId);
      repositoryCommitted = false;
      return failure(
        cancelled(signal) ? "CANCELLED" : "PROJECT_CHANGED",
        cancelled(signal)
          ? "Image import was cancelled."
          : "The active project changed while the image was importing.",
      );
    }

    const importCommand: ProjectCommand = { type: "asset.import", asset: record };
    const preview = applyProjectCommand(
      latest.project as StudioProjectV1,
      importCommand,
      { nextId: () => "compose-import-preview", now: () => timestamp },
    );
    if (!preview.ok) {
      const cleaned = await removeRepositoryAsset(ports.assets, assetId);
      if (!cleaned) return cleanupFailure(assetId, preview.diagnostics);
      repositoryCommitted = false;
      return failure("IMPORT_REJECTED", "The image could not be added to the active project.", preview.diagnostics);
    }

    const request = {
      source: { type: "asset" as const, id: assetId },
      commandId: ports.nextId("command"),
      issuedAt: timestamp,
    } as const;
    const intent = createCompositionEntryIntent(preview.project, request);
    if (!intent.ok || intent.outcome !== "create" || !intent.envelope) {
      const diagnostics = intent.ok ? undefined : intent.diagnostics;
      const cleaned = await removeRepositoryAsset(ports.assets, assetId);
      if (!cleaned) return cleanupFailure(assetId, diagnostics);
      repositoryCommitted = false;
      return failure(
        "COMPOSITION_REJECTED",
        "The image and its first composition could not be added atomically.",
        diagnostics,
      );
    }

    const imported = ports.store.dispatch({
      command: importCommand,
      metadata: {
        commandId: ports.nextId("command"),
        origin: "user",
        history: "record",
        issuedAt: timestamp,
      },
    });
    if (!imported.result.ok) {
      const cleaned = await removeRepositoryAsset(ports.assets, assetId);
      if (!cleaned) return cleanupFailure(assetId, imported.result.diagnostics);
      repositoryCommitted = false;
      return failure(
        "IMPORT_REJECTED",
        "The image could not be added to the active project.",
        imported.result.diagnostics,
      );
    }
    phase = "composition";

    const opened = ports.store.dispatch(intent.envelope);
    if (!opened.result.ok) {
      return failure(
        "COMPOSITION_REJECTED",
        "The image is available in Project sources, but its first composition was rejected. Open the source to retry.",
        opened.result.diagnostics,
      );
    }

    return Object.freeze({
      ok: true,
      outcome: "created",
      source: { type: "asset" as const, id: assetId },
      sourceAssetId: assetId,
      compositionId: intent.compositionId,
      ...(intent.layerId ? { layerId: intent.layerId } : {}),
      dimensions: intent.dimensions,
      revision: opened.revision,
      dispatched: true,
      assetId,
      assetName: record.name,
    });
  } catch {
    let graphOwnsAsset = false;
    if (repositoryCommitted) {
      try {
        graphOwnsAsset = ports.store.getSnapshot().project.assets[assetId]?.id === assetId;
      } catch {
        graphOwnsAsset = true;
      }
    }
    if (repositoryCommitted && !graphOwnsAsset) {
      const cleaned = await removeRepositoryAsset(ports.assets, assetId);
      if (!cleaned) return cleanupFailure(assetId);
      repositoryCommitted = false;
    }
    if (cancelled(signal)) return failure("CANCELLED", "Image import was cancelled.");
    return phase === "repository"
      ? failure("STORAGE_FAILED", "Image bytes could not be stored in the active project.")
      : phase === "composition"
        ? failure(
            "COMPOSITION_REJECTED",
            "The image is available in Project sources, but its first composition could not be confirmed. Open the source to retry.",
          )
        : failure("IMPORT_REJECTED", "The active project rejected the imported image.");
  } finally {
    try {
      decoded.close?.();
    } catch {
      // Decode resource ownership is terminal at this boundary.
    }
  }
}
