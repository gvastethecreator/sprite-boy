import type {
  CommandImpact,
  DestructivePolicy,
  EntityReference,
  ProjectCommand,
  ProjectCommandDiagnostic,
} from "./commands";
import { PROJECT_COMMAND_TYPES } from "./commands";
import { commandDiagnostic, hasOwn, isPlainRecord } from "./commandSupport";
import { PROJECT_RECORD_COLLECTIONS } from "./schema";
import type {
  CelSource,
  EntityId,
  ProjectRecordCollection,
  StudioProjectV1,
  VariantKey,
} from "./schema";
import { isEntityId } from "./primitives";
import { validateStudioProject } from "./validation";

interface ReferenceEdge {
  from: EntityReference;
  to: EntityReference;
  path: string;
}

interface CascadeRequest {
  direct: EntityReference[];
  deleteSeeds: EntityReference[];
  policy: DestructivePolicy;
  survivors?: EntityReference[];
  additionalEdges?: ReferenceEdge[];
}

interface ReferenceOverride {
  from: EntityReference;
  baseline: EntityReference;
  final: EntityReference;
}

const COLLECTION_RANK = new Map<ProjectRecordCollection, number>(
  PROJECT_RECORD_COLLECTIONS.map((collection, index) => [collection, index]),
);

type ImpactCommandType = ProjectCommand["type"] | "command.batch";

const IMPACT_COMMAND_KEYS: Partial<Record<ImpactCommandType, readonly string[]>> = {
  "asset.remove": ["type", "assetId", "policy"],
  "region.remove": ["type", "regionId", "policy"],
  "processingRecipe.remove": ["type", "recipeId", "policy"],
  "artifact.remove": ["type", "artifactId", "policy"],
  "composition.remove": ["type", "compositionId", "policy"],
  "layer.remove": ["type", "layerId"],
  "variant.replace": ["type", "variantSetId", "variant", "composition", "layers", "policy"],
  "variant.remove": ["type", "variantSetId", "variant", "policy"],
  "sequence.remove": ["type", "sequenceId", "policy"],
  "cel.remove": ["type", "celId", "policy"],
  "cel.replaceSource": [
    "type",
    "celId",
    "source",
    "ownedComposition",
    "ownedVariantSet",
    "ownedVariantCompositions",
    "ownedLayers",
    "policy",
  ],
  "collisionSet.remove": ["type", "collisionSetId"],
  "command.batch": ["type", "commands"],
};

function reference(collection: ProjectRecordCollection, id: EntityId): EntityReference {
  return { collection, id };
}

function referenceKey(value: EntityReference): string {
  return JSON.stringify([value.collection, value.id]);
}

function compareReferences(left: EntityReference, right: EntityReference): number {
  const collectionDifference =
    (COLLECTION_RANK.get(left.collection) ?? Number.MAX_SAFE_INTEGER) -
    (COLLECTION_RANK.get(right.collection) ?? Number.MAX_SAFE_INTEGER);
  return collectionDifference || left.id.localeCompare(right.id);
}

function uniqueSortedReferences(values: readonly EntityReference[]): EntityReference[] {
  const unique = new Map<string, EntityReference>();
  for (const value of values) unique.set(referenceKey(value), value);
  return [...unique.values()].sort(compareReferences);
}

function addEdge(
  edges: ReferenceEdge[],
  fromCollection: ProjectRecordCollection,
  fromId: EntityId,
  toCollection: ProjectRecordCollection,
  toId: EntityId,
  path: string,
): void {
  edges.push({
    from: reference(fromCollection, fromId),
    to: reference(toCollection, toId),
    path,
  });
}

/**
 * Build entity-to-entity references that must be repaired or removed together.
 * Owner order arrays are deliberately represented by their child backreference
 * only, so removing a layer/cel repairs membership instead of deleting its owner.
 */
function collectReferenceEdges(project: StudioProjectV1): ReferenceEdge[] {
  const edges: ReferenceEdge[] = [];

  for (const id of Object.keys(project.assets).sort()) {
    const provenance = project.assets[id].provenance;
    if (provenance.recipeId) {
      addEdge(edges, "assets", id, "processingRecipes", provenance.recipeId, `$.assets.${id}.provenance.recipeId`);
    }
    if (provenance.artifactId) {
      addEdge(edges, "assets", id, "generatedArtifacts", provenance.artifactId, `$.assets.${id}.provenance.artifactId`);
    }
    if (provenance.parentAssetId) {
      addEdge(edges, "assets", id, "assets", provenance.parentAssetId, `$.assets.${id}.provenance.parentAssetId`);
    }
  }

  for (const id of Object.keys(project.regions).sort()) {
    addEdge(edges, "regions", id, "assets", project.regions[id].assetId, `$.regions.${id}.assetId`);
  }

  for (const id of Object.keys(project.layers).sort()) {
    const layer = project.layers[id];
    addEdge(edges, "layers", id, "compositions", layer.compositionId, `$.layers.${id}.compositionId`);
    addEdge(
      edges,
      "layers",
      id,
      layer.source.type === "asset" ? "assets" : "regions",
      layer.source.id,
      `$.layers.${id}.source.id`,
    );
  }

  for (const id of Object.keys(project.compositions).sort()) {
    const owner = project.compositions[id].owner;
    if (owner.type === "cel") {
      addEdge(edges, "compositions", id, "cels", owner.celId, `$.compositions.${id}.owner.celId`);
    } else if (owner.type === "variantSet") {
      addEdge(
        edges,
        "compositions",
        id,
        "variantSets",
        owner.variantSetId,
        `$.compositions.${id}.owner.variantSetId`,
      );
    }
  }

  for (const id of Object.keys(project.variantSets).sort()) {
    const variantSet = project.variantSets[id];
    addEdge(edges, "variantSets", id, "cels", variantSet.celId, `$.variantSets.${id}.celId`);
    for (const variant of Object.keys(variantSet.variants).sort() as VariantKey[]) {
      const compositionId = variantSet.variants[variant];
      if (compositionId) {
        addEdge(
          edges,
          "variantSets",
          id,
          "compositions",
          compositionId,
          `$.variantSets.${id}.variants.${variant}`,
        );
      }
    }
  }

  for (const id of Object.keys(project.cels).sort()) {
    const cel = project.cels[id];
    addEdge(edges, "cels", id, "sequences", cel.sequenceId, `$.cels.${id}.sequenceId`);
    const source = cel.source;
    if (source.type === "region") {
      addEdge(edges, "cels", id, "regions", source.regionId, `$.cels.${id}.source.regionId`);
    } else if (source.type === "composition") {
      addEdge(edges, "cels", id, "compositions", source.compositionId, `$.cels.${id}.source.compositionId`);
    } else {
      addEdge(edges, "cels", id, "variantSets", source.variantSetId, `$.cels.${id}.source.variantSetId`);
    }
  }

  for (const id of Object.keys(project.collisionSets).sort()) {
    const owner = project.collisionSets[id].owner;
    if (owner.type === "region") {
      addEdge(edges, "collisionSets", id, "regions", owner.regionId, `$.collisionSets.${id}.owner.regionId`);
    } else if (owner.type === "composition") {
      addEdge(
        edges,
        "collisionSets",
        id,
        "compositions",
        owner.compositionId,
        `$.collisionSets.${id}.owner.compositionId`,
      );
    } else {
      addEdge(edges, "collisionSets", id, "cels", owner.celId, `$.collisionSets.${id}.owner.celId`);
    }
  }

  for (const id of Object.keys(project.processingRecipes).sort()) {
    addEdge(
      edges,
      "processingRecipes",
      id,
      "assets",
      project.processingRecipes[id].sourceAssetId,
      `$.processingRecipes.${id}.sourceAssetId`,
    );
  }

  for (const id of Object.keys(project.generatedArtifacts).sort()) {
    const artifact = project.generatedArtifacts[id];
    if (artifact.sourceAssetId) {
      addEdge(edges, "generatedArtifacts", id, "assets", artifact.sourceAssetId, `$.generatedArtifacts.${id}.sourceAssetId`);
    }
    if (artifact.outputAssetId) {
      addEdge(edges, "generatedArtifacts", id, "assets", artifact.outputAssetId, `$.generatedArtifacts.${id}.outputAssetId`);
    }
    if (artifact.recipeId) {
      addEdge(edges, "generatedArtifacts", id, "processingRecipes", artifact.recipeId, `$.generatedArtifacts.${id}.recipeId`);
    }
    if (artifact.provenance.recipeId) {
      addEdge(
        edges,
        "generatedArtifacts",
        id,
        "processingRecipes",
        artifact.provenance.recipeId,
        `$.generatedArtifacts.${id}.provenance.recipeId`,
      );
    }
    if (artifact.provenance.parentArtifactId) {
      addEdge(
        edges,
        "generatedArtifacts",
        id,
        "generatedArtifacts",
        artifact.provenance.parentArtifactId,
        `$.generatedArtifacts.${id}.provenance.parentArtifactId`,
      );
    }
  }

  return edges.sort((left, right) =>
    compareReferences(left.to, right.to) ||
    compareReferences(left.from, right.from) ||
    left.path.localeCompare(right.path));
}

function entityExists(project: StudioProjectV1, target: EntityReference): boolean {
  return hasOwn(project[target.collection], target.id);
}

function missingTargetBlocker(target: EntityReference): ProjectCommandDiagnostic {
  return commandDiagnostic(
    "ENTITY_NOT_FOUND",
    `Entity ${target.id} was not found in ${target.collection}.`,
    undefined,
    target,
  );
}

function analyzeCascade(project: StudioProjectV1, request: CascadeRequest): CommandImpact {
  const direct = uniqueSortedReferences(request.direct);
  const deleteSeeds = uniqueSortedReferences(request.deleteSeeds);
  const missing = uniqueSortedReferences([...direct, ...deleteSeeds])
    .filter((target) => !entityExists(project, target));
  if (missing.length > 0) {
    return { direct, referencedBy: [], cascades: [], blockers: missing.map(missingTargetBlocker) };
  }

  const edges = [...collectReferenceEdges(project), ...(request.additionalEdges ?? [])]
    .sort((left, right) =>
      compareReferences(left.to, right.to) ||
      compareReferences(left.from, right.from) ||
      left.path.localeCompare(right.path));
  const survivorKeys = new Set((request.survivors ?? []).map(referenceKey));
  const removed = new Map(deleteSeeds.map((target) => [referenceKey(target), target]));
  const immediate = edges
    .filter((edge) => removed.has(referenceKey(edge.to)) && !survivorKeys.has(referenceKey(edge.from)))
    .map((edge) => edge.from);

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      const fromKey = referenceKey(edge.from);
      if (
        removed.has(referenceKey(edge.to)) &&
        !removed.has(fromKey) &&
        !survivorKeys.has(fromKey)
      ) {
        removed.set(fromKey, edge.from);
        changed = true;
      }
    }
  }

  const directKeys = new Set(direct.map(referenceKey));
  const cascades = uniqueSortedReferences(
    [...removed.values()].filter((target) => !directKeys.has(referenceKey(target))),
  );
  const referencedBy = uniqueSortedReferences(immediate);
  const blockers: ProjectCommandDiagnostic[] = [];
  if (request.policy === "reject" && cascades.length > 0) {
    const blockedReferences = referencedBy.length > 0 ? referencedBy : deleteSeeds;
    for (const blocked of blockedReferences) {
      blockers.push(commandDiagnostic(
        "REFERENCE_BLOCKED",
        `Removing the requested graph would also remove ${blocked.collection}/${blocked.id}.`,
        undefined,
        blocked,
      ));
    }
  }
  return { direct, referencedBy, cascades, blockers };
}

function invalidImpact(message: string, path = "$"): CommandImpact {
  return {
    direct: [],
    referencedBy: [],
    cascades: [],
    blockers: [commandDiagnostic("INVALID_PATCH", message, path)],
  };
}

function invalidProjectImpact(project: StudioProjectV1): CommandImpact | undefined {
  const validation = validateStudioProject(project);
  if (validation.valid) return undefined;
  return {
    direct: [],
    referencedBy: [],
    cascades: [],
    blockers: validation.diagnostics.map((item) =>
      commandDiagnostic("INVARIANT_VIOLATION", item.message, item.path)),
  };
}

function readCommandType(command: unknown): string | undefined {
  if (!isPlainRecord(command)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(command, "type");
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function validateImpactCommandShape(command: unknown, type: ImpactCommandType): CommandImpact | undefined {
  const allowed = IMPACT_COMMAND_KEYS[type];
  if (!allowed) return undefined;
  const record = command as Record<string, unknown>;
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      return invalidImpact(`Field ${String(key)} is not supported by ${type} impact analysis.`, "$" as const);
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      return invalidImpact(`Accessor fields are not supported by ${type} impact analysis.`, `$.${key}`);
    }
  }
  for (const key of allowed) {
    if (key.startsWith("owned")) continue;
    if (!hasOwn(record, key)) return invalidImpact(`Field ${key} is required by ${type}.`, `$.${key}`);
  }
  return undefined;
}

function policyOf(command: Record<string, unknown>): DestructivePolicy | undefined {
  return command.policy === "reject" || command.policy === "cascade" ? command.policy : undefined;
}

function dataRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    result[key] = descriptor.value;
  }
  return result;
}

function sourceReference(source: unknown): EntityReference | undefined {
  const record = dataRecord(source);
  if (!record) return undefined;
  const keys = Object.keys(record);
  if (record.type === "region" && keys.every((key) => key === "type" || key === "regionId") && isEntityId(record.regionId)) {
    return reference("regions", record.regionId);
  }
  if (
    record.type === "composition" &&
    keys.every((key) => key === "type" || key === "compositionId") &&
    isEntityId(record.compositionId)
  ) {
    return reference("compositions", record.compositionId);
  }
  if (
    record.type === "variantSet" &&
    keys.every((key) => key === "type" || key === "variantSetId") &&
    isEntityId(record.variantSetId)
  ) {
    return reference("variantSets", record.variantSetId);
  }
  return undefined;
}

function ownedSourceBlocker(
  project: StudioProjectV1,
  command: Record<string, unknown>,
  celId: EntityId,
  nextSource: EntityReference,
): ProjectCommandDiagnostic | undefined {
  if (entityExists(project, nextSource)) {
    if (nextSource.collection === "compositions") {
      const owner = project.compositions[nextSource.id].owner;
      if (owner.type !== "cel" || owner.celId !== celId) {
        return commandDiagnostic(
          "PRECONDITION_FAILED",
          "A composition cel source must be owned by the cel being relinked.",
          "$.source.compositionId",
          nextSource,
        );
      }
    }
    if (
      nextSource.collection === "variantSets" &&
      project.variantSets[nextSource.id].celId !== celId
    ) {
      return commandDiagnostic(
        "PRECONDITION_FAILED",
        "A variantSet cel source must be owned by the cel being relinked.",
        "$.source.variantSetId",
        nextSource,
      );
    }
    return undefined;
  }

  if (nextSource.collection === "compositions") {
    const composition = dataRecord(command.ownedComposition);
    const owner = composition ? dataRecord(composition.owner) : undefined;
    if (
      composition?.id === nextSource.id &&
      owner?.type === "cel" &&
      owner.celId === celId
    ) return undefined;
  }
  if (nextSource.collection === "variantSets") {
    const variantSet = dataRecord(command.ownedVariantSet);
    if (variantSet?.id === nextSource.id && variantSet.celId === celId) return undefined;
  }
  return missingTargetBlocker(nextSource);
}

function readBatchCommands(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: unknown[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    result.push(descriptor.value);
  }
  return result;
}

function uniqueDiagnostics(values: readonly ProjectCommandDiagnostic[]): ProjectCommandDiagnostic[] {
  const unique = new Map<string, ProjectCommandDiagnostic>();
  for (const value of values) {
    const key = JSON.stringify([value.code, value.path, value.message, value.entity?.collection, value.entity?.id]);
    unique.set(key, value);
  }
  return [...unique.values()];
}

function mergeImpacts(
  impacts: readonly CommandImpact[],
  explicitDeletes: ReadonlySet<string> = new Set(),
): CommandImpact {
  const direct = uniqueSortedReferences(impacts.flatMap((impact) => impact.direct));
  return {
    direct,
    referencedBy: uniqueSortedReferences(impacts.flatMap((impact) => impact.referencedBy)),
    cascades: uniqueSortedReferences(impacts.flatMap((impact) => impact.cascades))
      .filter((value) => !explicitDeletes.has(referenceKey(value))),
    blockers: uniqueDiagnostics(impacts.flatMap((impact) => impact.blockers))
      .filter((blocker) =>
        blocker.code !== "REFERENCE_BLOCKED" ||
        !blocker.entity ||
        !explicitDeletes.has(referenceKey(blocker.entity))),
  };
}

function layerSourceReference(source: unknown): EntityReference | undefined {
  const record = dataRecord(source);
  if (!record || !isEntityId(record.id)) return undefined;
  if (record.type === "asset") return reference("assets", record.id);
  if (record.type === "region") return reference("regions", record.id);
  return undefined;
}

function collectBatchReferenceOverrides(
  project: StudioProjectV1,
  commands: readonly unknown[],
): ReferenceOverride[] {
  const overrides = new Map<string, ReferenceOverride>();
  const update = (
    from: EntityReference,
    baseline: EntityReference,
    final: EntityReference,
  ): void => {
    const key = referenceKey(from);
    const current = overrides.get(key);
    overrides.set(key, { from, baseline: current?.baseline ?? baseline, final });
  };
  for (const command of commands) {
    const record = dataRecord(command);
    if (!record) continue;
    if (record.type === "cel.replaceSource" && isEntityId(record.celId) && hasOwn(project.cels, record.celId)) {
      const nextSource = sourceReference(record.source);
      if (!nextSource || ownedSourceBlocker(project, record, record.celId, nextSource)) continue;
      const cel = project.cels[record.celId];
      const baseline = cel.source.type === "region"
        ? reference("regions", cel.source.regionId)
        : cel.source.type === "composition"
          ? reference("compositions", cel.source.compositionId)
          : reference("variantSets", cel.source.variantSetId);
      update(reference("cels", record.celId), baseline, nextSource);
    }
    if (record.type === "layer.update" && isEntityId(record.layerId) && hasOwn(project.layers, record.layerId)) {
      const patch = dataRecord(record.patch);
      if (!patch || !hasOwn(patch, "source")) continue;
      const nextSource = layerSourceReference(patch.source);
      if (!nextSource || !entityExists(project, nextSource)) continue;
      const layer = project.layers[record.layerId];
      const baseline = layer.source.type === "asset"
        ? reference("assets", layer.source.id)
        : reference("regions", layer.source.id);
      update(reference("layers", record.layerId), baseline, nextSource);
    }
  }
  return [...overrides.values()].sort((left, right) => compareReferences(left.from, right.from));
}

function analyzeBatch(project: StudioProjectV1, record: Record<string, unknown>): CommandImpact {
  const commands = readBatchCommands(record.commands);
  if (!commands) return invalidImpact("command.batch commands must be a dense data-only array.", "$.commands");
  const referenceOverrides = collectBatchReferenceOverrides(project, commands);
  const activeVariantOverrides = new Map<EntityId, VariantKey>();
  for (const command of commands) {
    const item = dataRecord(command);
    if (
      item?.type === "variant.activate" &&
      isEntityId(item.variantSetId) &&
      (item.variant === "A" || item.variant === "B" || item.variant === "C" || item.variant === "D") &&
      hasOwn(project.variantSets, item.variantSetId) &&
      hasOwn(project.variantSets[item.variantSetId].variants, item.variant)
    ) {
      activeVariantOverrides.set(item.variantSetId, item.variant);
    }
  }
  const explicitDeletes = new Set<string>();
  const impacts = commands.map((command, index) => {
    if (readCommandType(command) === "command.batch") {
      return invalidImpact("Nested command.batch payloads are not supported.", `$.commands[${index}]`);
    }
    const commandRecord = dataRecord(command);
    const variantSetId = commandRecord?.type === "variant.remove" && isEntityId(commandRecord.variantSetId)
      ? commandRecord.variantSetId
      : undefined;
    const activeVariant = variantSetId ? activeVariantOverrides.get(variantSetId) : undefined;
    const analysisProject = variantSetId && activeVariant
      ? {
          ...project,
          variantSets: {
            ...project.variantSets,
            [variantSetId]: { ...project.variantSets[variantSetId], activeVariant },
          },
        }
      : project;
    const impact = analyzeProjectCommandImpact(analysisProject, command);
    const type = commandRecord?.type;
    if (
      !commandRecord ||
      typeof type !== "string" ||
      !PROJECT_COMMAND_TYPES.includes(type as ProjectCommand["type"])
    ) {
      return impact;
    }
    const removal = removeTarget(type as ProjectCommand["type"], commandRecord);
    if (!removal.target || !removal.policy) return impact;
    const target = removal.target;
    explicitDeletes.add(referenceKey(target));
    if (impact.blockers.some(({ code }) => code !== "REFERENCE_BLOCKED")) return impact;
    return analyzeCascade(project, {
      direct: [target],
      deleteSeeds: [target],
      policy: removal.policy,
      survivors: referenceOverrides
        .filter((override) =>
          referenceKey(override.baseline) === referenceKey(target) &&
          referenceKey(override.final) !== referenceKey(target))
        .map((override) => override.from),
      additionalEdges: referenceOverrides
        .filter((override) =>
          referenceKey(override.baseline) !== referenceKey(target) &&
          referenceKey(override.final) === referenceKey(target))
        .map((override) => ({
          from: override.from,
          to: override.final,
          path: `$.command.batch.finalReferences.${override.from.collection}.${override.from.id}`,
        })),
    });
  });
  return mergeImpacts(impacts, explicitDeletes);
}

function sameSource(left: CelSource, right: EntityReference): boolean {
  return (
    (left.type === "region" && right.collection === "regions" && left.regionId === right.id) ||
    (left.type === "composition" && right.collection === "compositions" && left.compositionId === right.id) ||
    (left.type === "variantSet" && right.collection === "variantSets" && left.variantSetId === right.id)
  );
}

function removeTarget(
  type: ProjectCommand["type"],
  command: Record<string, unknown>,
): { target?: EntityReference; policy?: DestructivePolicy } {
  const spec: Partial<Record<ProjectCommand["type"], [ProjectRecordCollection, string]>> = {
    "asset.remove": ["assets", "assetId"],
    "region.remove": ["regions", "regionId"],
    "processingRecipe.remove": ["processingRecipes", "recipeId"],
    "artifact.remove": ["generatedArtifacts", "artifactId"],
    "composition.remove": ["compositions", "compositionId"],
    "layer.remove": ["layers", "layerId"],
    "sequence.remove": ["sequences", "sequenceId"],
    "cel.remove": ["cels", "celId"],
    "collisionSet.remove": ["collisionSets", "collisionSetId"],
  };
  const match = spec[type];
  if (!match) return {};
  const id = command[match[1]];
  if (!isEntityId(id)) return {};
  return {
    target: reference(match[0], id),
    policy: policyOf(command) ?? (type === "layer.remove" || type === "collisionSet.remove" ? "cascade" : undefined),
  };
}

function analyzeVariantChange(
  project: StudioProjectV1,
  type: "variant.replace" | "variant.remove",
  command: Record<string, unknown>,
): CommandImpact {
  if (!isEntityId(command.variantSetId)) return invalidImpact("variantSetId must be a non-empty string.", "$.variantSetId");
  if (command.variant !== "A" && command.variant !== "B" && command.variant !== "C" && command.variant !== "D") {
    return invalidImpact("variant must be A, B, C or D.", "$.variant");
  }
  const policy = policyOf(command);
  if (!policy) return invalidImpact("policy must be reject or cascade.", "$.policy");
  const direct = reference("variantSets", command.variantSetId);
  if (!entityExists(project, direct)) {
    return { direct: [direct], referencedBy: [], cascades: [], blockers: [missingTargetBlocker(direct)] };
  }
  const variantSet = project.variantSets[command.variantSetId];
  const oldCompositionId = variantSet.variants[command.variant];
  if (!oldCompositionId) {
    return {
      direct: [direct],
      referencedBy: [],
      cascades: [],
      blockers: [commandDiagnostic("ENTITY_NOT_FOUND", `Variant ${command.variant} does not exist.`, "$.variant", direct)],
    };
  }
  if (type === "variant.remove") {
    if (Object.keys(variantSet.variants).length === 1) {
      return {
        direct: [direct], referencedBy: [], cascades: [],
        blockers: [commandDiagnostic("PRECONDITION_FAILED", "A variant set must retain at least one variant.", "$.variant", direct)],
      };
    }
    if (variantSet.activeVariant === command.variant) {
      return {
        direct: [direct], referencedBy: [], cascades: [],
        blockers: [commandDiagnostic("PRECONDITION_FAILED", "Activate another variant before removing the active variant.", "$.variant", direct)],
      };
    }
  }

  const oldComposition = project.compositions[oldCompositionId];
  const replacement = type === "variant.replace" ? dataRecord(command.composition) : undefined;
  if (type === "variant.replace" && (!replacement || !isEntityId(replacement.id))) {
    return invalidImpact("composition must be a data-only record with a valid id.", "$.composition");
  }
  const replacementId = replacement && isEntityId(replacement.id)
    ? replacement.id
    : undefined;
  const replacementLayerIds = replacementId === oldCompositionId
    ? readBatchCommands(replacement?.layerIds)
    : undefined;
  if (
    replacementId === oldCompositionId &&
    (!replacementLayerIds || !replacementLayerIds.every(isEntityId))
  ) {
    return invalidImpact("replacement composition layerIds must be a dense entity-id array.", "$.composition.layerIds");
  }
  const retainedLayerIds = new Set(replacementLayerIds as EntityId[] | undefined);
  const deleteSeeds = replacementId === oldCompositionId && oldComposition
    ? oldComposition.layerIds
      .filter((id) => !retainedLayerIds.has(id))
      .map((id) => reference("layers", id))
    : [reference("compositions", oldCompositionId)];
  return analyzeCascade(project, { direct: [direct], deleteSeeds, policy, survivors: [direct] });
}

function analyzeCelRelink(project: StudioProjectV1, command: Record<string, unknown>): CommandImpact {
  if (!isEntityId(command.celId)) return invalidImpact("celId must be a non-empty string.", "$.celId");
  const policy = policyOf(command);
  if (!policy) return invalidImpact("policy must be reject or cascade.", "$.policy");
  const direct = reference("cels", command.celId);
  if (!entityExists(project, direct)) {
    return { direct: [direct], referencedBy: [], cascades: [], blockers: [missingTargetBlocker(direct)] };
  }
  const nextSource = sourceReference(command.source);
  if (!nextSource) return invalidImpact("source must be a closed region, composition or variantSet reference.", "$.source");
  const sourceBlocker = ownedSourceBlocker(project, command, command.celId, nextSource);
  if (sourceBlocker) return { direct: [direct], referencedBy: [], cascades: [], blockers: [sourceBlocker] };
  const previousSource = project.cels[command.celId].source;
  if (sameSource(previousSource, nextSource) || previousSource.type === "region") {
    return { direct: [direct], referencedBy: [], cascades: [], blockers: [] };
  }
  const oldSource = previousSource.type === "composition"
    ? reference("compositions", previousSource.compositionId)
    : reference("variantSets", previousSource.variantSetId);
  return analyzeCascade(project, {
    direct: [direct],
    deleteSeeds: [oldSource],
    policy,
    survivors: [direct],
  });
}

/**
 * Analyze graph consequences without mutating the project. “Orphans” are
 * prospective only: reject reports blockers; cascade lists every entity that
 * an atomic reducer must remove so StudioProjectV1 never contains dangling refs.
 */
export function analyzeProjectCommandImpact(
  project: StudioProjectV1,
  command: unknown,
): CommandImpact {
  try {
    const invalidProject = invalidProjectImpact(project);
    if (invalidProject) return invalidProject;
    const type = readCommandType(command);
    if (!type) return invalidImpact("Impact analysis requires a plain command with a data-only type field.");
    const knownType = type === "command.batch" || PROJECT_COMMAND_TYPES.includes(type as ProjectCommand["type"]);
    if (!knownType) {
      return {
        direct: [], referencedBy: [], cascades: [],
        blockers: [commandDiagnostic("COMMAND_UNSUPPORTED", `Command type ${type} is not supported.`, "$.type")],
      };
    }
    const impactType = type as ImpactCommandType;
    const shapeFailure = validateImpactCommandShape(command, impactType);
    if (shapeFailure) return shapeFailure;
    const record = command as Record<string, unknown>;

    if (impactType === "command.batch") return analyzeBatch(project, record);

    if (impactType === "variant.replace" || impactType === "variant.remove") {
      return analyzeVariantChange(project, impactType, record);
    }
    if (impactType === "cel.replaceSource") return analyzeCelRelink(project, record);

    const { target, policy } = removeTarget(impactType, record);
    if (!target) {
      return IMPACT_COMMAND_KEYS[impactType]
        ? invalidImpact(`The target id for ${impactType} is invalid.`)
        : { direct: [], referencedBy: [], cascades: [], blockers: [] };
    }
    if (!policy) return invalidImpact("policy must be reject or cascade.", "$.policy");
    return analyzeCascade(project, { direct: [target], deleteSeeds: [target], policy });
  } catch {
    return invalidImpact("Impact analysis could not safely read the project or command payload.");
  }
}
