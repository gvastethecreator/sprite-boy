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

const repositoryMutationLocks = new WeakMap<AssetRepository, Promise<void>>();

/** Serialize repository writes/removals with lifecycle reconciliation per project repository. */
export function withAssetRepositoryMutation<T>(
  repository: AssetRepository,
  operation: () => T | PromiseLike<T>,
): Promise<T> {
  const previous = repositoryMutationLocks.get(repository) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  repositoryMutationLocks.set(repository, next.then(() => undefined, () => undefined));
  return next;
}

/**
 * Remove repository records that have no owner in the recovered canonical
 * graph. Run only at a project lifecycle boundary, never during an import.
 */
async function reconcileProjectAssetRepositoryUnlocked(
  repository: AssetRepository,
  project: StudioProjectV1,
  options: ProjectAssetReconciliationOptions = {},
): Promise<ProjectAssetReconciliationResult> {
  let activeProject: StudioProjectV1;
  try {
    // The caller's project argument can predate a queued import. Resolve the
    // canonical graph only after this operation owns the repository lock.
    activeProject = options.getProject?.() ?? project;
  } catch {
    return Object.freeze({
      complete: false,
      removedAssetIds: Object.freeze([]),
      pendingAssetIds: Object.freeze([]),
      listFailed: true,
    });
  }
  if (repository.projectId !== activeProject.id) {
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
    const currentProject = options.getProject?.() ?? activeProject;
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

export function reconcileProjectAssetRepository(
  repository: AssetRepository,
  project: StudioProjectV1,
  options: ProjectAssetReconciliationOptions = {},
): Promise<ProjectAssetReconciliationResult> {
  return withAssetRepositoryMutation(repository, () => reconcileProjectAssetRepositoryUnlocked(repository, project, options));
}
