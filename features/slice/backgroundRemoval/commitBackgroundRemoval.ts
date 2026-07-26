import {
  isAssetRepositoryError,
  withAssetRepositoryMutation,
  type AssetMetadata,
  type AssetRepository,
} from "../../../core/assets";
import type {
  AssetRecord,
  BackgroundRemovalRecipeV1,
  GeneratedArtifact,
  ProcessingRecipe,
} from "../../../core/project";
import type { LocalModelId } from "../../../core/models";
import type { ProjectStore } from "../../../core/stores";

export interface BackgroundRemovalModelProvenance {
  readonly id: LocalModelId;
  readonly repositoryId: string;
  readonly revision: string;
  readonly backend: BackgroundRemovalRecipeV1["model"]["backend"];
  readonly inputWidth: number;
  readonly inputHeight: number;
}

export interface CommitBackgroundRemovalOptions {
  readonly store: ProjectStore;
  readonly repository: AssetRepository;
  readonly sourceAssetId: string;
  readonly expectedRevision: number;
  readonly output: Blob;
  readonly width: number;
  readonly height: number;
  readonly model: BackgroundRemovalModelProvenance;
  readonly signal?: AbortSignal;
  readonly now?: () => string;
  readonly nextId?: (kind: "asset" | "artifact" | "recipe" | "command") => string;
  readonly onCleanupDebtChange?: (projectId: string, assetId: string, pending: boolean) => void;
}

export interface CommitBackgroundRemovalResult {
  readonly revision: number;
  readonly asset: AssetRecord;
  readonly artifact: GeneratedArtifact;
  readonly recipe: ProcessingRecipe;
}

export class BackgroundRemovalCommitError extends Error {
  readonly code:
    | "invalid-input"
    | "project-changed"
    | "repository-failed"
    | "project-rejected"
    | "cleanup-failed";

  constructor(code: BackgroundRemovalCommitError["code"], message: string) {
    super(message);
    this.name = "BackgroundRemovalCommitError";
    this.code = code;
  }
}

function defaultId(kind: "asset" | "artifact" | "recipe" | "command"): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `background-${kind}-${random}`;
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new BackgroundRemovalCommitError("project-changed", "Background removal acceptance was cancelled.");
}

function outputName(sourceName: string): string {
  const base = sourceName.replace(/\.[^.]+$/u, "").trim() || "image";
  return `${base}-no-bg.png`;
}

function matchesStoredOutput(
  stored: AssetRecord,
  metadata: AssetMetadata,
  assetId: string,
): boolean {
  return stored.id === assetId
    && stored.name === metadata.name
    && stored.mimeType === "image/png"
    && stored.width === metadata.width
    && stored.height === metadata.height
    && stored.provenance.source === "derived"
    && stored.provenance.parentAssetId === metadata.provenance.parentAssetId
    && stored.provenance.recipeId === metadata.provenance.recipeId
    && stored.provenance.artifactId === metadata.provenance.artifactId;
}

async function removeStoredOutput(
  options: CommitBackgroundRemovalOptions,
  projectId: string,
  assetId: string,
): Promise<boolean> {
  try {
    await options.repository.remove(assetId, "release-and-remove");
    options.onCleanupDebtChange?.(projectId, assetId, false);
    return true;
  } catch (error) {
    if (isAssetRepositoryError(error) && error.code === "ASSET_NOT_FOUND") return true;
    options.onCleanupDebtChange?.(projectId, assetId, true);
    return false;
  }
}

async function commitUnlocked(options: CommitBackgroundRemovalOptions): Promise<CommitBackgroundRemovalResult> {
  const initial = options.store.getSnapshot();
  const project = initial.project;
  if (options.repository.projectId !== project.id) {
    throw new BackgroundRemovalCommitError("invalid-input", "The asset store belongs to another project.");
  }
  if (initial.revision !== options.expectedRevision) {
    throw new BackgroundRemovalCommitError("project-changed", "The project changed after this preview was made. Run it again.");
  }
  const source = project.assets[options.sourceAssetId];
  if (!source || source.media.type !== "image") {
    throw new BackgroundRemovalCommitError("invalid-input", "The source image is no longer available.");
  }
  if (
    typeof Blob !== "function" || !(options.output instanceof Blob) || options.output.size < 1
    || options.output.type !== "image/png"
    || !Number.isSafeInteger(options.width) || options.width !== source.width
    || !Number.isSafeInteger(options.height) || options.height !== source.height
  ) throw new BackgroundRemovalCommitError("invalid-input", "The reviewed output does not match its source image.");
  abortIfNeeded(options.signal);

  const nextId = options.nextId ?? defaultId;
  const timestamp = options.now?.() ?? new Date().toISOString();
  const assetId = nextId("asset");
  const artifactId = nextId("artifact");
  const recipeId = nextId("recipe");
  const commandId = nextId("command");
  const ids = [assetId, artifactId, recipeId, commandId];
  if (ids.some((id) => typeof id !== "string" || id.trim().length === 0) || new Set(ids).size !== ids.length) {
    throw new BackgroundRemovalCommitError("invalid-input", "Background removal IDs are invalid.");
  }
  if (project.assets[assetId] || project.generatedArtifacts[artifactId] || project.processingRecipes[recipeId]) {
    throw new BackgroundRemovalCommitError("invalid-input", "Background removal IDs already exist.");
  }
  const modelName = `${options.model.repositoryId}@${options.model.revision}`;
  const recipe: ProcessingRecipe = {
    id: recipeId,
    name: `Remove background · ${source.name}`,
    kind: "background-removal",
    version: 1,
    sourceAssetId: source.id,
    model: {
      id: options.model.id,
      revision: options.model.revision,
      backend: options.model.backend,
      inputWidth: options.model.inputWidth,
      inputHeight: options.model.inputHeight,
    },
    output: { mimeType: "image/png", alpha: "soft-mask" },
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies ProcessingRecipe & BackgroundRemovalRecipeV1;
  const metadata: AssetMetadata = {
    id: assetId,
    name: outputName(source.name),
    width: options.width,
    height: options.height,
    createdAt: timestamp,
    updatedAt: timestamp,
    provenance: {
      source: "derived",
      parentAssetId: source.id,
      recipeId,
      artifactId,
    },
    media: { type: "image" },
    declaredMimeType: "image/png",
  };

  let stored: AssetRecord;
  try {
    stored = await options.repository.put(
      options.output,
      metadata,
      options.signal ? { signal: options.signal } : undefined,
    );
  } catch {
    throw new BackgroundRemovalCommitError("repository-failed", "The reviewed image could not be stored.");
  }
  if (!matchesStoredOutput(stored, metadata, assetId)) {
    const removed = await removeStoredOutput(options, project.id, assetId);
    if (!removed) {
      throw new BackgroundRemovalCommitError("cleanup-failed", "The asset store returned an invalid record and its attempted output still needs cleanup.");
    }
    throw new BackgroundRemovalCommitError("repository-failed", "The asset store returned an invalid output record.");
  }
  try {
    abortIfNeeded(options.signal);
    const latest = options.store.getSnapshot();
    if (latest.revision !== options.expectedRevision || latest.project.id !== project.id) {
      throw new BackgroundRemovalCommitError("project-changed", "The project changed while the reviewed image was being stored.");
    }
    const artifact: GeneratedArtifact = {
      id: artifactId,
      name: `Background removed · ${source.name}`,
      type: "processed",
      outputAssetId: stored.id,
      sourceAssetId: source.id,
      recipeId,
      mimeType: stored.mimeType,
      byteSize: stored.byteSize,
      model: modelName,
      provenance: {
        source: "local-background-removal",
        recipeId,
        model: modelName,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const dispatched = options.store.dispatch({
      command: {
        type: "command.batch",
        commands: [
          {
            type: "artifact.record",
            artifact,
            outputAsset: stored,
            recipe,
            atIndex: latest.project.rootOrder.assetIds.length,
          },
          { type: "workspace.update", patch: { selectedAssetId: stored.id, activeWorkspace: "slice" } },
        ],
      },
      metadata: {
        commandId,
        transactionId: `background-removal:${artifactId}`,
        origin: "worker",
        history: "record",
        issuedAt: timestamp,
      },
    });
    if (!dispatched.result.ok) {
      throw new BackgroundRemovalCommitError(
        "project-rejected",
        dispatched.result.diagnostics[0]?.message ?? "The project rejected the reviewed image.",
      );
    }
    options.onCleanupDebtChange?.(project.id, stored.id, false);
    return Object.freeze({ revision: dispatched.revision, asset: stored, artifact, recipe });
  } catch (error) {
    const removed = await removeStoredOutput(options, project.id, stored.id);
    if (!removed) {
      throw new BackgroundRemovalCommitError("cleanup-failed", "The project rejected the output and its stored file still needs cleanup.");
    }
    if (error instanceof BackgroundRemovalCommitError) throw error;
    throw new BackgroundRemovalCommitError("project-rejected", "The project rejected the reviewed image.");
  }
}

export function commitBackgroundRemoval(
  options: CommitBackgroundRemovalOptions,
): Promise<CommitBackgroundRemovalResult> {
  return withAssetRepositoryMutation(options.repository, () => commitUnlocked(options));
}
