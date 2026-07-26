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

/**
 * Every durable workspace/render context understood by the canonical project.
 * `assets` is a shared resource context; the Studio shell's navigable
 * destinations are defined separately in `core/studio`.
 */
export const WORKSPACE_IDS = Object.freeze([
  "assets",
  "slice",
  "compose",
  "animate",
  "collision",
  "export",
] as const);

export type WorkspaceId = (typeof WORKSPACE_IDS)[number];

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

/** Durable media discriminant for image assets (no runtime payload). */
export type ImageAssetMedia = {
  type: "image";
};

/** Durable non-visual payload such as text or an opaque export artifact. */
export type BinaryAssetMedia = {
  type: "binary";
};

/**
 * Selected video track metadata persisted with a video asset.
 * Dimensions and timing are JSON numbers only — no decoder handles.
 */
export type VideoTrackMetadata = {
  /** Non-negative safe integer track index. */
  index: number;
  /** Non-empty codec identifier string. */
  codec: string;
  /** Positive safe integer coded frame width. */
  codedWidth: number;
  /** Positive safe integer coded frame height. */
  codedHeight: number;
  /** Positive safe integer display width (must match asset width). */
  displayWidth: number;
  /** Positive safe integer display height (must match asset height). */
  displayHeight: number;
  rotationDegrees: 0 | 90 | 180 | 270;
  /** Optional positive finite frames-per-second. */
  frameRate?: number;
  /** Optional non-negative safe integer sample count. */
  sampleCount?: number;
};

export type VideoAssetMedia = {
  type: "video";
  /** Positive safe integer duration in microseconds. */
  durationUs: number;
  track: VideoTrackMetadata;
};

export type AssetMedia = BinaryAssetMedia | ImageAssetMedia | VideoAssetMedia;

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
  /** Required durable media kind. Visual MIME types must match the discriminant. */
  media: AssetMedia;
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
    | {
        mode: "manual";
        rows: number;
        cols: number;
        /** Internal source-pixel dividers written after a user resizes the grid. */
        rowBoundaries?: readonly number[];
        /** Internal source-pixel dividers written after a user resizes the grid. */
        columnBoundaries?: readonly number[];
      };
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

/** Extract still frames from a durable video asset into PNG image assets. */
export interface VideoExtractRecipeV1 {
  kind: "video-extract";
  version: 1;
  sourceAssetId: EntityId;
  /** Non-negative safe integer; must equal source media.track.index. */
  trackIndex: number;
  range: {
    /** Non-negative safe integer start (microseconds). */
    startUs: number;
    /** Positive safe integer end (microseconds); must be > startUs and <= source durationUs. */
    endUs: number;
  };
  sampling: { mode: "all" } | { mode: "fps"; fps: number };
  output: { mimeType: "image/png" };
}

/** Remove an image background with one pinned local segmentation model. */
export interface BackgroundRemovalRecipeV1 {
  kind: "background-removal";
  version: 1;
  sourceAssetId: EntityId;
  model: {
    id: string;
    revision: string;
    backend: "wasm" | "webgpu" | "webgpu-wasm";
    inputWidth: number;
    inputHeight: number;
  };
  output: {
    mimeType: "image/png";
    alpha: "soft-mask";
  };
}

/** Shared durable identity/timestamps for every processing recipe kind. */
export type ProcessingRecipeCommon = {
  id: EntityId;
  name?: string;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
};

export type ProcessingRecipe = ProcessingRecipeCommon & (
  GridSplitRecipeV1 | VideoExtractRecipeV1 | BackgroundRemovalRecipeV1
);

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

export interface StudioProjectV2 {
  schemaVersion: 2;
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

/** Current canonical project document used by stores, commands and features. */
export type StudioProject = StudioProjectV2;

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
