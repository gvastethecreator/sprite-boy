import type {
  CelSource,
  EntityId,
  ProjectRecordCollection,
  StudioProjectV1,
} from "./schema";
import type {
  ChangedEntityIds,
  CommandImpact,
  EntityReference,
  ProjectCommand,
  ProjectCommandContext,
  ProjectCommandDiagnostic,
  ProjectCommandResult,
  ProjectSnapshotInverse,
} from "./commands";
import {
  cloneCommandPayload,
  commandDiagnostic,
  commandFailure,
  finalizeCommandMutation,
  hasOwn,
  isCommandResult,
  noChangeCommandResult,
  prepareCommandCandidate,
} from "./commandSupport";
import { cloneStudioProject } from "./graph";
import { analyzeProjectCommandImpact } from "./impact";
import { isEntityId } from "./primitives";

const PURE_REMOVE_TYPES = new Set<ProjectCommand["type"]>([
  "asset.remove",
  "region.remove",
  "processingRecipe.remove",
  "artifact.remove",
  "composition.remove",
  "layer.remove",
  "variant.remove",
  "sequence.remove",
  "cel.remove",
  "collisionSet.remove",
]);

type DestructiveCommand = Extract<
  ProjectCommand,
  {
    type:
      | "asset.remove"
      | "region.remove"
      | "processingRecipe.remove"
      | "artifact.remove"
      | "composition.remove"
      | "layer.remove"
      | "variant.replace"
      | "variant.remove"
      | "sequence.remove"
      | "cel.remove"
      | "cel.replaceSource"
      | "collisionSet.remove";
  }
>;

function keyOf(reference: EntityReference): string {
  return JSON.stringify([reference.collection, reference.id]);
}

function failureWithImpact(project: StudioProjectV1, impact: CommandImpact): ProjectCommandResult {
  return { ok: false, project, diagnostics: impact.blockers, impact };
}

function diagnosticFailure(
  project: StudioProjectV1,
  diagnostic: ProjectCommandDiagnostic,
  impact?: CommandImpact,
): ProjectCommandResult {
  return {
    ok: false,
    project,
    diagnostics: [diagnostic],
    ...(impact ? { impact } : {}),
  };
}

function snapshotInverse(project: StudioProjectV1): ProjectSnapshotInverse {
  return { type: "project.restoreSnapshot", project: cloneStudioProject(project) };
}

function appendChanged(
  changed: ChangedEntityIds,
  collection: keyof ChangedEntityIds,
  ids: readonly EntityId[],
): void {
  if (ids.length === 0) return;
  const current = changed[collection] ?? [];
  changed[collection] = [...new Set([...current, ...ids])].sort();
}

function setRecordValue(record: Record<string, unknown>, id: EntityId, value: unknown): void {
  Object.defineProperty(record, id, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function dataValue(value: unknown, key: PropertyKey): unknown {
  if (value === null || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor && descriptor.enumerable
    ? descriptor.value
    : undefined;
}

function denseDataArray(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: unknown[] = [];
  for (const ownKey of Reflect.ownKeys(value)) {
    if (ownKey === "length") continue;
    if (typeof ownKey !== "string" || !/^(0|[1-9]\d*)$/.test(ownKey)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, ownKey);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    result.push(descriptor.value);
  }
  return result;
}

function removeReferences(
  candidate: StudioProjectV1,
  references: readonly EntityReference[],
  now: string,
): ChangedEntityIds {
  const changed: ChangedEntityIds = {};
  const removed = new Set(references.map(keyOf));
  const idsFor = (collection: ProjectRecordCollection): Set<EntityId> =>
    new Set(references.filter((item) => item.collection === collection).map((item) => item.id));
  const removedLayers = idsFor("layers");
  const removedCompositions = idsFor("compositions");
  const removedCels = idsFor("cels");
  const removedSequences = idsFor("sequences");
  const changedCompositions = new Set<EntityId>();
  const changedSequences = new Set<EntityId>();
  const changedVariantSets = new Set<EntityId>();

  for (const layerId of removedLayers) {
    const layer = candidate.layers[layerId];
    if (layer && !removedCompositions.has(layer.compositionId)) changedCompositions.add(layer.compositionId);
  }
  for (const celId of removedCels) {
    const cel = candidate.cels[celId];
    if (cel && !removedSequences.has(cel.sequenceId)) changedSequences.add(cel.sequenceId);
  }
  for (const reference of references) {
    delete candidate[reference.collection][reference.id];
    appendChanged(changed, reference.collection, [reference.id]);
  }

  const oldRoot = JSON.stringify(candidate.rootOrder);
  candidate.rootOrder.assetIds = candidate.rootOrder.assetIds.filter((id) => !removed.has(keyOf({ collection: "assets", id })));
  candidate.rootOrder.regionIds = candidate.rootOrder.regionIds.filter((id) => !removed.has(keyOf({ collection: "regions", id })));
  candidate.rootOrder.compositionIds = candidate.rootOrder.compositionIds.filter((id) => !removed.has(keyOf({ collection: "compositions", id })));
  candidate.rootOrder.sequenceIds = candidate.rootOrder.sequenceIds.filter((id) => !removed.has(keyOf({ collection: "sequences", id })));
  if (JSON.stringify(candidate.rootOrder) !== oldRoot) appendChanged(changed, "rootOrder", references.map(({ id }) => id));

  for (const id of Object.keys(candidate.compositions)) {
    const composition = candidate.compositions[id];
    const next = composition.layerIds.filter((layerId) => !removedLayers.has(layerId));
    if (next.length !== composition.layerIds.length) {
      composition.layerIds = next;
      composition.updatedAt = now;
      changedCompositions.add(id);
    }
  }
  for (const id of Object.keys(candidate.sequences)) {
    const sequence = candidate.sequences[id];
    const next = sequence.celIds.filter((celId) => !removedCels.has(celId));
    if (next.length !== sequence.celIds.length) {
      sequence.celIds = next;
      sequence.updatedAt = now;
      changedSequences.add(id);
    }
  }
  for (const id of Object.keys(candidate.variantSets)) {
    const variantSet = candidate.variantSets[id];
    for (const variant of Object.keys(variantSet.variants) as Array<keyof typeof variantSet.variants>) {
      const compositionId = variantSet.variants[variant];
      if (compositionId && removedCompositions.has(compositionId)) {
        delete variantSet.variants[variant];
        variantSet.updatedAt = now;
        changedVariantSets.add(id);
      }
    }
  }
  appendChanged(changed, "compositions", [...changedCompositions]);
  appendChanged(changed, "sequences", [...changedSequences]);
  appendChanged(changed, "variantSets", [...changedVariantSets]);

  const workspaceBefore = JSON.stringify(candidate.workspace);
  const selectedFields: Array<[keyof StudioProjectV1["workspace"], ProjectRecordCollection]> = [
    ["selectedAssetId", "assets"],
    ["selectedRegionId", "regions"],
    ["selectedCompositionId", "compositions"],
    ["selectedLayerId", "layers"],
    ["selectedVariantSetId", "variantSets"],
    ["selectedSequenceId", "sequences"],
  ];
  for (const [field, collection] of selectedFields) {
    const id = candidate.workspace[field];
    if (typeof id === "string" && removed.has(keyOf({ collection, id }))) {
      delete candidate.workspace[field];
    }
  }
  if (candidate.workspace.selectedCelIds) {
    candidate.workspace.selectedCelIds = candidate.workspace.selectedCelIds.filter((id) => !removedCels.has(id));
  }
  if (JSON.stringify(candidate.workspace) !== workspaceBefore) appendChanged(changed, "workspace", [candidate.id]);
  candidate.updatedAt = now;
  return changed;
}

function analyze(project: StudioProjectV1, command: DestructiveCommand): CommandImpact {
  return analyzeProjectCommandImpact(project, command);
}

function applyPureRemove(
  original: StudioProjectV1,
  command: Exclude<DestructiveCommand, { type: "variant.remove" | "variant.replace" | "cel.replaceSource" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const impact = analyze(original, command);
  if (impact.blockers.length > 0) return failureWithImpact(original, impact);
  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  const changed = removeReferences(prepared, [...impact.direct, ...impact.cascades], context.now());
  return finalizeCommandMutation(original, prepared, changed, impact, snapshotInverse(original));
}

function applyVariantRemove(
  original: StudioProjectV1,
  command: Extract<DestructiveCommand, { type: "variant.remove" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const impact = analyze(original, command);
  if (impact.blockers.length > 0) return failureWithImpact(original, impact);
  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  const now = context.now();
  const changed = removeReferences(prepared, impact.cascades, now);
  const variantSet = prepared.variantSets[command.variantSetId];
  delete variantSet.variants[command.variant];
  variantSet.updatedAt = now;
  prepared.updatedAt = now;
  appendChanged(changed, "variantSets", [command.variantSetId]);
  return finalizeCommandMutation(original, prepared, changed, impact, snapshotInverse(original));
}

function payloadId(value: unknown): EntityId | undefined {
  const id = dataValue(value, "id");
  return isEntityId(id) ? id : undefined;
}

function ensureAvailableIds(
  original: StudioProjectV1,
  collection: ProjectRecordCollection,
  payloads: readonly unknown[],
  removable: ReadonlySet<string>,
  path: string,
): ProjectCommandDiagnostic | undefined {
  const seen = new Set<EntityId>();
  for (let index = 0; index < payloads.length; index += 1) {
    const id = payloadId(payloads[index]);
    if (!id) return commandDiagnostic("INVALID_PATCH", "Payload entity requires a data-only id.", `${path}[${index}].id`);
    if (seen.has(id)) return commandDiagnostic("ENTITY_ALREADY_EXISTS", `Duplicate payload id ${id}.`, `${path}[${index}].id`);
    seen.add(id);
    if (hasOwn(original[collection], id) && !removable.has(keyOf({ collection, id }))) {
      return commandDiagnostic("ENTITY_ALREADY_EXISTS", `Entity ${id} already exists in ${collection}.`, `${path}[${index}].id`, { collection, id });
    }
  }
  return undefined;
}

function installRecords(
  candidate: StudioProjectV1,
  collection: ProjectRecordCollection,
  payloads: readonly unknown[],
): void {
  for (const payload of payloads) {
    const id = payloadId(payload);
    if (id) setRecordValue(candidate[collection], id, cloneCommandPayload(payload));
  }
}

function applyVariantReplace(
  original: StudioProjectV1,
  command: Extract<DestructiveCommand, { type: "variant.replace" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const impact = analyze(original, command);
  if (impact.blockers.length > 0) return failureWithImpact(original, impact);
  const layers = denseDataArray(command.layers);
  if (!layers) return commandFailure(original, [commandDiagnostic("INVALID_PATCH", "layers must be a dense data-only array.", "$.layers")]);
  const compositionId = payloadId(command.composition);
  if (!compositionId) return commandFailure(original, [commandDiagnostic("INVALID_PATCH", "composition requires a data-only id.", "$.composition.id")]);
  const removable = new Set(impact.cascades.map(keyOf));
  const currentCompositionId = original.variantSets[command.variantSetId]?.variants[command.variant];
  if (currentCompositionId) {
    removable.add(keyOf({ collection: "compositions", id: currentCompositionId }));
    for (const layerId of original.compositions[currentCompositionId]?.layerIds ?? []) {
      removable.add(keyOf({ collection: "layers", id: layerId }));
    }
  }
  const compositionDiagnostic = ensureAvailableIds(original, "compositions", [command.composition], removable, "$.composition");
  if (compositionDiagnostic) return diagnosticFailure(original, compositionDiagnostic, impact);
  const layerDiagnostic = ensureAvailableIds(original, "layers", layers, removable, "$.layers");
  if (layerDiagnostic) return diagnosticFailure(original, layerDiagnostic, impact);

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  const now = context.now();
  const changed = removeReferences(prepared, impact.cascades, now);
  installRecords(prepared, "compositions", [command.composition]);
  installRecords(prepared, "layers", layers);
  const variantSet = prepared.variantSets[command.variantSetId];
  variantSet.variants[command.variant] = compositionId;
  variantSet.updatedAt = now;
  prepared.updatedAt = now;
  appendChanged(changed, "compositions", [compositionId]);
  appendChanged(changed, "layers", layers.map(payloadId).filter(isEntityId));
  appendChanged(changed, "variantSets", [command.variantSetId]);
  return finalizeCommandMutation(original, prepared, changed, impact, snapshotInverse(original));
}

function sourceTarget(source: unknown): EntityReference | undefined {
  const type = dataValue(source, "type");
  if (type === "region") {
    const id = dataValue(source, "regionId");
    return isEntityId(id) ? { collection: "regions", id } : undefined;
  }
  if (type === "composition") {
    const id = dataValue(source, "compositionId");
    return isEntityId(id) ? { collection: "compositions", id } : undefined;
  }
  if (type === "variantSet") {
    const id = dataValue(source, "variantSetId");
    return isEntityId(id) ? { collection: "variantSets", id } : undefined;
  }
  return undefined;
}

function installOwnedCelGraph(
  original: StudioProjectV1,
  candidate: StudioProjectV1,
  command: Extract<DestructiveCommand, { type: "cel.replaceSource" }>,
  removable: ReadonlySet<string>,
): ProjectCommandDiagnostic | undefined {
  const target = sourceTarget(command.source);
  if (!target || hasOwn(candidate[target.collection], target.id)) return undefined;
  const layers = denseDataArray(command.ownedLayers ?? []);
  if (!layers) return commandDiagnostic("INVALID_PATCH", "ownedLayers must be a dense data-only array.", "$.ownedLayers");
  const layerDiagnostic = ensureAvailableIds(original, "layers", layers, removable, "$.ownedLayers");
  if (layerDiagnostic) return layerDiagnostic;

  if (target.collection === "compositions") {
    if (!command.ownedComposition || payloadId(command.ownedComposition) !== target.id) {
      return commandDiagnostic("PRECONDITION_FAILED", "ownedComposition must provide the new source composition.", "$.ownedComposition");
    }
    const diagnostic = ensureAvailableIds(original, "compositions", [command.ownedComposition], removable, "$.ownedComposition");
    if (diagnostic) return diagnostic;
    installRecords(candidate, "compositions", [command.ownedComposition]);
    installRecords(candidate, "layers", layers);
    return undefined;
  }

  if (target.collection === "variantSets") {
    const variantSet = command.ownedVariantSet;
    const compositions = denseDataArray(command.ownedVariantCompositions ?? []);
    if (!variantSet || payloadId(variantSet) !== target.id || !compositions) {
      return commandDiagnostic("PRECONDITION_FAILED", "ownedVariantSet and ownedVariantCompositions must provide the new source graph.", "$.ownedVariantSet");
    }
    const variantDiagnostic = ensureAvailableIds(original, "variantSets", [variantSet], removable, "$.ownedVariantSet");
    if (variantDiagnostic) return variantDiagnostic;
    const compositionDiagnostic = ensureAvailableIds(original, "compositions", compositions, removable, "$.ownedVariantCompositions");
    if (compositionDiagnostic) return compositionDiagnostic;
    installRecords(candidate, "variantSets", [variantSet]);
    installRecords(candidate, "compositions", compositions);
    installRecords(candidate, "layers", layers);
    return undefined;
  }

  return commandDiagnostic("ENTITY_NOT_FOUND", `Source ${target.collection}/${target.id} does not exist.`, "$.source", target);
}

function applyCelReplaceSource(
  original: StudioProjectV1,
  command: Extract<DestructiveCommand, { type: "cel.replaceSource" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const impact = analyze(original, command);
  if (impact.blockers.length > 0) return failureWithImpact(original, impact);
  const cel = original.cels[command.celId];
  const sameSource = cel && JSON.stringify(cel.source) === JSON.stringify(command.source);
  const hasOwnedPayload =
    command.ownedComposition !== undefined || command.ownedVariantSet !== undefined ||
    command.ownedVariantCompositions !== undefined || command.ownedLayers !== undefined;
  if (sameSource && hasOwnedPayload) {
    return commandFailure(original, [
      commandDiagnostic(
        "PRECONDITION_FAILED",
        "Owned graph payloads require a different source id; update the existing graph with its own commands.",
        "$.source",
      ),
    ]);
  }
  if (
    sameSource && !hasOwnedPayload
  ) return noChangeCommandResult(original, impact, snapshotInverse(original));

  const prepared = prepareCommandCandidate(original);
  if (isCommandResult(prepared)) return prepared;
  const now = context.now();
  const changed = removeReferences(prepared, impact.cascades, now);
  const removable = new Set(impact.cascades.map(keyOf));
  const installDiagnostic = installOwnedCelGraph(original, prepared, command, removable);
  if (installDiagnostic) return diagnosticFailure(original, installDiagnostic, impact);
  prepared.cels[command.celId].source = cloneCommandPayload(command.source) as CelSource;
  prepared.cels[command.celId].updatedAt = now;
  prepared.updatedAt = now;
  appendChanged(changed, "cels", [command.celId]);
  const target = sourceTarget(command.source);
  if (target?.collection === "compositions") appendChanged(changed, "compositions", [target.id]);
  if (target?.collection === "variantSets") appendChanged(changed, "variantSets", [target.id]);
  const ownedLayers = denseDataArray(command.ownedLayers ?? []) ?? [];
  appendChanged(changed, "layers", ownedLayers.map(payloadId).filter(isEntityId));
  const ownedCompositions = denseDataArray(command.ownedVariantCompositions ?? []) ?? [];
  appendChanged(changed, "compositions", ownedCompositions.map(payloadId).filter(isEntityId));
  return finalizeCommandMutation(original, prepared, changed, impact, snapshotInverse(original));
}

export function isPureRemoveCommand(command: ProjectCommand): boolean {
  return PURE_REMOVE_TYPES.has(command.type);
}

function directRemoveTarget(command: ProjectCommand): EntityReference | undefined {
  switch (command.type) {
    case "asset.remove": return { collection: "assets", id: command.assetId };
    case "region.remove": return { collection: "regions", id: command.regionId };
    case "processingRecipe.remove": return { collection: "processingRecipes", id: command.recipeId };
    case "artifact.remove": return { collection: "generatedArtifacts", id: command.artifactId };
    case "composition.remove": return { collection: "compositions", id: command.compositionId };
    case "layer.remove": return { collection: "layers", id: command.layerId };
    case "sequence.remove": return { collection: "sequences", id: command.sequenceId };
    case "cel.remove": return { collection: "cels", id: command.celId };
    case "collisionSet.remove": return { collection: "collisionSets", id: command.collisionSetId };
    default: return undefined;
  }
}

/** Apply all explicit removes to one candidate so mutual reference cycles are atomic. */
export function applyCombinedRemoveCommands(
  project: StudioProjectV1,
  commands: ProjectCommand[],
  context: ProjectCommandContext,
): ProjectCommandResult {
  if (commands.some((command) => !isPureRemoveCommand(command))) {
    return commandFailure(project, [
      commandDiagnostic("INVALID_PATCH", "Combined remove execution accepts only destructive remove commands."),
    ]);
  }
  const impact = analyzeProjectCommandImpact(project, { type: "command.batch", commands });
  if (impact.blockers.length > 0) return failureWithImpact(project, impact);
  const prepared = prepareCommandCandidate(project);
  if (isCommandResult(prepared)) return prepared;
  const now = context.now();
  const explicitTargets = commands.map(directRemoveTarget).filter((value): value is EntityReference => Boolean(value));
  const references = [...new Map(
    [...explicitTargets, ...impact.cascades].map((reference) => [keyOf(reference), reference]),
  ).values()];
  const changed = removeReferences(prepared, references, now);
  for (const command of commands) {
    if (command.type !== "variant.remove") continue;
    const variantSet = prepared.variantSets[command.variantSetId];
    if (!variantSet) continue;
    delete variantSet.variants[command.variant];
    variantSet.updatedAt = now;
    appendChanged(changed, "variantSets", [command.variantSetId]);
  }
  prepared.updatedAt = now;
  return finalizeCommandMutation(project, prepared, changed, impact, snapshotInverse(project));
}

export function applyDestructiveFamilyCommand(
  project: StudioProjectV1,
  command: ProjectCommand,
  context: ProjectCommandContext,
): ProjectCommandResult | undefined {
  switch (command.type) {
    case "variant.remove": return applyVariantRemove(project, command, context);
    case "variant.replace": return applyVariantReplace(project, command, context);
    case "cel.replaceSource": return applyCelReplaceSource(project, command, context);
    case "asset.remove":
    case "region.remove":
    case "processingRecipe.remove":
    case "artifact.remove":
    case "composition.remove":
    case "layer.remove":
    case "sequence.remove":
    case "cel.remove":
    case "collisionSet.remove":
      return applyPureRemove(project, command, context);
    default:
      return undefined;
  }
}
