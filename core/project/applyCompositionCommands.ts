import type {
  Composition,
  Layer,
  StudioProjectV1,
  VariantKey,
} from "./schema";
import {
  cloneCommandPayload,
  commandDiagnostic,
  commandFailure,
  commandInsertionIndex,
  commandReorderIndex,
  duplicateEntityDiagnostic,
  directCommandImpact,
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
  EntityReference,
  CompositionPatch,
  LayerPatch,
  ProjectCommand,
  ProjectCommandContext,
  ProjectCommandDiagnostic,
  ProjectCommandInverse,
  ProjectCommandResult,
} from "./commands";
import { isEntityId, isISO8601Timestamp } from "./primitives";

const MAX_COMPOSITION_EDGE = 16_384;
const MAX_COMPOSITION_PIXELS = 64 * 1024 * 1024;
const MAX_COMPOSITION_NAME_LENGTH = 256;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const COMPOSITION_PATCH_FIELDS = [
  "name",
  "width",
  "height",
  "background",
  "updatedAt",
] as const;

const LAYER_PATCH_FIELDS = [
  "name",
  "source",
  "transform",
  "visible",
  "locked",
  "updatedAt",
] as const;

type LayerPatchField = (typeof LAYER_PATCH_FIELDS)[number];

const OPTIONAL_LAYER_FIELDS: readonly LayerPatchField[] = ["name", "visible", "locked"];
const VARIANT_KEYS: readonly VariantKey[] = ["A", "B", "C", "D"];

type FamilyCommand = Extract<
  ProjectCommand,
  {
    type:
      | "composition.create"
      | "composition.update"
      | "layer.add"
      | "layer.update"
      | "layer.reorder"
      | "layer.duplicate"
      | "variant.activate";
  }
>;

function invalidPatch(message: string, path = "$"): ProjectCommandDiagnostic {
  return commandDiagnostic("INVALID_PATCH", message, path);
}

function invalidId(value: unknown, path: string): ProjectCommandDiagnostic {
  return invalidPatch(`Entity id must be a non-empty string; received ${String(value)}.`, path);
}

function requireEntityId(value: unknown, path: string): ProjectCommandDiagnostic | undefined {
  return isEntityId(value) ? undefined : invalidId(value, path);
}

function requirePlainRecord(
  value: unknown,
  path: string,
  label: string,
): ProjectCommandDiagnostic | undefined {
  return isPlainRecord(value) ? undefined : invalidPatch(`${label} must be a plain object.`, path);
}

function requireArray(
  value: unknown,
  path: string,
  label: string,
): ProjectCommandDiagnostic | undefined {
  return Array.isArray(value) ? undefined : invalidPatch(`${label} must be an array.`, path);
}

function duplicatePayloadIds(
  values: readonly unknown[],
  collection: EntityReference["collection"],
  path: string,
): ProjectCommandDiagnostic | undefined {
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!isPlainRecord(value)) {
      return invalidPatch("Entity payload must be a plain object.", `${path}[${index}]`);
    }
    const id = value.id;
    const idDiagnostic = requireEntityId(id, `${path}[${index}].id`);
    if (idDiagnostic) return idDiagnostic;
    const validId = id as string;
    if (seen.has(validId)) return duplicateEntityDiagnostic(collection, validId, `${path}[${index}].id`);
    seen.add(validId);
  }
  return undefined;
}

function setRecordValue<T extends Record<string, unknown>>(record: T, key: string, value: unknown): void {
  // Defining the property avoids the special __proto__ setter when an otherwise
  // valid EntityId happens to use that spelling.
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function validateLayerSourceReference(
  original: StudioProjectV1,
  source: unknown,
  path: string,
): ProjectCommandDiagnostic | undefined {
  const recordDiagnostic = requirePlainRecord(source, path, "Layer source");
  if (recordDiagnostic) return recordDiagnostic;
  const sourceRecord = source as Record<string, unknown>;
  const sourceType = sourceRecord.type;
  if (sourceType === "composition") {
    // Nested composition is a document invariant. Let candidate validation
    // publish its dedicated INVARIANT_VIOLATION diagnostic.
    return undefined;
  }
  if (sourceType !== "asset" && sourceType !== "region") {
    return invalidPatch("Layer source type must be asset or region.", `${path}.type`);
  }
  const idDiagnostic = requireEntityId(sourceRecord.id, `${path}.id`);
  if (idDiagnostic) return idDiagnostic;
  const sourceId = sourceRecord.id as string;
  const collection = sourceType === "asset" ? "assets" : "regions";
  if (!hasOwn(original[collection], sourceId)) {
    return missingEntityDiagnostic(collection, sourceId, `${path}.id`);
  }
  return undefined;
}

function validateCompositionCreatePayload(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "composition.create" }>,
): ProjectCommandDiagnostic | undefined {
  const compositionRecordDiagnostic = requirePlainRecord(
    command.composition,
    "$.composition",
    "composition.create composition",
  );
  if (compositionRecordDiagnostic) return compositionRecordDiagnostic;
  const layersDiagnostic = requireArray(command.layers, "$.layers", "composition.create layers");
  if (layersDiagnostic) return layersDiagnostic;

  const composition = command.composition as unknown as Record<string, unknown>;
  const compositionIdDiagnostic = requireEntityId(composition.id, "$.composition.id");
  if (compositionIdDiagnostic) return compositionIdDiagnostic;
  const compositionId = composition.id as string;
  if (hasOwn(original.compositions, compositionId)) {
    return duplicateEntityDiagnostic("compositions", compositionId, "$.composition.id");
  }

  const ownerDiagnostic = requirePlainRecord(composition.owner, "$.composition.owner", "Composition owner");
  if (ownerDiagnostic) return ownerDiagnostic;
  if ((composition.owner as Record<string, unknown>).type !== "project") {
    return commandDiagnostic(
      "PRECONDITION_FAILED",
      "composition.create can only create a project-owned composition.",
      "$.composition.owner",
      entityReference("compositions", compositionId),
    );
  }

  const layerIdsDiagnostic = requireArray(
    composition.layerIds,
    "$.composition.layerIds",
    "Composition layerIds",
  );
  if (layerIdsDiagnostic) return layerIdsDiagnostic;
  const layers = command.layers as unknown as readonly unknown[];
  const duplicateLayer = duplicatePayloadIds(layers, "layers", "$.layers");
  if (duplicateLayer) return duplicateLayer;

  const layerIds = composition.layerIds as unknown[];
  if (layerIds.length !== layers.length) {
    return commandDiagnostic(
      "PRECONDITION_FAILED",
      "Composition layerIds must contain exactly the payload layers in order.",
      "$.composition.layerIds",
      entityReference("compositions", compositionId),
    );
  }

  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index] as Record<string, unknown>;
    const layerId = layer.id as string;
    const layerIdDiagnostic = requireEntityId(layerId, `$.layers[${index}].id`);
    if (layerIdDiagnostic) return layerIdDiagnostic;
    const compositionLayerId = layerIds[index];
    const orderedIdDiagnostic = requireEntityId(compositionLayerId, `$.composition.layerIds[${index}]`);
    if (orderedIdDiagnostic) return orderedIdDiagnostic;
    if (compositionLayerId !== layerId) {
      return commandDiagnostic(
        "PRECONDITION_FAILED",
        "Composition layerIds must preserve the payload layer order.",
        `$.composition.layerIds[${index}]`,
        entityReference("compositions", compositionId),
      );
    }
    if (hasOwn(original.layers, layerId)) {
      return duplicateEntityDiagnostic("layers", layerId, `$.layers[${index}].id`);
    }
    const layerCompositionIdDiagnostic = requireEntityId(
      layer.compositionId,
      `$.layers[${index}].compositionId`,
    );
    if (layerCompositionIdDiagnostic) return layerCompositionIdDiagnostic;
    if (layer.compositionId !== compositionId) {
      return commandDiagnostic(
        "PRECONDITION_FAILED",
        "Layer compositionId must match the composition being created.",
        `$.layers[${index}].compositionId`,
        entityReference("compositions", compositionId),
      );
    }
    const sourceDiagnostic = validateLayerSourceReference(
      original,
      layer.source,
      `$.layers[${index}].source`,
    );
    if (sourceDiagnostic) return sourceDiagnostic;
  }

  return undefined;
}

function applyCompositionCreate(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "composition.create" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const payloadDiagnostic = validateCompositionCreatePayload(original, command);
  if (payloadDiagnostic) return commandFailure(original, [payloadDiagnostic]);

  const composition = command.composition;
  const layers = command.layers;
  const compositionId = composition.id;
  const layerIds = composition.layerIds;
  const index = commandInsertionIndex(
    command.atIndex,
    original.rootOrder.compositionIds.length,
    "$.atIndex",
  );
  if (typeof index !== "number") return commandFailure(original, [index]);

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  setRecordValue(prepared.compositions, compositionId, cloneCommandPayload(composition));
  for (const layer of layers) {
    setRecordValue(prepared.layers, layer.id, cloneCommandPayload(layer));
  }
  const compositionOrder = prepared.rootOrder.compositionIds;
  prepared.rootOrder.compositionIds = [
    ...compositionOrder.slice(0, index),
    compositionId,
    ...compositionOrder.slice(index),
  ];
  prepared.updatedAt = context.now();

  const inverseCommands: ProjectCommand[] = [
    ...[...layerIds].reverse().map(
      (layerId): ProjectCommand => ({ type: "layer.remove", layerId }),
    ),
    { type: "composition.remove", compositionId, policy: "reject" },
  ];
  const inverse: ProjectCommandInverse = { type: "command.batch", commands: inverseCommands };
  return finalizeCommandMutation(
    original,
    prepared,
    {
      compositions: [compositionId],
      layers: [...layerIds],
      rootOrder: [compositionId],
    },
    directCommandImpact([
      entityReference("compositions", compositionId),
      ...layerIds.map((layerId) => entityReference("layers", layerId)),
    ]),
    inverse,
  );
}

function validateLayerAddPayload(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "layer.add" }>,
): ProjectCommandDiagnostic | undefined {
  const compositionIdDiagnostic = requireEntityId(command.compositionId, "$.compositionId");
  if (compositionIdDiagnostic) return compositionIdDiagnostic;
  if (!hasOwn(original.compositions, command.compositionId)) {
    return missingEntityDiagnostic("compositions", command.compositionId, "$.compositionId");
  }
  const layerDiagnostic = requirePlainRecord(command.layer, "$.layer", "layer.add layer");
  if (layerDiagnostic) return layerDiagnostic;
  const layer = command.layer as unknown as Record<string, unknown>;
  const layerIdDiagnostic = requireEntityId(layer.id, "$.layer.id");
  if (layerIdDiagnostic) return layerIdDiagnostic;
  const layerId = layer.id as string;
  if (hasOwn(original.layers, layerId)) {
    return duplicateEntityDiagnostic("layers", layerId, "$.layer.id");
  }
  const layerCompositionIdDiagnostic = requireEntityId(layer.compositionId, "$.layer.compositionId");
  if (layerCompositionIdDiagnostic) return layerCompositionIdDiagnostic;
  if (layer.compositionId !== command.compositionId) {
    return commandDiagnostic(
      "PRECONDITION_FAILED",
      "Layer compositionId must match compositionId.",
      "$.layer.compositionId",
      entityReference("compositions", command.compositionId),
    );
  }
  return validateLayerSourceReference(original, layer.source, "$.layer.source");
}

function applyLayerAdd(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "layer.add" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const payloadDiagnostic = validateLayerAddPayload(original, command);
  if (payloadDiagnostic) return commandFailure(original, [payloadDiagnostic]);
  const composition = original.compositions[command.compositionId];
  const index = commandInsertionIndex(command.atIndex, composition.layerIds.length, "$.atIndex");
  if (typeof index !== "number") return commandFailure(original, [index]);

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  setRecordValue(prepared.layers, command.layer.id, cloneCommandPayload(command.layer));
  const preparedComposition = prepared.compositions[command.compositionId];
  const oldOrder = preparedComposition.layerIds;
  preparedComposition.layerIds = [
    ...oldOrder.slice(0, index),
    command.layer.id,
    ...oldOrder.slice(index),
  ];
  prepared.updatedAt = context.now();
  const inverse: ProjectCommandInverse = { type: "layer.remove", layerId: command.layer.id };
  return finalizeCommandMutation(
    original,
    prepared,
    { layers: [command.layer.id], compositions: [command.compositionId] },
    directCommandImpact([
      entityReference("compositions", command.compositionId),
      entityReference("layers", command.layer.id),
    ]),
    inverse,
  );
}

function validateLayerPatch(
  original: StudioProjectV1,
  patch: unknown,
): ProjectCommandDiagnostic | undefined {
  const patchDiagnostic = requirePlainRecord(patch, "$.patch", "layer.update patch");
  if (patchDiagnostic) return patchDiagnostic;
  const patchRecord = patch as Record<string, unknown>;
  for (const ownKey of Reflect.ownKeys(patchRecord)) {
    if (typeof ownKey !== "string") {
      return invalidPatch("Symbol fields cannot be patched on a layer.", "$.patch");
    }
    const key = ownKey;
    if (!(LAYER_PATCH_FIELDS as readonly string[]).includes(key)) {
      return invalidPatch(`Field ${key} cannot be patched on a layer.`, `$.patch.${key}`);
    }
    const value = patchRecord[key];
    if (value === undefined && !OPTIONAL_LAYER_FIELDS.includes(key as LayerPatchField)) {
      return invalidPatch(`Field ${key} is required and cannot be removed.`, `$.patch.${key}`);
    }
    if (key === "source" && value !== undefined) {
      const sourceDiagnostic = validateLayerSourceReference(original, value, "$.patch.source");
      if (sourceDiagnostic) return sourceDiagnostic;
    }
  }
  return undefined;
}

function ownPatchKeys(record: Record<string, unknown>): string[] {
  return Reflect.ownKeys(record).filter((key): key is string => typeof key === "string");
}

function hasUnsafeNameControls(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function validateCompositionPatch(
  original: StudioProjectV1,
  compositionId: string,
  patch: unknown,
): ProjectCommandDiagnostic | undefined {
  const patchDiagnostic = requirePlainRecord(patch, "$.patch", "composition.update patch");
  if (patchDiagnostic) return patchDiagnostic;
  const patchRecord = patch as Record<string, unknown>;
  const keys = Reflect.ownKeys(patchRecord);
  if (keys.length === 0) return invalidPatch("composition.update patch cannot be empty.", "$.patch");

  for (const ownKey of keys) {
    if (typeof ownKey !== "string") {
      return invalidPatch("Symbol fields cannot be patched on a composition.", "$.patch");
    }
    if (!(COMPOSITION_PATCH_FIELDS as readonly string[]).includes(ownKey)) {
      return invalidPatch(`Field ${ownKey} cannot be patched on a composition.`, `$.patch.${ownKey}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(patchRecord, ownKey);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      return invalidPatch(
        `Field ${ownKey} on a composition patch must be an own enumerable data property.`,
        `$.patch.${ownKey}`,
      );
    }
    if (descriptor.value === undefined) {
      return invalidPatch(`Field ${ownKey} cannot be undefined.`, `$.patch.${ownKey}`);
    }
  }

  const read = (key: string): unknown => Object.getOwnPropertyDescriptor(patchRecord, key)?.value;
  if (hasOwn(patchRecord, "name")) {
    const name = read("name");
    if (
      typeof name !== "string" ||
      name.trim().length === 0 ||
      name.length > MAX_COMPOSITION_NAME_LENGTH ||
      hasUnsafeNameControls(name)
    ) {
      return invalidPatch(
        `Composition name must be a non-empty control-free string of at most ${MAX_COMPOSITION_NAME_LENGTH} characters.`,
        "$.patch.name",
      );
    }
  }

  for (const key of ["width", "height"] as const) {
    if (!hasOwn(patchRecord, key)) continue;
    const value = read(key);
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      Object.is(value, -0) ||
      value <= 0 ||
      value > MAX_COMPOSITION_EDGE
    ) {
      return invalidPatch(
        `Composition ${key} must be a positive safe integer no greater than ${MAX_COMPOSITION_EDGE}.`,
        `$.patch.${key}`,
      );
    }
  }

  const width = hasOwn(patchRecord, "width") ? read("width") : original.compositions[compositionId].width;
  const height = hasOwn(patchRecord, "height") ? read("height") : original.compositions[compositionId].height;
  if (
    typeof width === "number" &&
    typeof height === "number" &&
    width * height > MAX_COMPOSITION_PIXELS
  ) {
    return invalidPatch(
      `Composition canvas cannot exceed ${MAX_COMPOSITION_PIXELS} pixels.`,
      "$.patch",
    );
  }

  if (hasOwn(patchRecord, "background")) {
    const background = read("background");
    if (background !== null && (typeof background !== "string" || !HEX_COLOR.test(background))) {
      return invalidPatch(
        "Composition background must be null for transparency or a CSS hex color.",
        "$.patch.background",
      );
    }
  }

  if (hasOwn(patchRecord, "updatedAt") && !isISO8601Timestamp(read("updatedAt"))) {
    return invalidPatch(
      "Composition updatedAt must be an ISO-8601 timestamp with a timezone.",
      "$.patch.updatedAt",
    );
  }
  return undefined;
}

function applyCompositionUpdate(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "composition.update" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const compositionIdDiagnostic = requireEntityId(command.compositionId, "$.compositionId");
  if (compositionIdDiagnostic) return commandFailure(original, [compositionIdDiagnostic]);
  if (!hasOwn(original.compositions, command.compositionId)) {
    return commandFailure(original, [
      missingEntityDiagnostic("compositions", command.compositionId, "$.compositionId"),
    ]);
  }
  const patchDiagnostic = validateCompositionPatch(original, command.compositionId, command.patch);
  if (patchDiagnostic) return commandFailure(original, [patchDiagnostic]);

  const previous = original.compositions[command.compositionId] as unknown as Record<string, unknown>;
  const patchRecord = command.patch as unknown as Record<string, unknown>;
  const patchKeys = ownPatchKeys(patchRecord);
  const changesComposition = patchKeys.some((key) =>
    !jsonValuesEqual(previous[key], Object.getOwnPropertyDescriptor(patchRecord, key)?.value));
  const direct = directCommandImpact([
    entityReference("compositions", command.compositionId),
  ]);
  if (!changesComposition) {
    return noChangeCommandResult(original, direct, cloneCommandPayload(command));
  }

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  const preparedComposition = prepared.compositions[command.compositionId] as Composition & Record<string, unknown>;
  const inversePatch: Record<string, unknown> = {};
  let semanticInverseIsExact = true;
  for (const key of patchKeys) {
    if (hasOwn(previous, key)) inversePatch[key] = cloneCommandPayload(previous[key]);
    else semanticInverseIsExact = false;
    preparedComposition[key] = cloneCommandPayload(
      Object.getOwnPropertyDescriptor(patchRecord, key)?.value,
    );
  }
  const now = context.now();
  if (!patchKeys.includes("updatedAt")) {
    inversePatch.updatedAt = previous.updatedAt;
    preparedComposition.updatedAt = now;
  }
  prepared.updatedAt = now;
  const inverse: ProjectCommandInverse = semanticInverseIsExact
    ? {
        type: "composition.update",
        compositionId: command.compositionId,
        patch: inversePatch as CompositionPatch,
      }
    : { type: "project.restoreSnapshot", project: cloneCommandPayload(original) };
  return finalizeCommandMutation(
    original,
    prepared,
    { compositions: [command.compositionId] },
    direct,
    inverse,
  );
}

function applyLayerUpdate(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "layer.update" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const layerIdDiagnostic = requireEntityId(command.layerId, "$.layerId");
  if (layerIdDiagnostic) return commandFailure(original, [layerIdDiagnostic]);
  if (!hasOwn(original.layers, command.layerId)) {
    return commandFailure(original, [missingEntityDiagnostic("layers", command.layerId, "$.layerId")]);
  }
  const layer = original.layers[command.layerId];
  if (!hasOwn(original.compositions, layer.compositionId)) {
    return commandFailure(original, [
      missingEntityDiagnostic("compositions", layer.compositionId, "$.layer.compositionId"),
    ]);
  }
  const patchDiagnostic = validateLayerPatch(original, command.patch);
  if (patchDiagnostic) return commandFailure(original, [patchDiagnostic]);

  const previous = original.layers[command.layerId] as unknown as Record<string, unknown>;
  const patchRecord = command.patch as unknown as Record<string, unknown>;
  const patchKeys = ownPatchKeys(patchRecord);
  const changesLayer = patchKeys.some((key) => patchRecord[key] === undefined
    ? hasOwn(previous, key)
    : !jsonValuesEqual(previous[key], patchRecord[key]));
  const direct = directCommandImpact([entityReference("layers", command.layerId)]);
  if (!changesLayer) return noChangeCommandResult(original, direct, cloneCommandPayload(command));

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  const preparedLayer = prepared.layers[command.layerId] as unknown as Layer & Record<string, unknown>;
  const inversePatch: Record<string, unknown> = {};
  for (const key of patchKeys) {
    if (hasOwn(previous, key)) inversePatch[key] = cloneCommandPayload(previous[key]);
    else inversePatch[key] = undefined;
    const value = patchRecord[key];
    if (value === undefined) delete preparedLayer[key];
    else preparedLayer[key] = cloneCommandPayload(value);
  }
  const now = context.now();
  if (!patchKeys.includes("updatedAt")) {
    inversePatch.updatedAt = previous.updatedAt;
    preparedLayer.updatedAt = now;
  }
  prepared.updatedAt = now;
  const inverse: ProjectCommandInverse = {
    type: "layer.update",
    layerId: command.layerId,
    patch: inversePatch as LayerPatch,
  };
  return finalizeCommandMutation(
    original,
    prepared,
    { layers: [command.layerId] },
    direct,
    inverse,
  );
}

function applyLayerReorder(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "layer.reorder" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const layerIdDiagnostic = requireEntityId(command.layerId, "$.layerId");
  if (layerIdDiagnostic) return commandFailure(original, [layerIdDiagnostic]);
  if (!hasOwn(original.layers, command.layerId)) {
    return commandFailure(original, [missingEntityDiagnostic("layers", command.layerId, "$.layerId")]);
  }
  const layer = original.layers[command.layerId];
  if (!hasOwn(original.compositions, layer.compositionId)) {
    return commandFailure(original, [
      missingEntityDiagnostic("compositions", layer.compositionId, "$.layer.compositionId"),
    ]);
  }
  const composition = original.compositions[layer.compositionId];
  const index = commandReorderIndex(command.toIndex, composition.layerIds.length, "$.toIndex");
  if (typeof index !== "number") return commandFailure(original, [index]);
  const fromIndex = composition.layerIds.indexOf(command.layerId);
  if (fromIndex < 0) {
    return commandFailure(original, [
      commandDiagnostic(
        "INVARIANT_VIOLATION",
        `Layer ${command.layerId} is not present in its composition layerIds order.`,
        `$.compositions.${layer.compositionId}.layerIds`,
        entityReference("layers", command.layerId),
      ),
    ]);
  }

  const inverse: ProjectCommandInverse = {
    type: "layer.reorder",
    layerId: command.layerId,
    toIndex: fromIndex,
  };
  const direct = directCommandImpact([
    entityReference("compositions", layer.compositionId),
    entityReference("layers", command.layerId),
  ]);
  if (fromIndex === index) return noChangeCommandResult(original, direct, inverse);

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  const preparedOrder = prepared.compositions[layer.compositionId].layerIds;
  const [moved] = preparedOrder.splice(fromIndex, 1);
  preparedOrder.splice(index, 0, moved);
  prepared.updatedAt = context.now();
  return finalizeCommandMutation(
    original,
    prepared,
    { layers: [command.layerId], compositions: [layer.compositionId] },
    direct,
    inverse,
  );
}

function applyLayerDuplicate(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "layer.duplicate" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const idDiagnostic = requireEntityId(command.layerId, "$.layerId");
  if (idDiagnostic) return commandFailure(original, [idDiagnostic]);
  if (!hasOwn(original.layers, command.layerId)) {
    return commandFailure(original, [missingEntityDiagnostic("layers", command.layerId, "$.layerId")]);
  }
  const source = original.layers[command.layerId];
  const composition = original.compositions[source.compositionId];
  const sourceIndex = composition.layerIds.indexOf(command.layerId);
  if (sourceIndex < 0) {
    return commandFailure(original, [
      commandDiagnostic(
        "INVARIANT_VIOLATION",
        `Layer ${command.layerId} is not present in its composition order.`,
        `$.compositions.${source.compositionId}.layerIds`,
        entityReference("layers", command.layerId),
      ),
    ]);
  }
  const index = commandInsertionIndex(
    command.atIndex ?? sourceIndex + 1,
    composition.layerIds.length,
    "$.atIndex",
  );
  if (typeof index !== "number") return commandFailure(original, [index]);

  const duplicateId = context.nextId();
  const duplicateIdDiagnostic = requireEntityId(duplicateId, "$.generatedId");
  if (duplicateIdDiagnostic) return commandFailure(original, [duplicateIdDiagnostic]);
  if (hasOwn(original.layers, duplicateId)) {
    return commandFailure(original, [duplicateEntityDiagnostic("layers", duplicateId, "$.generatedId")]);
  }

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  const now = context.now();
  const duplicate: Layer = {
    ...cloneCommandPayload(source),
    id: duplicateId,
    createdAt: now,
    updatedAt: now,
  };
  setRecordValue(prepared.layers, duplicateId, duplicate);
  const order = prepared.compositions[source.compositionId].layerIds;
  prepared.compositions[source.compositionId].layerIds = [
    ...order.slice(0, index),
    duplicateId,
    ...order.slice(index),
  ];
  prepared.updatedAt = now;
  return finalizeCommandMutation(
    original,
    prepared,
    { layers: [duplicateId], compositions: [source.compositionId] },
    directCommandImpact([
      entityReference("layers", command.layerId),
      entityReference("layers", duplicateId),
      entityReference("compositions", source.compositionId),
    ]),
    { type: "layer.remove", layerId: duplicateId },
  );
}

function applyVariantActivate(
  original: StudioProjectV1,
  command: Extract<FamilyCommand, { type: "variant.activate" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const variantSetIdDiagnostic = requireEntityId(command.variantSetId, "$.variantSetId");
  if (variantSetIdDiagnostic) return commandFailure(original, [variantSetIdDiagnostic]);
  if (!hasOwn(original.variantSets, command.variantSetId)) {
    return commandFailure(original, [
      missingEntityDiagnostic("variantSets", command.variantSetId, "$.variantSetId"),
    ]);
  }
  if (!VARIANT_KEYS.includes(command.variant)) {
    return commandFailure(original, [
      invalidPatch("variant must be one of A, B, C or D.", "$.variant"),
    ]);
  }
  if (!hasOwn(command as unknown as object, "updatedAt")) {
    return commandFailure(original, [
      invalidPatch("variant.activate requires updatedAt.", "$.updatedAt"),
    ]);
  }
  const variantSet = original.variantSets[command.variantSetId];
  if (!isPlainRecord(variantSet.variants) || !hasOwn(variantSet.variants, command.variant)) {
    return commandFailure(original, [
      commandDiagnostic(
        "PRECONDITION_FAILED",
        `Variant ${command.variant} is not present in the variant set.`,
        "$.variant",
        entityReference("variantSets", command.variantSetId),
      ),
    ]);
  }
  const compositionId = variantSet.variants[command.variant];
  const compositionIdDiagnostic = requireEntityId(compositionId, `$.variantSet.variants.${command.variant}`);
  if (compositionIdDiagnostic) return commandFailure(original, [compositionIdDiagnostic]);
  const validCompositionId = compositionId as string;
  if (!hasOwn(original.compositions, validCompositionId)) {
    return commandFailure(original, [
      missingEntityDiagnostic("compositions", validCompositionId, `$.variantSet.variants.${command.variant}`),
    ]);
  }

  const direct = directCommandImpact([entityReference("variantSets", command.variantSetId)]);
  const inverse: ProjectCommandInverse = {
    type: "variant.activate",
    variantSetId: command.variantSetId,
    variant: variantSet.activeVariant,
    updatedAt: variantSet.updatedAt,
  };
  if (
    variantSet.activeVariant === command.variant &&
    variantSet.updatedAt === command.updatedAt
  ) return noChangeCommandResult(original, direct, inverse);

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  const preparedVariantSet = prepared.variantSets[command.variantSetId];
  preparedVariantSet.activeVariant = command.variant;
  preparedVariantSet.updatedAt = command.updatedAt;
  prepared.updatedAt = context.now();
  return finalizeCommandMutation(
    original,
    prepared,
    { variantSets: [command.variantSetId] },
    direct,
    inverse,
  );
}

/**
 * Apply the non-destructive composition/layer/variant command family.
 *
 * Returning undefined is reserved for command types owned by another family;
 * malformed payloads for these five types are always contained as INVALID_PATCH.
 */
export function applyCompositionFamilyCommand(
  project: StudioProjectV1,
  command: ProjectCommand,
  context: ProjectCommandContext,
): ProjectCommandResult | undefined {
  try {
    if (command === null || typeof command !== "object") {
      return malformedCommandFailure(project);
    }
    const type = (command as { type?: unknown }).type;
    if (typeof type !== "string") return malformedCommandFailure(project);
    switch (type) {
      case "composition.create":
        return applyCompositionCreate(project, command as Extract<FamilyCommand, { type: "composition.create" }>, context);
      case "composition.update":
        return applyCompositionUpdate(project, command as Extract<FamilyCommand, { type: "composition.update" }>, context);
      case "layer.add":
        return applyLayerAdd(project, command as Extract<FamilyCommand, { type: "layer.add" }>, context);
      case "layer.update":
        return applyLayerUpdate(project, command as Extract<FamilyCommand, { type: "layer.update" }>, context);
      case "layer.reorder":
        return applyLayerReorder(project, command as Extract<FamilyCommand, { type: "layer.reorder" }>, context);
      case "layer.duplicate":
        return applyLayerDuplicate(project, command as Extract<FamilyCommand, { type: "layer.duplicate" }>, context);
      case "variant.activate":
        return applyVariantActivate(project, command as Extract<FamilyCommand, { type: "variant.activate" }>, context);
      default:
        return undefined;
    }
  } catch {
    return malformedCommandFailure(project);
  }
}
