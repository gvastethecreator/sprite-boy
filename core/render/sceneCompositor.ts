import type { EntityId, ProjectRevision, WorkspaceId } from "../project";
import {
  composeSceneMatrices,
  IDENTITY_SCENE_MATRIX,
  multiplySceneMatrices,
  sceneRotation,
  sceneScale,
  sceneTranslation,
  type SceneAffineMatrix,
} from "./affine";
import type {
  SceneAssetDescriptor,
  SceneCanvas,
  SceneCelNode,
  SceneCompositionNode,
  SceneImageSource,
  SceneLayerNode,
  SceneProjection,
  SceneRect,
  SceneRegionNode,
  SceneRootNode,
  SceneVariantNode,
} from "./sceneProjection";

export type SceneSampling = "nearest" | "smooth";

export interface SceneDrawOrigin {
  readonly kind: "asset" | "region" | "layer";
  readonly id: EntityId;
}

export interface SceneDrawOperation {
  readonly origin: SceneDrawOrigin;
  readonly asset: SceneAssetDescriptor;
  readonly sourceRect: SceneRect;
  readonly matrix: SceneAffineMatrix;
  readonly opacity: number;
}

export interface SceneDrawPlan {
  readonly projectId: EntityId;
  readonly revision: ProjectRevision;
  readonly workspaceId: WorkspaceId;
  readonly canvas: SceneCanvas | null;
  readonly operations: readonly SceneDrawOperation[];
}

export interface SceneCompositorFrame extends SceneCanvas {
  readonly sampling: SceneSampling;
}

export interface SceneAssetImageResolver<TImage> {
  resolve(asset: SceneAssetDescriptor): TImage | PromiseLike<TImage>;
}

export interface SceneCompositorTarget<TImage> {
  beginFrame(frame: SceneCompositorFrame): void | PromiseLike<void>;
  drawImage(image: TImage, operation: SceneDrawOperation): void | PromiseLike<void>;
  endFrame(): void | PromiseLike<void>;
  /** Mandatory rollback hook; stateless targets may implement a no-op. */
  abortFrame(): void | PromiseLike<void>;
}

export interface CompositeSceneRequest<TImage> {
  readonly projection: SceneProjection;
  readonly resolver: SceneAssetImageResolver<TImage>;
  readonly target: SceneCompositorTarget<TImage>;
  readonly sampling?: SceneSampling;
}

export interface CompositeSceneDrawPlanRequest<TImage> {
  readonly plan: SceneDrawPlan;
  readonly resolver: SceneAssetImageResolver<TImage>;
  readonly target: SceneCompositorTarget<TImage>;
  readonly sampling?: SceneSampling;
}

export interface SceneCompositeResult {
  readonly canvas: SceneCanvas | null;
  readonly drawCount: number;
}

export type SceneCompositorErrorCode =
  | "SCENE_INVALID_PROJECTION"
  | "SCENE_ASSET_RESOLVE_FAILED"
  | "SCENE_TARGET_FAILED";

export class SceneCompositorError extends Error {
  readonly code: SceneCompositorErrorCode;
  readonly assetId?: EntityId;
  override readonly cause?: unknown;

  constructor(
    code: SceneCompositorErrorCode,
    message: string,
    options: { readonly assetId?: EntityId; readonly cause?: unknown } = {},
  ) {
    super(message);
    this.name = "SceneCompositorError";
    this.code = code;
    this.assetId = options.assetId;
    this.cause = options.cause;
  }
}

function copyCanvas(canvas: SceneCanvas): SceneCanvas {
  return Object.freeze({
    width: canvas.width,
    height: canvas.height,
    background: canvas.background,
  });
}

function copyAsset(asset: SceneAssetDescriptor): SceneAssetDescriptor {
  return Object.freeze({
    assetId: asset.assetId,
    blobKey: asset.blobKey,
    contentHash: asset.contentHash,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
  });
}

function copyRect(rect: SceneRect): SceneRect {
  return Object.freeze({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

function layerMatrix(layer: SceneLayerNode): SceneAffineMatrix {
  const flipX = layer.transform.flipX ? -1 : 1;
  const flipY = layer.transform.flipY ? -1 : 1;
  return composeSceneMatrices(
    sceneTranslation(layer.transform.x, layer.transform.y),
    sceneRotation(layer.transform.rotation),
    sceneScale(layer.transform.scaleX * flipX, layer.transform.scaleY * flipY),
    sceneTranslation(-layer.source.sourceRect.width / 2, -layer.source.sourceRect.height / 2),
  );
}

function celMatrix(cel: SceneCelNode): SceneAffineMatrix {
  const pivot = cel.pivot ?? { x: cel.width / 2, y: cel.height / 2 };
  const flipX = cel.transform.flipX ? -1 : 1;
  const flipY = cel.transform.flipY ? -1 : 1;
  return composeSceneMatrices(
    sceneTranslation(cel.width / 2 + cel.transform.x, cel.height / 2 + cel.transform.y),
    sceneRotation(cel.transform.rotation),
    sceneScale(cel.transform.scaleX * flipX, cel.transform.scaleY * flipY),
    sceneTranslation(-pivot.x, -pivot.y),
  );
}

function appendImage(
  operations: SceneDrawOperation[],
  origin: SceneDrawOrigin,
  source: SceneImageSource,
  matrix: SceneAffineMatrix,
  opacity: number,
): void {
  operations.push(Object.freeze({
    origin: Object.freeze({ ...origin }),
    asset: copyAsset(source.asset),
    sourceRect: copyRect(source.sourceRect),
    matrix,
    opacity,
  }));
}

function appendRegion(
  operations: SceneDrawOperation[],
  region: SceneRegionNode,
  parentMatrix: SceneAffineMatrix,
  parentOpacity: number,
): void {
  if (region.hidden) return;
  appendImage(
    operations,
    { kind: "region", id: region.regionId },
    region.source,
    parentMatrix,
    parentOpacity,
  );
}

function appendLayer(
  operations: SceneDrawOperation[],
  layer: SceneLayerNode,
  parentMatrix: SceneAffineMatrix,
  parentOpacity: number,
): void {
  if (!layer.visible) return;
  appendImage(
    operations,
    { kind: "layer", id: layer.layerId },
    layer.source,
    multiplySceneMatrices(parentMatrix, layerMatrix(layer)),
    parentOpacity * layer.transform.opacity,
  );
}

function appendComposition(
  operations: SceneDrawOperation[],
  composition: SceneCompositionNode,
  parentMatrix: SceneAffineMatrix,
  parentOpacity: number,
): void {
  for (const layer of composition.layers) {
    appendLayer(operations, layer, parentMatrix, parentOpacity);
  }
}

function appendVariant(
  operations: SceneDrawOperation[],
  variant: SceneVariantNode,
  parentMatrix: SceneAffineMatrix,
  parentOpacity: number,
): void {
  appendComposition(operations, variant.composition, parentMatrix, parentOpacity);
}

function appendCel(
  operations: SceneDrawOperation[],
  cel: SceneCelNode,
  parentMatrix: SceneAffineMatrix,
  parentOpacity: number,
): void {
  const matrix = multiplySceneMatrices(parentMatrix, celMatrix(cel));
  const opacity = parentOpacity * cel.transform.opacity;
  const source = cel.source;
  if (source.kind === "region") {
    appendRegion(operations, source, matrix, opacity);
  } else if (source.kind === "composition") {
    appendComposition(operations, source, matrix, opacity);
  } else {
    appendVariant(operations, source, matrix, opacity);
  }
}

function appendRoot(operations: SceneDrawOperation[], root: SceneRootNode): void {
  switch (root.kind) {
    case "asset":
      appendImage(
        operations,
        { kind: "asset", id: root.assetId },
        root.source,
        IDENTITY_SCENE_MATRIX,
        1,
      );
      return;
    case "region":
      appendRegion(operations, root, IDENTITY_SCENE_MATRIX, 1);
      return;
    case "composition":
      appendComposition(operations, root, IDENTITY_SCENE_MATRIX, 1);
      return;
    case "variant":
      appendVariant(operations, root, IDENTITY_SCENE_MATRIX, 1);
      return;
    case "cel":
      appendCel(operations, root, IDENTITY_SCENE_MATRIX, 1);
  }
}

function validateProjectionPair(projection: SceneProjection): void {
  const { root, canvas } = projection;
  if ((root === null) !== (canvas === null)) {
    throw new SceneCompositorError(
      "SCENE_INVALID_PROJECTION",
      "Scene projection root and canvas must both be present or both be null.",
    );
  }
  if (
    root !== null && canvas !== null &&
    (root.width !== canvas.width ||
      root.height !== canvas.height ||
      root.background !== canvas.background)
  ) {
    throw new SceneCompositorError(
      "SCENE_INVALID_PROJECTION",
      "Scene projection canvas must match its root dimensions and background.",
    );
  }
}

export function createSceneDrawPlan(projection: SceneProjection): SceneDrawPlan {
  validateProjectionPair(projection);
  const operations: SceneDrawOperation[] = [];
  if (projection.root !== null) appendRoot(operations, projection.root);
  return Object.freeze({
    projectId: projection.projectId,
    revision: projection.revision,
    workspaceId: projection.workspaceId,
    canvas: projection.canvas === null ? null : copyCanvas(projection.canvas),
    operations: Object.freeze(operations),
  });
}

function copyMatrix(matrix: SceneAffineMatrix): SceneAffineMatrix {
  return Object.freeze({
    a: matrix.a,
    b: matrix.b,
    c: matrix.c,
    d: matrix.d,
    e: matrix.e,
    f: matrix.f,
  });
}

function copyDrawOperation(operation: SceneDrawOperation): SceneDrawOperation {
  return Object.freeze({
    origin: Object.freeze({ kind: operation.origin.kind, id: operation.origin.id }),
    asset: copyAsset(operation.asset),
    sourceRect: copyRect(operation.sourceRect),
    matrix: copyMatrix(operation.matrix),
    opacity: operation.opacity,
  });
}

function copyDrawPlan(plan: SceneDrawPlan): SceneDrawPlan {
  return Object.freeze({
    projectId: plan.projectId,
    revision: plan.revision,
    workspaceId: plan.workspaceId,
    canvas: plan.canvas === null ? null : copyCanvas(plan.canvas),
    operations: Object.freeze(plan.operations.map(copyDrawOperation)),
  });
}

function targetError(error: unknown, assetId?: EntityId): SceneCompositorError {
  return new SceneCompositorError(
    "SCENE_TARGET_FAILED",
    `Scene compositor target failed${assetId ? ` while drawing ${assetId}` : ""}.`,
    { assetId, cause: error },
  );
}

async function suppressAbort<TImage>(target: SceneCompositorTarget<TImage>): Promise<void> {
  try {
    await target.abortFrame();
  } catch {
    // Preserve the primary target failure.
  }
}

/**
 * Executes one defensive snapshot. Callers that allocate asynchronously from a
 * plan can keep metadata, bounds and rendered pixels on the same revision.
 */
export async function compositeSceneDrawPlan<TImage>(
  request: CompositeSceneDrawPlanRequest<TImage>,
): Promise<SceneCompositeResult> {
  const plan = copyDrawPlan(request.plan);
  if (plan.canvas === null) return Object.freeze({ canvas: null, drawCount: 0 });

  const resolved = new Map<EntityId, TImage>();
  const uniqueAssets = new Map<EntityId, SceneAssetDescriptor>();
  for (const operation of plan.operations) uniqueAssets.set(operation.asset.assetId, operation.asset);
  await Promise.all([...uniqueAssets.values()].map(async (asset) => {
    try {
      const image = await request.resolver.resolve(asset);
      if (image === null || image === undefined) {
        throw new TypeError("Scene asset resolver returned no image.");
      }
      resolved.set(asset.assetId, image);
    } catch (error) {
      throw new SceneCompositorError(
        "SCENE_ASSET_RESOLVE_FAILED",
        `Scene asset ${asset.assetId} could not be resolved.`,
        { assetId: asset.assetId, cause: error },
      );
    }
  }));

  const frame: SceneCompositorFrame = Object.freeze({
    ...plan.canvas,
    sampling: request.sampling ?? "nearest",
  });
  let frameStarted = false;
  try {
    frameStarted = true;
    try {
      await request.target.beginFrame(frame);
    } catch (error) {
      throw targetError(error);
    }
    for (const operation of plan.operations) {
      const image = resolved.get(operation.asset.assetId);
      if (image === undefined) {
        throw new SceneCompositorError(
          "SCENE_ASSET_RESOLVE_FAILED",
          `Scene asset ${operation.asset.assetId} resolved to no image.`,
          { assetId: operation.asset.assetId },
        );
      }
      try {
        await request.target.drawImage(image, operation);
      } catch (error) {
        throw targetError(error, operation.asset.assetId);
      }
    }
    try {
      await request.target.endFrame();
    } catch (error) {
      throw targetError(error);
    }
    frameStarted = false;
  } catch (error) {
    if (frameStarted) await suppressAbort(request.target);
    if (error instanceof SceneCompositorError) throw error;
    throw targetError(error);
  }
  return Object.freeze({ canvas: copyCanvas(plan.canvas), drawCount: plan.operations.length });
}

export async function compositeScene<TImage>(
  request: CompositeSceneRequest<TImage>,
): Promise<SceneCompositeResult> {
  return compositeSceneDrawPlan({
    plan: createSceneDrawPlan(request.projection),
    resolver: request.resolver,
    target: request.target,
    ...(request.sampling === undefined ? {} : { sampling: request.sampling }),
  });
}
