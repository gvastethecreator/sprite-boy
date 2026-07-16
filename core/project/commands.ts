import type {
  AssetRecord,
  Cel,
  CelSource,
  CollisionSet,
  CollisionShape,
  Composition,
  EntityId,
  GeneratedArtifact,
  ISO8601Timestamp,
  Layer,
  ProcessingRecipe,
  ProjectRecordCollection,
  ProjectWorkspaceState,
  Region,
  Sequence,
  StudioProjectV1,
  VariantKey,
  VariantSet,
} from "./schema";

export const PROJECT_COMMAND_TYPES = [
  "project.rename",
  "asset.import",
  "asset.replace",
  "asset.rename",
  "asset.remove",
  "regions.commitRecipe",
  "region.update",
  "region.remove",
  "region.reorder",
  "processingRecipe.remove",
  "artifact.record",
  "artifact.remove",
  "composition.create",
  "composition.update",
  "composition.remove",
  "layer.add",
  "layer.update",
  "layer.remove",
  "layer.reorder",
  "layer.duplicate",
  "layer.sync",
  "variant.create",
  "variant.activate",
  "variant.replace",
  "variant.remove",
  "sequence.create",
  "sequence.update",
  "sequence.remove",
  "cel.add",
  "cel.update",
  "cel.remove",
  "cel.reorder",
  "cel.duplicate",
  "cel.swap",
  "cel.batchUpdate",
  "cel.replaceSource",
  "collisionSet.create",
  "collisionSet.remove",
  "collision.add",
  "collision.update",
  "collision.remove",
  "workspace.update",
] as const;

export type ProjectCommandType = (typeof PROJECT_COMMAND_TYPES)[number];
export type ProjectCommandFamily = ProjectCommandType extends `${infer Family}.${string}`
  ? Family
  : never;

export type CommandOrigin = "user" | "migration" | "ai" | "worker";
export type HistoryPolicy = "record" | "coalesce" | "ignore";
export type DestructivePolicy = "reject" | "cascade";

export interface ProjectCommandMetadata {
  commandId: EntityId;
  origin: CommandOrigin;
  history: HistoryPolicy;
  transactionId?: EntityId;
  issuedAt?: ISO8601Timestamp;
}

export interface ProjectCommandEnvelope<
  TCommand extends ProjectDispatchCommand = ProjectDispatchCommand,
> {
  command: TCommand;
  metadata: ProjectCommandMetadata;
}

export interface ProjectCommandContext {
  nextId: () => EntityId;
  now: () => ISO8601Timestamp;
}

export type EntityReference = {
  collection: ProjectRecordCollection;
  id: EntityId;
};

export interface CommandImpact {
  direct: EntityReference[];
  referencedBy: EntityReference[];
  cascades: EntityReference[];
  blockers: ProjectCommandDiagnostic[];
}

export type ProjectCommandErrorCode =
  | "COMMAND_UNSUPPORTED"
  | "PRECONDITION_FAILED"
  | "ENTITY_NOT_FOUND"
  | "ENTITY_ALREADY_EXISTS"
  | "REFERENCE_BLOCKED"
  | "INVALID_ORDER"
  | "INVALID_PATCH"
  | "INVARIANT_VIOLATION";

export interface ProjectCommandDiagnostic {
  code: ProjectCommandErrorCode;
  message: string;
  path?: string;
  entity?: EntityReference;
}

export interface ProjectCommandWarning {
  code: string;
  message: string;
  entity?: EntityReference;
}

export type ChangedEntityIds = Partial<
  Record<ProjectRecordCollection | "rootOrder" | "workspace", EntityId[]>
>;

export interface ProjectCommandBatch {
  type: "command.batch";
  commands: ProjectCommand[];
}

export type ProjectDispatchCommand = ProjectCommand | ProjectCommandBatch;

export interface ProjectSnapshotInverse {
  type: "project.restoreSnapshot";
  project: StudioProjectV1;
  semantic?: ProjectCommand | ProjectCommandBatch;
}

export type ProjectCommandInverse = ProjectCommand | ProjectCommandBatch | ProjectSnapshotInverse;

export type ProjectCommandResult =
  | {
      ok: true;
      project: StudioProjectV1;
      changedIds: ChangedEntityIds;
      warnings: ProjectCommandWarning[];
      impact: CommandImpact;
      inverse: ProjectCommandInverse;
    }
  | {
      ok: false;
      project: StudioProjectV1;
      diagnostics: ProjectCommandDiagnostic[];
      impact?: CommandImpact;
    };

export type RegionPatch = Partial<
  Pick<Region, "name" | "bounds" | "pivot" | "hidden" | "updatedAt" | "provenance">
>;
export type LayerPatch = Partial<
  Pick<Layer, "name" | "source" | "transform" | "visible" | "locked" | "updatedAt">
>;
export type CompositionPatch = Partial<
  Pick<Composition, "name" | "width" | "height" | "background" | "updatedAt">
>;
export type CelPatch = Partial<
  Pick<Cel, "durationMs" | "pivot" | "transform" | "locked" | "prompt" | "updatedAt">
>;
export type SequencePatch = Partial<
  Pick<Sequence, "name" | "fps" | "defaultDurationMs" | "loop" | "updatedAt">
>;
export type WorkspacePatch = Partial<ProjectWorkspaceState>;

export type ProjectCommand =
  | { type: "project.rename"; name: string; updatedAt: ISO8601Timestamp }
  | { type: "asset.import"; asset: AssetRecord; atIndex?: number }
  | { type: "asset.replace"; assetId: EntityId; replacement: AssetRecord }
  | { type: "asset.rename"; assetId: EntityId; name: string; updatedAt: ISO8601Timestamp }
  | { type: "asset.remove"; assetId: EntityId; policy: DestructivePolicy }
  | {
      type: "regions.commitRecipe";
      recipe: ProcessingRecipe;
      regions: Region[];
      derivedAssets?: AssetRecord[];
      atIndex?: number;
    }
  | { type: "region.update"; regionId: EntityId; patch: RegionPatch }
  | { type: "region.remove"; regionId: EntityId; policy: DestructivePolicy }
  | { type: "region.reorder"; regionId: EntityId; toIndex: number }
  | { type: "processingRecipe.remove"; recipeId: EntityId; policy: DestructivePolicy }
  | {
      type: "artifact.record";
      artifact: GeneratedArtifact;
      outputAsset?: AssetRecord;
      atIndex?: number;
    }
  | { type: "artifact.remove"; artifactId: EntityId; policy: DestructivePolicy }
  | { type: "composition.create"; composition: Composition; layers: Layer[]; atIndex?: number }
  | { type: "composition.update"; compositionId: EntityId; patch: CompositionPatch }
  | { type: "composition.remove"; compositionId: EntityId; policy: DestructivePolicy }
  | { type: "layer.add"; compositionId: EntityId; layer: Layer; atIndex?: number }
  | { type: "layer.update"; layerId: EntityId; patch: LayerPatch }
  | { type: "layer.remove"; layerId: EntityId }
  | { type: "layer.reorder"; layerId: EntityId; toIndex: number }
  | { type: "layer.duplicate"; layerId: EntityId; atIndex?: number }
  | {
      type: "layer.sync";
      sourceLayerId: EntityId;
      targetLayerIds: EntityId[];
      fields: Array<"source" | "transform" | "visible" | "locked">;
    }
  | {
      type: "variant.create";
      celId: EntityId;
      variantSet: VariantSet;
      compositions: Composition[];
      layers: Layer[];
    }
  | {
      type: "variant.activate";
      variantSetId: EntityId;
      variant: VariantKey;
      updatedAt: ISO8601Timestamp;
    }
  | {
      type: "variant.replace";
      variantSetId: EntityId;
      variant: VariantKey;
      composition: Composition;
      layers: Layer[];
      policy: DestructivePolicy;
    }
  | { type: "variant.remove"; variantSetId: EntityId; variant: VariantKey; policy: DestructivePolicy }
  | { type: "sequence.create"; sequence: Sequence; atIndex?: number }
  | { type: "sequence.update"; sequenceId: EntityId; patch: SequencePatch }
  | { type: "sequence.remove"; sequenceId: EntityId; policy: DestructivePolicy }
  | {
      type: "cel.add";
      sequenceId: EntityId;
      cel: Cel;
      ownedComposition?: Composition;
      ownedVariantSet?: VariantSet;
      ownedVariantCompositions?: Composition[];
      ownedLayers?: Layer[];
      atIndex?: number;
    }
  | { type: "cel.update"; celId: EntityId; patch: CelPatch }
  | { type: "cel.remove"; celId: EntityId; policy: DestructivePolicy }
  | { type: "cel.reorder"; celId: EntityId; toIndex: number }
  | { type: "cel.duplicate"; celId: EntityId; atIndex?: number }
  | { type: "cel.swap"; firstCelId: EntityId; secondCelId: EntityId }
  | { type: "cel.batchUpdate"; celIds: EntityId[]; patch: CelPatch }
  | {
      type: "cel.replaceSource";
      celId: EntityId;
      source: CelSource;
      ownedComposition?: Composition;
      ownedVariantSet?: VariantSet;
      ownedVariantCompositions?: Composition[];
      ownedLayers?: Layer[];
      policy: DestructivePolicy;
    }
  | { type: "collisionSet.create"; collisionSet: CollisionSet }
  | { type: "collisionSet.remove"; collisionSetId: EntityId }
  | { type: "collision.add"; collisionSetId: EntityId; shape: CollisionShape; atIndex?: number }
  | {
      type: "collision.update";
      collisionSetId: EntityId;
      shapeId: EntityId;
      patch: Partial<Pick<CollisionShape, "type" | "bounds" | "tag">>;
    }
  | { type: "collision.remove"; collisionSetId: EntityId; shapeId: EntityId }
  | { type: "workspace.update"; patch: WorkspacePatch };

type MissingCommandTypes = Exclude<ProjectCommandType, ProjectCommand["type"]>;
type ExtraCommandTypes = Exclude<ProjectCommand["type"], ProjectCommandType>;
const _commandTypeContract: [MissingCommandTypes, ExtraCommandTypes] extends [never, never]
  ? true
  : never = true;
void _commandTypeContract;

export function getProjectCommandFamily(command: ProjectCommand): ProjectCommandFamily {
  return command.type.slice(0, command.type.indexOf(".")) as ProjectCommandFamily;
}

export function createEmptyImpact(): CommandImpact {
  return { direct: [], referencedBy: [], cascades: [], blockers: [] };
}
