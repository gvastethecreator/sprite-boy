import type { EntityId, ProjectRevision, WorkspaceId } from "../project";
import {
  compositeSceneDrawPlan,
  createSceneDrawPlan,
  type SceneAssetImageResolver,
  type SceneCompositorTarget,
  type SceneSampling,
} from "./sceneCompositor";
import {
  isPlatformBlob,
  type SceneRasterEncodeOptions,
  type SceneRasterMimeType,
} from "./sceneEncoding";
import type { SceneCanvas, SceneProjection } from "./sceneProjection";

export const MAX_SCENE_EXPORT_EDGE = 16_384;
export const MAX_SCENE_EXPORT_PIXELS = 64 * 1024 * 1024;

export interface SceneExportOptions {
  readonly sampling?: SceneSampling;
  readonly mimeType?: SceneRasterMimeType;
  readonly quality?: number;
}

export interface SceneExportSurface<TImage> {
  readonly target: SceneCompositorTarget<TImage>;
  encode(options: SceneRasterEncodeOptions): Blob | PromiseLike<Blob>;
  dispose(): void | PromiseLike<void>;
}

export interface SceneExportSurfaceFactory<TImage> {
  create(frame: SceneCanvas): SceneExportSurface<TImage>;
}

export interface RenderSceneExportRequest<TImage> extends SceneExportOptions {
  readonly projection: SceneProjection;
  readonly resolver: SceneAssetImageResolver<TImage>;
  readonly surfaceFactory: SceneExportSurfaceFactory<TImage>;
}

export interface SceneExportResult extends SceneCanvas {
  readonly projectId: EntityId;
  readonly revision: ProjectRevision;
  readonly workspaceId: WorkspaceId;
  readonly sampling: SceneSampling;
  readonly mimeType: SceneRasterMimeType;
  readonly fileExtension: "png" | "webp";
  readonly drawCount: number;
  readonly byteSize: number;
  readonly blob: Blob;
}

export type SceneExportErrorCode =
  | "SCENE_EXPORT_INVALID_REQUEST"
  | "SCENE_EXPORT_DIMENSIONS_EXCEEDED"
  | "SCENE_EXPORT_SURFACE_FAILED"
  | "SCENE_EXPORT_ENCODE_FAILED"
  | "SCENE_EXPORT_CLEANUP_FAILED";

export class SceneExportError extends Error {
  readonly code: SceneExportErrorCode;
  override readonly cause?: unknown;

  constructor(code: SceneExportErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "SceneExportError";
    this.code = code;
    this.cause = cause;
  }
}

interface NormalizedExportOptions {
  readonly sampling: SceneSampling;
  readonly mimeType: SceneRasterMimeType;
  readonly quality?: number;
}

function invalidRequest(message: string): SceneExportError {
  return new SceneExportError("SCENE_EXPORT_INVALID_REQUEST", message);
}

function normalizeOptions(options: SceneExportOptions): NormalizedExportOptions {
  if (!options || typeof options !== "object") {
    throw invalidRequest("Scene export options are required.");
  }
  if (
    options.sampling !== undefined &&
    options.sampling !== "nearest" &&
    options.sampling !== "smooth"
  ) {
    throw invalidRequest("Scene export sampling must be nearest or smooth.");
  }
  if (
    options.mimeType !== undefined &&
    options.mimeType !== "image/png" &&
    options.mimeType !== "image/webp"
  ) {
    throw invalidRequest("Scene export MIME type must be image/png or image/webp.");
  }
  if (
    options.quality !== undefined &&
    (!Number.isFinite(options.quality) || options.quality < 0 || options.quality > 1)
  ) {
    throw invalidRequest("Scene export quality must be a finite number from 0 to 1.");
  }
  return Object.freeze({
    sampling: options.sampling ?? "nearest",
    mimeType: options.mimeType ?? "image/png",
    ...(options.quality === undefined ? {} : { quality: options.quality }),
  });
}

function validateDimensions(canvas: SceneCanvas): void {
  if (
    !Number.isSafeInteger(canvas.width) ||
    !Number.isSafeInteger(canvas.height) ||
    canvas.width < 1 ||
    canvas.height < 1
  ) {
    throw invalidRequest("Scene export dimensions must be positive safe integers.");
  }
  if (
    canvas.width > MAX_SCENE_EXPORT_EDGE ||
    canvas.height > MAX_SCENE_EXPORT_EDGE ||
    canvas.width * canvas.height > MAX_SCENE_EXPORT_PIXELS
  ) {
    throw new SceneExportError(
      "SCENE_EXPORT_DIMENSIONS_EXCEEDED",
      `Scene export exceeds ${MAX_SCENE_EXPORT_EDGE}px per edge or ${MAX_SCENE_EXPORT_PIXELS} pixels.`,
    );
  }
}

function assertSurface<TImage>(surface: SceneExportSurface<TImage>): void {
  if (
    !surface ||
    typeof surface !== "object" ||
    !surface.target ||
    typeof surface.target.beginFrame !== "function" ||
    typeof surface.target.drawImage !== "function" ||
    typeof surface.target.endFrame !== "function" ||
    typeof surface.target.abortFrame !== "function" ||
    typeof surface.encode !== "function" ||
    typeof surface.dispose !== "function"
  ) {
    throw new TypeError("Scene export surface is incomplete.");
  }
}

export async function renderSceneExport<TImage>(
  request: RenderSceneExportRequest<TImage>,
): Promise<SceneExportResult | null> {
  if (!request || typeof request !== "object") {
    throw invalidRequest("Scene export request is required.");
  }
  const options = normalizeOptions(request);
  if (!request.surfaceFactory || typeof request.surfaceFactory.create !== "function") {
    throw invalidRequest("Scene export requires a surface factory.");
  }
  const plan = createSceneDrawPlan(request.projection);
  if (plan.canvas === null) return null;
  validateDimensions(plan.canvas);
  const frame = Object.freeze({ ...plan.canvas });

  let surface: SceneExportSurface<TImage>;
  let candidate: SceneExportSurface<TImage> | undefined;
  try {
    candidate = request.surfaceFactory.create(frame);
    assertSurface(candidate);
    surface = candidate;
  } catch (error) {
    if (candidate && typeof candidate === "object") {
      try {
        if (typeof candidate.dispose === "function") await candidate.dispose();
      } catch {
        // Preserve the surface creation/contract failure.
      }
    }
    throw new SceneExportError(
      "SCENE_EXPORT_SURFACE_FAILED",
      "Scene export surface could not be created.",
      error,
    );
  }

  let failed = false;
  let primaryError: unknown;
  let result: SceneExportResult | undefined;
  try {
    const composite = await compositeSceneDrawPlan({
      plan,
      resolver: request.resolver,
      target: surface.target,
      sampling: options.sampling,
    });
    let blob: Blob;
    try {
      blob = await surface.encode(Object.freeze({
        mimeType: options.mimeType,
        ...(options.quality === undefined ? {} : { quality: options.quality }),
      }));
    } catch (error) {
      throw new SceneExportError(
        "SCENE_EXPORT_ENCODE_FAILED",
        "Scene export surface could not be encoded.",
        error,
      );
    }
    if (!isPlatformBlob(blob) || blob.size === 0 || blob.type !== options.mimeType) {
      throw new SceneExportError(
        "SCENE_EXPORT_ENCODE_FAILED",
        "Scene export encoder returned an invalid or mismatched Blob.",
      );
    }
    result = Object.freeze({
      projectId: plan.projectId,
      revision: plan.revision,
      workspaceId: plan.workspaceId,
      width: frame.width,
      height: frame.height,
      background: frame.background,
      sampling: options.sampling,
      mimeType: options.mimeType,
      fileExtension: options.mimeType === "image/png" ? "png" : "webp",
      drawCount: composite.drawCount,
      byteSize: blob.size,
      blob,
    });
  } catch (error) {
    failed = true;
    primaryError = error;
  }

  try {
    await surface.dispose();
  } catch (error) {
    if (!failed) {
      failed = true;
      primaryError = new SceneExportError(
        "SCENE_EXPORT_CLEANUP_FAILED",
        "Scene export surface could not be disposed.",
        error,
      );
    }
  }
  if (failed) throw primaryError;
  return result as SceneExportResult;
}
