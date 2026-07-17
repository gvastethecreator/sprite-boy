import {
  isAssetRepositoryError,
  withAssetRepositoryMutation,
  type AssetMetadata,
  type AssetRepository,
} from "../../../core/assets";
import type {
  AssetRecord,
  GridSplitRecipeV1,
  ProcessingRecipe,
  Region,
  StudioProjectV1,
} from "../../../core/project";
import type { ProjectStore } from "../../../core/stores";
import type { StagedGridResultOutput, StagedGridResultsSnapshot } from "./stagedGridResults";

export const STAGED_GRID_COMMIT_ERROR_CODES = Object.freeze([
  "invalid-input",
  "cancelled",
  "project-changed",
  "source-missing",
  "repository-mismatch",
  "id-conflict",
  "ownership-uncertain",
  "encode-failed",
  "repository-failed",
  "project-dispatch-failed",
  "cleanup-failed",
] as const);

export type StagedGridCommitErrorCode = (typeof STAGED_GRID_COMMIT_ERROR_CODES)[number];

export class StagedGridCommitError extends Error {
  readonly code: StagedGridCommitErrorCode;
  readonly assetIds: readonly string[];
  readonly cleanupAssetIds: readonly string[];

  constructor(
    code: StagedGridCommitErrorCode,
    message: string,
    options: { assetIds?: readonly string[]; cleanupAssetIds?: readonly string[] } = {},
  ) {
    super(message);
    this.name = "StagedGridCommitError";
    this.code = code;
    this.assetIds = Object.freeze([...(options.assetIds ?? [])]);
    this.cleanupAssetIds = Object.freeze([...(options.cleanupAssetIds ?? [])]);
  }
}

export interface StagedGridSurfaceEncoder {
  (output: StagedGridResultOutput, signal?: AbortSignal): Promise<Blob>;
}

export interface CommitStagedGridResultsOptions {
  readonly store: ProjectStore;
  readonly repository: AssetRepository;
  readonly staged: StagedGridResultsSnapshot;
  readonly sourceAssetId: string;
  readonly name?: string;
  readonly nextId?: () => string;
  readonly now?: () => string;
  readonly encode?: StagedGridSurfaceEncoder;
  readonly signal?: AbortSignal;
}

export interface CommitStagedGridResultsResult {
  readonly revision: number;
  readonly recipe: ProcessingRecipe;
  readonly regions: readonly Region[];
  readonly derivedAssets: readonly AssetRecord[];
  readonly usedDerivedAssets: boolean;
}

function fail(code: StagedGridCommitErrorCode, message: string, options?: { assetIds?: readonly string[]; cleanupAssetIds?: readonly string[] }): never {
  throw new StagedGridCommitError(code, message, options);
}

function assertTimestamp(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) fail("invalid-input", `${label} must be an ISO timestamp.`);
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) fail("cancelled", "Grid result commit was cancelled.");
}

let identitySequence = 0;

function defaultId(prefix: string): string {
  try {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID === "function") return `${prefix}-${randomUUID.call(globalThis.crypto)}`;
  } catch {
    // The caller can inject a deterministic id factory for tests/hosts.
  }
  identitySequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${identitySequence.toString(36)}`;
}

function safeName(value: string | undefined): string {
  const normalized = (value ?? "slice").replace(/[\\/:*?"<>|\p{Cc}]/gu, "-").trim();
  return normalized.length > 0 ? normalized.slice(0, 120) : "slice";
}

function recipeNeedsDerivedAssets(recipe: GridSplitRecipeV1): boolean {
  return recipe.chroma.enabled || recipe.crop.threshold > 0 || recipe.crop.padding > 0 || recipe.pixel.enabled;
}

function cloneRecipe(recipe: GridSplitRecipeV1, id: string, name: string, timestamp: string): ProcessingRecipe {
  return {
    kind: "grid-split",
    version: 1,
    id,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceAssetId: recipe.sourceAssetId,
    layout: recipe.layout.mode === "auto"
      ? { mode: "auto" }
      : { mode: "manual", rows: recipe.layout.rows, cols: recipe.layout.cols },
    crop: { threshold: recipe.crop.threshold, padding: recipe.crop.padding },
    chroma: {
      enabled: recipe.chroma.enabled,
      color: recipe.chroma.color,
      tolerance: recipe.chroma.tolerance,
      smoothness: recipe.chroma.smoothness,
      spill: recipe.chroma.spill,
    },
    pixel: {
      enabled: recipe.pixel.enabled,
      size: recipe.pixel.size,
      quantize: recipe.pixel.quantize,
      colors: recipe.pixel.colors,
      ...(recipe.pixel.palette === undefined ? {} : { palette: [...recipe.pixel.palette] }),
    },
  };
}

function createDefaultEncoder(output: StagedGridResultOutput, signal?: AbortSignal): Promise<Blob> {
  abortIfNeeded(signal);
  const width = output.surface.width;
  const height = output.surface.height;
  const draw = (context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): Blob | Promise<Blob> => {
    context.imageSmoothingEnabled = false;
    context.putImageData(new ImageData(new Uint8ClampedArray(output.surface.pixels), width, height), 0, 0);
    abortIfNeeded(signal);
    if ("convertToBlob" in context.canvas && typeof context.canvas.convertToBlob === "function") {
      return context.canvas.convertToBlob({ type: "image/png" });
    }
    return new Promise<Blob>((resolve, reject) => {
      (context.canvas as HTMLCanvasElement).toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas could not encode a PNG."));
      }, "image/png");
    });
  };
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context) return Promise.resolve(draw(context));
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context) return Promise.resolve(draw(context));
  }
  return Promise.reject(new Error("PNG encoding is unavailable in this runtime."));
}

function sourceBounds(output: StagedGridResultOutput, source: AssetRecord): { x: number; y: number; width: number; height: number } {
  const bounds = output.cellBounds;
  if (bounds.x < 0 || bounds.y < 0 || bounds.width < 1 || bounds.height < 1 ||
    bounds.x > source.width - bounds.width || bounds.y > source.height - bounds.height) {
    fail("invalid-input", `Output ${output.index} cell bounds exceed the source asset.`);
  }
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

function sameSourceIdentity(left: AssetRecord, right: AssetRecord): boolean {
  return left.id === right.id
    && left.contentHash === right.contentHash
    && left.blobKey === right.blobKey
    && left.width === right.width
    && left.height === right.height
    && left.byteSize === right.byteSize
    && left.updatedAt === right.updatedAt;
}

function createRegion(
  output: StagedGridResultOutput,
  assetId: string,
  bounds: { x: number; y: number; width: number; height: number },
  recipeId: string,
  timestamp: string,
  id: string,
): Region {
  return {
    id,
    assetId,
    name: `Slice ${output.index + 1}`,
    bounds,
    createdAt: timestamp,
    updatedAt: timestamp,
    provenance: {
      source: "grid-split",
      sourceId: recipeId,
      importedAt: timestamp,
      note: `output:${output.index}`,
    },
  };
}

interface CreatedAssetAttempt {
  readonly requestedId: string;
  readonly recipeId: string;
  readonly parentAssetId: string;
  storedId?: string;
}

function isNotFound(error: unknown): boolean {
  if (isAssetRepositoryError(error)) return error.code === "ASSET_NOT_FOUND";
  try {
    if (typeof DOMException !== "undefined" && error instanceof DOMException) return error.name === "NotFoundError";
    return error !== null && typeof error === "object" && "name" in error && (error as { readonly name?: unknown }).name === "NotFoundError";
  } catch {
    return false;
  }
}

function generatedId(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail("invalid-input", `${label} must be a non-empty ID.`);
  return value;
}

function assertGeneratedIdsAvailable(project: StudioProjectV1, ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) fail("id-conflict", "Generated recipe, asset and region IDs are not unique.");
  for (const id of ids) {
    if (project.processingRecipes[id] || project.assets[id] || project.regions[id]) {
      fail("id-conflict", `Generated ID ${id} already belongs to the active project.`);
    }
  }
}

async function assertRepositoryDestinationAbsent(repository: AssetRepository, assetId: string): Promise<void> {
  try {
    const record = await repository.getMetadata(assetId);
    if (record) fail("id-conflict", `Repository destination ${assetId} already exists.`);
    fail("repository-failed", `Repository destination preflight returned no metadata for ${assetId}.`);
  } catch (error) {
    if (error instanceof StagedGridCommitError) throw error;
    if (isNotFound(error)) return;
    fail("repository-failed", `Repository destination preflight failed for ${assetId}.`);
  }
}

function matchesAttempt(record: AssetRecord, attempt: CreatedAssetAttempt): boolean {
  return record.id === attempt.requestedId
    && record.provenance.source === "derived"
    && record.provenance.recipeId === attempt.recipeId
    && record.provenance.parentAssetId === attempt.parentAssetId;
}

async function removeCreatedAssets(
  repository: AssetRepository,
  store: ProjectStore,
  attempts: readonly CreatedAssetAttempt[],
): Promise<readonly string[]> {
  const failed: string[] = [];
  const candidates = [...new Set(attempts.flatMap((attempt) => [attempt.storedId, attempt.requestedId].filter((id): id is string => Boolean(id))))];
  for (const assetId of candidates.reverse()) {
    const attempt = attempts.find((candidate) => candidate.requestedId === assetId || candidate.storedId === assetId);
    try {
      const current = store.getSnapshot();
      if (current.project.id !== repository.projectId) {
        failed.push(assetId);
        continue;
      }
      const graphRecord = current.project.assets[assetId];
      if (graphRecord) {
        // A command may have committed and then reported a late failure. An
        // exact graph-owned attempt is already durable and must not be removed.
        if (attempt && graphRecord.provenance.source === "derived"
          && graphRecord.provenance.recipeId === attempt.recipeId
          && graphRecord.provenance.parentAssetId === attempt.parentAssetId) continue;
        failed.push(assetId);
        continue;
      }
      const record = await repository.getMetadata(assetId);
      if (!attempt || !matchesAttempt(record, attempt)) {
        failed.push(assetId);
        continue;
      }
      // Metadata lookup yields. Re-read the graph immediately before remove;
      // a late dispatch may have claimed the same ID while cleanup awaited IO.
      const latest = store.getSnapshot();
      if (latest.project.id !== repository.projectId) {
        failed.push(assetId);
        continue;
      }
      const latestGraphRecord = latest.project.assets[assetId];
      if (latestGraphRecord) {
        if (attempt && latestGraphRecord.provenance.source === "derived"
          && latestGraphRecord.provenance.recipeId === attempt.recipeId
          && latestGraphRecord.provenance.parentAssetId === attempt.parentAssetId) continue;
        failed.push(assetId);
        continue;
      }
      await repository.remove(assetId, "release-and-remove");
      try {
        await repository.getMetadata(assetId);
        failed.push(assetId);
      } catch (verifyError) {
        if (!isNotFound(verifyError)) failed.push(assetId);
      }
    } catch (error) {
      if (isNotFound(error)) continue;
      failed.push(assetId);
    }
  }
  return Object.freeze(failed);
}

function attemptedAssetIds(attempts: readonly CreatedAssetAttempt[]): readonly string[] {
  const ids = attempts.flatMap((attempt) => [attempt.requestedId, attempt.storedId]
    .filter((id): id is string => Boolean(id)));
  return Object.freeze([...new Set(ids)]);
}

async function commitStagedGridResultsUnlocked(options: CommitStagedGridResultsOptions): Promise<CommitStagedGridResultsResult> {
  const staged = options.staged;
  if (staged.status !== "succeeded" || staged.recipe === null || staged.source === null || staged.outputs.length === 0) {
    fail("invalid-input", "Only a non-empty succeeded Grid result can be committed.");
  }
  if (typeof options.sourceAssetId !== "string" || options.sourceAssetId.length === 0 || options.sourceAssetId !== staged.recipe.sourceAssetId) {
    fail("invalid-input", "The staged recipe is not bound to the current canonical source asset.");
  }
  const projectState = options.store.getSnapshot();
  const project = projectState.project as StudioProjectV1;
  if (options.repository.projectId !== project.id) {
    fail("repository-mismatch", "The AssetRepository belongs to a different active project.");
  }
  const source = project.assets[options.sourceAssetId];
  if (!source) fail("source-missing", "The canonical source asset is missing from the active project.");
  const next = (prefix: string): string => generatedId(options.nextId?.() ?? defaultId(prefix), prefix);
  const recipeId = next("recipe");
  const timestamp = options.now?.() ?? new Date().toISOString();
  assertTimestamp(timestamp, "timestamp");
  const recipe = cloneRecipe(staged.recipe, recipeId, safeName(options.name), timestamp);
  const useDerivedAssets = recipeNeedsDerivedAssets(staged.recipe);
  const assetIds: string[] = [];
  const regionIds: string[] = [];
  for (let index = 0; index < staged.outputs.length; index += 1) {
    if (useDerivedAssets) assetIds.push(next("asset"));
    regionIds.push(next("region"));
  }
  assertGeneratedIdsAvailable(project, [recipeId, ...assetIds, ...regionIds]);
  for (const assetId of assetIds) {
    abortIfNeeded(options.signal);
    await assertRepositoryDestinationAbsent(options.repository, assetId);
  }
  const encoder = options.encode ?? createDefaultEncoder;
  const derivedAssets: AssetRecord[] = [];
  const regions: Region[] = [];
  const createdAssetAttempts: CreatedAssetAttempt[] = assetIds.map((assetId) => ({
    requestedId: assetId,
    recipeId,
    parentAssetId: source.id,
  }));
  try {
    for (const [outputIndex, output] of staged.outputs.entries()) {
      abortIfNeeded(options.signal);
      let assetId = source.id;
      let bounds = sourceBounds(output, source);
      if (useDerivedAssets) {
        assetId = assetIds[outputIndex]!;
        const attempt = createdAssetAttempts[outputIndex]!;
        const blob = await encoder(output, options.signal);
        abortIfNeeded(options.signal);
        if (!(blob instanceof Blob) || blob.size < 1) fail("encode-failed", `Output ${output.index} did not encode to a Blob.`);
        const metadata: AssetMetadata = {
          id: assetId,
          name: `${safeName(options.name)}-${String(output.index + 1).padStart(3, "0")}.png`,
          width: output.surface.width,
          height: output.surface.height,
          createdAt: timestamp,
          updatedAt: timestamp,
          provenance: {
            source: "derived",
            recipeId,
            parentAssetId: source.id,
          },
          declaredMimeType: "image/png",
        };
        // The attempt is tracked before this await so a late adapter rejection
        // can still reconcile and clean up a record that was actually written.
        const record: AssetRecord = await options.repository.put(
          blob,
          metadata,
          options.signal ? { signal: options.signal } : undefined,
        );
        attempt.storedId = record.id;
        derivedAssets.push(record);
        abortIfNeeded(options.signal);
        if (record.id !== assetId) fail("repository-failed", `Repository returned a mismatched asset id for output ${output.index}.`);
        bounds = { x: 0, y: 0, width: record.width, height: record.height };
      }
      const regionId = regionIds[outputIndex]!;
      regions.push(createRegion(output, assetId, bounds, recipeId, timestamp, regionId));
    }
    abortIfNeeded(options.signal);
    const beforeDispatch = options.store.getSnapshot();
    const currentSource = beforeDispatch.project.assets[source.id];
    if (beforeDispatch.revision !== projectState.revision
      || beforeDispatch.project.id !== project.id
      || !currentSource
      || !sameSourceIdentity(currentSource, source)) {
      fail("project-changed", "The canonical source changed while Grid outputs were being prepared.");
    }
    const dispatch = options.store.dispatch({
      command: {
        type: "regions.commitRecipe",
        recipe,
        regions,
        ...(derivedAssets.length > 0 ? { derivedAssets } : {}),
        atIndex: project.rootOrder.regionIds.length,
      },
      metadata: {
        commandId: defaultId("grid-commit"),
        origin: "user",
        history: "record",
        issuedAt: timestamp,
      },
    });
    if (!dispatch.result.ok) {
      const cleanupAssetIds = await removeCreatedAssets(options.repository, options.store, createdAssetAttempts);
      if (cleanupAssetIds.length > 0) fail("cleanup-failed", "Project commit failed and derived asset cleanup is pending.", { assetIds: attemptedAssetIds(createdAssetAttempts), cleanupAssetIds });
      fail("project-dispatch-failed", dispatch.result.diagnostics[0]?.message ?? "Project commit was rejected.", { assetIds: attemptedAssetIds(createdAssetAttempts) });
    }
    return Object.freeze({
      revision: dispatch.revision,
      recipe: Object.freeze(recipe),
      regions: Object.freeze([...regions]),
      derivedAssets: Object.freeze([...derivedAssets]),
      usedDerivedAssets: useDerivedAssets,
    });
  } catch (error) {
    if (error instanceof StagedGridCommitError) {
      if (error.code === "project-dispatch-failed" || error.code === "cleanup-failed") throw error;
      const cleanupAssetIds = await removeCreatedAssets(options.repository, options.store, createdAssetAttempts);
      if (cleanupAssetIds.length > 0) {
        throw new StagedGridCommitError("cleanup-failed", "Grid commit failed and derived asset cleanup is pending.", {
          assetIds: attemptedAssetIds(createdAssetAttempts),
          cleanupAssetIds,
        });
      }
      throw error;
    }
    const cleanupAssetIds = await removeCreatedAssets(options.repository, options.store, createdAssetAttempts);
    if (cleanupAssetIds.length > 0) {
      throw new StagedGridCommitError("cleanup-failed", "Grid commit failed and derived asset cleanup is pending.", {
        assetIds: attemptedAssetIds(createdAssetAttempts),
        cleanupAssetIds,
      });
    }
    throw new StagedGridCommitError("repository-failed", "Grid outputs could not be committed.", { assetIds: attemptedAssetIds(createdAssetAttempts) });
  }
}

export function commitStagedGridResults(options: CommitStagedGridResultsOptions): Promise<CommitStagedGridResultsResult> {
  return withAssetRepositoryMutation(options.repository, () => commitStagedGridResultsUnlocked(options));
}
