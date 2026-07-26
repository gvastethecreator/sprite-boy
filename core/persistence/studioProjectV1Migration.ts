type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function migratedMedia(mimeType: unknown): { readonly type: "binary" | "image" } {
  return typeof mimeType === "string" && /^image\//iu.test(mimeType)
    ? Object.freeze({ type: "image" })
    : Object.freeze({ type: "binary" });
}

/**
 * Upgrade parsed V1 JSON into the V2 media layout without mutating the input.
 * V1 had no inspected video-track contract, so legacy video MIME remains
 * binary and current validation rejects it until the user imports it again.
 */
export function migrateStudioProjectV1Document(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const assets = value.assets;
  if (!isRecord(assets)) return { ...value, schemaVersion: 2 };
  const migratedAssets: UnknownRecord = {};
  for (const [id, candidate] of Object.entries(assets)) {
    migratedAssets[id] = isRecord(candidate)
      ? {
          ...candidate,
          media: candidate.media ?? migratedMedia(candidate.mimeType),
        }
      : candidate;
  }
  return {
    ...value,
    schemaVersion: 2,
    assets: migratedAssets,
  };
}

/** Build a strict legacy snapshot for the ordered V0→V1→V2 migrator. */
export function projectV2AsLegacyV1Document(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const assets = value.assets;
  const legacyAssets: UnknownRecord = {};
  if (isRecord(assets)) {
    for (const [id, candidate] of Object.entries(assets)) {
      if (!isRecord(candidate)) {
        legacyAssets[id] = candidate;
        continue;
      }
      const { media: _media, ...legacy } = candidate;
      legacyAssets[id] = legacy;
    }
  }
  return {
    ...value,
    schemaVersion: 1,
    ...(isRecord(assets) ? { assets: legacyAssets } : {}),
  };
}
