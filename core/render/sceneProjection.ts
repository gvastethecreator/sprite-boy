import type {
  AssetRecord,
  Cel,
  CelTransform,
  Composition,
  EntityId,
  Layer,
  LayerTransform,
  ProjectRevision,
  Region,
  StudioProjectV1,
  VariantKey,
  VariantSet,
  WorkspaceId,
} from "../project";
import type {
  DeepReadonly,
  ProjectStoreState,
  WorkspaceState,
  WorkspaceViewport,
} from "../stores";

export interface ScenePoint {
  readonly x: number;
  readonly y: number;
}

export interface SceneSize {
  readonly width: number;
  readonly height: number;
}

export interface SceneRect extends ScenePoint, SceneSize {}

export interface SceneTransform {
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number;
  readonly opacity: number;
  readonly flipX: boolean;
  readonly flipY: boolean;
}

export interface SceneAssetDescriptor extends SceneSize {
  readonly assetId: EntityId;
  readonly blobKey: string;
  readonly contentHash: string;
  readonly mimeType: string;
}

export interface SceneImageSource {
  readonly asset: SceneAssetDescriptor;
  readonly sourceRect: SceneRect;
}

export interface SceneAssetNode extends SceneSize {
  readonly kind: "asset";
  readonly assetId: EntityId;
  readonly background: null;
  readonly source: SceneImageSource;
}

export interface SceneRegionNode extends SceneSize {
  readonly kind: "region";
  readonly regionId: EntityId;
  readonly background: null;
  readonly hidden: boolean;
  readonly pivot: ScenePoint | null;
  readonly source: SceneImageSource;
}

export interface SceneLayerNode {
  readonly kind: "layer";
  readonly layerId: EntityId;
  readonly name: string | null;
  readonly source: SceneImageSource;
  readonly transform: SceneTransform;
  readonly visible: boolean;
  readonly locked: boolean;
}

export interface SceneCompositionNode extends SceneSize {
  readonly kind: "composition";
  readonly compositionId: EntityId;
  readonly name: string;
  readonly background: string | null;
  readonly layers: readonly SceneLayerNode[];
}

export interface SceneVariantNode extends SceneSize {
  readonly kind: "variant";
  readonly variantSetId: EntityId;
  readonly activeVariant: VariantKey;
  readonly background: string | null;
  readonly composition: SceneCompositionNode;
}

export interface SceneCelNode extends SceneSize {
  readonly kind: "cel";
  readonly celId: EntityId;
  readonly sequenceId: EntityId;
  readonly durationMs: number;
  readonly background: string | null;
  readonly pivot: ScenePoint | null;
  readonly transform: SceneTransform;
  readonly locked: boolean;
  readonly source: SceneRegionNode | SceneCompositionNode | SceneVariantNode;
}

export type SceneRootNode =
  | SceneAssetNode
  | SceneRegionNode
  | SceneCompositionNode
  | SceneVariantNode
  | SceneCelNode;

export interface SceneCanvas extends SceneSize {
  readonly background: string | null;
}

/**
 * Immutable, data-only render input. Runtime images, URLs, canvas objects,
 * interaction and playback state are deliberately outside this contract.
 */
export interface SceneProjection {
  readonly projectId: EntityId;
  readonly revision: ProjectRevision;
  readonly workspaceId: WorkspaceId;
  readonly viewport: WorkspaceViewport;
  readonly canvas: SceneCanvas | null;
  readonly root: SceneRootNode | null;
}

type ProjectSnapshot = DeepReadonly<StudioProjectV1>;

type RootReference =
  | { readonly kind: "asset"; readonly id: EntityId }
  | { readonly kind: "region"; readonly id: EntityId }
  | { readonly kind: "composition"; readonly id: EntityId }
  | { readonly kind: "variant"; readonly id: EntityId }
  | { readonly kind: "cel"; readonly id: EntityId };

const DEFAULT_WORKSPACE: WorkspaceId = "assets";
const DEFAULT_VIEWPORT: WorkspaceViewport = Object.freeze({
  scale: 1,
  offset: Object.freeze({ x: 0, y: 0 }),
});

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function requireEntity<T>(
  record: Readonly<Record<EntityId, T>>,
  id: EntityId,
  kind: string,
): T {
  const entity = record[id];
  if (entity === undefined) {
    throw new Error(`SceneProjection invariant failed: missing ${kind} ${id}.`);
  }
  return entity;
}

function firstOrderedId<T>(
  ids: readonly EntityId[],
  record: Readonly<Record<EntityId, T>>,
): EntityId | undefined {
  return ids.find((id) => record[id] !== undefined);
}

function selectedCelId(project: ProjectSnapshot): EntityId | undefined {
  const selectedSequenceId = project.workspace.selectedSequenceId;
  const selectedSequence = selectedSequenceId === undefined
    ? undefined
    : project.sequences[selectedSequenceId];
  const selected = project.workspace.selectedCelIds?.find((id) => {
    const cel = project.cels[id];
    return cel !== undefined &&
      (selectedSequence === undefined || cel.sequenceId === selectedSequence.id);
  });
  if (selected !== undefined) return selected;
  return selectedSequence?.celIds.find((id) => project.cels[id] !== undefined);
}

function selectedCompositionId(project: ProjectSnapshot): EntityId | undefined {
  const direct = project.workspace.selectedCompositionId;
  if (direct !== undefined && project.compositions[direct] !== undefined) return direct;
  const selectedLayerId = project.workspace.selectedLayerId;
  if (selectedLayerId !== undefined) {
    const layer = project.layers[selectedLayerId];
    if (layer !== undefined && project.compositions[layer.compositionId] !== undefined) {
      return layer.compositionId;
    }
  }
  return undefined;
}

function selectedVariantId(project: ProjectSnapshot): EntityId | undefined {
  const id = project.workspace.selectedVariantSetId;
  return id !== undefined && project.variantSets[id] !== undefined ? id : undefined;
}

function firstProjectCompositionId(project: ProjectSnapshot): EntityId | undefined {
  return project.rootOrder.compositionIds.find(
    (id) => project.compositions[id]?.owner.type === "project",
  );
}

function assetFallback(project: ProjectSnapshot, preferRegion: boolean): RootReference | null {
  const selectedAssetId = project.workspace.selectedAssetId;
  const selectedRegionId = project.workspace.selectedRegionId;
  const orderedAssetId = firstOrderedId(project.rootOrder.assetIds, project.assets);
  const orderedRegionId = firstOrderedId(project.rootOrder.regionIds, project.regions);
  const candidates: readonly (RootReference | null)[] = preferRegion
    ? [
        selectedRegionId !== undefined && project.regions[selectedRegionId] !== undefined
          ? { kind: "region", id: selectedRegionId }
          : null,
        selectedAssetId !== undefined && project.assets[selectedAssetId] !== undefined
          ? { kind: "asset", id: selectedAssetId }
          : null,
        orderedRegionId === undefined ? null : { kind: "region", id: orderedRegionId },
        orderedAssetId === undefined ? null : { kind: "asset", id: orderedAssetId },
      ]
    : [
        selectedAssetId !== undefined && project.assets[selectedAssetId] !== undefined
          ? { kind: "asset", id: selectedAssetId }
          : null,
        selectedRegionId !== undefined && project.regions[selectedRegionId] !== undefined
          ? { kind: "region", id: selectedRegionId }
          : null,
        orderedAssetId === undefined ? null : { kind: "asset", id: orderedAssetId },
        orderedRegionId === undefined ? null : { kind: "region", id: orderedRegionId },
      ];
  return candidates.find((candidate): candidate is RootReference => candidate !== null) ?? null;
}

function compositionFallback(project: ProjectSnapshot): RootReference | null {
  const compositionId = selectedCompositionId(project);
  if (compositionId !== undefined) return { kind: "composition", id: compositionId };
  const variantId = selectedVariantId(project);
  if (variantId !== undefined) return { kind: "variant", id: variantId };
  const orderedCompositionId = firstProjectCompositionId(project);
  if (orderedCompositionId !== undefined) {
    return { kind: "composition", id: orderedCompositionId };
  }
  return assetFallback(project, true);
}

function timelineFallback(project: ProjectSnapshot): RootReference | null {
  const celId = selectedCelId(project);
  if (celId !== undefined) return { kind: "cel", id: celId };
  return compositionFallback(project);
}

function resolveRoot(project: ProjectSnapshot, workspaceId: WorkspaceId): RootReference | null {
  switch (workspaceId) {
    case "assets":
      return assetFallback(project, false);
    case "slice":
      return assetFallback(project, true);
    case "compose":
      return compositionFallback(project);
    case "animate":
    case "collision":
    case "export":
      return timelineFallback(project);
  }
}

function point(value: DeepReadonly<{ x: number; y: number }> | undefined): ScenePoint | null {
  return value === undefined ? null : { x: value.x, y: value.y };
}

function transform(value: DeepReadonly<LayerTransform>): SceneTransform;
function transform(value: DeepReadonly<CelTransform> | undefined): SceneTransform;
function transform(value: DeepReadonly<LayerTransform | CelTransform> | undefined): SceneTransform {
  return {
    x: value?.x ?? 0,
    y: value?.y ?? 0,
    scaleX: value?.scaleX ?? 1,
    scaleY: value?.scaleY ?? 1,
    rotation: value?.rotation ?? 0,
    opacity: value?.opacity ?? 1,
    flipX: value?.flipX ?? false,
    flipY: value?.flipY ?? false,
  };
}

function assetDescriptor(asset: DeepReadonly<AssetRecord>): SceneAssetDescriptor {
  return {
    assetId: asset.id,
    blobKey: asset.blobKey,
    contentHash: asset.contentHash,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
  };
}

function imageSource(
  asset: DeepReadonly<AssetRecord>,
  sourceRect: SceneRect,
): SceneImageSource {
  return { asset: assetDescriptor(asset), sourceRect };
}

function projectAsset(asset: DeepReadonly<AssetRecord>): SceneAssetNode {
  return {
    kind: "asset",
    assetId: asset.id,
    width: asset.width,
    height: asset.height,
    background: null,
    source: imageSource(asset, { x: 0, y: 0, width: asset.width, height: asset.height }),
  };
}

function projectRegion(project: ProjectSnapshot, region: DeepReadonly<Region>): SceneRegionNode {
  const asset = requireEntity(project.assets, region.assetId, "asset");
  return {
    kind: "region",
    regionId: region.id,
    width: region.bounds.width,
    height: region.bounds.height,
    background: null,
    hidden: region.hidden ?? false,
    pivot: point(region.pivot),
    source: imageSource(asset, {
      x: region.bounds.x,
      y: region.bounds.y,
      width: region.bounds.width,
      height: region.bounds.height,
    }),
  };
}

function projectLayer(project: ProjectSnapshot, layer: DeepReadonly<Layer>): SceneLayerNode {
  const source = layer.source.type === "asset"
    ? projectAsset(requireEntity(project.assets, layer.source.id, "asset")).source
    : projectRegion(project, requireEntity(project.regions, layer.source.id, "region")).source;
  return {
    kind: "layer",
    layerId: layer.id,
    name: layer.name ?? null,
    source,
    transform: transform(layer.transform),
    visible: layer.visible ?? true,
    locked: layer.locked ?? false,
  };
}

function projectComposition(
  project: ProjectSnapshot,
  composition: DeepReadonly<Composition>,
): SceneCompositionNode {
  return {
    kind: "composition",
    compositionId: composition.id,
    name: composition.name,
    width: composition.width,
    height: composition.height,
    background: composition.background ?? null,
    layers: composition.layerIds.map((id) =>
      projectLayer(project, requireEntity(project.layers, id, "layer"))),
  };
}

function projectVariant(
  project: ProjectSnapshot,
  variantSet: DeepReadonly<VariantSet>,
): SceneVariantNode {
  const compositionId = variantSet.variants[variantSet.activeVariant];
  if (compositionId === undefined) {
    throw new Error(
      `SceneProjection invariant failed: variant ${variantSet.id} has no active composition.`,
    );
  }
  const composition = projectComposition(
    project,
    requireEntity(project.compositions, compositionId, "composition"),
  );
  return {
    kind: "variant",
    variantSetId: variantSet.id,
    activeVariant: variantSet.activeVariant,
    width: composition.width,
    height: composition.height,
    background: composition.background,
    composition,
  };
}

function projectCel(project: ProjectSnapshot, cel: DeepReadonly<Cel>): SceneCelNode {
  const source = cel.source.type === "region"
    ? projectRegion(project, requireEntity(project.regions, cel.source.regionId, "region"))
    : cel.source.type === "composition"
      ? projectComposition(
          project,
          requireEntity(project.compositions, cel.source.compositionId, "composition"),
        )
      : projectVariant(
          project,
          requireEntity(project.variantSets, cel.source.variantSetId, "variant set"),
        );
  return {
    kind: "cel",
    celId: cel.id,
    sequenceId: cel.sequenceId,
    durationMs: cel.durationMs,
    width: source.width,
    height: source.height,
    background: source.background,
    pivot: point(cel.pivot),
    transform: transform(cel.transform),
    locked: cel.locked ?? false,
    source,
  };
}

function projectRoot(project: ProjectSnapshot, reference: RootReference): SceneRootNode {
  switch (reference.kind) {
    case "asset":
      return projectAsset(requireEntity(project.assets, reference.id, "asset"));
    case "region":
      return projectRegion(project, requireEntity(project.regions, reference.id, "region"));
    case "composition":
      return projectComposition(
        project,
        requireEntity(project.compositions, reference.id, "composition"),
      );
    case "variant":
      return projectVariant(
        project,
        requireEntity(project.variantSets, reference.id, "variant set"),
      );
    case "cel":
      return projectCel(project, requireEntity(project.cels, reference.id, "cel"));
  }
}

export function createSceneProjection(
  projectState: ProjectStoreState,
  workspaceState: WorkspaceState,
): SceneProjection {
  const workspaceId = projectState.project.workspace.activeWorkspace ?? DEFAULT_WORKSPACE;
  const viewportValue = workspaceState.viewports[workspaceId] ?? DEFAULT_VIEWPORT;
  const viewport: WorkspaceViewport = {
    scale: viewportValue.scale,
    offset: { x: viewportValue.offset.x, y: viewportValue.offset.y },
  };
  const reference = resolveRoot(projectState.project, workspaceId);
  const root = reference === null ? null : projectRoot(projectState.project, reference);
  return deepFreeze({
    projectId: projectState.project.id,
    revision: projectState.revision,
    workspaceId,
    viewport,
    canvas: root === null
      ? null
      : { width: root.width, height: root.height, background: root.background },
    root,
  });
}
