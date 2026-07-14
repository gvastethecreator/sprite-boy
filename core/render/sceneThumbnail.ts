import type { EntityId, ProjectRevision, WorkspaceId } from "../project";
import {
  compositeSceneDrawPlan,
  createSceneDrawPlan,
  type SceneAssetImageResolver,
  type SceneCompositorTarget,
  type SceneSampling,
} from "./sceneCompositor";
import type { SceneCanvas, SceneProjection } from "./sceneProjection";
import {
  isPlatformBlob,
  type SceneRasterEncodeOptions,
  type SceneRasterMimeType,
} from "./sceneEncoding";

export const MAX_SCENE_THUMBNAIL_EDGE = 2048;

export type SceneThumbnailMimeType = SceneRasterMimeType;

export interface SceneThumbnailOptions {
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly allowUpscale?: boolean;
  readonly sampling?: SceneSampling;
  readonly mimeType?: SceneThumbnailMimeType;
  readonly quality?: number;
}

export interface SceneThumbnailLayout {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly width: number;
  readonly height: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface SceneThumbnailEncodeOptions extends SceneRasterEncodeOptions {}

export interface SceneThumbnailSurface<TImage> {
  readonly target: SceneCompositorTarget<TImage>;
  encode(options: SceneThumbnailEncodeOptions): Blob | PromiseLike<Blob>;
  dispose(): void | PromiseLike<void>;
}

export interface SceneThumbnailSurfaceFactory<TImage> {
  create(layout: SceneThumbnailLayout): SceneThumbnailSurface<TImage>;
}

export interface RenderSceneThumbnailRequest<TImage> extends SceneThumbnailOptions {
  readonly projection: SceneProjection;
  readonly resolver: SceneAssetImageResolver<TImage>;
  readonly surfaceFactory: SceneThumbnailSurfaceFactory<TImage>;
}

export interface SceneThumbnailResult extends SceneThumbnailLayout {
  readonly projectId: EntityId;
  readonly revision: ProjectRevision;
  readonly workspaceId: WorkspaceId;
  readonly sampling: SceneSampling;
  readonly mimeType: SceneThumbnailMimeType;
  readonly drawCount: number;
  readonly blob: Blob;
}

export type SceneThumbnailErrorCode =
  | "SCENE_THUMBNAIL_INVALID_REQUEST"
  | "SCENE_THUMBNAIL_SURFACE_FAILED"
  | "SCENE_THUMBNAIL_ENCODE_FAILED"
  | "SCENE_THUMBNAIL_CLEANUP_FAILED";

export class SceneThumbnailError extends Error {
  readonly code: SceneThumbnailErrorCode;
  override readonly cause?: unknown;

  constructor(code: SceneThumbnailErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "SceneThumbnailError";
    this.code = code;
    this.cause = cause;
  }
}

interface NormalizedThumbnailOptions {
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly allowUpscale: boolean;
  readonly sampling: SceneSampling;
  readonly mimeType: SceneThumbnailMimeType;
  readonly quality?: number;
}

function invalidRequest(message: string): SceneThumbnailError {
  return new SceneThumbnailError("SCENE_THUMBNAIL_INVALID_REQUEST", message);
}

function validateEdge(value: number, name: string): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_SCENE_THUMBNAIL_EDGE
  ) {
    throw invalidRequest(
      `${name} must be a safe integer from 1 to ${MAX_SCENE_THUMBNAIL_EDGE}.`,
    );
  }
}

function normalizeOptions(options: SceneThumbnailOptions): NormalizedThumbnailOptions {
  if (!options || typeof options !== "object") {
    throw invalidRequest("Scene thumbnail options are required.");
  }
  validateEdge(options.maxWidth, "Scene thumbnail maxWidth");
  validateEdge(options.maxHeight, "Scene thumbnail maxHeight");
  if (options.allowUpscale !== undefined && typeof options.allowUpscale !== "boolean") {
    throw invalidRequest("Scene thumbnail allowUpscale must be a boolean.");
  }
  if (
    options.sampling !== undefined &&
    options.sampling !== "nearest" &&
    options.sampling !== "smooth"
  ) {
    throw invalidRequest("Scene thumbnail sampling must be nearest or smooth.");
  }
  if (
    options.mimeType !== undefined &&
    options.mimeType !== "image/png" &&
    options.mimeType !== "image/webp"
  ) {
    throw invalidRequest("Scene thumbnail MIME type must be image/png or image/webp.");
  }
  if (
    options.quality !== undefined &&
    (!Number.isFinite(options.quality) || options.quality < 0 || options.quality > 1)
  ) {
    throw invalidRequest("Scene thumbnail quality must be a finite number from 0 to 1.");
  }
  return Object.freeze({
    maxWidth: options.maxWidth,
    maxHeight: options.maxHeight,
    allowUpscale: options.allowUpscale ?? false,
    sampling: options.sampling ?? "nearest",
    mimeType: options.mimeType ?? "image/png",
    ...(options.quality === undefined ? {} : { quality: options.quality }),
  });
}

function validateSourceCanvas(canvas: SceneCanvas): void {
  if (
    !canvas ||
    typeof canvas !== "object" ||
    !Number.isSafeInteger(canvas.width) ||
    !Number.isSafeInteger(canvas.height) ||
    canvas.width < 1 ||
    canvas.height < 1
  ) {
    throw invalidRequest("Scene thumbnail source dimensions must be positive safe integers.");
  }
}

export function createSceneThumbnailLayout(
  canvas: SceneCanvas,
  options: Pick<SceneThumbnailOptions, "maxWidth" | "maxHeight" | "allowUpscale">,
): SceneThumbnailLayout {
  validateSourceCanvas(canvas);
  if (!options || typeof options !== "object") {
    throw invalidRequest("Scene thumbnail layout options are required.");
  }
  validateEdge(options.maxWidth, "Scene thumbnail maxWidth");
  validateEdge(options.maxHeight, "Scene thumbnail maxHeight");
  if (options.allowUpscale !== undefined && typeof options.allowUpscale !== "boolean") {
    throw invalidRequest("Scene thumbnail allowUpscale must be a boolean.");
  }
  const boundScale = Math.min(
    options.maxWidth / canvas.width,
    options.maxHeight / canvas.height,
  );
  const scale = options.allowUpscale ? boundScale : Math.min(1, boundScale);
  const width = Math.min(
    options.maxWidth,
    Math.max(1, Math.round(canvas.width * scale)),
  );
  const height = Math.min(
    options.maxHeight,
    Math.max(1, Math.round(canvas.height * scale)),
  );
  return Object.freeze({
    sourceWidth: canvas.width,
    sourceHeight: canvas.height,
    width,
    height,
    scaleX: width / canvas.width,
    scaleY: height / canvas.height,
  });
}

function assertSurface<TImage>(surface: SceneThumbnailSurface<TImage>): void {
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
    throw new TypeError("Scene thumbnail surface is incomplete.");
  }
}

export async function renderSceneThumbnail<TImage>(
  request: RenderSceneThumbnailRequest<TImage>,
): Promise<SceneThumbnailResult | null> {
  if (!request || typeof request !== "object") {
    throw invalidRequest("Scene thumbnail request is required.");
  }
  const options = normalizeOptions(request);
  if (!request.surfaceFactory || typeof request.surfaceFactory.create !== "function") {
    throw invalidRequest("Scene thumbnail requires a surface factory.");
  }
  const plan = createSceneDrawPlan(request.projection);
  if (plan.canvas === null) return null;
  const layout = createSceneThumbnailLayout(plan.canvas, options);

  let surface: SceneThumbnailSurface<TImage>;
  let candidate: SceneThumbnailSurface<TImage> | undefined;
  try {
    candidate = request.surfaceFactory.create(layout);
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
    throw new SceneThumbnailError(
      "SCENE_THUMBNAIL_SURFACE_FAILED",
      "Scene thumbnail surface could not be created.",
      error,
    );
  }

  let failed = false;
  let primaryError: unknown;
  let result: SceneThumbnailResult | undefined;
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
      throw new SceneThumbnailError(
        "SCENE_THUMBNAIL_ENCODE_FAILED",
        "Scene thumbnail surface could not be encoded.",
        error,
      );
    }
    if (!isPlatformBlob(blob) || blob.size === 0 || blob.type !== options.mimeType) {
      throw new SceneThumbnailError(
        "SCENE_THUMBNAIL_ENCODE_FAILED",
        "Scene thumbnail encoder returned an invalid or mismatched Blob.",
      );
    }
    result = Object.freeze({
      ...layout,
      projectId: plan.projectId,
      revision: plan.revision,
      workspaceId: plan.workspaceId,
      sampling: options.sampling,
      mimeType: options.mimeType,
      drawCount: composite.drawCount,
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
      primaryError = new SceneThumbnailError(
        "SCENE_THUMBNAIL_CLEANUP_FAILED",
        "Scene thumbnail surface could not be disposed.",
        error,
      );
    }
  }
  if (failed) throw primaryError;
  return result as SceneThumbnailResult;
}
