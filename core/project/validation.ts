import type {
  Cel,
  CollisionSet,
  Composition,
  EntityId,
  GeneratedArtifact,
  Layer,
  ProcessingRecipe,
  Sequence,
  StudioProjectV1,
  VariantKey,
  VariantSet,
} from "./schema";
import { isEntityId, isISO8601Timestamp } from "./primitives";

export type ProjectDiagnosticCode =
  | "INVALID_DOCUMENT"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "NON_JSON_VALUE"
  | "RUNTIME_URL"
  | "INVALID_ID"
  | "KEY_ID_MISMATCH"
  | "ORDER_MISMATCH"
  | "DUPLICATE_OWNERSHIP"
  | "MISSING_REFERENCE"
  | "OWNER_MISMATCH"
  | "NESTED_COMPOSITION_FORBIDDEN"
  | "INVALID_NUMBER"
  | "INVALID_TIMESTAMP"
  | "INVALID_DIMENSIONS";

export interface ProjectDiagnostic {
  code: ProjectDiagnosticCode;
  path: string;
  message: string;
  entityId?: EntityId;
}

export interface ProjectValidationResult {
  valid: boolean;
  diagnostics: ProjectDiagnostic[];
  project?: StudioProjectV1;
}

type UnknownRecord = Record<string, unknown>;
type CollectionName =
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

const COLLECTION_NAMES: readonly CollectionName[] = [
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

const VARIANT_KEYS: readonly VariantKey[] = ["A", "B", "C", "D"] as const;
const RUNTIME_URL = /^(?:blob:|data:)/i;

function isRecord(value: unknown): value is UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function validateAllowedKeys(
  record: UnknownRecord,
  allowedKeys: readonly string[],
  path: string,
  diagnostics: ProjectDiagnostic[],
  entityId?: EntityId,
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record).sort()) {
    if (!allowed.has(key)) {
      push(
        diagnostics,
        "INVALID_DOCUMENT",
        pathFor(path, key),
        "Field is not part of the StudioProjectV1 schema.",
        entityId,
      );
    }
  }
}

function pathFor(path: string, key: string): string {
  return `${path}.${key}`;
}

function compareDiagnostics(a: ProjectDiagnostic, b: ProjectDiagnostic): number {
  const pathOrder = a.path.localeCompare(b.path);
  if (pathOrder !== 0) return pathOrder;
  const codeOrder = a.code.localeCompare(b.code);
  if (codeOrder !== 0) return codeOrder;
  return a.message.localeCompare(b.message);
}

function sortDiagnostics(diagnostics: ProjectDiagnostic[]): ProjectDiagnostic[] {
  return [...diagnostics].sort(compareDiagnostics);
}

function push(
  diagnostics: ProjectDiagnostic[],
  code: ProjectDiagnosticCode,
  path: string,
  message: string,
  entityId?: EntityId,
): void {
  diagnostics.push({ code, path, message, ...(entityId ? { entityId } : {}) });
}

function inspectJson(value: unknown, path: string, diagnostics: ProjectDiagnostic[], ancestors: WeakSet<object>): void {
  if (value === null) return;

  switch (typeof value) {
    case "string":
      if (RUNTIME_URL.test(value)) {
        push(diagnostics, "RUNTIME_URL", path, "Runtime object/data URLs are not durable project values.");
      }
      return;
    case "number":
      if (!Number.isFinite(value)) {
        push(diagnostics, "INVALID_NUMBER", path, "Numbers must be finite.");
      }
      return;
    case "boolean":
      return;
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      push(diagnostics, "NON_JSON_VALUE", path, "Value is not representable in JSON.");
      return;
    default:
      break;
  }

  if (typeof value !== "object") return;
  if (ancestors.has(value)) {
    push(diagnostics, "NON_JSON_VALUE", path, "Cyclic object graphs are not JSON-safe.");
    return;
  }

  if (Array.isArray(value)) {
    ancestors.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key === "symbol") {
        push(diagnostics, "NON_JSON_VALUE", path, `Symbol key ${String(key)} is not JSON-safe.`);
        continue;
      }
      if (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
        push(diagnostics, "NON_JSON_VALUE", pathFor(path, key), "Arrays cannot contain named properties.");
      }
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor) {
        push(diagnostics, "NON_JSON_VALUE", `${path}[${index}]`, "Sparse arrays are not canonical JSON values.");
        continue;
      }
      if (!("value" in descriptor)) {
        push(diagnostics, "NON_JSON_VALUE", `${path}[${index}]`, "Accessor properties are not canonical JSON values.");
        continue;
      }
      inspectJson(descriptor.value, `${path}[${index}]`, diagnostics, ancestors);
    }
    ancestors.delete(value);
    return;
  }

  if (!isRecord(value)) {
    push(diagnostics, "NON_JSON_VALUE", path, "Only plain objects are JSON-safe.");
    return;
  }

  ancestors.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") {
      push(diagnostics, "NON_JSON_VALUE", path, `Symbol key ${String(key)} is not JSON-safe.`);
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      push(diagnostics, "NON_JSON_VALUE", pathFor(path, key), "Non-enumerable/accessor properties are not canonical JSON values.");
      continue;
    }
    inspectJson(descriptor.value, pathFor(path, key), diagnostics, ancestors);
  }
  ancestors.delete(value);
}

function validId(value: unknown): value is EntityId {
  return isEntityId(value);
}

function validateId(
  value: unknown,
  path: string,
  diagnostics: ProjectDiagnostic[],
  entityId?: EntityId,
): value is EntityId {
  if (!validId(value)) {
    push(diagnostics, "INVALID_ID", path, "Entity IDs must be non-empty strings.", entityId);
    return false;
  }
  return true;
}

function validateString(
  value: unknown,
  path: string,
  diagnostics: ProjectDiagnostic[],
  message = "Expected a string.",
): value is string {
  if (typeof value !== "string") {
    push(diagnostics, "INVALID_DOCUMENT", path, message);
    return false;
  }
  return true;
}

function validateNonEmptyString(
  value: unknown,
  path: string,
  diagnostics: ProjectDiagnostic[],
  message = "Expected a non-empty string.",
): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    push(diagnostics, "INVALID_DOCUMENT", path, message);
    return false;
  }
  return true;
}

function validateTimestamp(value: unknown, path: string, diagnostics: ProjectDiagnostic[]): value is string {
  if (!isISO8601Timestamp(value)) {
    push(diagnostics, "INVALID_TIMESTAMP", path, "Expected an ISO-8601 timestamp with a timezone.");
    return false;
  }
  return true;
}

function validateFiniteNumber(value: unknown, path: string, diagnostics: ProjectDiagnostic[]): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    push(diagnostics, "INVALID_NUMBER", path, "Expected a finite number.");
    return false;
  }
  return true;
}

function validateUnitInterval(
  value: unknown,
  path: string,
  diagnostics: ProjectDiagnostic[],
  entityId?: EntityId,
): value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    push(diagnostics, "INVALID_NUMBER", path, "Expected a finite number between 0 and 1.", entityId);
    return false;
  }
  return true;
}

function validateBoolean(value: unknown, path: string, diagnostics: ProjectDiagnostic[]): value is boolean {
  if (typeof value !== "boolean") {
    push(diagnostics, "INVALID_DOCUMENT", path, "Expected a boolean.");
    return false;
  }
  return true;
}

function validateDimensions(
  value: unknown,
  path: string,
  diagnostics: ProjectDiagnostic[],
): value is { width: number; height: number } {
  if (!isRecord(value)) {
    push(diagnostics, "INVALID_DIMENSIONS", path, "Expected width and height dimensions.");
    return false;
  }
  const width = value.width;
  const height = value.height;
  const valid =
    typeof width === "number" &&
    Number.isFinite(width) &&
    Number.isInteger(width) &&
    typeof height === "number" &&
    Number.isFinite(height) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0;
  if (!valid) {
    push(diagnostics, "INVALID_DIMENSIONS", path, "Dimensions must be finite positive integers.");
    return false;
  }
  return true;
}

function validatePoint(value: unknown, path: string, diagnostics: ProjectDiagnostic[]): void {
  if (!isRecord(value)) {
    push(diagnostics, "INVALID_DOCUMENT", path, "Expected a point object.");
    return;
  }
  validateAllowedKeys(value, ["x", "y"], path, diagnostics);
  validateFiniteNumber(value.x, pathFor(path, "x"), diagnostics);
  validateFiniteNumber(value.y, pathFor(path, "y"), diagnostics);
}

function validateRect(value: unknown, path: string, diagnostics: ProjectDiagnostic[]): void {
  if (!isRecord(value)) {
    push(diagnostics, "INVALID_DIMENSIONS", path, "Expected a rectangular bounds object.");
    return;
  }
  validateAllowedKeys(value, ["x", "y", "width", "height"], path, diagnostics);
  validateFiniteNumber(value.x, pathFor(path, "x"), diagnostics);
  validateFiniteNumber(value.y, pathFor(path, "y"), diagnostics);
  validateDimensions(value, path, diagnostics);
}

function validateBaseEntity(
  item: UnknownRecord,
  path: string,
  key: string,
  diagnostics: ProjectDiagnostic[],
): string | undefined {
  const idPath = pathFor(path, "id");
  const itemId = item.id;
  const id = validId(itemId) ? itemId : undefined;
  if (!id) validateId(itemId, idPath, diagnostics);
  if (id && id !== key) {
    push(diagnostics, "KEY_ID_MISMATCH", idPath, "Record key must equal entity.id.", id);
  }
  validateTimestamp(item.createdAt, pathFor(path, "createdAt"), diagnostics);
  validateTimestamp(item.updatedAt, pathFor(path, "updatedAt"), diagnostics);
  return id ? id : undefined;
}

function collectionRecords(
  root: UnknownRecord,
  collection: CollectionName,
  diagnostics: ProjectDiagnostic[],
): Map<EntityId, UnknownRecord> {
  const value = root[collection];
  const records = new Map<EntityId, UnknownRecord>();
  if (!isRecord(value)) {
    push(diagnostics, "INVALID_DOCUMENT", `$.${collection}`, "Expected a record collection.");
    return records;
  }

  for (const key of Object.keys(value).sort()) {
    const path = `$.${collection}.${key}`;
    const item = value[key];
    if (!isRecord(item)) {
      push(diagnostics, "INVALID_DOCUMENT", path, "Expected an entity record.");
      continue;
    }
    const id = validateBaseEntity(item, path, key, diagnostics);
    if (id) records.set(id, item);
  }
  return records;
}

function validateReference(
  value: unknown,
  path: string,
  records: Map<EntityId, UnknownRecord>,
  diagnostics: ProjectDiagnostic[],
  entityId?: EntityId,
): value is EntityId {
  if (!validateId(value, path, diagnostics, entityId)) return false;
  if (!records.has(value)) {
    push(diagnostics, "MISSING_REFERENCE", path, "Referenced entity does not exist.", entityId);
    return false;
  }
  return true;
}

function validateIdArray(
  value: unknown,
  path: string,
  diagnostics: ProjectDiagnostic[],
  entityId?: EntityId,
): value is EntityId[] {
  if (!Array.isArray(value)) {
    push(diagnostics, "INVALID_DOCUMENT", path, "Expected an ordered array of entity IDs.", entityId);
    return false;
  }
  value.forEach((id, index) => validateId(id, `${path}[${index}]`, diagnostics, entityId));
  return true;
}

function validateOrder(
  value: unknown,
  path: string,
  records: Map<EntityId, UnknownRecord>,
  diagnostics: ProjectDiagnostic[],
  expectedIds: ReadonlySet<EntityId> = new Set(records.keys()),
): void {
  if (!validateIdArray(value, path, diagnostics)) return;
  const order = value as unknown[];
  const seen = new Set<EntityId>();
  let mismatch = false;
  for (const id of order) {
    if (!validId(id)) {
      mismatch = true;
      continue;
    }
    if (seen.has(id)) mismatch = true;
    seen.add(id);
    if (!expectedIds.has(id)) mismatch = true;
  }
  if (seen.size !== expectedIds.size) mismatch = true;
  if (mismatch) {
    push(diagnostics, "ORDER_MISMATCH", path, "Order must contain each owned ID exactly once.");
  }
}

function validateLayer(
  item: Layer,
  path: string,
  id: string,
  assets: Map<EntityId, UnknownRecord>,
  regions: Map<EntityId, UnknownRecord>,
  compositions: Map<EntityId, UnknownRecord>,
  diagnostics: ProjectDiagnostic[],
): void {
  validateAllowedKeys(
    item as unknown as UnknownRecord,
    [
      "id",
      "compositionId",
      "name",
      "source",
      "transform",
      "visible",
      "locked",
      "createdAt",
      "updatedAt",
    ],
    path,
    diagnostics,
    id,
  );
  if (item.name !== undefined) validateString(item.name, pathFor(path, "name"), diagnostics);
  validateReference(item.compositionId, pathFor(path, "compositionId"), compositions, diagnostics, id);
  const sourcePath = pathFor(path, "source");
  const source = item.source as unknown;
  if (!isRecord(source)) {
    push(diagnostics, "INVALID_DOCUMENT", sourcePath, "Layer source must be discriminated.", id);
  } else if (source.type === "asset") {
    validateAllowedKeys(source, ["type", "id"], sourcePath, diagnostics, id);
    validateReference(source.id, pathFor(sourcePath, "id"), assets, diagnostics, id);
  } else if (source.type === "region") {
    validateAllowedKeys(source, ["type", "id"], sourcePath, diagnostics, id);
    validateReference(source.id, pathFor(sourcePath, "id"), regions, diagnostics, id);
  } else if (source.type === "composition") {
    push(
      diagnostics,
      "NESTED_COMPOSITION_FORBIDDEN",
      sourcePath,
      "Composition sources are not allowed for layers in StudioProjectV1.",
      id,
    );
  } else {
    push(diagnostics, "INVALID_DOCUMENT", sourcePath, "Layer source type is unsupported.", id);
  }

  const transformPath = pathFor(path, "transform");
  if (!isRecord(item.transform)) {
    push(diagnostics, "INVALID_DOCUMENT", transformPath, "Layer transform is required.", id);
  } else {
    validateAllowedKeys(
      item.transform,
      ["x", "y", "scaleX", "scaleY", "rotation", "opacity", "flipX", "flipY"],
      transformPath,
      diagnostics,
      id,
    );
    for (const key of ["x", "y", "scaleX", "scaleY", "rotation", "opacity"] as const) {
      if (key === "opacity") {
        validateUnitInterval(item.transform[key], pathFor(transformPath, key), diagnostics, id);
      } else {
        validateFiniteNumber(item.transform[key], pathFor(transformPath, key), diagnostics);
      }
    }
    validateBoolean(item.transform.flipX, pathFor(transformPath, "flipX"), diagnostics);
    validateBoolean(item.transform.flipY, pathFor(transformPath, "flipY"), diagnostics);
  }
}

function validateComposition(
  item: Composition,
  path: string,
  id: string,
  layers: Map<EntityId, UnknownRecord>,
  cels: Map<EntityId, UnknownRecord>,
  variantSets: Map<EntityId, UnknownRecord>,
  diagnostics: ProjectDiagnostic[],
): void {
  validateAllowedKeys(
    item as unknown as UnknownRecord,
    ["id", "name", "owner", "layerIds", "width", "height", "background", "createdAt", "updatedAt"],
    path,
    diagnostics,
    id,
  );
  validateString(item.name, pathFor(path, "name"), diagnostics, "Composition name is required.");
  validateDimensions(item, path, diagnostics);
  if (!validateIdArray(item.layerIds, pathFor(path, "layerIds"), diagnostics, id)) return;
  item.layerIds.forEach((layerId, index) => {
    validateReference(layerId, `${path}.layerIds[${index}]`, layers, diagnostics, id);
  });
  if (item.background !== undefined && item.background !== null) {
    validateString(item.background, pathFor(path, "background"), diagnostics);
  }
  const ownerPath = pathFor(path, "owner");
  if (!isRecord(item.owner)) {
    push(diagnostics, "INVALID_DOCUMENT", ownerPath, "Composition owner is required.", id);
    return;
  }
  if (item.owner.type === "project") {
    validateAllowedKeys(item.owner, ["type"], ownerPath, diagnostics, id);
    return;
  }
  if (item.owner.type === "cel") {
    validateAllowedKeys(item.owner, ["type", "celId"], ownerPath, diagnostics, id);
    validateReference(item.owner.celId, pathFor(ownerPath, "celId"), cels, diagnostics, id);
    return;
  }
  if (item.owner.type === "variantSet") {
    validateAllowedKeys(item.owner, ["type", "variantSetId", "variant"], ownerPath, diagnostics, id);
    validateReference(item.owner.variantSetId, pathFor(ownerPath, "variantSetId"), variantSets, diagnostics, id);
    if (!VARIANT_KEYS.includes(item.owner.variant as VariantKey)) {
      push(diagnostics, "INVALID_DOCUMENT", pathFor(ownerPath, "variant"), "Variant key must be A, B, C or D.", id);
    }
    return;
  }
  push(diagnostics, "INVALID_DOCUMENT", ownerPath, "Composition owner type is unsupported.", id);
}

function validateVariantSet(
  item: VariantSet,
  path: string,
  id: string,
  cels: Map<EntityId, UnknownRecord>,
  compositions: Map<EntityId, UnknownRecord>,
  diagnostics: ProjectDiagnostic[],
): void {
  validateAllowedKeys(
    item as unknown as UnknownRecord,
    ["id", "celId", "variants", "activeVariant", "createdAt", "updatedAt"],
    path,
    diagnostics,
    id,
  );
  validateReference(item.celId, pathFor(path, "celId"), cels, diagnostics, id);
  const variantsPath = pathFor(path, "variants");
  if (!isRecord(item.variants)) {
    push(diagnostics, "INVALID_DOCUMENT", variantsPath, "Variants must be a record.", id);
  } else {
    const keys = Object.keys(item.variants).sort();
    if (keys.length < 1 || keys.length > 4) {
      push(diagnostics, "ORDER_MISMATCH", variantsPath, "A variant set must contain one to four variants.", id);
    }
    for (const key of keys) {
      if (!VARIANT_KEYS.includes(key as VariantKey)) {
        push(diagnostics, "INVALID_DOCUMENT", pathFor(variantsPath, key), "Variant key must be A, B, C or D.", id);
        continue;
      }
      validateReference(item.variants[key as VariantKey], pathFor(variantsPath, key), compositions, diagnostics, id);
    }
  }
  if (!VARIANT_KEYS.includes(item.activeVariant)) {
    push(diagnostics, "INVALID_DOCUMENT", pathFor(path, "activeVariant"), "Active variant must be A, B, C or D.", id);
  } else if (isRecord(item.variants) && !hasOwn(item.variants, item.activeVariant)) {
    push(diagnostics, "MISSING_REFERENCE", pathFor(path, "activeVariant"), "Active variant is not present.", id);
  }
}

function validateCel(
  item: Cel,
  path: string,
  id: string,
  sequences: Map<EntityId, UnknownRecord>,
  regions: Map<EntityId, UnknownRecord>,
  compositions: Map<EntityId, UnknownRecord>,
  variantSets: Map<EntityId, UnknownRecord>,
  diagnostics: ProjectDiagnostic[],
): void {
  validateAllowedKeys(
    item as unknown as UnknownRecord,
    [
      "id",
      "sequenceId",
      "source",
      "durationMs",
      "pivot",
      "transform",
      "locked",
      "prompt",
      "createdAt",
      "updatedAt",
    ],
    path,
    diagnostics,
    id,
  );
  validateReference(item.sequenceId, pathFor(path, "sequenceId"), sequences, diagnostics, id);
  const durationPath = pathFor(path, "durationMs");
  if (
    typeof item.durationMs !== "number" ||
    !Number.isFinite(item.durationMs) ||
    item.durationMs <= 0
  ) {
    push(diagnostics, "INVALID_NUMBER", durationPath, "Cel duration must be a positive finite number.", id);
  }
  const sourcePath = pathFor(path, "source");
  if (!isRecord(item.source)) {
    push(diagnostics, "INVALID_DOCUMENT", sourcePath, "Cel source must be discriminated.", id);
    return;
  }
  if (item.source.type === "region") {
    validateAllowedKeys(item.source, ["type", "regionId"], sourcePath, diagnostics, id);
    validateReference(item.source.regionId, pathFor(sourcePath, "regionId"), regions, diagnostics, id);
  } else if (item.source.type === "composition") {
    validateAllowedKeys(item.source, ["type", "compositionId"], sourcePath, diagnostics, id);
    validateReference(item.source.compositionId, pathFor(sourcePath, "compositionId"), compositions, diagnostics, id);
  } else if (item.source.type === "variantSet") {
    validateAllowedKeys(item.source, ["type", "variantSetId"], sourcePath, diagnostics, id);
    validateReference(item.source.variantSetId, pathFor(sourcePath, "variantSetId"), variantSets, diagnostics, id);
  } else {
    push(diagnostics, "INVALID_DOCUMENT", sourcePath, "Cel source type is unsupported.", id);
  }

  if (item.pivot !== undefined) validatePoint(item.pivot, pathFor(path, "pivot"), diagnostics);
  if (item.locked !== undefined) validateBoolean(item.locked, pathFor(path, "locked"), diagnostics);
  if (item.prompt !== undefined) validateString(item.prompt, pathFor(path, "prompt"), diagnostics);
  if (item.transform !== undefined) {
    const transformPath = pathFor(path, "transform");
    if (!isRecord(item.transform)) {
      push(diagnostics, "INVALID_DOCUMENT", transformPath, "Cel transform must be an object.", id);
    } else {
      validateAllowedKeys(
        item.transform,
        ["x", "y", "scaleX", "scaleY", "rotation", "opacity", "flipX", "flipY"],
        transformPath,
        diagnostics,
        id,
      );
      for (const key of ["x", "y", "scaleX", "scaleY", "rotation"] as const) {
        if (item.transform[key] !== undefined) {
          validateFiniteNumber(item.transform[key], pathFor(transformPath, key), diagnostics);
        }
      }
      if (item.transform.opacity !== undefined) {
        validateUnitInterval(item.transform.opacity, pathFor(transformPath, "opacity"), diagnostics, id);
      }
      for (const key of ["flipX", "flipY"] as const) {
        if (item.transform[key] !== undefined) {
          validateBoolean(item.transform[key], pathFor(transformPath, key), diagnostics);
        }
      }
    }
  }
}

function validateSequence(item: Sequence, path: string, id: string, cels: Map<EntityId, UnknownRecord>, diagnostics: ProjectDiagnostic[]): void {
  validateAllowedKeys(
    item as unknown as UnknownRecord,
    ["id", "name", "celIds", "fps", "defaultDurationMs", "loop", "createdAt", "updatedAt"],
    path,
    diagnostics,
    id,
  );
  validateString(item.name, pathFor(path, "name"), diagnostics, "Sequence name is required.");
  validateIdArray(item.celIds, pathFor(path, "celIds"), diagnostics, id);
  if (typeof item.fps !== "number" || !Number.isFinite(item.fps) || item.fps <= 0) {
    push(diagnostics, "INVALID_NUMBER", pathFor(path, "fps"), "Sequence FPS must be positive and finite.", id);
  }
  if (item.defaultDurationMs !== undefined) {
    if (
      typeof item.defaultDurationMs !== "number" ||
      !Number.isFinite(item.defaultDurationMs) ||
      item.defaultDurationMs <= 0
    ) {
      push(diagnostics, "INVALID_NUMBER", pathFor(path, "defaultDurationMs"), "Default duration must be positive and finite.", id);
    }
  }
  validateBoolean(item.loop, pathFor(path, "loop"), diagnostics);
  if (Array.isArray(item.celIds)) {
    item.celIds.forEach((celId, index) => {
      validateReference(celId, `${path}.celIds[${index}]`, cels, diagnostics, id);
    });
  }
}

function validateCollisionSet(
  item: CollisionSet,
  path: string,
  id: string,
  regions: Map<EntityId, UnknownRecord>,
  compositions: Map<EntityId, UnknownRecord>,
  cels: Map<EntityId, UnknownRecord>,
  diagnostics: ProjectDiagnostic[],
): void {
  validateAllowedKeys(
    item as unknown as UnknownRecord,
    ["id", "owner", "shapes", "createdAt", "updatedAt"],
    path,
    diagnostics,
    id,
  );
  const ownerPath = pathFor(path, "owner");
  if (!isRecord(item.owner)) {
    push(diagnostics, "INVALID_DOCUMENT", ownerPath, "Collision owner is required.", id);
  } else if (item.owner.type === "region") {
    validateAllowedKeys(item.owner, ["type", "regionId"], ownerPath, diagnostics, id);
    validateReference(item.owner.regionId, pathFor(ownerPath, "regionId"), regions, diagnostics, id);
  } else if (item.owner.type === "composition") {
    validateAllowedKeys(item.owner, ["type", "compositionId"], ownerPath, diagnostics, id);
    validateReference(item.owner.compositionId, pathFor(ownerPath, "compositionId"), compositions, diagnostics, id);
  } else if (item.owner.type === "cel") {
    validateAllowedKeys(item.owner, ["type", "celId"], ownerPath, diagnostics, id);
    validateReference(item.owner.celId, pathFor(ownerPath, "celId"), cels, diagnostics, id);
  } else {
    push(diagnostics, "INVALID_DOCUMENT", ownerPath, "Collision owner type is unsupported.", id);
  }
  const shapesPath = pathFor(path, "shapes");
  if (!Array.isArray(item.shapes)) {
    push(diagnostics, "INVALID_DOCUMENT", shapesPath, "Collision shapes must be an array.", id);
    return;
  }
  const shapeIds = new Set<EntityId>();
  item.shapes.forEach((shape, index) => {
    const shapePath = `${shapesPath}[${index}]`;
    if (!isRecord(shape)) {
      push(diagnostics, "INVALID_DOCUMENT", shapePath, "Collision shape must be an object.", id);
      return;
    }
    validateAllowedKeys(shape, ["id", "type", "bounds", "tag"], shapePath, diagnostics, id);
    const shapeId = validId(shape.id) ? shape.id : undefined;
    if (!shapeId) validateId(shape.id, pathFor(shapePath, "id"), diagnostics, id);
    if (shapeId && shapeIds.has(shapeId)) {
      push(diagnostics, "DUPLICATE_OWNERSHIP", pathFor(shapePath, "id"), "Collision shape IDs must be unique.", id);
    }
    if (shapeId) shapeIds.add(shapeId);
    if (typeof shape.type !== "string" || !["hurtbox", "hitbox", "solid", "trigger"].includes(shape.type)) {
      push(diagnostics, "INVALID_DOCUMENT", pathFor(shapePath, "type"), "Unsupported collision shape type.", id);
    }
    validateRect(shape.bounds, pathFor(shapePath, "bounds"), diagnostics);
    if (shape.tag !== undefined) validateString(shape.tag, pathFor(shapePath, "tag"), diagnostics);
  });
}

function validateRecipe(
  item: ProcessingRecipe,
  path: string,
  id: string,
  assets: Map<EntityId, UnknownRecord>,
  diagnostics: ProjectDiagnostic[],
): void {
  validateAllowedKeys(
    item as unknown as UnknownRecord,
    ["id", "name", "kind", "version", "sourceAssetId", "layout", "crop", "chroma", "pixel", "createdAt", "updatedAt"],
    path,
    diagnostics,
    id,
  );
  if (item.name !== undefined) validateString(item.name, pathFor(path, "name"), diagnostics);
  if (item.kind !== "grid-split") {
    push(diagnostics, "INVALID_DOCUMENT", pathFor(path, "kind"), "Processing recipe kind must be grid-split in V1.", id);
  }
  if (item.version !== 1) {
    push(diagnostics, "UNSUPPORTED_SCHEMA_VERSION", pathFor(path, "version"), "Processing recipe version must be 1.", id);
  }
  validateReference(item.sourceAssetId, pathFor(path, "sourceAssetId"), assets, diagnostics, id);
  if (!isRecord(item.layout)) {
    push(diagnostics, "INVALID_DOCUMENT", pathFor(path, "layout"), "Recipe layout is required.", id);
  } else if (item.layout.mode === "manual") {
    validateAllowedKeys(item.layout, ["mode", "rows", "cols"], pathFor(path, "layout"), diagnostics, id);
    for (const key of ["rows", "cols"] as const) {
      const value = item.layout[key];
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        push(diagnostics, "INVALID_NUMBER", pathFor(pathFor(path, "layout"), key), "Grid counts must be positive integers.", id);
      }
    }
  } else if (item.layout.mode !== "auto") {
    push(diagnostics, "INVALID_DOCUMENT", pathFor(path, "layout"), "Recipe layout mode is unsupported.", id);
  } else {
    validateAllowedKeys(item.layout, ["mode"], pathFor(path, "layout"), diagnostics, id);
  }
  const crop = item.crop;
  if (!isRecord(crop)) {
    push(diagnostics, "INVALID_DOCUMENT", pathFor(path, "crop"), "Recipe crop settings are required.", id);
  } else {
    validateAllowedKeys(crop, ["threshold", "padding"], pathFor(path, "crop"), diagnostics, id);
    validateFiniteNumber(crop.threshold, `${path}.crop.threshold`, diagnostics);
    validateFiniteNumber(crop.padding, `${path}.crop.padding`, diagnostics);
  }
  const chroma = item.chroma;
  if (!isRecord(chroma)) {
    push(diagnostics, "INVALID_DOCUMENT", pathFor(path, "chroma"), "Recipe chroma settings are required.", id);
  } else {
    validateAllowedKeys(
      chroma,
      ["enabled", "color", "tolerance", "smoothness", "spill"],
      pathFor(path, "chroma"),
      diagnostics,
      id,
    );
    validateBoolean(chroma.enabled, `${path}.chroma.enabled`, diagnostics);
    validateString(chroma.color, `${path}.chroma.color`, diagnostics);
    for (const key of ["tolerance", "smoothness", "spill"] as const) {
      validateFiniteNumber(chroma[key], `${path}.chroma.${key}`, diagnostics);
    }
  }
  const pixel = item.pixel;
  if (!isRecord(pixel)) {
    push(diagnostics, "INVALID_DOCUMENT", pathFor(path, "pixel"), "Recipe pixel settings are required.", id);
  } else {
    validateAllowedKeys(
      pixel,
      ["enabled", "size", "quantize", "colors", "palette"],
      pathFor(path, "pixel"),
      diagnostics,
      id,
    );
    validateBoolean(pixel.enabled, `${path}.pixel.enabled`, diagnostics);
    validateBoolean(pixel.quantize, `${path}.pixel.quantize`, diagnostics);
    if (typeof pixel.size !== "number" || !Number.isInteger(pixel.size) || pixel.size <= 0) {
      push(diagnostics, "INVALID_NUMBER", `${path}.pixel.size`, "Pixel size must be a positive integer.", id);
    }
    if (typeof pixel.colors !== "number" || !Number.isInteger(pixel.colors) || pixel.colors <= 0) {
      push(diagnostics, "INVALID_NUMBER", `${path}.pixel.colors`, "Palette color count must be a positive integer.", id);
    }
    if (pixel.palette !== undefined) {
      if (!Array.isArray(pixel.palette)) {
        push(diagnostics, "INVALID_DOCUMENT", `${path}.pixel.palette`, "Palette must be an array of strings.", id);
      } else {
        pixel.palette.forEach((color, index) => validateString(color, `${path}.pixel.palette[${index}]`, diagnostics));
      }
    }
  }
}

function validateArtifact(
  item: GeneratedArtifact,
  path: string,
  id: string,
  assets: Map<EntityId, UnknownRecord>,
  recipes: Map<EntityId, UnknownRecord>,
  diagnostics: ProjectDiagnostic[],
): void {
  validateAllowedKeys(
    item as unknown as UnknownRecord,
    [
      "id",
      "name",
      "type",
      "outputAssetId",
      "sourceAssetId",
      "recipeId",
      "mimeType",
      "byteSize",
      "model",
      "prompt",
      "cost",
      "provenance",
      "createdAt",
      "updatedAt",
    ],
    path,
    diagnostics,
    id,
  );
  if (!isRecord(item) || !["ai", "export", "processed"].includes(item.type)) {
    push(diagnostics, "INVALID_DOCUMENT", pathFor(path, "type"), "Artifact type is unsupported.", id);
  }
  for (const key of ["name", "mimeType", "model", "prompt"] as const) {
    if (item[key] !== undefined) validateString(item[key], pathFor(path, key), diagnostics);
  }
  if ((item.type === "ai" || item.type === "processed") && item.outputAssetId === undefined) {
    push(diagnostics, "MISSING_REFERENCE", pathFor(path, "outputAssetId"), "Completed AI/processed artifacts require an output asset.", id);
  }
  if (item.outputAssetId !== undefined) validateReference(item.outputAssetId, pathFor(path, "outputAssetId"), assets, diagnostics, id);
  if (item.sourceAssetId !== undefined) validateReference(item.sourceAssetId, pathFor(path, "sourceAssetId"), assets, diagnostics, id);
  if (item.recipeId !== undefined) validateReference(item.recipeId, pathFor(path, "recipeId"), recipes, diagnostics, id);
  if (!isRecord(item.provenance)) {
    push(diagnostics, "INVALID_DOCUMENT", pathFor(path, "provenance"), "Completed artifacts require provenance.", id);
  } else {
    validateAllowedKeys(
      item.provenance,
      ["source", "recipeId", "parentArtifactId", "model", "prompt"],
      pathFor(path, "provenance"),
      diagnostics,
      id,
    );
    for (const key of ["source", "model", "prompt"] as const) {
      if (key === "source" || item.provenance[key] !== undefined) {
        validateString(item.provenance[key], `${path}.provenance.${key}`, diagnostics);
      }
    }
  }
  if (item.cost !== undefined) {
    if (!isRecord(item.cost)) {
      push(diagnostics, "INVALID_DOCUMENT", pathFor(path, "cost"), "Artifact cost must be an object.", id);
    } else {
      validateAllowedKeys(item.cost, ["amount", "currency"], pathFor(path, "cost"), diagnostics, id);
      if (
        typeof item.cost.amount !== "number" ||
        !Number.isFinite(item.cost.amount) ||
        item.cost.amount < 0
      ) {
        push(diagnostics, "INVALID_NUMBER", `${path}.cost.amount`, "Artifact cost must be non-negative.", id);
      }
      validateString(item.cost.currency, `${path}.cost.currency`, diagnostics);
    }
  }
  if (item.byteSize !== undefined && (typeof item.byteSize !== "number" || !Number.isInteger(item.byteSize) || item.byteSize < 0)) {
    push(diagnostics, "INVALID_NUMBER", pathFor(path, "byteSize"), "Artifact byteSize must be a non-negative integer.", id);
  }
}

function validateWorkspace(
  value: unknown,
  assets: Map<EntityId, UnknownRecord>,
  regions: Map<EntityId, UnknownRecord>,
  compositions: Map<EntityId, UnknownRecord>,
  layers: Map<EntityId, UnknownRecord>,
  variantSets: Map<EntityId, UnknownRecord>,
  sequences: Map<EntityId, UnknownRecord>,
  cels: Map<EntityId, UnknownRecord>,
  diagnostics: ProjectDiagnostic[],
): void {
  const path = "$.workspace";
  if (!isRecord(value)) {
    push(diagnostics, "INVALID_DOCUMENT", path, "Workspace state must be a plain object.");
    return;
  }
  validateAllowedKeys(
    value,
    [
      "activeWorkspace",
      "selectedAssetId",
      "selectedRegionId",
      "selectedCompositionId",
      "selectedLayerId",
      "selectedVariantSetId",
      "selectedSequenceId",
      "selectedCelIds",
    ],
    path,
    diagnostics,
  );
  if (value.activeWorkspace !== undefined && !["assets", "slice", "compose", "animate", "collision", "export"].includes(String(value.activeWorkspace))) {
    push(diagnostics, "INVALID_DOCUMENT", pathFor(path, "activeWorkspace"), "Unknown workspace.");
  }
  const refs: readonly [string, unknown, Map<EntityId, UnknownRecord>][] = [
    ["selectedAssetId", value.selectedAssetId, assets],
    ["selectedRegionId", value.selectedRegionId, regions],
    ["selectedCompositionId", value.selectedCompositionId, compositions],
    ["selectedLayerId", value.selectedLayerId, layers],
    ["selectedVariantSetId", value.selectedVariantSetId, variantSets],
    ["selectedSequenceId", value.selectedSequenceId, sequences],
  ];
  for (const [key, ref, records] of refs) {
    if (ref !== undefined) validateReference(ref, pathFor(path, key), records, diagnostics);
  }
  if (value.selectedCelIds !== undefined) {
    if (validateIdArray(value.selectedCelIds, pathFor(path, "selectedCelIds"), diagnostics)) {
      value.selectedCelIds.forEach((ref, index) => validateReference(ref, `${path}.selectedCelIds[${index}]`, cels, diagnostics));
    }
  }
}

function ownerKey(owner: unknown): string | undefined {
  if (!isRecord(owner) || typeof owner.type !== "string") return undefined;
  switch (owner.type) {
    case "region":
      return validId(owner.regionId) ? `region:${owner.regionId}` : undefined;
    case "composition":
      return validId(owner.compositionId) ? `composition:${owner.compositionId}` : undefined;
    case "cel":
      return validId(owner.celId) ? `cel:${owner.celId}` : undefined;
    default:
      return undefined;
  }
}

function validateOwnership(
  compositions: Map<EntityId, UnknownRecord>,
  layers: Map<EntityId, UnknownRecord>,
  variantSets: Map<EntityId, UnknownRecord>,
  cels: Map<EntityId, UnknownRecord>,
  sequences: Map<EntityId, UnknownRecord>,
  collisionSets: Map<EntityId, UnknownRecord>,
  diagnostics: ProjectDiagnostic[],
): void {
  const layerOwners = new Map<EntityId, string[]>();
  for (const [compositionId, composition] of compositions) {
    if (!Array.isArray(composition.layerIds)) continue;
    composition.layerIds.forEach((layerId, index) => {
      if (!validId(layerId)) return;
      const owners = layerOwners.get(layerId) ?? [];
      owners.push(compositionId);
      layerOwners.set(layerId, owners);
      const layer = layers.get(layerId);
      if (layer && layer.compositionId !== compositionId) {
        push(
          diagnostics,
          "OWNER_MISMATCH",
          `$.compositions.${compositionId}.layerIds[${index}]`,
          "Layer compositionId does not match its owning composition.",
          layerId,
        );
      }
    });
  }
  for (const [layerId, layer] of layers) {
    const owners = layerOwners.get(layerId) ?? [];
    if (owners.length === 0) {
      push(diagnostics, "OWNER_MISMATCH", `$.layers.${layerId}.compositionId`, "Layer is not owned by a composition.", layerId);
    } else if (owners.length > 1) {
      push(diagnostics, "DUPLICATE_OWNERSHIP", `$.layers.${layerId}.compositionId`, "Layer cannot be owned by multiple compositions.", layerId);
    }
    if (validId(layer.compositionId) && owners.length === 1 && owners[0] !== layer.compositionId) {
      push(diagnostics, "OWNER_MISMATCH", `$.layers.${layerId}.compositionId`, "Layer owner does not match compositionId.", layerId);
    }
  }

  const celOwners = new Map<EntityId, string[]>();
  for (const [sequenceId, sequence] of sequences) {
    if (!Array.isArray(sequence.celIds)) continue;
    sequence.celIds.forEach((celId, index) => {
      if (!validId(celId)) return;
      const owners = celOwners.get(celId) ?? [];
      owners.push(sequenceId);
      celOwners.set(celId, owners);
      const cel = cels.get(celId);
      if (cel && cel.sequenceId !== sequenceId) {
        push(
          diagnostics,
          "OWNER_MISMATCH",
          `$.sequences.${sequenceId}.celIds[${index}]`,
          "Cel sequenceId does not match its owning sequence.",
          celId,
        );
      }
    });
  }
  for (const [celId, cel] of cels) {
    const owners = celOwners.get(celId) ?? [];
    if (owners.length === 0) {
      push(diagnostics, "OWNER_MISMATCH", `$.cels.${celId}.sequenceId`, "Cel is not owned by a sequence.", celId);
    } else if (owners.length > 1) {
      push(diagnostics, "DUPLICATE_OWNERSHIP", `$.cels.${celId}.sequenceId`, "Cel cannot be owned by multiple sequences.", celId);
    }
    if (validId(cel.sequenceId) && owners.length === 1 && owners[0] !== cel.sequenceId) {
      push(diagnostics, "OWNER_MISMATCH", `$.cels.${celId}.sequenceId`, "Cel owner does not match sequenceId.", celId);
    }
  }

  const variantCompositionOwners = new Map<EntityId, string[]>();
  for (const [variantSetId, variantSet] of variantSets) {
    if (!isRecord(variantSet.variants)) continue;
    for (const key of Object.keys(variantSet.variants).sort()) {
      const compositionId = variantSet.variants[key];
      if (!validId(compositionId)) continue;
      const owners = variantCompositionOwners.get(compositionId) ?? [];
      owners.push(`${variantSetId}:${key}`);
      variantCompositionOwners.set(compositionId, owners);
      const composition = compositions.get(compositionId);
      if (composition && (!isRecord(composition.owner) || composition.owner.type !== "variantSet" || composition.owner.variantSetId !== variantSetId || composition.owner.variant !== key)) {
        push(
          diagnostics,
          "OWNER_MISMATCH",
          `$.variantSets.${variantSetId}.variants.${key}`,
          "Variant composition owner does not match the variant map.",
          compositionId,
        );
      }
    }
  }
  for (const [compositionId, owners] of variantCompositionOwners) {
    if (owners.length > 1) {
      push(diagnostics, "DUPLICATE_OWNERSHIP", `$.compositions.${compositionId}.owner`, "Composition cannot belong to multiple variants.", compositionId);
    }
  }

  for (const [compositionId, composition] of compositions) {
    const owner = composition.owner;
    if (!isRecord(owner)) continue;
    if (owner.type === "cel") {
      const cel = cels.get(owner.celId as EntityId);
      if (cel && (!isRecord(cel.source) || cel.source.type !== "composition" || cel.source.compositionId !== compositionId)) {
        push(diagnostics, "OWNER_MISMATCH", `$.compositions.${compositionId}.owner`, "Cel-owned composition is not the cel source.", compositionId);
      }
    } else if (owner.type === "variantSet") {
      const variantSet = variantSets.get(owner.variantSetId as EntityId);
      if (variantSet && (!isRecord(variantSet.variants) || variantSet.variants[owner.variant as string] !== compositionId)) {
        push(diagnostics, "OWNER_MISMATCH", `$.compositions.${compositionId}.owner`, "Variant composition is not listed by its variant set.", compositionId);
      }
    }
  }

  for (const [celId, cel] of cels) {
    if (!isRecord(cel.source)) continue;
    if (cel.source.type === "composition" && validId(cel.source.compositionId)) {
      const composition = compositions.get(cel.source.compositionId);
      if (
        composition &&
        (!isRecord(composition.owner) ||
          composition.owner.type !== "cel" ||
          composition.owner.celId !== celId)
      ) {
        push(
          diagnostics,
          "OWNER_MISMATCH",
          `$.cels.${celId}.source.compositionId`,
          "Cel source composition must be owned by that cel.",
          celId,
        );
      }
    }
    if (cel.source.type === "variantSet" && validId(cel.source.variantSetId)) {
      const variantSet = variantSets.get(cel.source.variantSetId);
      if (variantSet && variantSet.celId !== celId) {
        push(
          diagnostics,
          "OWNER_MISMATCH",
          `$.cels.${celId}.source.variantSetId`,
          "Cel source variant set must be owned by that cel.",
          celId,
        );
      }
    }
  }

  const variantSetOwners = new Map<EntityId, string[]>();
  for (const [celId, cel] of cels) {
    if (isRecord(cel.source) && cel.source.type === "variantSet" && validId(cel.source.variantSetId)) {
      const owners = variantSetOwners.get(cel.source.variantSetId) ?? [];
      owners.push(celId);
      variantSetOwners.set(cel.source.variantSetId, owners);
    }
  }
  for (const [variantSetId, variantSet] of variantSets) {
    const owners = variantSetOwners.get(variantSetId) ?? [];
    if (owners.length === 0) {
      push(diagnostics, "OWNER_MISMATCH", `$.variantSets.${variantSetId}.celId`, "Variant set is not the source of its owning cel.", variantSetId);
    } else if (owners.length > 1) {
      push(diagnostics, "DUPLICATE_OWNERSHIP", `$.variantSets.${variantSetId}.celId`, "Variant set cannot be shared by multiple cels.", variantSetId);
    }
    if (validId(variantSet.celId) && owners.length === 1 && owners[0] !== variantSet.celId) {
      push(diagnostics, "OWNER_MISMATCH", `$.variantSets.${variantSetId}.celId`, "Variant set celId does not match its source cel.", variantSetId);
    }
  }

  const collisionOwners = new Map<string, string[]>();
  for (const [collisionId, collision] of collisionSets) {
    const key = ownerKey(collision.owner);
    if (!key) continue;
    const owners = collisionOwners.get(key) ?? [];
    owners.push(collisionId);
    collisionOwners.set(key, owners);
  }
  for (const [key, collisionIds] of collisionOwners) {
    if (collisionIds.length > 1) {
      push(diagnostics, "DUPLICATE_OWNERSHIP", `$.collisionSets.${collisionIds[1]}.owner`, "An owner may have at most one CollisionSet in V1.", collisionIds[1]);
    }
    void key;
  }
}

function validateRootOrder(
  value: unknown,
  assets: Map<EntityId, UnknownRecord>,
  regions: Map<EntityId, UnknownRecord>,
  compositions: Map<EntityId, UnknownRecord>,
  sequences: Map<EntityId, UnknownRecord>,
  diagnostics: ProjectDiagnostic[],
): void {
  const path = "$.rootOrder";
  if (!isRecord(value)) {
    push(diagnostics, "INVALID_DOCUMENT", path, "rootOrder is required.");
    return;
  }
  validateAllowedKeys(
    value,
    ["assetIds", "regionIds", "compositionIds", "sequenceIds"],
    path,
    diagnostics,
  );
  validateOrder(value.assetIds, `${path}.assetIds`, assets, diagnostics);
  validateOrder(value.regionIds, `${path}.regionIds`, regions, diagnostics);
  const projectCompositionIds = new Set<EntityId>();
  for (const [id, composition] of compositions) {
    if (isRecord(composition.owner) && composition.owner.type === "project") projectCompositionIds.add(id);
  }
  validateOrder(value.compositionIds, `${path}.compositionIds`, compositions, diagnostics, projectCompositionIds);
  validateOrder(value.sequenceIds, `${path}.sequenceIds`, sequences, diagnostics);
}

function validateProvenanceConsistency(
  assets: Map<EntityId, UnknownRecord>,
  artifacts: Map<EntityId, UnknownRecord>,
  diagnostics: ProjectDiagnostic[],
): void {
  for (const [assetId, asset] of assets) {
    if (!isRecord(asset.provenance) || !validId(asset.provenance.artifactId)) continue;
    const artifact = artifacts.get(asset.provenance.artifactId);
    if (artifact && artifact.outputAssetId !== assetId) {
      push(
        diagnostics,
        "OWNER_MISMATCH",
        `$.assets.${assetId}.provenance.artifactId`,
        "Asset provenance artifact must point back to this output asset.",
        assetId,
      );
    }
  }

  for (const [artifactId, artifact] of artifacts) {
    if (validId(artifact.outputAssetId)) {
      const outputAsset = assets.get(artifact.outputAssetId);
      if (
        outputAsset &&
        (!isRecord(outputAsset.provenance) || outputAsset.provenance.artifactId !== artifactId)
      ) {
        push(
          diagnostics,
          "OWNER_MISMATCH",
          `$.generatedArtifacts.${artifactId}.outputAssetId`,
          "Artifact output asset must link back through provenance.artifactId.",
          artifactId,
        );
      }
      if (outputAsset && isRecord(outputAsset.provenance)) {
        if (
          validId(artifact.recipeId) &&
          validId(outputAsset.provenance.recipeId) &&
          outputAsset.provenance.recipeId !== artifact.recipeId
        ) {
          push(
            diagnostics,
            "OWNER_MISMATCH",
            `$.generatedArtifacts.${artifactId}.recipeId`,
            "Artifact recipe must match output asset provenance.",
            artifactId,
          );
        }
        if (
          validId(artifact.sourceAssetId) &&
          validId(outputAsset.provenance.parentAssetId) &&
          outputAsset.provenance.parentAssetId !== artifact.sourceAssetId
        ) {
          push(
            diagnostics,
            "OWNER_MISMATCH",
            `$.generatedArtifacts.${artifactId}.sourceAssetId`,
            "Artifact source asset must match output asset provenance.",
            artifactId,
          );
        }
      }
    }
    if (
      isRecord(artifact.provenance) &&
      validId(artifact.recipeId) &&
      validId(artifact.provenance.recipeId) &&
      artifact.provenance.recipeId !== artifact.recipeId
    ) {
      push(
        diagnostics,
        "OWNER_MISMATCH",
        `$.generatedArtifacts.${artifactId}.provenance.recipeId`,
        "Artifact provenance recipe must match artifact.recipeId.",
        artifactId,
      );
    }
  }
}

function validateEntityCollections(root: UnknownRecord, diagnostics: ProjectDiagnostic[]): {
  assets: Map<EntityId, UnknownRecord>;
  regions: Map<EntityId, UnknownRecord>;
  layers: Map<EntityId, UnknownRecord>;
  compositions: Map<EntityId, UnknownRecord>;
  variantSets: Map<EntityId, UnknownRecord>;
  cels: Map<EntityId, UnknownRecord>;
  sequences: Map<EntityId, UnknownRecord>;
  collisionSets: Map<EntityId, UnknownRecord>;
  processingRecipes: Map<EntityId, UnknownRecord>;
  generatedArtifacts: Map<EntityId, UnknownRecord>;
} {
  const records = {
    assets: collectionRecords(root, "assets", diagnostics),
    regions: collectionRecords(root, "regions", diagnostics),
    layers: collectionRecords(root, "layers", diagnostics),
    compositions: collectionRecords(root, "compositions", diagnostics),
    variantSets: collectionRecords(root, "variantSets", diagnostics),
    cels: collectionRecords(root, "cels", diagnostics),
    sequences: collectionRecords(root, "sequences", diagnostics),
    collisionSets: collectionRecords(root, "collisionSets", diagnostics),
    processingRecipes: collectionRecords(root, "processingRecipes", diagnostics),
    generatedArtifacts: collectionRecords(root, "generatedArtifacts", diagnostics),
  };
  void COLLECTION_NAMES;

  for (const [id, item] of records.assets) {
    const path = `$.assets.${id}`;
    validateAllowedKeys(
      item,
      [
        "id",
        "name",
        "blobKey",
        "contentHash",
        "mimeType",
        "width",
        "height",
        "byteSize",
        "createdAt",
        "updatedAt",
        "provenance",
      ],
      path,
      diagnostics,
      id,
    );
    validateString(item.name, `${path}.name`, diagnostics, "Asset name is required.");
    validateString(item.blobKey, `${path}.blobKey`, diagnostics, "Asset blobKey is required.");
    validateString(item.contentHash, `${path}.contentHash`, diagnostics, "Asset contentHash is required.");
    validateString(item.mimeType, `${path}.mimeType`, diagnostics, "Asset mimeType is required.");
    validateDimensions(item, path, diagnostics);
    if (typeof item.byteSize !== "number" || !Number.isInteger(item.byteSize) || item.byteSize < 0) {
      push(diagnostics, "INVALID_NUMBER", `${path}.byteSize`, "Asset byteSize must be a non-negative integer.", id);
    }
    if (!isRecord(item.provenance)) {
      push(diagnostics, "INVALID_DOCUMENT", `${path}.provenance`, "Asset provenance is required.", id);
    } else {
      validateAllowedKeys(
        item.provenance,
        ["source", "sourceId", "importedAt", "note", "recipeId", "artifactId", "parentAssetId"],
        `${path}.provenance`,
        diagnostics,
        id,
      );
      validateNonEmptyString(item.provenance.source, `${path}.provenance.source`, diagnostics, "Asset provenance source is required.");
      if (item.provenance.sourceId !== undefined) {
        validateString(item.provenance.sourceId, `${path}.provenance.sourceId`, diagnostics);
      }
      if (item.provenance.importedAt !== undefined) {
        validateTimestamp(item.provenance.importedAt, `${path}.provenance.importedAt`, diagnostics);
      }
      if (item.provenance.note !== undefined) {
        validateString(item.provenance.note, `${path}.provenance.note`, diagnostics);
      }
      if (item.provenance.recipeId !== undefined) {
        validateReference(item.provenance.recipeId, `${path}.provenance.recipeId`, records.processingRecipes, diagnostics, id);
      }
      if (item.provenance.artifactId !== undefined) {
        validateReference(item.provenance.artifactId, `${path}.provenance.artifactId`, records.generatedArtifacts, diagnostics, id);
      }
      if (item.provenance.parentAssetId !== undefined) {
        validateReference(item.provenance.parentAssetId, `${path}.provenance.parentAssetId`, records.assets, diagnostics, id);
        if (item.provenance.parentAssetId === id) {
          push(diagnostics, "OWNER_MISMATCH", `${path}.provenance.parentAssetId`, "Asset provenance cannot name itself as parent.", id);
        }
      }
    }
  }

  for (const [id, item] of records.regions) {
    const path = `$.regions.${id}`;
    validateAllowedKeys(
      item,
      ["id", "assetId", "name", "bounds", "pivot", "hidden", "createdAt", "updatedAt", "provenance"],
      path,
      diagnostics,
      id,
    );
    if (item.name !== undefined) validateString(item.name, `${path}.name`, diagnostics);
    validateReference(item.assetId, `${path}.assetId`, records.assets, diagnostics, id);
    validateRect(item.bounds, `${path}.bounds`, diagnostics);
    if (item.pivot !== undefined) validatePoint(item.pivot, `${path}.pivot`, diagnostics);
    if (item.hidden !== undefined) validateBoolean(item.hidden, `${path}.hidden`, diagnostics);
    if (item.provenance !== undefined) {
      if (!isRecord(item.provenance)) {
        push(diagnostics, "INVALID_DOCUMENT", `${path}.provenance`, "Region provenance must be an object.", id);
      } else {
        validateAllowedKeys(
          item.provenance,
          ["source", "sourceId", "importedAt", "note"],
          `${path}.provenance`,
          diagnostics,
          id,
        );
        validateNonEmptyString(item.provenance.source, `${path}.provenance.source`, diagnostics, "Region provenance source is required.");
        if (item.provenance.sourceId !== undefined) {
          validateString(item.provenance.sourceId, `${path}.provenance.sourceId`, diagnostics);
        }
        if (item.provenance.importedAt !== undefined) {
          validateTimestamp(item.provenance.importedAt, `${path}.provenance.importedAt`, diagnostics);
        }
        if (item.provenance.note !== undefined) {
          validateString(item.provenance.note, `${path}.provenance.note`, diagnostics);
        }
      }
    }
  }

  for (const [id, item] of records.compositions) {
    validateComposition(
      item as unknown as Composition,
      `$.compositions.${id}`,
      id,
      records.layers,
      records.cels,
      records.variantSets,
      diagnostics,
    );
  }
  for (const [id, item] of records.layers) {
    validateLayer(item as unknown as Layer, `$.layers.${id}`, id, records.assets, records.regions, records.compositions, diagnostics);
    if (item.visible !== undefined) validateBoolean(item.visible, `$.layers.${id}.visible`, diagnostics);
    if (item.locked !== undefined) validateBoolean(item.locked, `$.layers.${id}.locked`, diagnostics);
  }
  for (const [id, item] of records.variantSets) {
    validateVariantSet(item as unknown as VariantSet, `$.variantSets.${id}`, id, records.cels, records.compositions, diagnostics);
  }
  for (const [id, item] of records.sequences) {
    validateSequence(item as unknown as Sequence, `$.sequences.${id}`, id, records.cels, diagnostics);
  }
  for (const [id, item] of records.cels) {
    validateCel(item as unknown as Cel, `$.cels.${id}`, id, records.sequences, records.regions, records.compositions, records.variantSets, diagnostics);
  }
  for (const [id, item] of records.collisionSets) {
    validateCollisionSet(item as unknown as CollisionSet, `$.collisionSets.${id}`, id, records.regions, records.compositions, records.cels, diagnostics);
  }
  for (const [id, item] of records.processingRecipes) {
    validateRecipe(item as unknown as ProcessingRecipe, `$.processingRecipes.${id}`, id, records.assets, diagnostics);
  }
  for (const [id, item] of records.generatedArtifacts) {
    validateArtifact(
      item as unknown as GeneratedArtifact,
      `$.generatedArtifacts.${id}`,
      id,
      records.assets,
      records.processingRecipes,
      diagnostics,
    );
    if (isRecord(item.provenance)) {
      validateNonEmptyString(item.provenance.source, `$.generatedArtifacts.${id}.provenance.source`, diagnostics, "Artifact provenance source is required.");
      if (item.provenance.recipeId !== undefined) {
        validateReference(item.provenance.recipeId, `$.generatedArtifacts.${id}.provenance.recipeId`, records.processingRecipes, diagnostics, id);
      }
      if (item.provenance.parentArtifactId !== undefined) {
        validateReference(item.provenance.parentArtifactId, `$.generatedArtifacts.${id}.provenance.parentArtifactId`, records.generatedArtifacts, diagnostics, id);
        if (item.provenance.parentArtifactId === id) {
          push(diagnostics, "OWNER_MISMATCH", `$.generatedArtifacts.${id}.provenance.parentArtifactId`, "Artifact provenance cannot name itself as parent.", id);
        }
      }
    }
  }

  validateOwnership(records.compositions, records.layers, records.variantSets, records.cels, records.sequences, records.collisionSets, diagnostics);
  validateProvenanceConsistency(records.assets, records.generatedArtifacts, diagnostics);
  return records;
}

function validateStudioProjectInternal(input: unknown): ProjectValidationResult {
  const diagnostics: ProjectDiagnostic[] = [];
  inspectJson(input, "$", diagnostics, new WeakSet<object>());

  if (diagnostics.some(({ code }) => code === "NON_JSON_VALUE")) {
    return { valid: false, diagnostics: sortDiagnostics(diagnostics) };
  }

  if (!isRecord(input)) {
    push(diagnostics, "INVALID_DOCUMENT", "$", "A StudioProjectV1 document must be a plain object.");
    return { valid: false, diagnostics: sortDiagnostics(diagnostics) };
  }

  const root = input;
  validateAllowedKeys(
    root,
    [
      "schemaVersion",
      "id",
      "name",
      "createdAt",
      "updatedAt",
      "rootOrder",
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
      "workspace",
    ],
    "$",
    diagnostics,
  );
  if (!hasOwn(root, "schemaVersion") || typeof root.schemaVersion !== "number") {
    push(diagnostics, "INVALID_DOCUMENT", "$.schemaVersion", "schemaVersion must be numeric and present.");
  } else if (root.schemaVersion !== 1) {
    push(
      diagnostics,
      "UNSUPPORTED_SCHEMA_VERSION",
      "$.schemaVersion",
      "Only StudioProjectV1 (schemaVersion 1) is supported.",
    );
  }
  validateId(root.id, "$.id", diagnostics);
  validateString(root.name, "$.name", diagnostics, "Project name is required.");
  validateTimestamp(root.createdAt, "$.createdAt", diagnostics);
  validateTimestamp(root.updatedAt, "$.updatedAt", diagnostics);

  const rootOrder = root.rootOrder;
  const workspace = root.workspace;
  if (root.schemaVersion === 1) {
    const records = validateEntityCollections(root, diagnostics);
    validateRootOrder(rootOrder, records.assets, records.regions, records.compositions, records.sequences, diagnostics);
    validateWorkspace(workspace, records.assets, records.regions, records.compositions, records.layers, records.variantSets, records.sequences, records.cels, diagnostics);
  } else {
    if (!isRecord(rootOrder)) push(diagnostics, "INVALID_DOCUMENT", "$.rootOrder", "rootOrder is required.");
    if (!isRecord(workspace)) push(diagnostics, "INVALID_DOCUMENT", "$.workspace", "Workspace state must be a plain object.");
  }

  const ordered = sortDiagnostics(diagnostics);
  if (ordered.length > 0) return { valid: false, diagnostics: ordered };
  return { valid: true, diagnostics: [], project: input as unknown as StudioProjectV1 };
}

/** Validate any runtime value without mutating it or propagating inspection failures. */
export function validateStudioProject(input: unknown): ProjectValidationResult {
  try {
    return validateStudioProjectInternal(input);
  } catch {
    return {
      valid: false,
      diagnostics: [
        {
          code: "INVALID_DOCUMENT",
          path: "$",
          message: "The input could not be inspected as a StudioProjectV1 document.",
        },
      ],
    };
  }
}

export const validateProject = validateStudioProject;
