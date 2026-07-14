import type {
  Cel,
  CollisionSet,
  CollisionShape,
  Composition,
  CompositionOwner,
  Layer,
  Sequence,
  StudioProjectV1,
  VariantKey,
  VariantSet,
} from "./schema";
import {
  cloneCommandPayload,
  commandDiagnostic,
  commandFailure,
  commandInsertionIndex,
  commandReorderIndex,
  directCommandImpact,
  duplicateEntityDiagnostic,
  entityReference,
  finalizeCommandMutation,
  hasOwn,
  isCommandResult,
  isPlainRecord,
  jsonValuesEqual,
  malformedCommandFailure,
  missingEntityDiagnostic,
  noChangeCommandResult,
  prepareCommandCandidate,
} from "./commandSupport";
import type {
  CelPatch,
  ProjectCommand,
  ProjectCommandContext,
  ProjectCommandDiagnostic,
  ProjectCommandInverse,
  ProjectCommandResult,
  SequencePatch,
} from "./commands";
import { isEntityId } from "./primitives";

const SEQUENCE_PATCH_FIELDS = [
  "name",
  "fps",
  "defaultDurationMs",
  "loop",
  "updatedAt",
] as const;
const CEL_PATCH_FIELDS = [
  "durationMs",
  "pivot",
  "transform",
  "locked",
  "prompt",
  "updatedAt",
] as const;
const COLLISION_PATCH_FIELDS = ["type", "bounds", "tag"] as const;
const OPTIONAL_SEQUENCE_FIELDS = ["defaultDurationMs"] as const;
const OPTIONAL_CEL_FIELDS = ["pivot", "transform", "locked", "prompt"] as const;
const OPTIONAL_COLLISION_FIELDS = ["tag"] as const;
const OWNED_CEL_FIELDS = [
  "ownedComposition",
  "ownedVariantSet",
  "ownedVariantCompositions",
  "ownedLayers",
] as const;

type FamilyCommand = Extract<
  ProjectCommand,
  {
    type:
      | "sequence.create"
      | "sequence.update"
      | "cel.add"
      | "cel.update"
      | "cel.reorder"
      | "cel.duplicate"
      | "collisionSet.create"
      | "collision.add"
      | "collision.update"
      | "collision.remove";
  }
>;

const VARIANT_KEYS: readonly VariantKey[] = ["A", "B", "C", "D"];

function invalidPatch(message: string, path = "$"): ProjectCommandDiagnostic {
  return commandDiagnostic("INVALID_PATCH", message, path);
}

function requireEntityId(value: unknown, path: string): ProjectCommandDiagnostic | undefined {
  if (isEntityId(value)) return undefined;
  return invalidPatch(`Entity id must be a non-empty string; received ${String(value)}.`, path);
}

function requirePlainRecord(
  value: unknown,
  path: string,
  label: string,
): ProjectCommandDiagnostic | undefined {
  return isPlainRecord(value) ? undefined : invalidPatch(`${label} must be a plain object.`, path);
}

function setRecordValue<T extends Record<string, unknown>>(record: T, key: string, value: unknown): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function validateCelSource(
  project: StudioProjectV1,
  source: unknown,
  path: string,
): ProjectCommandDiagnostic | undefined {
  const recordDiagnostic = requirePlainRecord(source, path, "Cel source");
  if (recordDiagnostic) return recordDiagnostic;
  const record = source as Record<string, unknown>;
  const spec = record.type === "region"
    ? { field: "regionId", collection: "regions" as const }
    : record.type === "composition"
      ? { field: "compositionId", collection: "compositions" as const }
      : record.type === "variantSet"
        ? { field: "variantSetId", collection: "variantSets" as const }
        : undefined;
  if (!spec) return invalidPatch("Cel source type must be region, composition or variantSet.", `${path}.type`);
  const id = record[spec.field];
  const idDiagnostic = requireEntityId(id, `${path}.${spec.field}`);
  if (idDiagnostic) return idDiagnostic;
  if (!hasOwn(project[spec.collection], id as string)) {
    return missingEntityDiagnostic(spec.collection, id, `${path}.${spec.field}`);
  }
  return undefined;
}

function validateCollisionOwner(
  project: StudioProjectV1,
  owner: unknown,
  path: string,
): ProjectCommandDiagnostic | undefined {
  const recordDiagnostic = requirePlainRecord(owner, path, "Collision owner");
  if (recordDiagnostic) return recordDiagnostic;
  const record = owner as Record<string, unknown>;
  const spec = record.type === "region"
    ? { field: "regionId", collection: "regions" as const }
    : record.type === "composition"
      ? { field: "compositionId", collection: "compositions" as const }
      : record.type === "cel"
        ? { field: "celId", collection: "cels" as const }
        : undefined;
  if (!spec) return invalidPatch("Collision owner type must be region, composition or cel.", `${path}.type`);
  const id = record[spec.field];
  const idDiagnostic = requireEntityId(id, `${path}.${spec.field}`);
  if (idDiagnostic) return idDiagnostic;
  if (!hasOwn(project[spec.collection], id as string)) {
    return missingEntityDiagnostic(spec.collection, id, `${path}.${spec.field}`);
  }
  return undefined;
}

function applySequenceCreate(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "sequence.create" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const recordDiagnostic = requirePlainRecord(command.sequence, "$.sequence", "Sequence");
  if (recordDiagnostic) return commandFailure(original, [recordDiagnostic]);
  const sequence = command.sequence as Sequence;
  const idDiagnostic = requireEntityId(sequence.id, "$.sequence.id");
  if (idDiagnostic) return commandFailure(original, [idDiagnostic]);
  if (hasOwn(original.sequences, sequence.id)) {
    return commandFailure(original, [duplicateEntityDiagnostic("sequences", sequence.id, "$.sequence.id")]);
  }
  if (!Array.isArray(sequence.celIds)) {
    return commandFailure(original, [invalidPatch("Sequence celIds must be an array.", "$.sequence.celIds")]);
  }
  if (sequence.celIds.length > 0) {
    return commandFailure(original, [
      commandDiagnostic(
        "PRECONDITION_FAILED",
        "sequence.create accepts an empty celIds list; add cels with cel.add.",
        "$.sequence.celIds",
        entityReference("sequences", sequence.id),
      ),
    ]);
  }
  const index = commandInsertionIndex(
    command.atIndex,
    original.rootOrder.sequenceIds.length,
    "$.atIndex",
  );
  if (typeof index !== "number") return commandFailure(original, [index]);

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  setRecordValue(prepared.sequences, sequence.id, cloneCommandPayload(sequence));
  const order = prepared.rootOrder.sequenceIds;
  prepared.rootOrder.sequenceIds = [
    ...order.slice(0, index),
    sequence.id,
    ...order.slice(index),
  ];
  prepared.updatedAt = context.now();
  const inverse: ProjectCommandInverse = {
    type: "sequence.remove",
    sequenceId: sequence.id,
    policy: "reject",
  };
  return finalizeCommandMutation(
    original,
    prepared,
    { sequences: [sequence.id], rootOrder: [sequence.id] },
    directCommandImpact([entityReference("sequences", sequence.id)]),
    inverse,
  );
}

function validatePatch(
  patch: unknown,
  allowed: readonly string[],
  optional: readonly string[],
  label: string,
): ProjectCommandDiagnostic | undefined {
  const recordDiagnostic = requirePlainRecord(patch, "$.patch", `${label} patch`);
  if (recordDiagnostic) return recordDiagnostic;
  for (const ownKey of Reflect.ownKeys(patch as Record<string, unknown>)) {
    if (typeof ownKey !== "string") {
      return invalidPatch(`Symbol fields cannot be patched on ${label}.`, "$.patch");
    }
    const key = ownKey;
    if (!allowed.includes(key)) return invalidPatch(`Field ${key} cannot be patched on ${label}.`, `$.patch.${key}`);
    if ((patch as Record<string, unknown>)[key] === undefined && !optional.includes(key)) {
      return invalidPatch(`Field ${key} is required and cannot be removed.`, `$.patch.${key}`);
    }
  }
  return undefined;
}

function ownPatchKeys(record: Record<string, unknown>): string[] {
  return Reflect.ownKeys(record).filter((key): key is string => typeof key === "string");
}

function applySequenceUpdate(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "sequence.update" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const idDiagnostic = requireEntityId(command.sequenceId, "$.sequenceId");
  if (idDiagnostic) return commandFailure(original, [idDiagnostic]);
  if (!hasOwn(original.sequences, command.sequenceId)) {
    return commandFailure(original, [missingEntityDiagnostic("sequences", command.sequenceId, "$.sequenceId")]);
  }
  const patchDiagnostic = validatePatch(
    command.patch,
    SEQUENCE_PATCH_FIELDS,
    OPTIONAL_SEQUENCE_FIELDS,
    "sequence",
  );
  if (patchDiagnostic) return commandFailure(original, [patchDiagnostic]);

  const previous = original.sequences[command.sequenceId] as unknown as Record<string, unknown>;
  const patch = command.patch as unknown as Record<string, unknown>;
  const patchKeys = ownPatchKeys(patch);
  const changesSequence = patchKeys.some((key) => patch[key] === undefined
    ? hasOwn(previous, key)
    : !jsonValuesEqual(previous[key], patch[key]));
  const direct = directCommandImpact([entityReference("sequences", command.sequenceId)]);
  if (!changesSequence) return noChangeCommandResult(original, direct, cloneCommandPayload(command));

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  const target = prepared.sequences[command.sequenceId] as unknown as Record<string, unknown>;
  const inversePatch: Record<string, unknown> = {};
  for (const key of patchKeys) {
    inversePatch[key] = hasOwn(previous, key) ? cloneCommandPayload(previous[key]) : undefined;
    if (patch[key] === undefined) delete target[key];
    else target[key] = cloneCommandPayload(patch[key]);
  }
  const now = context.now();
  if (!patchKeys.includes("updatedAt")) {
    inversePatch.updatedAt = previous.updatedAt;
    target.updatedAt = now;
  }
  prepared.updatedAt = now;
  return finalizeCommandMutation(
    original,
    prepared,
    { sequences: [command.sequenceId] },
    direct,
    { type: "sequence.update", sequenceId: command.sequenceId, patch: inversePatch as SequencePatch },
  );
}

function ownedCelPayloadDiagnostic(
  command: Extract<FamilyCommand, { type: "cel.add" }>,
): ProjectCommandDiagnostic | undefined {
  for (const field of OWNED_CEL_FIELDS) {
    if (command[field] !== undefined) {
      return commandDiagnostic(
        "PRECONDITION_FAILED",
        `${field} is deferred until owned-graph impact and inverse handling is available.`,
        `$.${field}`,
      );
    }
  }
  return undefined;
}

function applyCelAdd(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "cel.add" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const ownedDiagnostic = ownedCelPayloadDiagnostic(command);
  if (ownedDiagnostic) return commandFailure(original, [ownedDiagnostic]);
  const sequenceIdDiagnostic = requireEntityId(command.sequenceId, "$.sequenceId");
  if (sequenceIdDiagnostic) return commandFailure(original, [sequenceIdDiagnostic]);
  if (!hasOwn(original.sequences, command.sequenceId)) {
    return commandFailure(original, [missingEntityDiagnostic("sequences", command.sequenceId, "$.sequenceId")]);
  }
  const recordDiagnostic = requirePlainRecord(command.cel, "$.cel", "Cel");
  if (recordDiagnostic) return commandFailure(original, [recordDiagnostic]);
  const cel = command.cel as Cel;
  const idDiagnostic = requireEntityId(cel.id, "$.cel.id");
  if (idDiagnostic) return commandFailure(original, [idDiagnostic]);
  if (hasOwn(original.cels, cel.id)) {
    return commandFailure(original, [duplicateEntityDiagnostic("cels", cel.id, "$.cel.id")]);
  }
  if (cel.sequenceId !== command.sequenceId) {
    return commandFailure(original, [
      commandDiagnostic(
        "PRECONDITION_FAILED",
        "Cel sequenceId must match sequenceId.",
        "$.cel.sequenceId",
        entityReference("sequences", command.sequenceId),
      ),
    ]);
  }
  const sourceDiagnostic = validateCelSource(original, cel.source, "$.cel.source");
  if (sourceDiagnostic) return commandFailure(original, [sourceDiagnostic]);
  const sequence = original.sequences[command.sequenceId];
  const index = commandInsertionIndex(command.atIndex, sequence.celIds.length, "$.atIndex");
  if (typeof index !== "number") return commandFailure(original, [index]);

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  setRecordValue(prepared.cels, cel.id, cloneCommandPayload(cel));
  const order = prepared.sequences[command.sequenceId].celIds;
  prepared.sequences[command.sequenceId].celIds = [
    ...order.slice(0, index),
    cel.id,
    ...order.slice(index),
  ];
  prepared.updatedAt = context.now();
  return finalizeCommandMutation(
    original,
    prepared,
    { cels: [cel.id], sequences: [command.sequenceId] },
    directCommandImpact([
      entityReference("sequences", command.sequenceId),
      entityReference("cels", cel.id),
    ]),
    { type: "cel.remove", celId: cel.id, policy: "reject" },
  );
}

function applyCelUpdate(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "cel.update" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const idDiagnostic = requireEntityId(command.celId, "$.celId");
  if (idDiagnostic) return commandFailure(original, [idDiagnostic]);
  if (!hasOwn(original.cels, command.celId)) {
    return commandFailure(original, [missingEntityDiagnostic("cels", command.celId, "$.celId")]);
  }
  const patchDiagnostic = validatePatch(command.patch, CEL_PATCH_FIELDS, OPTIONAL_CEL_FIELDS, "cel");
  if (patchDiagnostic) return commandFailure(original, [patchDiagnostic]);
  const patch = command.patch as unknown as Record<string, unknown>;

  const previous = original.cels[command.celId] as unknown as Record<string, unknown>;
  const patchKeys = ownPatchKeys(patch);
  const changesCel = patchKeys.some((key) => patch[key] === undefined
    ? hasOwn(previous, key)
    : !jsonValuesEqual(previous[key], patch[key]));
  const direct = directCommandImpact([entityReference("cels", command.celId)]);
  if (!changesCel) return noChangeCommandResult(original, direct, cloneCommandPayload(command));

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  const target = prepared.cels[command.celId] as unknown as Record<string, unknown>;
  const inversePatch: Record<string, unknown> = {};
  for (const key of patchKeys) {
    inversePatch[key] = hasOwn(previous, key) ? cloneCommandPayload(previous[key]) : undefined;
    if (patch[key] === undefined) delete target[key];
    else target[key] = cloneCommandPayload(patch[key]);
  }
  const now = context.now();
  if (!patchKeys.includes("updatedAt")) {
    inversePatch.updatedAt = previous.updatedAt;
    target.updatedAt = now;
  }
  prepared.updatedAt = now;
  return finalizeCommandMutation(
    original,
    prepared,
    { cels: [command.celId] },
    direct,
    { type: "cel.update", celId: command.celId, patch: inversePatch as CelPatch },
  );
}

function applyCelReorder(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "cel.reorder" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const idDiagnostic = requireEntityId(command.celId, "$.celId");
  if (idDiagnostic) return commandFailure(original, [idDiagnostic]);
  if (!hasOwn(original.cels, command.celId)) {
    return commandFailure(original, [missingEntityDiagnostic("cels", command.celId, "$.celId")]);
  }
  const cel = original.cels[command.celId];
  if (!hasOwn(original.sequences, cel.sequenceId)) {
    return commandFailure(original, [missingEntityDiagnostic("sequences", cel.sequenceId, "$.cel.sequenceId")]);
  }
  const sequence = original.sequences[cel.sequenceId];
  const index = commandReorderIndex(command.toIndex, sequence.celIds.length, "$.toIndex");
  if (typeof index !== "number") return commandFailure(original, [index]);
  const fromIndex = sequence.celIds.indexOf(command.celId);
  if (fromIndex < 0) {
    return commandFailure(original, [
      commandDiagnostic(
        "INVARIANT_VIOLATION",
        `Cel ${command.celId} is not present in its sequence order.`,
        `$.sequences.${cel.sequenceId}.celIds`,
        entityReference("cels", command.celId),
      ),
    ]);
  }

  const inverse: ProjectCommandInverse = {
    type: "cel.reorder",
    celId: command.celId,
    toIndex: fromIndex,
  };
  const direct = directCommandImpact([
    entityReference("sequences", cel.sequenceId),
    entityReference("cels", command.celId),
  ]);
  if (fromIndex === index) return noChangeCommandResult(original, direct, inverse);

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  const order = prepared.sequences[cel.sequenceId].celIds;
  const [moved] = order.splice(fromIndex, 1);
  order.splice(index, 0, moved);
  prepared.updatedAt = context.now();
  return finalizeCommandMutation(
    original,
    prepared,
    { cels: [command.celId], sequences: [cel.sequenceId] },
    direct,
    inverse,
  );
}

type DuplicateCollection = "cels" | "compositions" | "layers" | "variantSets" | "collisionSets";

function sortedUniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

function applyCelDuplicate(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "cel.duplicate" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const idDiagnostic = requireEntityId(command.celId, "$.celId");
  if (idDiagnostic) return commandFailure(original, [idDiagnostic]);
  if (!hasOwn(original.cels, command.celId)) {
    return commandFailure(original, [missingEntityDiagnostic("cels", command.celId, "$.celId")]);
  }
  const sourceCel = original.cels[command.celId];
  if (!hasOwn(original.sequences, sourceCel.sequenceId)) {
    return commandFailure(original, [
      missingEntityDiagnostic("sequences", sourceCel.sequenceId, `$.cels.${sourceCel.id}.sequenceId`),
    ]);
  }
  const sequence = original.sequences[sourceCel.sequenceId];
  const sourceIndex = sequence.celIds.indexOf(sourceCel.id);
  if (sourceIndex < 0) {
    return commandFailure(original, [
      commandDiagnostic(
        "INVARIANT_VIOLATION",
        `Cel ${sourceCel.id} is not present in its sequence order.`,
        `$.sequences.${sequence.id}.celIds`,
        entityReference("cels", sourceCel.id),
      ),
    ]);
  }
  const index = commandInsertionIndex(
    command.atIndex ?? sourceIndex + 1,
    sequence.celIds.length,
    "$.atIndex",
  );
  if (typeof index !== "number") return commandFailure(original, [index]);

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  const now = context.now();
  const allocated: Record<DuplicateCollection, Set<string>> = {
    cels: new Set(),
    compositions: new Set(),
    layers: new Set(),
    variantSets: new Set(),
    collisionSets: new Set(),
  };
  const allocate = (
    collection: DuplicateCollection,
    path: string,
  ): string | ProjectCommandDiagnostic => {
    const id = context.nextId();
    const invalid = requireEntityId(id, path);
    if (invalid) return invalid;
    if (hasOwn(original[collection], id) || allocated[collection].has(id)) {
      return duplicateEntityDiagnostic(collection, id, path);
    }
    allocated[collection].add(id);
    return id;
  };

  const duplicateCelId = allocate("cels", "$.generatedIds.cel");
  if (typeof duplicateCelId !== "string") return commandFailure(original, [duplicateCelId]);
  const changedCompositionIds: string[] = [];
  const changedLayerIds: string[] = [];
  const changedVariantSetIds: string[] = [];
  const changedCollisionSetIds: string[] = [];

  const duplicateComposition = (
    sourceCompositionId: string,
    owner: CompositionOwner,
    path: string,
  ): string | ProjectCommandDiagnostic => {
    const sourceComposition = original.compositions[sourceCompositionId];
    if (!sourceComposition) {
      return missingEntityDiagnostic("compositions", sourceCompositionId, path);
    }
    const compositionId = allocate("compositions", `${path}.compositionId`);
    if (typeof compositionId !== "string") return compositionId;
    const layerIds: string[] = [];
    for (let layerIndex = 0; layerIndex < sourceComposition.layerIds.length; layerIndex += 1) {
      const sourceLayerId = sourceComposition.layerIds[layerIndex];
      const sourceLayer = original.layers[sourceLayerId];
      if (!sourceLayer) return missingEntityDiagnostic("layers", sourceLayerId, `${path}.layerIds[${layerIndex}]`);
      const layerId = allocate("layers", `${path}.layerIds[${layerIndex}]`);
      if (typeof layerId !== "string") return layerId;
      const layer: Layer = {
        ...cloneCommandPayload(sourceLayer),
        id: layerId,
        compositionId,
        createdAt: now,
        updatedAt: now,
      };
      setRecordValue(prepared.layers, layerId, layer);
      layerIds.push(layerId);
      changedLayerIds.push(layerId);
    }
    const composition: Composition = {
      ...cloneCommandPayload(sourceComposition),
      id: compositionId,
      owner: cloneCommandPayload(owner),
      layerIds,
      createdAt: now,
      updatedAt: now,
    };
    setRecordValue(prepared.compositions, compositionId, composition);
    changedCompositionIds.push(compositionId);
    for (const collisionSetId of Object.keys(original.collisionSets).sort()) {
      const sourceCollisionSet = original.collisionSets[collisionSetId];
      if (
        sourceCollisionSet.owner.type !== "composition" ||
        sourceCollisionSet.owner.compositionId !== sourceCompositionId
      ) {
        continue;
      }
      const duplicateCollisionSetId = allocate(
        "collisionSets",
        `${path}.collisionSets.${collisionSetId}`,
      );
      if (typeof duplicateCollisionSetId !== "string") return duplicateCollisionSetId;
      const collisionSet: CollisionSet = {
        ...cloneCommandPayload(sourceCollisionSet),
        id: duplicateCollisionSetId,
        owner: { type: "composition", compositionId },
        createdAt: now,
        updatedAt: now,
      };
      setRecordValue(prepared.collisionSets, duplicateCollisionSetId, collisionSet);
      changedCollisionSetIds.push(duplicateCollisionSetId);
    }
    return compositionId;
  };

  let duplicateSource = cloneCommandPayload(sourceCel.source);
  if (sourceCel.source.type === "composition") {
    const compositionId = duplicateComposition(
      sourceCel.source.compositionId,
      { type: "cel", celId: duplicateCelId },
      "$.generatedGraph.composition",
    );
    if (typeof compositionId !== "string") return commandFailure(original, [compositionId]);
    duplicateSource = { type: "composition", compositionId };
  } else if (sourceCel.source.type === "variantSet") {
    const sourceVariantSet = original.variantSets[sourceCel.source.variantSetId];
    if (!sourceVariantSet) {
      return commandFailure(original, [
        missingEntityDiagnostic("variantSets", sourceCel.source.variantSetId, "$.cel.source.variantSetId"),
      ]);
    }
    const variantSetId = allocate("variantSets", "$.generatedGraph.variantSetId");
    if (typeof variantSetId !== "string") return commandFailure(original, [variantSetId]);
    const variants: VariantSet["variants"] = {};
    for (const variant of VARIANT_KEYS) {
      const sourceCompositionId = sourceVariantSet.variants[variant];
      if (!sourceCompositionId) continue;
      const compositionId = duplicateComposition(
        sourceCompositionId,
        { type: "variantSet", variantSetId, variant },
        `$.generatedGraph.variants.${variant}`,
      );
      if (typeof compositionId !== "string") return commandFailure(original, [compositionId]);
      variants[variant] = compositionId;
    }
    const variantSet: VariantSet = {
      ...cloneCommandPayload(sourceVariantSet),
      id: variantSetId,
      celId: duplicateCelId,
      variants,
      createdAt: now,
      updatedAt: now,
    };
    setRecordValue(prepared.variantSets, variantSetId, variantSet);
    changedVariantSetIds.push(variantSetId);
    duplicateSource = { type: "variantSet", variantSetId };
  }

  const duplicateCel: Cel = {
    ...cloneCommandPayload(sourceCel),
    id: duplicateCelId,
    source: duplicateSource,
    createdAt: now,
    updatedAt: now,
  };
  setRecordValue(prepared.cels, duplicateCelId, duplicateCel);
  const order = prepared.sequences[sequence.id].celIds;
  prepared.sequences[sequence.id].celIds = [
    ...order.slice(0, index),
    duplicateCelId,
    ...order.slice(index),
  ];

  for (const collisionSetId of Object.keys(original.collisionSets).sort()) {
    const sourceCollisionSet = original.collisionSets[collisionSetId];
    if (sourceCollisionSet.owner.type !== "cel" || sourceCollisionSet.owner.celId !== sourceCel.id) continue;
    const duplicateCollisionSetId = allocate(
      "collisionSets",
      `$.generatedGraph.collisionSets.${collisionSetId}`,
    );
    if (typeof duplicateCollisionSetId !== "string") {
      return commandFailure(original, [duplicateCollisionSetId]);
    }
    const collisionSet: CollisionSet = {
      ...cloneCommandPayload(sourceCollisionSet),
      id: duplicateCollisionSetId,
      owner: { type: "cel", celId: duplicateCelId },
      createdAt: now,
      updatedAt: now,
    };
    setRecordValue(prepared.collisionSets, duplicateCollisionSetId, collisionSet);
    changedCollisionSetIds.push(duplicateCollisionSetId);
  }

  prepared.updatedAt = now;
  const compositionIds = sortedUniqueIds(changedCompositionIds);
  const layerIds = sortedUniqueIds(changedLayerIds);
  const variantSetIds = sortedUniqueIds(changedVariantSetIds);
  const collisionSetIds = sortedUniqueIds(changedCollisionSetIds);
  return finalizeCommandMutation(
    original,
    prepared,
    {
      cels: [duplicateCelId],
      sequences: [sequence.id],
      ...(compositionIds.length > 0 ? { compositions: compositionIds } : {}),
      ...(layerIds.length > 0 ? { layers: layerIds } : {}),
      ...(variantSetIds.length > 0 ? { variantSets: variantSetIds } : {}),
      ...(collisionSetIds.length > 0 ? { collisionSets: collisionSetIds } : {}),
    },
    directCommandImpact([
      entityReference("cels", sourceCel.id),
      entityReference("cels", duplicateCelId),
      entityReference("sequences", sequence.id),
      ...compositionIds.map((id) => entityReference("compositions", id)),
      ...layerIds.map((id) => entityReference("layers", id)),
      ...variantSetIds.map((id) => entityReference("variantSets", id)),
      ...collisionSetIds.map((id) => entityReference("collisionSets", id)),
    ]),
    { type: "cel.remove", celId: duplicateCelId, policy: "cascade" },
  );
}

function shapeIndex(
  set: CollisionSet,
  shapeId: unknown,
): number | ProjectCommandDiagnostic {
  const idDiagnostic = requireEntityId(shapeId, "$.shapeId");
  if (idDiagnostic) return idDiagnostic;
  const index = set.shapes.findIndex((shape) => shape.id === shapeId);
  if (index < 0) {
    return commandDiagnostic(
      "ENTITY_NOT_FOUND",
      `Collision shape ${String(shapeId)} was not found.`,
      "$.shapeId",
      entityReference("collisionSets", set.id),
    );
  }
  return index;
}

function applyCollisionSetCreate(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "collisionSet.create" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const recordDiagnostic = requirePlainRecord(command.collisionSet, "$.collisionSet", "CollisionSet");
  if (recordDiagnostic) return commandFailure(original, [recordDiagnostic]);
  const set = command.collisionSet as CollisionSet;
  const idDiagnostic = requireEntityId(set.id, "$.collisionSet.id");
  if (idDiagnostic) return commandFailure(original, [idDiagnostic]);
  if (hasOwn(original.collisionSets, set.id)) {
    return commandFailure(original, [duplicateEntityDiagnostic("collisionSets", set.id, "$.collisionSet.id")]);
  }
  const ownerDiagnostic = validateCollisionOwner(original, set.owner, "$.collisionSet.owner");
  if (ownerDiagnostic) return commandFailure(original, [ownerDiagnostic]);
  if (!Array.isArray(set.shapes)) {
    return commandFailure(original, [invalidPatch("CollisionSet shapes must be an array.", "$.collisionSet.shapes")]);
  }

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  setRecordValue(prepared.collisionSets, set.id, cloneCommandPayload(set));
  prepared.updatedAt = context.now();
  return finalizeCommandMutation(
    original,
    prepared,
    { collisionSets: [set.id] },
    directCommandImpact([entityReference("collisionSets", set.id)]),
    { type: "collisionSet.remove", collisionSetId: set.id },
  );
}

function existingCollisionSet(
  original: StudioProjectV1,
  id: unknown,
): CollisionSet | ProjectCommandResult {
  const idDiagnostic = requireEntityId(id, "$.collisionSetId");
  if (idDiagnostic) return commandFailure(original, [idDiagnostic]);
  if (!hasOwn(original.collisionSets, id as string)) {
    return commandFailure(original, [missingEntityDiagnostic("collisionSets", id, "$.collisionSetId")]);
  }
  return original.collisionSets[id as string];
}

function applyCollisionAdd(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "collision.add" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const set = existingCollisionSet(original, command.collisionSetId);
  if ("ok" in set) return set;
  const recordDiagnostic = requirePlainRecord(command.shape, "$.shape", "Collision shape");
  if (recordDiagnostic) return commandFailure(original, [recordDiagnostic]);
  const shape = command.shape as CollisionShape;
  const idDiagnostic = requireEntityId(shape.id, "$.shape.id");
  if (idDiagnostic) return commandFailure(original, [idDiagnostic]);
  if (set.shapes.some((item) => item.id === shape.id)) {
    return commandFailure(original, [
      commandDiagnostic(
        "ENTITY_ALREADY_EXISTS",
        `Collision shape ${shape.id} already exists.`,
        "$.shape.id",
        entityReference("collisionSets", set.id),
      ),
    ]);
  }
  const index = commandInsertionIndex(command.atIndex, set.shapes.length, "$.atIndex");
  if (typeof index !== "number") return commandFailure(original, [index]);

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  const target = prepared.collisionSets[set.id];
  target.shapes = [
    ...target.shapes.slice(0, index),
    cloneCommandPayload(shape),
    ...target.shapes.slice(index),
  ];
  const now = context.now();
  target.updatedAt = now;
  prepared.updatedAt = now;
  return finalizeCommandMutation(
    original,
    prepared,
    { collisionSets: [set.id] },
    directCommandImpact([entityReference("collisionSets", set.id)]),
    { type: "collision.remove", collisionSetId: set.id, shapeId: shape.id },
  );
}

function applyCollisionUpdate(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "collision.update" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const set = existingCollisionSet(original, command.collisionSetId);
  if ("ok" in set) return set;
  const index = shapeIndex(set, command.shapeId);
  if (typeof index !== "number") return commandFailure(original, [index]);
  const patchDiagnostic = validatePatch(
    command.patch,
    COLLISION_PATCH_FIELDS,
    OPTIONAL_COLLISION_FIELDS,
    "collision shape",
  );
  if (patchDiagnostic) return commandFailure(original, [patchDiagnostic]);

  const previous = set.shapes[index] as unknown as Record<string, unknown>;
  const patch = command.patch as unknown as Record<string, unknown>;
  const patchKeys = ownPatchKeys(patch);
  const changesShape = patchKeys.some((key) => patch[key] === undefined
    ? hasOwn(previous, key)
    : !jsonValuesEqual(previous[key], patch[key]));
  const direct = directCommandImpact([entityReference("collisionSets", set.id)]);
  if (!changesShape) return noChangeCommandResult(original, direct, cloneCommandPayload(command));

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  const target = prepared.collisionSets[set.id].shapes[index] as unknown as Record<string, unknown>;
  const inversePatch: Record<string, unknown> = {};
  for (const key of patchKeys) {
    inversePatch[key] = hasOwn(previous, key) ? cloneCommandPayload(previous[key]) : undefined;
    if (patch[key] === undefined) delete target[key];
    else target[key] = cloneCommandPayload(patch[key]);
  }
  const now = context.now();
  prepared.collisionSets[set.id].updatedAt = now;
  prepared.updatedAt = now;
  return finalizeCommandMutation(
    original,
    prepared,
    { collisionSets: [set.id] },
    direct,
    {
      type: "collision.update",
      collisionSetId: set.id,
      shapeId: command.shapeId,
      patch: inversePatch as Extract<ProjectCommand, { type: "collision.update" }>["patch"],
    },
  );
}

function applyCollisionRemove(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "collision.remove" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const set = existingCollisionSet(original, command.collisionSetId);
  if ("ok" in set) return set;
  const index = shapeIndex(set, command.shapeId);
  if (typeof index !== "number") return commandFailure(original, [index]);
  const removed = cloneCommandPayload(set.shapes[index]);

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  prepared.collisionSets[set.id].shapes.splice(index, 1);
  const now = context.now();
  prepared.collisionSets[set.id].updatedAt = now;
  prepared.updatedAt = now;
  return finalizeCommandMutation(
    original,
    prepared,
    { collisionSets: [set.id] },
    directCommandImpact([entityReference("collisionSets", set.id)]),
    { type: "collision.add", collisionSetId: set.id, shape: removed, atIndex: index },
  );
}

/** Apply the minimal sequence/cel/collision family; other command types are unhandled. */
export function applyAnimationFamilyCommand(
  project: StudioProjectV1,
  command: ProjectCommand,
  context: ProjectCommandContext,
): ProjectCommandResult | undefined {
  try {
    if (command === null || typeof command !== "object") return malformedCommandFailure(project);
    const type = (command as { type?: unknown }).type;
    if (typeof type !== "string") return malformedCommandFailure(project);
    switch (type) {
      case "sequence.create":
        return applySequenceCreate(project, command as Extract<FamilyCommand, { type: "sequence.create" }>, context);
      case "sequence.update":
        return applySequenceUpdate(project, command as Extract<FamilyCommand, { type: "sequence.update" }>, context);
      case "cel.add":
        return applyCelAdd(project, command as Extract<FamilyCommand, { type: "cel.add" }>, context);
      case "cel.update":
        return applyCelUpdate(project, command as Extract<FamilyCommand, { type: "cel.update" }>, context);
      case "cel.reorder":
        return applyCelReorder(project, command as Extract<FamilyCommand, { type: "cel.reorder" }>, context);
      case "cel.duplicate":
        return applyCelDuplicate(project, command as Extract<FamilyCommand, { type: "cel.duplicate" }>, context);
      case "collisionSet.create":
        return applyCollisionSetCreate(project, command as Extract<FamilyCommand, { type: "collisionSet.create" }>, context);
      case "collision.add":
        return applyCollisionAdd(project, command as Extract<FamilyCommand, { type: "collision.add" }>, context);
      case "collision.update":
        return applyCollisionUpdate(project, command as Extract<FamilyCommand, { type: "collision.update" }>, context);
      case "collision.remove":
        return applyCollisionRemove(project, command as Extract<FamilyCommand, { type: "collision.remove" }>, context);
      default:
        return undefined;
    }
  } catch {
    return malformedCommandFailure(project);
  }
}
