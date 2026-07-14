import type {
  EntityId,
  Region,
  StudioProjectV1,
} from "./schema";
import {
  cloneStudioProject,
  insertOrderedId,
  moveOrderedId,
} from "./graph";
import type {
  ChangedEntityIds,
  CommandImpact,
  EntityReference,
  ProjectCommand,
  ProjectCommandContext,
  ProjectCommandBatch,
  ProjectCommandDiagnostic,
  ProjectCommandInverse,
  ProjectCommandResult,
  ProjectCommandWarning,
  RegionPatch,
} from "./commands";
import { validateStudioProject } from "./validation";
import { applyCompositionFamilyCommand } from "./applyCompositionCommands";
import { applyAnimationFamilyCommand } from "./applyAnimationCommands";
import { jsonValuesEqual, noChangeCommandResult } from "./commandSupport";
import {
  applyCombinedRemoveCommands,
  applyDestructiveFamilyCommand,
  isPureRemoveCommand,
} from "./applyDestructiveCommands";
import { analyzeProjectCommandImpact } from "./impact";
import { PROJECT_RECORD_COLLECTIONS } from "./schema";

/**
 * Apply the small, non-destructive ProjectEngine command surface used by F1-03.
 *
 * The reducer deliberately builds a fresh candidate and validates that candidate
 * before exposing it.  A failed command always returns the exact input project
 * reference, which makes callers' rollback behaviour unambiguous.
 */

const REGION_PATCH_FIELDS = [
  "name",
  "bounds",
  "pivot",
  "hidden",
  "updatedAt",
  "provenance",
] as const;

type RegionPatchField = (typeof REGION_PATCH_FIELDS)[number];

const OPTIONAL_REGION_FIELDS: readonly RegionPatchField[] = [
  "name",
  "pivot",
  "hidden",
  "provenance",
];

const SUPPORTED_COMMAND_KEYS: Partial<Record<ProjectCommand["type"], readonly string[]>> = {
  "project.rename": ["type", "name", "updatedAt"],
  "asset.import": ["type", "asset", "atIndex"],
  "asset.replace": ["type", "assetId", "replacement"],
  "asset.rename": ["type", "assetId", "name", "updatedAt"],
  "asset.remove": ["type", "assetId", "policy"],
  "regions.commitRecipe": ["type", "recipe", "regions", "derivedAssets", "atIndex"],
  "region.update": ["type", "regionId", "patch"],
  "region.remove": ["type", "regionId", "policy"],
  "region.reorder": ["type", "regionId", "toIndex"],
  "processingRecipe.remove": ["type", "recipeId", "policy"],
  "artifact.remove": ["type", "artifactId", "policy"],
  "composition.create": ["type", "composition", "layers", "atIndex"],
  "composition.remove": ["type", "compositionId", "policy"],
  "layer.add": ["type", "compositionId", "layer", "atIndex"],
  "layer.update": ["type", "layerId", "patch"],
  "layer.remove": ["type", "layerId"],
  "layer.reorder": ["type", "layerId", "toIndex"],
  "layer.duplicate": ["type", "layerId", "atIndex"],
  "variant.activate": ["type", "variantSetId", "variant", "updatedAt"],
  "variant.replace": ["type", "variantSetId", "variant", "composition", "layers", "policy"],
  "variant.remove": ["type", "variantSetId", "variant", "policy"],
  "sequence.create": ["type", "sequence", "atIndex"],
  "sequence.update": ["type", "sequenceId", "patch"],
  "sequence.remove": ["type", "sequenceId", "policy"],
  "cel.add": [
    "type",
    "sequenceId",
    "cel",
    "ownedComposition",
    "ownedVariantSet",
    "ownedVariantCompositions",
    "ownedLayers",
    "atIndex",
  ],
  "cel.update": ["type", "celId", "patch"],
  "cel.remove": ["type", "celId", "policy"],
  "cel.reorder": ["type", "celId", "toIndex"],
  "cel.duplicate": ["type", "celId", "atIndex"],
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
  "collisionSet.create": ["type", "collisionSet"],
  "collisionSet.remove": ["type", "collisionSetId"],
  "collision.add": ["type", "collisionSetId", "shape", "atIndex"],
  "collision.update": ["type", "collisionSetId", "shapeId", "patch"],
  "collision.remove": ["type", "collisionSetId", "shapeId"],
};

const SUPPORTED_COMMAND_OPTIONAL_KEYS: Partial<Record<ProjectCommand["type"], readonly string[]>> = {
  "asset.import": ["atIndex"],
  "regions.commitRecipe": ["derivedAssets", "atIndex"],
  "composition.create": ["atIndex"],
  "layer.add": ["atIndex"],
  "layer.duplicate": ["atIndex"],
  "sequence.create": ["atIndex"],
  "cel.add": [
    "ownedComposition",
    "ownedVariantSet",
    "ownedVariantCompositions",
    "ownedLayers",
    "atIndex",
  ],
  "cel.duplicate": ["atIndex"],
  "cel.replaceSource": [
    "ownedComposition",
    "ownedVariantSet",
    "ownedVariantCompositions",
    "ownedLayers",
  ],
  "collision.add": ["atIndex"],
};

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function setRecordValue<T extends Record<string, unknown>>(record: T, key: string, value: unknown): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function diagnostic(
  code: ProjectCommandDiagnostic["code"],
  message: string,
  path?: string,
  entity?: EntityReference,
): ProjectCommandDiagnostic {
  return {
    code,
    message,
    ...(path ? { path } : {}),
    ...(entity ? { entity } : {}),
  };
}

interface CommandEnvelopeValidation {
  type?: string;
  diagnostic?: ProjectCommandDiagnostic;
}

function validateSupportedCommandShape(command: unknown): CommandEnvelopeValidation {
  if (!isPlainRecord(command)) {
    return { diagnostic: diagnostic("INVALID_PATCH", "ProjectCommand must be a plain object.", "$") };
  }
  const typeDescriptor = Object.getOwnPropertyDescriptor(command, "type");
  if (!typeDescriptor || !("value" in typeDescriptor) || !typeDescriptor.enumerable) {
    return {
      diagnostic: diagnostic(
        "INVALID_PATCH",
        "ProjectCommand type must be an own enumerable data property.",
        "$.type",
      ),
    };
  }
  const type = typeDescriptor.value;
  if (typeof type !== "string") {
    return { diagnostic: diagnostic("INVALID_PATCH", "ProjectCommand type must be a string.", "$.type") };
  }
  const allowed = SUPPORTED_COMMAND_KEYS[type as ProjectCommand["type"]];
  if (!allowed) return { type };
  const optional = SUPPORTED_COMMAND_OPTIONAL_KEYS[type as ProjectCommand["type"]] ?? [];
  for (const key of allowed) {
    if (!optional.includes(key) && !hasOwn(command, key)) {
      return {
        diagnostic: diagnostic(
          "INVALID_PATCH",
          `Required field ${key} is missing from ${type}.`,
          `$.${key}`,
        ),
      };
    }
  }
  for (const key of Reflect.ownKeys(command)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      return {
        diagnostic: diagnostic(
          "INVALID_PATCH",
          `Field ${String(key)} is not allowed on ${type}.`,
          typeof key === "string" ? `$.${key}` : "$",
        ),
      };
    }
    const descriptor = Object.getOwnPropertyDescriptor(command, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      return {
        diagnostic: diagnostic(
          "INVALID_PATCH",
          `Field ${key} on ${type} must be an own enumerable data property.`,
          `$.${key}`,
        ),
      };
    }
  }
  return { type };
}

function failure(
  project: StudioProjectV1,
  diagnostics: ProjectCommandDiagnostic[],
): ProjectCommandResult {
  return { ok: false, project, diagnostics };
}

function invariantFailure(
  project: StudioProjectV1,
  validation: ReturnType<typeof validateStudioProject>,
): ProjectCommandResult {
  return failure(
    project,
    validation.diagnostics.map((item) =>
      diagnostic("INVARIANT_VIOLATION", item.message, item.path),
    ),
  );
}

function unsupported(project: StudioProjectV1, type: string): ProjectCommandResult {
  return failure(project, [
    diagnostic("COMMAND_UNSUPPORTED", `Command type "${type}" is not supported by this reducer.`),
  ]);
}

function malformedCommand(project: StudioProjectV1): ProjectCommandResult {
  return failure(project, [
    diagnostic(
      "INVALID_PATCH",
      "The command payload could not be read as a valid ProjectCommand.",
      "$",
    ),
  ]);
}

function directImpact(direct: EntityReference[]): CommandImpact {
  return {
    direct,
    referencedBy: [],
    cascades: [],
    blockers: [],
  };
}

function reference(collection: EntityReference["collection"], id: EntityId): EntityReference {
  return { collection, id };
}

function success(
  project: StudioProjectV1,
  changedIds: ChangedEntityIds,
  impact: CommandImpact,
  inverse: ProjectCommandInverse,
): ProjectCommandResult {
  const warnings: ProjectCommandWarning[] = [];
  return { ok: true, project, changedIds, warnings, impact, inverse };
}

function finalize(
  original: StudioProjectV1,
  candidate: StudioProjectV1,
  changedIds: ChangedEntityIds,
  impact: CommandImpact,
  inverse: ProjectCommandInverse,
): ProjectCommandResult {
  const validation = validateStudioProject(candidate);
  if (!validation.valid) return invariantFailure(original, validation);
  const semantic = inverse.type === "project.restoreSnapshot" ? inverse.semantic : inverse;
  return success(candidate, changedIds, impact, {
    type: "project.restoreSnapshot",
    project: cloneStudioProject(original),
    ...(semantic ? { semantic } : {}),
  });
}

/** Clone command payloads without normalising invalid runtime values. */
function clonePayload<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;
  const objectValue = value as object;
  const existing = seen.get(objectValue);
  if (existing !== undefined) return existing as T;

  if (Array.isArray(value)) {
    const target: unknown[] = [];
    target.length = value.length;
    seen.set(objectValue, target);
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) continue;
      if ("value" in descriptor) descriptor.value = clonePayload(descriptor.value, seen);
      Object.defineProperty(target, key, descriptor);
    }
    return target as T;
  }

  const target = Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>;
  seen.set(objectValue, target);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if ("value" in descriptor) descriptor.value = clonePayload(descriptor.value, seen);
    Object.defineProperty(target, key, descriptor);
  }
  return target as T;
}

function prepareCandidate(project: StudioProjectV1): StudioProjectV1 | ProjectCommandResult {
  const baseline = validateStudioProject(project);
  if (!baseline.valid) return invariantFailure(project, baseline);
  try {
    return cloneStudioProject(project);
  } catch {
    return failure(project, [
      diagnostic(
        "INVARIANT_VIOLATION",
        "The project could not be cloned as a JSON-safe StudioProjectV1 document.",
        "$",
      ),
    ]);
  }
}

function isResult(value: StudioProjectV1 | ProjectCommandResult): value is ProjectCommandResult {
  return typeof value === "object" && "ok" in value;
}

function insertionIndex(
  value: unknown,
  length: number,
  path: string,
): number | ProjectCommandDiagnostic {
  if (value === undefined) return length;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > length) {
    return diagnostic(
      "INVALID_ORDER",
      `Insertion index must be an integer between 0 and ${length}.`,
      path,
    );
  }
  return value;
}

function reorderIndex(
  value: unknown,
  length: number,
  path: string,
): number | ProjectCommandDiagnostic {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= length) {
    return diagnostic(
      "INVALID_ORDER",
      `Destination index must be an integer between 0 and ${Math.max(0, length - 1)}.`,
      path,
    );
  }
  return value;
}

function duplicateIdDiagnostic(
  collection: EntityReference["collection"],
  id: unknown,
  path: string,
): ProjectCommandDiagnostic {
  const entity = typeof id === "string" && id.length > 0 ? reference(collection, id) : undefined;
  return diagnostic(
    "ENTITY_ALREADY_EXISTS",
    `Entity ${String(id)} already exists in ${collection}.`,
    path,
    entity,
  );
}

function missingEntityDiagnostic(
  collection: EntityReference["collection"],
  id: unknown,
  path: string,
): ProjectCommandDiagnostic {
  const entity = typeof id === "string" && id.length > 0 ? reference(collection, id) : undefined;
  return diagnostic(
    "ENTITY_NOT_FOUND",
    `Entity ${String(id)} was not found in ${collection}.`,
    path,
    entity,
  );
}

function duplicatePayloadIds<T extends { id: EntityId }>(
  values: readonly T[],
  collection: EntityReference["collection"],
  path: string,
): ProjectCommandDiagnostic | undefined {
  const seen = new Set<unknown>();
  for (let index = 0; index < values.length; index += 1) {
    const id = values[index]?.id;
    if (seen.has(id)) return duplicateIdDiagnostic(collection, id, `${path}[${index}].id`);
    seen.add(id);
  }
  return undefined;
}

function applyProjectRename(
  original: StudioProjectV1,
  command: Extract<ProjectCommand, { type: "project.rename" }>,
  _context: ProjectCommandContext,
): ProjectCommandResult {
  const inverse: ProjectCommandInverse = {
    type: "project.rename",
    name: original.name,
    updatedAt: original.updatedAt,
  };
  if (original.name === command.name && original.updatedAt === command.updatedAt) {
    return noChangeCommandResult(original, directImpact([]), inverse);
  }
  const prepared = prepareCandidate(original);
  if (isResult(prepared)) return prepared;
  prepared.name = command.name;
  prepared.updatedAt = command.updatedAt;
  return finalize(original, prepared, {}, directImpact([]), inverse);
}

function applyAssetImport(
  original: StudioProjectV1,
  command: Extract<ProjectCommand, { type: "asset.import" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const asset = command.asset;
  if (asset === null || typeof asset !== "object" || Array.isArray(asset)) {
    return failure(original, [diagnostic("INVALID_PATCH", "asset.import requires an asset record.", "$.asset")]);
  }
  if (hasOwn(original.assets, asset.id)) {
    return failure(original, [duplicateIdDiagnostic("assets", asset.id, "$.asset.id")]);
  }
  const index = insertionIndex(command.atIndex, original.rootOrder.assetIds.length, "$.atIndex");
  if (typeof index !== "number") return failure(original, [index]);

  const prepared = prepareCandidate(original);
  if (isResult(prepared)) return prepared;
  const oldOrder = prepared.rootOrder.assetIds;
  setRecordValue(prepared.assets, asset.id, clonePayload(asset));
  prepared.rootOrder.assetIds = insertOrderedId(oldOrder, asset.id, index);
  prepared.updatedAt = context.now();
  const inverse: ProjectCommandInverse = {
    type: "asset.remove",
    assetId: asset.id,
    policy: "reject",
  };
  return finalize(
    original,
    prepared,
    { assets: [asset.id], rootOrder: [asset.id] },
    directImpact([reference("assets", asset.id)]),
    inverse,
  );
}

function applyAssetReplace(
  original: StudioProjectV1,
  command: Extract<ProjectCommand, { type: "asset.replace" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  if (!hasOwn(original.assets, command.assetId)) {
    return failure(original, [missingEntityDiagnostic("assets", command.assetId, "$.assetId")]);
  }
  if (command.replacement === null || typeof command.replacement !== "object" || Array.isArray(command.replacement)) {
    return failure(original, [diagnostic("INVALID_PATCH", "asset.replace requires a replacement asset record.", "$.replacement")]);
  }
  if (command.replacement.id !== command.assetId) {
    return failure(original, [
      diagnostic(
        "PRECONDITION_FAILED",
        "Replacement asset id must match assetId.",
        "$.replacement.id",
        reference("assets", command.assetId),
      ),
    ]);
  }

  const direct = directImpact([reference("assets", command.assetId)]);
  const inverse: ProjectCommandInverse = {
    type: "asset.replace",
    assetId: command.assetId,
    replacement: clonePayload(original.assets[command.assetId]),
  };
  if (jsonValuesEqual(original.assets[command.assetId], command.replacement)) {
    return noChangeCommandResult(original, direct, inverse);
  }

  const prepared = prepareCandidate(original);
  if (isResult(prepared)) return prepared;
  prepared.assets[command.assetId] = clonePayload(command.replacement);
  prepared.updatedAt = context.now();
  return finalize(
    original,
    prepared,
    { assets: [command.assetId] },
    direct,
    inverse,
  );
}

function applyAssetRename(
  original: StudioProjectV1,
  command: Extract<ProjectCommand, { type: "asset.rename" }>,
  _context: ProjectCommandContext,
): ProjectCommandResult {
  if (!hasOwn(original.assets, command.assetId)) {
    return failure(original, [missingEntityDiagnostic("assets", command.assetId, "$.assetId")]);
  }
  const originalAsset = original.assets[command.assetId];
  const inverse: ProjectCommandInverse = {
    type: "asset.rename",
    assetId: command.assetId,
    name: originalAsset.name,
    updatedAt: originalAsset.updatedAt,
  };
  const direct = directImpact([reference("assets", command.assetId)]);
  if (originalAsset.name === command.name && originalAsset.updatedAt === command.updatedAt) {
    return noChangeCommandResult(original, direct, inverse);
  }
  const prepared = prepareCandidate(original);
  if (isResult(prepared)) return prepared;
  const asset = prepared.assets[command.assetId];
  asset.name = command.name;
  asset.updatedAt = command.updatedAt;
  prepared.updatedAt = command.updatedAt;
  return finalize(
    original,
    prepared,
    { assets: [command.assetId] },
    direct,
    inverse,
  );
}

function applyRegionsCommitRecipe(
  original: StudioProjectV1,
  command: Extract<ProjectCommand, { type: "regions.commitRecipe" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const regions = command.regions;
  const derivedAssets = command.derivedAssets ?? [];
  if (!Array.isArray(regions)) {
    return failure(original, [diagnostic("INVALID_PATCH", "regions.commitRecipe requires a regions array.", "$.regions")]);
  }
  if (!Array.isArray(derivedAssets)) {
    return failure(original, [diagnostic("INVALID_PATCH", "derivedAssets must be an array when provided.", "$.derivedAssets")]);
  }
  if (command.recipe === null || typeof command.recipe !== "object" || Array.isArray(command.recipe)) {
    return failure(original, [diagnostic("INVALID_PATCH", "regions.commitRecipe requires a recipe record.", "$.recipe")]);
  }
  if (hasOwn(original.processingRecipes, command.recipe.id)) {
    return failure(original, [duplicateIdDiagnostic("processingRecipes", command.recipe.id, "$.recipe.id")]);
  }
  const duplicateAsset = duplicatePayloadIds(derivedAssets, "assets", "$.derivedAssets");
  if (duplicateAsset) return failure(original, [duplicateAsset]);
  const duplicateRegion = duplicatePayloadIds(regions, "regions", "$.regions");
  if (duplicateRegion) return failure(original, [duplicateRegion]);
  for (const asset of derivedAssets) {
    if (hasOwn(original.assets, asset.id)) {
      return failure(original, [duplicateIdDiagnostic("assets", asset.id, "$.derivedAssets.id")]);
    }
  }
  for (const region of regions) {
    if (hasOwn(original.regions, region.id)) {
      return failure(original, [duplicateIdDiagnostic("regions", region.id, "$.regions.id")]);
    }
  }
  const index = insertionIndex(command.atIndex, original.rootOrder.regionIds.length, "$.atIndex");
  if (typeof index !== "number") return failure(original, [index]);

  const prepared = prepareCandidate(original);
  if (isResult(prepared)) return prepared;
  setRecordValue(prepared.processingRecipes, command.recipe.id, clonePayload(command.recipe));
  for (const asset of derivedAssets) setRecordValue(prepared.assets, asset.id, clonePayload(asset));
  for (const region of regions) setRecordValue(prepared.regions, region.id, clonePayload(region));

  const regionIds = regions.map(({ id }) => id);
  const assetIds = derivedAssets.map(({ id }) => id);
  prepared.rootOrder.assetIds = [...prepared.rootOrder.assetIds, ...assetIds];
  prepared.rootOrder.regionIds = [
    ...prepared.rootOrder.regionIds.slice(0, index),
    ...regionIds,
    ...prepared.rootOrder.regionIds.slice(index),
  ];
  prepared.updatedAt = context.now();

  const inverseCommands: ProjectCommand[] = [
    ...[...regionIds].reverse().map(
      (regionId): ProjectCommand => ({ type: "region.remove", regionId, policy: "reject" }),
    ),
    ...[...assetIds].reverse().map(
      (assetId): ProjectCommand => ({ type: "asset.remove", assetId, policy: "reject" }),
    ),
    { type: "processingRecipe.remove", recipeId: command.recipe.id, policy: "reject" },
  ];
  const inverse: ProjectCommandInverse = { type: "command.batch", commands: inverseCommands };
  return finalize(
    original,
    prepared,
    {
      processingRecipes: [command.recipe.id],
      assets: assetIds,
      regions: regionIds,
      rootOrder: [...assetIds, ...regionIds],
    },
    directImpact([
      reference("processingRecipes", command.recipe.id),
      ...assetIds.map((id) => reference("assets", id)),
      ...regionIds.map((id) => reference("regions", id)),
    ]),
    inverse,
  );
}

function applyRegionUpdate(
  original: StudioProjectV1,
  command: Extract<ProjectCommand, { type: "region.update" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  if (!hasOwn(original.regions, command.regionId)) {
    return failure(original, [missingEntityDiagnostic("regions", command.regionId, "$.regionId")]);
  }
  if (!isPlainRecord(command.patch)) {
    return failure(original, [diagnostic("INVALID_PATCH", "region.update patch must be a plain object.", "$.patch")]);
  }
  const patchKeys: string[] = [];
  for (const ownKey of Reflect.ownKeys(command.patch)) {
    if (typeof ownKey !== "string") {
      return failure(original, [diagnostic("INVALID_PATCH", "Symbol fields cannot be patched on a region.", "$.patch")]);
    }
    const key = ownKey;
    if (!(REGION_PATCH_FIELDS as readonly string[]).includes(key)) {
      return failure(original, [diagnostic("INVALID_PATCH", `Field ${key} cannot be patched on a region.`, `$.patch.${key}`)]);
    }
    if (
      command.patch[key as RegionPatchField] === undefined &&
      !OPTIONAL_REGION_FIELDS.includes(key as RegionPatchField)
    ) {
      return failure(original, [diagnostic("INVALID_PATCH", `Field ${key} is required and cannot be removed.`, `$.patch.${key}`)]);
    }
    patchKeys.push(key);
  }

  const previous = original.regions[command.regionId];
  const previousRecord = previous as unknown as Record<string, unknown>;
  const changesRegion = patchKeys.some((key) => {
    const value = command.patch[key as RegionPatchField];
    return value === undefined
      ? hasOwn(previousRecord, key)
      : !jsonValuesEqual(previousRecord[key], value);
  });
  const direct = directImpact([reference("regions", command.regionId)]);
  if (!changesRegion) {
    return noChangeCommandResult(original, direct, clonePayload(command));
  }

  const prepared = prepareCandidate(original);
  if (isResult(prepared)) return prepared;
  const inversePatch: Record<string, unknown> = {};
  const region = prepared.regions[command.regionId] as unknown as Region & Record<string, unknown>;
  for (const key of patchKeys) {
    if (hasOwn(previous, key)) {
      inversePatch[key] = clonePayload((previous as unknown as Record<string, unknown>)[key]);
    }
    else inversePatch[key] = undefined;

    const value = command.patch[key as RegionPatchField];
    if (value === undefined) delete region[key];
    else region[key] = clonePayload(value);
  }
  const now = context.now();
  if (!patchKeys.includes("updatedAt")) {
    inversePatch.updatedAt = previous.updatedAt;
    region.updatedAt = now;
  }
  prepared.updatedAt = now;
  const inverse: ProjectCommandInverse = {
    type: "region.update",
    regionId: command.regionId,
    patch: inversePatch as RegionPatch,
  };
  return finalize(
    original,
    prepared,
    { regions: [command.regionId] },
    direct,
    inverse,
  );
}

function applyRegionReorder(
  original: StudioProjectV1,
  command: Extract<ProjectCommand, { type: "region.reorder" }>,
  context: ProjectCommandContext,
): ProjectCommandResult {
  if (!hasOwn(original.regions, command.regionId)) {
    return failure(original, [missingEntityDiagnostic("regions", command.regionId, "$.regionId")]);
  }
  const order = original.rootOrder.regionIds;
  const index = reorderIndex(command.toIndex, order.length, "$.toIndex");
  if (typeof index !== "number") return failure(original, [index]);
  const fromIndex = order.indexOf(command.regionId);
  if (fromIndex < 0) {
    return failure(original, [
      diagnostic(
        "INVARIANT_VIOLATION",
        `Region ${command.regionId} is not present in rootOrder.regionIds.`,
        "$.rootOrder.regionIds",
        reference("regions", command.regionId),
      ),
    ]);
  }
  const inverse: ProjectCommandInverse = {
    type: "region.reorder",
    regionId: command.regionId,
    toIndex: fromIndex,
  };
  const direct = directImpact([reference("regions", command.regionId)]);
  if (fromIndex === index) return noChangeCommandResult(original, direct, inverse);
  const prepared = prepareCandidate(original);
  if (isResult(prepared)) return prepared;
  prepared.rootOrder.regionIds = moveOrderedId(prepared.rootOrder.regionIds, command.regionId, index);
  prepared.updatedAt = context.now();
  return finalize(
    original,
    prepared,
    { regions: [command.regionId], rootOrder: [command.regionId] },
    direct,
    inverse,
  );
}

/** Apply one supported command; unsupported command families fail atomically. */
export function applyProjectCommand(
  project: StudioProjectV1,
  command: ProjectCommand,
  context: ProjectCommandContext,
): ProjectCommandResult {
  try {
    const envelope = validateSupportedCommandShape(command);
    if (envelope.diagnostic) return failure(project, [envelope.diagnostic]);
    const commandType = envelope.type;
    if (!commandType) return malformedCommand(project);
    // Shape validation above guarantees this is an own data property, so the
    // discriminant is safe to read and still narrows ProjectCommand for TS.
    switch (command.type) {
      case "project.rename":
        return applyProjectRename(project, command, context);
      case "asset.import":
        return applyAssetImport(project, command, context);
      case "asset.replace":
        return applyAssetReplace(project, command, context);
      case "asset.rename":
        return applyAssetRename(project, command, context);
      case "regions.commitRecipe":
        return applyRegionsCommitRecipe(project, command, context);
      case "region.update":
        return applyRegionUpdate(project, command, context);
      case "region.reorder":
        return applyRegionReorder(project, command, context);
      default: {
        const compositionResult = applyCompositionFamilyCommand(project, command, context);
        if (compositionResult) return compositionResult;
        const animationResult = applyAnimationFamilyCommand(project, command, context);
        if (animationResult) return animationResult;
        const destructiveResult = applyDestructiveFamilyCommand(project, command, context);
        return destructiveResult ?? unsupported(project, commandType);
      }
    }
  } catch {
    return malformedCommand(project);
  }
}

function mergeChangedIds(target: ChangedEntityIds, source: ChangedEntityIds): void {
  for (const [collection, ids] of Object.entries(source) as Array<[keyof ChangedEntityIds, string[]]>) {
    target[collection] = [...new Set([...(target[collection] ?? []), ...ids])].sort();
  }
}

/** Apply a batch atomically; failures return the exact original project. */
export function applyProjectCommandBatch(
  project: StudioProjectV1,
  batch: ProjectCommandBatch,
  context: ProjectCommandContext,
): ProjectCommandResult {
  const impact = analyzeProjectCommandImpact(project, batch);
  if (impact.blockers.length > 0) {
    return { ok: false, project, diagnostics: impact.blockers, impact };
  }
  if (!Array.isArray(batch.commands)) return malformedCommand(project);

  const nonRemovals = batch.commands.filter((command) => !isPureRemoveCommand(command));
  const removals = batch.commands.filter((command) => isPureRemoveCommand(command));

  let current = project;
  const changedIds: ChangedEntityIds = {};
  const warnings: ProjectCommandWarning[] = [];
  for (const command of nonRemovals) {
    const result = applyProjectCommand(current, command, context);
    if (!result.ok) return { ok: false, project, diagnostics: result.diagnostics, impact };
    current = result.project;
    mergeChangedIds(changedIds, result.changedIds);
    warnings.push(...result.warnings);
  }
  if (removals.length > 0) {
    const result = applyCombinedRemoveCommands(current, removals, context);
    if (!result.ok) return { ok: false, project, diagnostics: result.diagnostics, impact };
    current = result.project;
    mergeChangedIds(changedIds, result.changedIds);
    warnings.push(...result.warnings);
  }
  return {
    ok: true,
    project: current,
    changedIds,
    warnings,
    impact,
    inverse: { type: "project.restoreSnapshot", project: cloneStudioProject(project) },
  };
}

function changedIdsBetween(current: StudioProjectV1, target: StudioProjectV1): ChangedEntityIds {
  const changed: ChangedEntityIds = {};
  for (const collection of PROJECT_RECORD_COLLECTIONS) {
    const ids = [...new Set([...Object.keys(current[collection]), ...Object.keys(target[collection])])]
      .filter((id) => JSON.stringify(current[collection][id]) !== JSON.stringify(target[collection][id]));
    if (ids.length > 0) changed[collection] = ids.sort();
  }
  if (JSON.stringify(current.rootOrder) !== JSON.stringify(target.rootOrder)) changed.rootOrder = [target.id];
  if (JSON.stringify(current.workspace) !== JSON.stringify(target.workspace)) changed.workspace = [target.id];
  return changed;
}

/** Execute a typed command, batch or structured snapshot inverse. */
export function applyProjectCommandInverse(
  project: StudioProjectV1,
  inverse: ProjectCommandInverse,
  context: ProjectCommandContext,
): ProjectCommandResult {
  try {
    if (inverse === null || typeof inverse !== "object") return malformedCommand(project);
    const typeDescriptor = Object.getOwnPropertyDescriptor(inverse, "type");
    if (!typeDescriptor || !("value" in typeDescriptor) || !typeDescriptor.enumerable) {
      return malformedCommand(project);
    }
    const type = typeDescriptor.value;
    if (type === "command.batch") return applyProjectCommandBatch(project, inverse as ProjectCommandBatch, context);
    if (type !== "project.restoreSnapshot") return applyProjectCommand(project, inverse as ProjectCommand, context);
    const projectDescriptor = Object.getOwnPropertyDescriptor(inverse, "project");
    if (!projectDescriptor || !("value" in projectDescriptor) || !projectDescriptor.enumerable) {
      return malformedCommand(project);
    }
    const snapshot = projectDescriptor.value;
    const validation = validateStudioProject(snapshot);
    if (!validation.valid) {
      return {
        ok: false,
        project,
        diagnostics: validation.diagnostics.map((item) =>
          diagnostic("INVARIANT_VIOLATION", item.message, item.path)),
      };
    }
    const restored = cloneStudioProject(snapshot as StudioProjectV1);
    return {
      ok: true,
      project: restored,
      changedIds: changedIdsBetween(project, restored),
      warnings: [],
      impact: directImpact([]),
      inverse: { type: "project.restoreSnapshot", project: cloneStudioProject(project) },
    };
  } catch {
    return malformedCommand(project);
  }
}
