import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { createEmptyStudioProject, type AssetRecord, type ProcessingRecipe, type Region } from "../../core/project";
import { createProjectStoreWithHistory } from "../../core/stores";
import { AssetRepositoryError, type AssetRepository } from "../../core/assets";
import {
  createGridExportPort,
  createGridExportRequest,
  GRID_EXPORT_FORMATS,
  resolveGridExportBundle,
  resolveGridRegionBlob,
} from "../../features/slice/export/gridExport";
import { openCompositionFromSource } from "../../features/compose/project/compositionEntry";

const NOW = "2026-07-16T12:00:00.000Z";

function fixture() {
  const project = createEmptyStudioProject({ id: "project-grid-export", now: NOW });
  const source: AssetRecord = {
    id: "asset-source",
    name: "sheet.png",
    blobKey: "sha256:" + "b".repeat(64),
    contentHash: "b".repeat(64),
    mimeType: "image/png",
    width: 4,
    height: 4,
    byteSize: 4,
    createdAt: NOW,
    updatedAt: NOW,
    provenance: { source: "import", importedAt: NOW },
  };
  const recipe: Extract<ProcessingRecipe, { kind: "grid-split" }> = {
    kind: "grid-split",
    version: 1,
    id: "recipe-grid",
    name: "Grid export fixture",
    createdAt: NOW,
    updatedAt: NOW,
    sourceAssetId: source.id,
    layout: { mode: "manual", rows: 1, cols: 1 },
    crop: { threshold: 0, padding: 0 },
    chroma: { enabled: false, color: "#00ff00", tolerance: 0, smoothness: 0, spill: 0 },
    pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
  };
  const asset: AssetRecord = {
    id: "asset-derived",
    name: "slice.png",
    blobKey: "sha256:" + "a".repeat(64),
    contentHash: "a".repeat(64),
    mimeType: "image/png",
    width: 2,
    height: 2,
    byteSize: 4,
    createdAt: NOW,
    updatedAt: NOW,
    provenance: { source: "derived", recipeId: "recipe-grid", parentAssetId: "asset-source" },
  };
  const region: Region = {
    id: "region-1",
    name: "Slice 1",
    assetId: asset.id,
    bounds: { x: 0, y: 0, width: 2, height: 2 },
    createdAt: NOW,
    updatedAt: NOW,
    provenance: { source: "grid-split", sourceId: "recipe-grid", importedAt: NOW, note: "output:0" },
  };
  const seeded = {
    ...project,
    assets: { [source.id]: source, [asset.id]: asset },
    processingRecipes: { [recipe.id]: recipe },
    regions: { [region.id]: region },
    rootOrder: { ...project.rootOrder, assetIds: [source.id, asset.id], regionIds: [region.id] },
  };
  const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" });
  const repository = {
    projectId: project.id,
    getBlob: vi.fn(async (assetId: string) => {
      if (assetId !== asset.id) throw new AssetRepositoryError("ASSET_NOT_FOUND", "missing", { operation: "get-blob", assetId });
      return blob;
    }),
    put: vi.fn(),
    getMetadata: vi.fn(),
    remove: vi.fn(),
    list: vi.fn(),
    verify: vi.fn(),
    scanIntegrity: vi.fn(),
    exportMany: vi.fn(),
    createRuntimeUrl: vi.fn(),
    releaseRuntimeUrl: vi.fn(),
    releaseOwner: vi.fn(),
    dispose: vi.fn(),
  } as unknown as AssetRepository;
  return { project: seeded, repository, blob, region, source };
}

function writer() {
  const writes: Array<{ fileName: string; blob: Blob }> = [];
  return {
    writes,
    value: {
      id: "test-writer",
      write: vi.fn(async ({ artifact }: { artifact: { fileName: string; blob: Blob; requestId: string; artifactId: string; byteSize: number } }) => {
        writes.push({ fileName: artifact.fileName, blob: artifact.blob });
        return {
          requestId: artifact.requestId,
          artifactId: artifact.artifactId,
          fileName: artifact.fileName,
          bytesWritten: artifact.byteSize,
        };
      }),
    },
  };
}

describe("Grid Export Center port (G7-01/G7-02)", () => {
  it("resolves a committed region and downloads one PNG through ExportPort", async () => {
    const { project, repository, blob, region } = fixture();
    const payload = await resolveGridRegionBlob(project, repository, region.id);
    expect(payload.blob).toBe(blob);
    const sink = writer();
    const port = createGridExportPort(sink.value, () => NOW);
    const result = await port.run(createGridExportRequest(
      project,
      1,
      GRID_EXPORT_FORMATS.png,
      "Slice 1",
      { kind: "single", region: payload },
      { requestId: "request-one", artifactId: "artifact-one" },
    ));
    expect(result.artifact.fileName).toBe("Slice 1.png");
    expect(result.artifact.mimeType).toBe("image/png");
    expect(sink.writes).toHaveLength(1);
  });

  it("crops a source-backed region from provenance even when UI selection changed", async () => {
    const { project, repository, source } = fixture();
    const sourceRegion: Region = {
      id: "region-source",
      name: "Source slice",
      assetId: source.id,
      bounds: { x: 1, y: 1, width: 2, height: 2 },
      createdAt: NOW,
      updatedAt: NOW,
      provenance: { source: "grid-split", sourceId: "recipe-grid", importedAt: NOW, note: "output:0" },
    };
    const selectedOtherAssetProject = {
      ...project,
      workspace: { ...project.workspace, selectedAssetId: "asset-derived" },
      regions: { ...project.regions, [sourceRegion.id]: sourceRegion },
      rootOrder: { ...project.rootOrder, regionIds: [sourceRegion.id] },
    };
    const sourceBlob = new Blob([new Uint8Array([9, 8, 7, 6])], { type: "image/png" });
    vi.mocked(repository.getBlob).mockImplementation(async (assetId: string) => {
      if (assetId === source.id) return sourceBlob;
      throw new AssetRepositoryError("ASSET_NOT_FOUND", "missing", { operation: "get-blob", assetId });
    });
    const drawImage = vi.fn();
    const close = vi.fn();
    class MockCanvas {
      readonly width: number;
      readonly height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return { imageSmoothingEnabled: false, clearRect: vi.fn(), drawImage };
      }
      convertToBlob = vi.fn(async () => new Blob([new Uint8Array([1])], { type: "image/png" }));
    }
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close })));
    vi.stubGlobal("OffscreenCanvas", MockCanvas);
    try {
      const payload = await resolveGridRegionBlob(selectedOtherAssetProject, repository, sourceRegion.id);
      expect(payload.blob.type).toBe("image/png");
      expect(payload.blob).not.toBe(sourceBlob);
      expect(drawImage).toHaveBeenCalledWith(expect.anything(), 1, 1, 2, 2, 0, 0, 2, 2);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("crops irregular wand/manual Regions from the canonical source Blob", async () => {
    const { project, repository, source } = fixture();
    const irregularRegion: Region = {
      id: "region-wand",
      name: "Irregular region",
      assetId: source.id,
      bounds: { x: 0, y: 1, width: 2, height: 2 },
      createdAt: NOW,
      updatedAt: NOW,
      provenance: { source: "wand", sourceId: "wand:sha256:" + "c".repeat(64), importedAt: NOW },
    };
    const irregularProject = {
      ...project,
      regions: { [irregularRegion.id]: irregularRegion },
      rootOrder: { ...project.rootOrder, regionIds: [irregularRegion.id] },
    };
    const sourceBlob = new Blob([new Uint8Array([9, 8, 7, 6])], { type: "image/png" });
    vi.mocked(repository.getBlob).mockResolvedValue(sourceBlob);
    const drawImage = vi.fn();
    const close = vi.fn();
    class MockCanvas {
      readonly width: number;
      readonly height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return { imageSmoothingEnabled: false, clearRect: vi.fn(), drawImage };
      }
      convertToBlob = vi.fn(async () => new Blob([new Uint8Array([1])], { type: "image/png" }));
    }
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close })));
    vi.stubGlobal("OffscreenCanvas", MockCanvas);
    try {
      const payload = await resolveGridRegionBlob(irregularProject, repository, irregularRegion.id);
      expect(payload.blob).not.toBe(sourceBlob);
      expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 1, 2, 2, 0, 0, 2, 2);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("exports all committed regions with a manifest and provenance entries", async () => {
    const { project, repository } = fixture();
    const bundle = await resolveGridExportBundle(project, repository, 1);
    const sink = writer();
    const port = createGridExportPort(sink.value, () => NOW);
    const result = await port.run(createGridExportRequest(
      project,
      1,
      GRID_EXPORT_FORMATS.zip,
      "Grid package",
      { kind: "bundle", bundle },
      { requestId: "request-zip", artifactId: "artifact-zip" },
    ));
    const zip = await JSZip.loadAsync(result.artifact.blob);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as { regions: Array<{ id: string; fileName: string }> };
    expect(manifest.regions).toHaveLength(1);
    expect(manifest.regions[0]).toMatchObject({
      id: "region-1",
      name: "Slice 1",
      fileName: "Slice 1.png",
      assetId: "asset-derived",
      bounds: { x: 0, y: 0, width: 2, height: 2 },
    });
    expect(await zip.file("slices/Slice 1.png")!.async("uint8array")).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(sink.writes[0]?.fileName).toBe("Grid package.zip");
  });

  it("keeps duplicate region names as distinct ZIP entries and manifest rows", async () => {
    const { project, repository } = fixture();
    const bundle = await resolveGridExportBundle(project, repository, 1);
    const duplicateBundle = {
      ...bundle,
      regions: [bundle.regions[0]!, { ...bundle.regions[0]!, id: "region-duplicate" }],
    };
    const sink = writer();
    const port = createGridExportPort(sink.value, () => NOW);
    const result = await port.run(createGridExportRequest(
      project,
      1,
      GRID_EXPORT_FORMATS.zip,
      "Grid duplicate names",
      { kind: "bundle", bundle: duplicateBundle },
      { requestId: "request-duplicate", artifactId: "artifact-duplicate" },
    ));
    const zip = await JSZip.loadAsync(result.artifact.blob);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as { regions: Array<{ fileName: string }> };
    expect(manifest.regions.map((region) => region.fileName)).toEqual(["Slice 1.png", "Slice 1 (2).png"]);
    expect(zip.file("slices/Slice 1.png")).toBeTruthy();
    expect(zip.file("slices/Slice 1 (2).png")).toBeTruthy();
  });

  it("does not write an archive after cancellation", async () => {
    const { project, repository } = fixture();
    const bundle = await resolveGridExportBundle(project, repository, 1);
    const sink = writer();
    const port = createGridExportPort(sink.value, () => NOW);
    const controller = new AbortController();
    controller.abort();
    await expect(port.run(createGridExportRequest(
      project,
      1,
      GRID_EXPORT_FORMATS.zip,
      "cancelled",
      { kind: "bundle", bundle },
      { requestId: "request-cancel", artifactId: "artifact-cancel" },
      controller.signal,
    ))).rejects.toMatchObject({ code: "EXPORT_ABORTED" });
    expect(sink.writes).toHaveLength(0);
  });

  it("opens a committed region through the canonical Compose entry intent", () => {
    const { project, region } = fixture();
    const store = createProjectStoreWithHistory(project, { context: { now: () => NOW, nextId: () => "unused" } });
    const result = openCompositionFromSource(store.store, {
      source: { type: "region", id: region.id },
      commandId: "grid-export-compose",
      issuedAt: NOW,
    });
    expect(result).toMatchObject({
      ok: true,
      outcome: "created",
      source: { type: "region", id: region.id },
      sourceAssetId: "asset-derived",
      dimensions: { width: 2, height: 2 },
      dispatched: true,
    });
    const next = store.store.getSnapshot().project;
    expect(next.workspace.activeWorkspace).toBe("compose");
    expect(next.workspace.selectedRegionId).toBe(region.id);
    const compositionId = next.workspace.selectedCompositionId;
    expect(compositionId).toBeTruthy();
    expect(next.compositions[compositionId!]?.layerIds).toHaveLength(1);
    expect(next.layers[next.compositions[compositionId!]?.layerIds[0] ?? ""]?.source).toEqual({
      type: "region",
      id: region.id,
    });
  });
});
