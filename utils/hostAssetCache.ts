import type { BuilderAsset } from "../types";

/**
 * Pure prune of decoded image cache: keep only ids present in builderAssets.
 */
export function pruneAssetCacheEntries<T>(
  cache: Readonly<Record<string, T>>,
  builderAssets: readonly BuilderAsset[] | undefined,
): Record<string, T> {
  const allowed = new Set((builderAssets ?? []).map((a) => a.id));
  let changed = false;
  const next: Record<string, T> = {};
  for (const [id, value] of Object.entries(cache)) {
    if (allowed.has(id)) {
      next[id] = value;
    } else {
      changed = true;
    }
  }
  if (!changed && Object.keys(next).length === Object.keys(cache).length) {
    return cache as Record<string, T>;
  }
  return next;
}

export function missingAssetIdsForCache(
  cache: Readonly<Record<string, unknown>>,
  builderAssets: readonly BuilderAsset[] | undefined,
): BuilderAsset[] {
  return (builderAssets ?? []).filter((a) => !cache[a.id]);
}
