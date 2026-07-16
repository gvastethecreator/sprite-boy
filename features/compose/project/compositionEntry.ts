import type {
  Composition,
  EntityId,
  ISO8601Timestamp,
  Layer,
  ProjectCommandDiagnostic,
  ProjectCommandEnvelope,
  StudioProjectV1,
} from "../../../core/project";
import { isEntityId, isISO8601Timestamp } from "../../../core/project";
import type { DeepReadonly, ProjectStore } from "../../../core/stores";

export type CompositionEntrySource =
  | { readonly type: "asset"; readonly id: EntityId }
  | { readonly type: "region"; readonly id: EntityId };

export interface CompositionEntryRequest {
  readonly source: CompositionEntrySource;
  readonly commandId: EntityId;
  readonly issuedAt: ISO8601Timestamp;
}

export interface CompositionEntryIdentity {
  readonly compositionId: EntityId;
  readonly layerId: EntityId;
}

export interface CompositionEntryDimensions {
  readonly width: number;
  readonly height: number;
}

export const COMPOSITION_ENTRY_POLICY = Object.freeze({
  assetCanvas: "intrinsic-asset-dimensions",
  regionCanvas: "region-bounds-dimensions",
  initialLayerTransform: "identity-at-canvas-origin",
  initialBackground: null,
} as const);

export type CompositionEntryFailureCode =
  | "INVALID_REQUEST"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_REFERENCE_MISSING"
  | "IDENTITY_CONFLICT"
  | "STORE_UNAVAILABLE"
  | "DISPATCH_REJECTED";

export interface CompositionEntryFailure {
  readonly ok: false;
  readonly code: CompositionEntryFailureCode;
  readonly message: string;
  readonly revision?: number;
  readonly diagnostics?: readonly ProjectCommandDiagnostic[];
}

export interface CompositionEntryReadyIntent {
  readonly ok: true;
  readonly outcome: "create" | "open" | "already-open";
  readonly source: CompositionEntrySource;
  readonly sourceAssetId: EntityId;
  readonly compositionId: EntityId;
  readonly layerId?: EntityId;
  readonly dimensions: CompositionEntryDimensions;
  readonly envelope?: ProjectCommandEnvelope;
}

export type CompositionEntryIntent = CompositionEntryReadyIntent | CompositionEntryFailure;

export interface CompositionEntryOpenSuccess {
  readonly ok: true;
  readonly outcome: "created" | "opened" | "already-open";
  readonly source: CompositionEntrySource;
  readonly sourceAssetId: EntityId;
  readonly compositionId: EntityId;
  readonly layerId?: EntityId;
  readonly dimensions: CompositionEntryDimensions;
  readonly revision: number;
  readonly dispatched: boolean;
}

export type CompositionEntryOpenResult = CompositionEntryOpenSuccess | CompositionEntryFailure;

interface OwnDataProperty {
  readonly present: boolean;
  readonly value?: unknown;
}

interface ResolvedSource {
  readonly source: CompositionEntrySource;
  readonly assetId: EntityId;
  readonly displayName: string;
  readonly dimensions: CompositionEntryDimensions;
}

function deepFreezeOwned<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreezeOwned(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function failure(
  code: CompositionEntryFailureCode,
  message: string,
  options: {
    readonly revision?: number;
    readonly diagnostics?: readonly ProjectCommandDiagnostic[];
  } = {},
): CompositionEntryFailure {
  return deepFreezeOwned({
    ok: false,
    code,
    message,
    ...(options.revision !== undefined ? { revision: options.revision } : {}),
    ...(options.diagnostics
      ? {
          diagnostics: options.diagnostics.map((diagnostic) => ({
            code: diagnostic.code,
            message: diagnostic.message,
            ...(diagnostic.path !== undefined ? { path: diagnostic.path } : {}),
            ...(diagnostic.entity !== undefined
              ? {
                  entity: {
                    collection: diagnostic.entity.collection,
                    id: diagnostic.entity.id,
                  },
                }
              : {}),
          })),
        }
      : {}),
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readOwnData(record: object, key: string): OwnDataProperty | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return { present: false };
  if (!("value" in descriptor) || !descriptor.enumerable) return undefined;
  return { present: true, value: descriptor.value };
}

function hasOnlyKeys(record: object, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Reflect.ownKeys(record).every(
    (key) => typeof key === "string" && allowedKeys.has(key),
  );
}

function readRecordEntry(record: unknown, key: EntityId): unknown {
  if (!isPlainRecord(record)) return undefined;
  const property = readOwnData(record, key);
  return property?.present ? property.value : undefined;
}

function readEntityIdArray(value: unknown): readonly EntityId[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (!length || !("value" in length) || !Number.isSafeInteger(length.value) || length.value < 0) {
    return undefined;
  }
  const ids: EntityId[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const item = readOwnData(value, String(index));
    if (!item?.present || !isEntityId(item.value)) return undefined;
    ids.push(item.value);
  }
  if (Reflect.ownKeys(value).length !== ids.length + 1) return undefined;
  return ids;
}

function isPositiveDimension(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function encodeIdentityPart(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return encoded;
}

/** Stable, collision-free across Asset/Region source namespaces and UTF-16 IDs. */
export function deriveCompositionEntryIdentity(
  source: CompositionEntrySource,
): CompositionEntryIdentity {
  const sourceKey = `${source.type}-${encodeIdentityPart(source.id)}`;
  return Object.freeze({
    compositionId: `compose-entry-${sourceKey}`,
    layerId: `compose-entry-layer-${sourceKey}`,
  });
}

function readRequest(request: unknown):
  | { readonly ok: true; readonly request: CompositionEntryRequest }
  | CompositionEntryFailure {
  try {
    if (!isPlainRecord(request) || !hasOnlyKeys(request, ["source", "commandId", "issuedAt"])) {
      return failure("INVALID_REQUEST", "Composition entry request must contain source, commandId and issuedAt only.");
    }
    const sourceProperty = readOwnData(request, "source");
    const commandIdProperty = readOwnData(request, "commandId");
    const issuedAtProperty = readOwnData(request, "issuedAt");
    if (!sourceProperty?.present || !isPlainRecord(sourceProperty.value)) {
      return failure("INVALID_REQUEST", "Composition entry source must be a plain data object.");
    }
    if (!hasOnlyKeys(sourceProperty.value, ["type", "id"])) {
      return failure("INVALID_REQUEST", "Composition entry source accepts only type and id.");
    }
    const typeProperty = readOwnData(sourceProperty.value, "type");
    const idProperty = readOwnData(sourceProperty.value, "id");
    if (
      !typeProperty?.present ||
      (typeProperty.value !== "asset" && typeProperty.value !== "region") ||
      !idProperty?.present ||
      !isEntityId(idProperty.value)
    ) {
      return failure("INVALID_REQUEST", "Composition entry source must identify an Asset or Region.");
    }
    if (!commandIdProperty?.present || !isEntityId(commandIdProperty.value)) {
      return failure("INVALID_REQUEST", "Composition entry commandId must be an EntityId.");
    }
    if (!issuedAtProperty?.present || !isISO8601Timestamp(issuedAtProperty.value)) {
      return failure("INVALID_REQUEST", "Composition entry issuedAt must be an ISO-8601 timestamp.");
    }
    return {
      ok: true,
      request: {
        source: { type: typeProperty.value, id: idProperty.value },
        commandId: commandIdProperty.value,
        issuedAt: issuedAtProperty.value,
      },
    };
  } catch {
    return failure("INVALID_REQUEST", "Composition entry request could not be inspected safely.");
  }
}

function readNamedDimensions(
  record: unknown,
  expectedId: EntityId,
): { readonly name: string; readonly width: number; readonly height: number } | undefined {
  if (!isPlainRecord(record)) return undefined;
  const id = readOwnData(record, "id");
  const name = readOwnData(record, "name");
  const width = readOwnData(record, "width");
  const height = readOwnData(record, "height");
  if (
    !id?.present || id.value !== expectedId ||
    !name?.present || typeof name.value !== "string" || name.value.trim().length === 0 ||
    !width?.present || !isPositiveDimension(width.value) ||
    !height?.present || !isPositiveDimension(height.value)
  ) return undefined;
  return { name: name.value, width: width.value, height: height.value };
}

function resolveSource(
  project: DeepReadonly<StudioProjectV1>,
  source: CompositionEntrySource,
): ResolvedSource | CompositionEntryFailure {
  try {
    if (!isPlainRecord(project)) {
      return failure("STORE_UNAVAILABLE", "Project snapshot is not a plain canonical document.");
    }
    const assetsProperty = readOwnData(project, "assets");
    const regionsProperty = readOwnData(project, "regions");
    if (!assetsProperty?.present || !regionsProperty?.present) {
      return failure("STORE_UNAVAILABLE", "Project snapshot does not expose canonical Asset and Region collections.");
    }

    if (source.type === "asset") {
      const asset = readNamedDimensions(
        readRecordEntry(assetsProperty.value, source.id),
        source.id,
      );
      if (!asset) {
        return failure("SOURCE_NOT_FOUND", `Asset ${source.id} is missing or invalid.`);
      }
      return {
        source,
        assetId: source.id,
        displayName: asset.name,
        dimensions: { width: asset.width, height: asset.height },
      };
    }

    const region = readRecordEntry(regionsProperty.value, source.id);
    if (!isPlainRecord(region)) {
      return failure("SOURCE_NOT_FOUND", `Region ${source.id} is missing or invalid.`);
    }
    const regionId = readOwnData(region, "id");
    const assetId = readOwnData(region, "assetId");
    const name = readOwnData(region, "name");
    const bounds = readOwnData(region, "bounds");
    if (
      !regionId?.present || regionId.value !== source.id ||
      !assetId?.present || !isEntityId(assetId.value) ||
      !bounds?.present || !isPlainRecord(bounds.value)
    ) {
      return failure("SOURCE_NOT_FOUND", `Region ${source.id} is missing or invalid.`);
    }
    const width = readOwnData(bounds.value, "width");
    const height = readOwnData(bounds.value, "height");
    if (!width?.present || !isPositiveDimension(width.value) || !height?.present || !isPositiveDimension(height.value)) {
      return failure("SOURCE_NOT_FOUND", `Region ${source.id} has invalid bounds dimensions.`);
    }
    const asset = readNamedDimensions(
      readRecordEntry(assetsProperty.value, assetId.value),
      assetId.value,
    );
    if (!asset) {
      return failure(
        "SOURCE_REFERENCE_MISSING",
        `Region ${source.id} references missing Asset ${assetId.value}.`,
      );
    }
    const regionName = name?.present && typeof name.value === "string" && name.value.trim().length > 0
      ? name.value
      : asset.name;
    return {
      source,
      assetId: assetId.value,
      displayName: regionName,
      dimensions: { width: width.value, height: height.value },
    };
  } catch {
    return failure("STORE_UNAVAILABLE", "Project source graph could not be inspected safely.");
  }
}

function readExistingComposition(
  project: DeepReadonly<StudioProjectV1>,
  resolved: ResolvedSource,
  identity: CompositionEntryIdentity,
):
  | { readonly exists: false }
  | { readonly exists: true; readonly layerId?: EntityId; readonly dimensions: CompositionEntryDimensions }
  | CompositionEntryFailure {
  try {
    const compositions = readOwnData(project, "compositions");
    const layers = readOwnData(project, "layers");
    if (!compositions?.present || !layers?.present) {
      return failure("STORE_UNAVAILABLE", "Project snapshot does not expose canonical Composition and Layer collections.");
    }
    const existing = readRecordEntry(compositions.value, identity.compositionId);
    const reservedLayer = readRecordEntry(layers.value, identity.layerId);
    if (existing === undefined) {
      if (reservedLayer !== undefined) {
        return failure(
          "IDENTITY_CONFLICT",
          `Reserved Layer identity ${identity.layerId} is already in use.`,
        );
      }
      return { exists: false };
    }
    if (!isPlainRecord(existing)) {
      return failure("IDENTITY_CONFLICT", `Reserved Composition identity ${identity.compositionId} is invalid.`);
    }
    const id = readOwnData(existing, "id");
    const owner = readOwnData(existing, "owner");
    const layerIdsProperty = readOwnData(existing, "layerIds");
    const width = readOwnData(existing, "width");
    const height = readOwnData(existing, "height");
    if (
      !id?.present || id.value !== identity.compositionId ||
      !owner?.present || !isPlainRecord(owner.value) ||
      readOwnData(owner.value, "type")?.value !== "project" ||
      !layerIdsProperty?.present ||
      !width?.present || width.value !== resolved.dimensions.width ||
      !height?.present || height.value !== resolved.dimensions.height
    ) {
      return failure(
        "IDENTITY_CONFLICT",
        `Reserved Composition identity ${identity.compositionId} belongs to another graph entity.`,
      );
    }
    const layerIds = readEntityIdArray(layerIdsProperty.value);
    if (!layerIds) {
      return failure(
        "IDENTITY_CONFLICT",
        `Reserved Composition identity ${identity.compositionId} has invalid Layer order.`,
      );
    }
    const source = isPlainRecord(reservedLayer)
      ? readOwnData(reservedLayer, "source")
      : undefined;
    if (
      layerIds.length !== 1 || layerIds[0] !== identity.layerId ||
      !isPlainRecord(reservedLayer) ||
      readOwnData(reservedLayer, "id")?.value !== identity.layerId ||
      readOwnData(reservedLayer, "compositionId")?.value !== identity.compositionId ||
      !source?.present ||
      !isPlainRecord(source.value) ||
      !hasOnlyKeys(source.value, ["type", "id"]) ||
      readOwnData(source.value, "type")?.value !== resolved.source.type ||
      readOwnData(source.value, "id")?.value !== resolved.source.id
    ) {
      return failure(
        "IDENTITY_CONFLICT",
        `Reserved Layer identity ${identity.layerId} does not match the requested source graph.`,
      );
    }
    return {
      exists: true,
      layerId: identity.layerId,
      dimensions: { width: width.value, height: height.value },
    };
  } catch {
    return failure("STORE_UNAVAILABLE", "Project Composition identities could not be inspected safely.");
  }
}

function workspacePatch(
  resolved: ResolvedSource,
  compositionId: EntityId,
  layerId: EntityId | undefined,
): Extract<ProjectCommandEnvelope["command"], { type: "workspace.update" }> {
  return {
    type: "workspace.update",
    patch: {
      activeWorkspace: "compose",
      selectedAssetId: resolved.assetId,
      selectedRegionId: resolved.source.type === "region" ? resolved.source.id : undefined,
      selectedCompositionId: compositionId,
      selectedLayerId: layerId,
    },
  };
}

function workspaceAlreadyOpen(
  project: DeepReadonly<StudioProjectV1>,
  resolved: ResolvedSource,
  compositionId: EntityId,
  layerId: EntityId | undefined,
): boolean {
  const workspace = project.workspace;
  return workspace.activeWorkspace === "compose" &&
    workspace.selectedAssetId === resolved.assetId &&
    workspace.selectedRegionId === (resolved.source.type === "region" ? resolved.source.id : undefined) &&
    workspace.selectedCompositionId === compositionId &&
    workspace.selectedLayerId === layerId;
}

function metadata(request: CompositionEntryRequest): ProjectCommandEnvelope["metadata"] {
  return {
    commandId: request.commandId,
    origin: "user",
    history: "record",
    issuedAt: request.issuedAt,
  };
}

function createInitialLayer(
  resolved: ResolvedSource,
  identity: CompositionEntryIdentity,
  now: ISO8601Timestamp,
): Layer {
  return {
    id: identity.layerId,
    compositionId: identity.compositionId,
    name: resolved.displayName,
    source: { type: resolved.source.type, id: resolved.source.id },
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
      flipX: false,
      flipY: false,
    },
    visible: true,
    locked: false,
    createdAt: now,
    updatedAt: now,
  };
}

function createInitialComposition(
  resolved: ResolvedSource,
  identity: CompositionEntryIdentity,
  now: ISO8601Timestamp,
): Composition {
  return {
    id: identity.compositionId,
    name: `${resolved.displayName} composition`,
    owner: { type: "project" },
    layerIds: [identity.layerId],
    width: resolved.dimensions.width,
    height: resolved.dimensions.height,
    background: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Build a deterministic, data-only open/create intent without mutating the Project graph. */
export function createCompositionEntryIntent(
  project: DeepReadonly<StudioProjectV1>,
  input: CompositionEntryRequest,
): CompositionEntryIntent {
  const requestResult = readRequest(input);
  if (!requestResult.ok) return requestResult;
  const request = requestResult.request;
  const resolved = resolveSource(project, request.source);
  if (!("source" in resolved)) return resolved;
  const identity = deriveCompositionEntryIdentity(resolved.source);
  const existing = readExistingComposition(project, resolved, identity);
  if ("ok" in existing) return existing;

  if (existing.exists) {
    const intent = {
      ok: true,
      outcome: workspaceAlreadyOpen(
        project,
        resolved,
        identity.compositionId,
        existing.layerId,
      ) ? "already-open" as const : "open" as const,
      source: { ...resolved.source },
      sourceAssetId: resolved.assetId,
      compositionId: identity.compositionId,
      ...(existing.layerId !== undefined ? { layerId: existing.layerId } : {}),
      dimensions: { ...existing.dimensions },
      ...(workspaceAlreadyOpen(project, resolved, identity.compositionId, existing.layerId)
        ? {}
        : {
            envelope: {
              command: workspacePatch(resolved, identity.compositionId, existing.layerId),
              metadata: metadata(request),
            },
          }),
    } satisfies CompositionEntryReadyIntent;
    return deepFreezeOwned(intent);
  }

  const layer = createInitialLayer(resolved, identity, request.issuedAt);
  const composition = createInitialComposition(resolved, identity, request.issuedAt);
  return deepFreezeOwned({
    ok: true,
    outcome: "create",
    source: { ...resolved.source },
    sourceAssetId: resolved.assetId,
    compositionId: identity.compositionId,
    layerId: identity.layerId,
    dimensions: { ...resolved.dimensions },
    envelope: {
      command: {
        type: "command.batch",
        commands: [
          { type: "composition.create", composition, layers: [layer] },
          workspacePatch(resolved, identity.compositionId, identity.layerId),
        ],
      },
      metadata: metadata(request),
    },
  } satisfies CompositionEntryReadyIntent);
}

/** Dispatch the intent through the one canonical ProjectStore boundary. */
export function openCompositionFromSource(
  store: ProjectStore,
  request: CompositionEntryRequest,
): CompositionEntryOpenResult {
  let snapshot: ReturnType<ProjectStore["getSnapshot"]>;
  try {
    snapshot = store.getSnapshot();
  } catch {
    return failure("STORE_UNAVAILABLE", "ProjectStore snapshot could not be read.");
  }
  const intent = createCompositionEntryIntent(snapshot.project, request);
  if (!intent.ok) {
    return failure(intent.code, intent.message, {
      revision: snapshot.revision,
      ...(intent.diagnostics ? { diagnostics: intent.diagnostics } : {}),
    });
  }
  if (intent.outcome === "already-open") {
    return deepFreezeOwned({
      ok: true,
      outcome: "already-open",
      source: { ...intent.source },
      sourceAssetId: intent.sourceAssetId,
      compositionId: intent.compositionId,
      ...(intent.layerId !== undefined ? { layerId: intent.layerId } : {}),
      dimensions: { ...intent.dimensions },
      revision: snapshot.revision,
      dispatched: false,
    });
  }
  if (!intent.envelope) {
    return failure("STORE_UNAVAILABLE", "Composition entry intent did not provide a command envelope.", {
      revision: snapshot.revision,
    });
  }

  try {
    const dispatched = store.dispatch(intent.envelope);
    if (!dispatched.result.ok) {
      return failure(
        "DISPATCH_REJECTED",
        "ProjectStore rejected the atomic Composition entry command.",
        { revision: dispatched.revision, diagnostics: dispatched.result.diagnostics },
      );
    }
    return deepFreezeOwned({
      ok: true,
      outcome: intent.outcome === "create" ? "created" : "opened",
      source: { ...intent.source },
      sourceAssetId: intent.sourceAssetId,
      compositionId: intent.compositionId,
      ...(intent.layerId !== undefined ? { layerId: intent.layerId } : {}),
      dimensions: { ...intent.dimensions },
      revision: dispatched.revision,
      dispatched: true,
    });
  } catch {
    return failure("STORE_UNAVAILABLE", "ProjectStore dispatch could not be completed.", {
      revision: snapshot.revision,
    });
  }
}
