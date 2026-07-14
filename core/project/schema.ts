/**
 * Canonical, JSON-safe project contract for Studio Foundation F0.
 *
 * This module deliberately contains data-only types.  Runtime values such as
 * Blob instances and object URLs belong to AssetRepository and must never be
 * represented by these records.
 */

export type EntityId = string;

export type ISO8601Timestamp = string;

export type VariantKey = "A" | "B" | "C" | "D";

export type WorkspaceId =
  | "assets"
  | "slice"
  | "compose"
  | "animate"
  | "collision"
  | "export";

export interface Dimensions {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point, Dimensions {}

export interface EntityProvenance {
  source: string;
  sourceId?: string;
  importedAt?: ISO8601Timestamp;
  note?: string;
}

export interface AssetProvenance extends EntityProvenance {
  source: "import" | "generated" | "derived" | "legacy" | "fixture" | string;
  recipeId?: EntityId;
  artifactId?: EntityId;
  parentAssetId?: EntityId;
}

export interface AssetRecord {
  id: EntityId;
  name: string;
  blobKey: string;
  contentHash: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
  provenance: AssetProvenance;
}

/** A rectangular region inside an immutable source asset. */
export interface Region {
  id: EntityId;
  assetId: EntityId;
  name?: string;
  bounds: Rect;
  pivot?: Point;
  hidden?: boolean;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
  provenance?: EntityProvenance;
}

export interface LayerTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  flipX: boolean;
  flipY: boolean;
}

export type LayerSource =
  | { type: "asset"; id: EntityId }
  | { type: "region"; id: EntityId };

export interface Layer {
  id: EntityId;
  compositionId: EntityId;
  name?: string;
  source: LayerSource;
  transform: LayerTransform;
  visible?: boolean;
  locked?: boolean;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
}

export type CompositionOwner =
  | { type: "project" }
  | { type: "cel"; celId: EntityId }
  | { type: "variantSet"; variantSetId: EntityId; variant: VariantKey };

export interface Composition extends Dimensions {
  id: EntityId;
  name: string;
  owner: CompositionOwner;
  layerIds: EntityId[];
  background?: string | null;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
}

export interface VariantSet {
  id: EntityId;
  celId: EntityId;
  variants: Partial<Record<VariantKey, EntityId>>;
  activeVariant: VariantKey;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
}

export type CelSource =
  | { type: "region"; regionId: EntityId }
  | { type: "composition"; compositionId: EntityId }
  | { type: "variantSet"; variantSetId: EntityId };

export interface CelTransform {
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  opacity?: number;
  flipX?: boolean;
  flipY?: boolean;
}

export interface Cel {
  id: EntityId;
  sequenceId: EntityId;
  source: CelSource;
  durationMs: number;
  pivot?: Point;
  transform?: CelTransform;
  locked?: boolean;
  prompt?: string;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
}

export interface Sequence {
  id: EntityId;
  name: string;
  celIds: EntityId[];
  fps: number;
  defaultDurationMs?: number;
  loop: boolean;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
}

export type CollisionOwner =
  | { type: "region"; regionId: EntityId }
  | { type: "composition"; compositionId: EntityId }
  | { type: "cel"; celId: EntityId };

export type CollisionShapeType = "hurtbox" | "hitbox" | "solid" | "trigger";

export interface CollisionShape {
  id: EntityId;
  type: CollisionShapeType;
  bounds: Rect;
  tag?: string;
}

export interface CollisionSet {
  id: EntityId;
  owner: CollisionOwner;
  shapes: CollisionShape[];
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
}

export interface GridSplitRecipeV1 {
  kind: "grid-split";
  version: 1;
  sourceAssetId: EntityId;
  layout:
    | { mode: "auto" }
    | { mode: "manual"; rows: number; cols: number };
  crop: { threshold: number; padding: number };
  chroma: {
    enabled: boolean;
    color: string;
    tolerance: number;
    smoothness: number;
    spill: number;
  };
  pixel: {
    enabled: boolean;
    size: number;
    quantize: boolean;
    colors: number;
    palette?: string[];
  };
}

export interface ProcessingRecipe extends GridSplitRecipeV1 {
  id: EntityId;
  name?: string;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
}

export type GeneratedArtifactType = "ai" | "export" | "processed";

export interface ArtifactCost {
  amount: number;
  currency: string;
}

export interface GeneratedArtifactProvenance {
  source: string;
  recipeId?: EntityId;
  parentArtifactId?: EntityId;
  model?: string;
  prompt?: string;
}

interface GeneratedArtifactBase {
  id: EntityId;
  name?: string;
  sourceAssetId?: EntityId;
  recipeId?: EntityId;
  mimeType?: string;
  byteSize?: number;
  model?: string;
  prompt?: string;
  cost?: ArtifactCost;
  provenance: GeneratedArtifactProvenance;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
}

export type GeneratedArtifact = GeneratedArtifactBase &
  (
    | { type: "ai" | "processed"; outputAssetId: EntityId }
    | { type: "export"; outputAssetId?: EntityId }
  );

export interface ProjectRootOrder {
  assetIds: EntityId[];
  regionIds: EntityId[];
  compositionIds: EntityId[];
  sequenceIds: EntityId[];
}

/** Durable selection/workspace context. Interaction and playback state is excluded. */
export interface ProjectWorkspaceState {
  activeWorkspace?: WorkspaceId;
  selectedAssetId?: EntityId;
  selectedRegionId?: EntityId;
  selectedCompositionId?: EntityId;
  selectedLayerId?: EntityId;
  selectedVariantSetId?: EntityId;
  selectedSequenceId?: EntityId;
  selectedCelIds?: EntityId[];
}

export interface StudioProjectV1 {
  schemaVersion: 1;
  id: EntityId;
  name: string;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
  rootOrder: ProjectRootOrder;
  assets: Record<EntityId, AssetRecord>;
  regions: Record<EntityId, Region>;
  layers: Record<EntityId, Layer>;
  compositions: Record<EntityId, Composition>;
  variantSets: Record<EntityId, VariantSet>;
  cels: Record<EntityId, Cel>;
  sequences: Record<EntityId, Sequence>;
  collisionSets: Record<EntityId, CollisionSet>;
  processingRecipes: Record<EntityId, ProcessingRecipe>;
  generatedArtifacts: Record<EntityId, GeneratedArtifact>;
  workspace: ProjectWorkspaceState;
}

export type ProjectRecordCollection =
  | "assets"
  | "regions"
  | "layers"
  | "compositions"
  | "variantSets"
  | "cels"
  | "sequences"
  | "collisionSets"
  | "processingRecipes"
  | "generatedArtifacts";

export const PROJECT_RECORD_COLLECTIONS: readonly ProjectRecordCollection[] = [
  "assets",
  "regions",
  "layers",
  "compositions",
  "variantSets",
  "cels",
  "sequences",
  "collisionSets",
  "processingRecipes",
  "generatedArtifacts",
] as const;
