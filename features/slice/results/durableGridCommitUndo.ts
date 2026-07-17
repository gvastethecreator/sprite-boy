import type { StudioProjectV1 } from "../../../core/project";
import type { CommitStagedGridResultsResult } from "./commitStagedGridResults";

export const GRID_COMMIT_UNDO_KEY = "sprite-boy-studio:grid-commit-undo:v1";

export interface DurableGridCommitUndo {
  readonly projectId: string;
  readonly sourceAssetId: string;
  readonly recipeId: string;
  readonly regionIds: readonly string[];
  readonly derivedAssetIds: readonly string[];
  readonly committedRevision: number;
}

function parseMarker(value: unknown, projectId: string): DurableGridCommitUndo | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.projectId !== projectId || typeof candidate.sourceAssetId !== "string" ||
    typeof candidate.recipeId !== "string" || !Array.isArray(candidate.regionIds) ||
    !candidate.regionIds.every((id) => typeof id === "string") || !Array.isArray(candidate.derivedAssetIds) ||
    !candidate.derivedAssetIds.every((id) => typeof id === "string") ||
    !Number.isSafeInteger(candidate.committedRevision)) return null;
  return Object.freeze({
    projectId,
    sourceAssetId: candidate.sourceAssetId,
    recipeId: candidate.recipeId,
    regionIds: Object.freeze([...candidate.regionIds] as string[]),
    derivedAssetIds: Object.freeze([...candidate.derivedAssetIds] as string[]),
    committedRevision: candidate.committedRevision as number,
  });
}

function readStorageValue(): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(GRID_COMMIT_UNDO_KEY);
    return raw ? JSON.parse(raw) as unknown : null;
  } catch {
    return null;
  }
}

export function readDurableGridCommitUndo(projectId: string): DurableGridCommitUndo | null {
  const value = readStorageValue();
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version === 1 && record.projects !== null && typeof record.projects === "object" && !Array.isArray(record.projects)) {
    return parseMarker((record.projects as Record<string, unknown>)[projectId], projectId);
  }
  // Backward-compatible read of the pre-namespace marker shape.
  return parseMarker(value, projectId);
}

export function writeDurableGridCommitUndo(result: CommitStagedGridResultsResult, projectId: string): void {
  try {
    const value = readStorageValue();
    const projects = value !== null && typeof value === "object" && !Array.isArray(value) &&
      (value as Record<string, unknown>).version === 1 &&
      (value as Record<string, unknown>).projects !== null &&
      typeof (value as Record<string, unknown>).projects === "object" &&
      !Array.isArray((value as Record<string, unknown>).projects)
      ? { ...((value as Record<string, unknown>).projects as Record<string, unknown>) }
      : {};
    projects[projectId] = {
      projectId,
      sourceAssetId: result.recipe.sourceAssetId,
      recipeId: result.recipe.id,
      regionIds: result.regions.map((region) => region.id),
      derivedAssetIds: result.derivedAssets.map((asset) => asset.id),
      committedRevision: result.revision,
    } satisfies DurableGridCommitUndo;
    globalThis.localStorage?.setItem(GRID_COMMIT_UNDO_KEY, JSON.stringify({ version: 1, projects }));
  } catch {
    // The canonical graph and autosave remain authoritative when metadata storage is unavailable.
  }
}

export function clearDurableGridCommitUndo(projectId?: string): void {
  try {
    if (!projectId) {
      globalThis.localStorage?.removeItem(GRID_COMMIT_UNDO_KEY);
      return;
    }
    const value = readStorageValue();
    if (value === null || typeof value !== "object" || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    if (record.version !== 1 || record.projects === null || typeof record.projects !== "object" || Array.isArray(record.projects)) return;
    const projects = { ...(record.projects as Record<string, unknown>) };
    delete projects[projectId];
    if (Object.keys(projects).length === 0) globalThis.localStorage?.removeItem(GRID_COMMIT_UNDO_KEY);
    else globalThis.localStorage?.setItem(GRID_COMMIT_UNDO_KEY, JSON.stringify({ version: 1, projects }));
  } catch {
    // Metadata cleanup is best effort; stale markers are validated against the graph before use.
  }
}

export function durableGridCommitMatchesProject(
  project: StudioProjectV1,
  marker: DurableGridCommitUndo | null,
): marker is DurableGridCommitUndo {
  if (!marker || marker.projectId !== project.id ||
    marker.regionIds.length === 0 || new Set(marker.regionIds).size !== marker.regionIds.length ||
    new Set(marker.derivedAssetIds).size !== marker.derivedAssetIds.length) return false;
  const source = project.assets[marker.sourceAssetId];
  const recipe = project.processingRecipes[marker.recipeId];
  if (!source || !recipe || recipe.kind !== "grid-split" || recipe.sourceAssetId !== marker.sourceAssetId) return false;
  const regions = marker.regionIds.map((id) => project.regions[id]);
  if (regions.some((region) => !region || region.provenance?.source !== "grid-split" || region.provenance.sourceId !== marker.recipeId)) return false;
  const derivedIds = regions
    .map((region) => region!.assetId)
    .filter((assetId) => assetId !== marker.sourceAssetId);
  if (new Set(derivedIds).size !== new Set(marker.derivedAssetIds).size ||
    derivedIds.some((assetId) => !marker.derivedAssetIds.includes(assetId)) ||
    marker.derivedAssetIds.some((assetId) => !derivedIds.includes(assetId))) return false;
  if (regions.some((region) => !project.rootOrder.regionIds.includes(region!.id))) return false;
  return marker.derivedAssetIds.every((id) => {
    const asset = project.assets[id];
    return Boolean(asset && asset.provenance.source === "derived" &&
      asset.provenance.recipeId === marker.recipeId && asset.provenance.parentAssetId === marker.sourceAssetId);
  });
}
