import JSZip from "jszip";
import {
  createExportFormatRegistry,
  createExportPort,
  createExportFileName,
  type ArtifactWriter,
  type ExportPort,
  type ExportRequest,
} from "../../../core/export";
import type { AssetRepository } from "../../../core/assets";
import type { DeepReadonly } from "../../../core/stores";
import type { EntityId, Region, StudioProjectV1 } from "../../../core/project";
import { ExportPortError } from "../../../core/export";

export const GRID_EXPORT_FORMATS = Object.freeze({
  png: "grid-region-png",
  zip: "grid-regions-zip",
} as const);

export interface GridExportRegionPayload {
  readonly id: EntityId;
  readonly name: string;
  readonly blob: Blob;
  readonly fileName: string;
  readonly bounds: Region["bounds"];
  readonly assetId: EntityId;
}

export interface GridExportBundlePayload {
  readonly projectId: EntityId;
  readonly revision: number;
  readonly sourceAssetId?: EntityId;
  readonly regions: readonly GridExportRegionPayload[];
}

export type GridExportPayload =
  | { readonly kind: "single"; readonly region: GridExportRegionPayload }
  | { readonly kind: "bundle"; readonly bundle: GridExportBundlePayload };

/**
 * A canonical Slice Region keeps source-space bounds even when its output is
 * backed by a derived Asset. Grid, wand and manual provenance therefore decide
 * whether the repository Blob must be cropped; current UI selection is only a
 * compatibility fallback for older manual Regions without provenance.
 */
export function isSourceBackedGridRegion(
  project: DeepReadonly<StudioProjectV1>,
  region: Region,
): boolean {
  const provenance = region.provenance;
  if (provenance?.source === "grid-split") {
    if (!provenance.sourceId) return false;
    const recipe = project.processingRecipes[provenance.sourceId];
    return recipe?.kind === "grid-split" && recipe.sourceAssetId === region.assetId;
  }
  if (provenance?.source === "wand" || provenance?.source === "manual") return true;
  return provenance === undefined && project.workspace.selectedAssetId === region.assetId;
}

function sourceAssetIdForRegion(
  project: DeepReadonly<StudioProjectV1>,
  region: Region,
): EntityId | undefined {
  const provenance = region.provenance;
  if (provenance?.source === "grid-split" && provenance.sourceId) {
    const recipe = project.processingRecipes[provenance.sourceId];
    return recipe?.kind === "grid-split" ? recipe.sourceAssetId : undefined;
  }
  if (provenance?.source === "wand" || provenance?.source === "manual") return region.assetId;
  return undefined;
}

export interface GridExportManifest {
  readonly schemaVersion: 1;
  readonly projectId: EntityId;
  readonly revision: number;
  readonly sourceAssetId?: EntityId;
  readonly regions: readonly {
    readonly id: EntityId;
    readonly name: string;
    readonly fileName: string;
    readonly assetId: EntityId;
    readonly bounds: Region["bounds"];
  }[];
}

function asBlob(value: unknown, mimeType: string): Blob {
  if (!(value instanceof Blob) || value.size < 1) {
    throw new ExportPortError("EXPORT_ARTIFACT_INVALID", "Grid export payload is empty.");
  }
  if (value.type !== mimeType) return value.slice(0, value.size, mimeType);
  return value;
}

function createManifest(bundle: GridExportBundlePayload): GridExportManifest {
  return Object.freeze({
    schemaVersion: 1,
    projectId: bundle.projectId,
    revision: bundle.revision,
    ...(bundle.sourceAssetId ? { sourceAssetId: bundle.sourceAssetId } : {}),
    regions: Object.freeze(bundle.regions.map((region) => Object.freeze({
      id: region.id,
      name: region.name,
      fileName: region.fileName,
      assetId: region.assetId,
      bounds: { ...region.bounds },
    }))),
  });
}

function uniqueBundleRegions(regions: readonly GridExportRegionPayload[]): readonly GridExportRegionPayload[] {
  const used = new Set<string>();
  return Object.freeze(regions.map((region) => {
    const extensionIndex = region.fileName.lastIndexOf(".");
    const stem = extensionIndex > 0 ? region.fileName.slice(0, extensionIndex) : region.fileName;
    const extension = extensionIndex > 0 ? region.fileName.slice(extensionIndex) : "";
    let fileName = region.fileName;
    let suffix = 2;
    while (used.has(fileName.toLocaleLowerCase())) {
      fileName = `${stem} (${suffix})${extension}`;
      suffix += 1;
    }
    used.add(fileName.toLocaleLowerCase());
    return fileName === region.fileName ? region : Object.freeze({ ...region, fileName });
  }));
}

export function createGridExportPort(writer: ArtifactWriter, now?: () => string): ExportPort {
  const registry = createExportFormatRegistry([
    {
      format: {
        id: GRID_EXPORT_FORMATS.png,
        label: "Grid region PNG",
        category: "raster-image",
        fileExtension: "png",
        mimeType: "image/png",
      },
      encode: async ({ source }) => {
        if (!source || typeof source !== "object" || (source as GridExportPayload).kind !== "single") {
          throw new Error("A single Grid region is required.");
        }
        return asBlob((source as Extract<GridExportPayload, { kind: "single" }>).region.blob, "image/png");
      },
    },
    {
      format: {
        id: GRID_EXPORT_FORMATS.zip,
        label: "Grid regions ZIP",
        category: "archive",
        fileExtension: "zip",
        mimeType: "application/zip",
      },
      encode: async ({ source }) => {
        if (!source || typeof source !== "object" || (source as GridExportPayload).kind !== "bundle") {
          throw new Error("A Grid export bundle is required.");
        }
        const bundle = (source as Extract<GridExportPayload, { kind: "bundle" }>).bundle;
        const regions = uniqueBundleRegions(bundle.regions);
        const zip = new JSZip();
        const manifest = createManifest({ ...bundle, regions });
        zip.file("manifest.json", JSON.stringify(manifest, null, 2));
        for (const region of regions) {
          zip.file(`slices/${region.fileName}`, await region.blob.arrayBuffer());
        }
        return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      },
    },
  ]);
  return createExportPort({ registry, writer, now });
}

export function createBrowserDownloadWriter(
  onWrite?: (fileName: string, blob: Blob) => void,
): ArtifactWriter {
  return {
    id: "browser-download",
    write: ({ artifact }) => {
      if (onWrite) {
        onWrite(artifact.fileName, artifact.blob);
      } else if (typeof document !== "undefined") {
        const url = URL.createObjectURL(artifact.blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = artifact.fileName;
        anchor.rel = "noopener";
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      return {
        requestId: artifact.requestId,
        artifactId: artifact.artifactId,
        fileName: artifact.fileName,
        bytesWritten: artifact.byteSize,
      };
    },
  };
}

export function createGridExportRequest<TSource>(
  project: DeepReadonly<StudioProjectV1>,
  revision: number,
  formatId: string,
  baseName: string,
  source: TSource,
  ids: { readonly requestId: EntityId; readonly artifactId: EntityId },
  signal?: AbortSignal,
): ExportRequest<TSource> {
  return {
    requestId: ids.requestId,
    artifactId: ids.artifactId,
    projectId: project.id,
    revision,
    formatId,
    baseName,
    source,
    ...(signal ? { signal } : {}),
  };
}

async function cropRegionBlob(
  blob: Blob,
  bounds: Region["bounds"],
  signal?: AbortSignal,
): Promise<Blob> {
  if (signal?.aborted) throw new ExportPortError("EXPORT_ABORTED", "Export was cancelled.");
  if (typeof createImageBitmap !== "function") {
    throw new ExportPortError("EXPORT_PROVIDER_FAILED", "Grid PNG encoding is unavailable in this runtime.");
  }
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(bounds.width, bounds.height)
      : (() => {
          if (typeof document === "undefined") return null;
          const element = document.createElement("canvas");
          element.width = bounds.width;
          element.height = bounds.height;
          return element;
        })();
    if (!canvas) throw new ExportPortError("EXPORT_PROVIDER_FAILED", "Grid PNG canvas is unavailable.");
    const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context) throw new ExportPortError("EXPORT_PROVIDER_FAILED", "Grid PNG context is unavailable.");
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, bounds.width, bounds.height);
    context.drawImage(bitmap, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
    if ("convertToBlob" in canvas && typeof canvas.convertToBlob === "function") {
      return canvas.convertToBlob({ type: "image/png" });
    }
    return new Promise((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob((result) => {
        if (result) resolve(result);
        else reject(new ExportPortError("EXPORT_PROVIDER_FAILED", "Grid PNG encoding failed."));
      }, "image/png");
    });
  } finally {
    bitmap.close();
  }
}

export async function resolveGridRegionBlob(
  project: DeepReadonly<StudioProjectV1>,
  repository: AssetRepository,
  regionId: EntityId,
  signal?: AbortSignal,
): Promise<GridExportRegionPayload> {
  if (signal?.aborted) throw new ExportPortError("EXPORT_ABORTED", "Export was cancelled.");
  const region = project.regions[regionId];
  if (!region) throw new ExportPortError("EXPORT_INVALID_REQUEST", "The selected Grid region does not exist.");
  const asset = project.assets[region.assetId];
  if (!asset) throw new ExportPortError("EXPORT_INVALID_REQUEST", "The selected Grid asset does not exist.");
  const sourceBlob = await repository.getBlob(asset.id, signal ? { signal } : undefined);
  const isSourceRegion = isSourceBackedGridRegion(project, region);
  const blob = isSourceRegion
    ? await cropRegionBlob(sourceBlob, region.bounds, signal)
    : sourceBlob;
  return Object.freeze({
    id: region.id,
    name: region.name ?? "Slice",
    blob: blob.type === "image/png" ? blob : blob.slice(0, blob.size, "image/png"),
    fileName: createExportFileName(region.name ?? "Slice", "png"),
    bounds: { ...region.bounds },
    assetId: region.assetId,
  });
}

export async function resolveGridExportBundle(
  project: DeepReadonly<StudioProjectV1>,
  repository: AssetRepository,
  revision: number,
  signal?: AbortSignal,
): Promise<GridExportBundlePayload> {
  const regions = project.rootOrder.regionIds
    .map((regionId) => project.regions[regionId])
    .filter((region): region is Region => Boolean(region));
  const payloads: GridExportRegionPayload[] = [];
  for (const region of regions) {
    if (signal?.aborted) throw new ExportPortError("EXPORT_ABORTED", "Export was cancelled.");
    payloads.push(await resolveGridRegionBlob(project, repository, region.id, signal));
  }
  const sourceAssetIds = regions
    .map((region) => sourceAssetIdForRegion(project, region))
    .filter((assetId): assetId is EntityId => Boolean(assetId));
  const sourceAssetId = sourceAssetIds.length > 0 && sourceAssetIds.every((assetId) => assetId === sourceAssetIds[0])
    ? sourceAssetIds[0]
    : undefined;
  return Object.freeze({
    projectId: project.id,
    revision,
    ...(sourceAssetId ? { sourceAssetId } : {}),
    regions: Object.freeze(payloads),
  });
}
