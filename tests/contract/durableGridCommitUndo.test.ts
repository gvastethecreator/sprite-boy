import { describe, expect, it } from "vitest";
import { createEmptyStudioProject, type AssetRecord, type Region, type StudioProjectV1 } from "../../core/project";
import {
  durableGridCommitMatchesProject,
  GRID_COMMIT_UNDO_KEY,
  readDurableGridCommitUndo,
} from "../../features/slice/results/durableGridCommitUndo";

const NOW = "2026-07-16T12:00:00.000Z";

function fixture(): StudioProjectV1 {
  const project = createEmptyStudioProject({ id: "project-marker", now: NOW });
  const source: AssetRecord = {
    id: "asset-source",
    name: "sheet.png",
    blobKey: "sha256:" + "a".repeat(64),
    contentHash: "a".repeat(64),
    mimeType: "image/png",
    width: 4,
    height: 2,
    byteSize: 8,
    createdAt: NOW,
    updatedAt: NOW,
    provenance: { source: "import", importedAt: NOW },
  };
  const recipe = {
    kind: "grid-split" as const,
    version: 1 as const,
    id: "recipe-grid",
    name: "sheet",
    createdAt: NOW,
    updatedAt: NOW,
    sourceAssetId: source.id,
    layout: { mode: "manual" as const, rows: 1, cols: 1 },
    crop: { threshold: 0, padding: 0 },
    chroma: { enabled: false, color: "#00ff00", tolerance: 0, smoothness: 0, spill: 0 },
    pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
  };
  const region: Region = {
    id: "region-grid",
    name: "Slice 1",
    assetId: source.id,
    bounds: { x: 0, y: 0, width: 4, height: 2 },
    createdAt: NOW,
    updatedAt: NOW,
    provenance: { source: "grid-split", sourceId: recipe.id, importedAt: NOW, note: "output:0" },
  };
  return {
    ...project,
    assets: { [source.id]: source },
    processingRecipes: { [recipe.id]: recipe },
    regions: { [region.id]: region },
    rootOrder: { ...project.rootOrder, assetIds: [source.id], regionIds: [region.id] },
    workspace: { ...project.workspace, selectedAssetId: source.id },
  };
}

function marker(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "project-marker",
    sourceAssetId: "asset-source",
    recipeId: "recipe-grid",
    regionIds: ["region-grid"],
    derivedAssetIds: [],
    committedRevision: 1,
    ...overrides,
  };
}

describe("durable Grid commit undo marker", () => {
  it("accepts only a graph- and provenance-matched marker", () => {
    const project = fixture();
    expect(durableGridCommitMatchesProject(project, marker())).toBe(true);
    expect(durableGridCommitMatchesProject(project, marker({ projectId: "foreign-project" }))).toBe(false);
    expect(durableGridCommitMatchesProject(project, marker({ regionIds: ["region-grid", "region-grid"] }))).toBe(false);
  });

  it("rejects markers that point at an unrelated recipe or region provenance", () => {
    const project = fixture();
    expect(durableGridCommitMatchesProject(project, marker({ recipeId: "other-recipe" }))).toBe(false);
    const altered = {
      ...project,
      regions: {
        ...project.regions,
        "region-grid": {
          ...project.regions["region-grid"]!,
          provenance: { ...project.regions["region-grid"]!.provenance, source: "grid-split", sourceId: "other-recipe" },
        },
      },
    };
    expect(durableGridCommitMatchesProject(altered, marker())).toBe(false);
  });

  it("fails closed for malformed local metadata", () => {
    const previousStorage = globalThis.localStorage;
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } satisfies Pick<Storage, "getItem" | "setItem" | "removeItem">;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    try {
      storage.setItem(GRID_COMMIT_UNDO_KEY, JSON.stringify({ projectId: "project-marker", regionIds: [] }));
      expect(readDurableGridCommitUndo("project-marker")).toBeNull();
      storage.setItem(GRID_COMMIT_UNDO_KEY, "not-json");
      expect(readDurableGridCommitUndo("project-marker")).toBeNull();
      storage.removeItem(GRID_COMMIT_UNDO_KEY);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previousStorage });
    }
  });
});
