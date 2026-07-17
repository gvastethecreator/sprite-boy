import type { EntityId, StudioProjectV1 } from "../project";
import type { AssetRepository } from "./contracts";

export interface ProjectAssetReconciliationResult {
  readonly complete: boolean;
  readonly removedAssetIds: readonly EntityId[];
  readonly pendingAssetIds: readonly EntityId[];
  readonly listFailed: boolean;
}

export interface ProjectAssetReconciliationOptions {
  /** Re-read the active graph immediately before each removal. */
  readonly getProject?: () => StudioProjectV1;
}

/**
 * Remove repository records that have no owner in the recovered canonical
 * graph. Run only at a project lifecycle boundary, never during an import.
 */
export async function reconcileProjectAssetRepository(
  repository: AssetRepository,
  project: StudioProjectV1,
  options: ProjectAssetReconciliationOptions = {},
): Promise<ProjectAssetReconciliationResult> {
  if (repository.projectId !== project.id) {
    return Object.freeze({
      complete: false,
      removedAssetIds: Object.freeze([]),
      pendingAssetIds: Object.freeze([]),
      listFailed: true,
    });
  }

  let records: Awaited<ReturnType<AssetRepository["list"]>>;
  try {
    records = await repository.list();
  } catch {
    return Object.freeze({
      complete: false,
      removedAssetIds: Object.freeze([]),
      pendingAssetIds: Object.freeze([]),
      listFailed: true,
    });
  }

  const removedAssetIds: EntityId[] = [];
  const pendingAssetIds: EntityId[] = [];
  for (const record of records) {
    const currentProject = options.getProject?.() ?? project;
    if (currentProject.id !== repository.projectId) {
      pendingAssetIds.push(record.id);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(currentProject.assets, record.id)) continue;
    try {
      await repository.remove(record.id, "release-and-remove");
      removedAssetIds.push(record.id);
    } catch {
      pendingAssetIds.push(record.id);
    }
  }
  return Object.freeze({
    complete: pendingAssetIds.length === 0,
    removedAssetIds: Object.freeze(removedAssetIds),
    pendingAssetIds: Object.freeze(pendingAssetIds),
    listFailed: false,
  });
}
