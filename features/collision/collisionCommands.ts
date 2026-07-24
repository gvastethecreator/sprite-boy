/**
 * Canonical Collision workspace helpers — pure command builders over ProjectStore.
 */
import type {
  CollisionOwner,
  CollisionSet,
  CollisionShape,
  CollisionShapeType,
  EntityId,
  ISO8601Timestamp,
  ProjectCommandEnvelope,
  StudioProjectV1,
} from "../../core/project";
import type { DeepReadonly, ProjectStore } from "../../core/stores";

export interface EnsureCollisionSetRequest {
  readonly collisionSetId: EntityId;
  readonly owner: CollisionOwner;
  readonly commandId: EntityId;
  readonly issuedAt: ISO8601Timestamp;
}

export interface AddCollisionShapeRequest {
  readonly collisionSetId: EntityId;
  readonly shape: CollisionShape;
  readonly commandId: EntityId;
  readonly issuedAt: ISO8601Timestamp;
}

function metadata(commandId: EntityId, issuedAt: ISO8601Timestamp) {
  return {
    commandId,
    origin: "user" as const,
    history: "record" as const,
    issuedAt,
  };
}

export function listCollisionSets(
  project: DeepReadonly<StudioProjectV1>,
): readonly CollisionSet[] {
  return Object.freeze(
    Object.values(project.collisionSets).map((set) => Object.freeze({ ...set, shapes: [...set.shapes] })),
  );
}

export function buildCollisionSetCreateEnvelope(
  request: EnsureCollisionSetRequest,
): ProjectCommandEnvelope {
  const collisionSet: CollisionSet = {
    id: request.collisionSetId,
    owner: request.owner,
    shapes: [],
    createdAt: request.issuedAt,
    updatedAt: request.issuedAt,
  };
  return {
    command: { type: "collisionSet.create", collisionSet },
    metadata: metadata(request.commandId, request.issuedAt),
  };
}

export function buildCollisionAddEnvelope(
  request: AddCollisionShapeRequest,
): ProjectCommandEnvelope {
  return {
    command: {
      type: "collision.add",
      collisionSetId: request.collisionSetId,
      shape: request.shape,
    },
    metadata: metadata(request.commandId, request.issuedAt),
  };
}

export function ensureRegionCollisionSet(
  store: ProjectStore,
  regionId: EntityId,
  ids: { collisionSetId: EntityId; commandId: EntityId; issuedAt: ISO8601Timestamp },
): { ok: true; collisionSetId: EntityId; revision: number } | { ok: false; message: string } {
  const snap = store.getSnapshot();
  const region = snap.project.regions[regionId];
  if (!region) return { ok: false, message: "Region not found." };
  const existing = Object.values(snap.project.collisionSets).find(
    (set) => set.owner.type === "region" && set.owner.regionId === regionId,
  );
  if (existing) {
    return { ok: true, collisionSetId: existing.id, revision: snap.revision };
  }
  const envelope = buildCollisionSetCreateEnvelope({
    collisionSetId: ids.collisionSetId,
    owner: { type: "region", regionId },
    commandId: ids.commandId,
    issuedAt: ids.issuedAt,
  });
  const result = store.dispatch({ command: envelope.command, metadata: envelope.metadata });
  if (!result.result.ok) {
    return { ok: false, message: result.result.diagnostics[0]?.message ?? "Dispatch rejected." };
  }
  return {
    ok: true,
    collisionSetId: ids.collisionSetId,
    revision: result.revision,
  };
}

export function addDefaultHitbox(
  store: ProjectStore,
  collisionSetId: EntityId,
  shapeId: EntityId,
  bounds: { x: number; y: number; width: number; height: number },
  ids: { commandId: EntityId; issuedAt: ISO8601Timestamp },
  type: CollisionShapeType = "hitbox",
): { ok: true; revision: number } | { ok: false; message: string } {
  const envelope = buildCollisionAddEnvelope({
    collisionSetId,
    shape: {
      id: shapeId,
      type,
      bounds,
      tag: "body",
    },
    commandId: ids.commandId,
    issuedAt: ids.issuedAt,
  });
  const result = store.dispatch({ command: envelope.command, metadata: envelope.metadata });
  if (!result.result.ok) {
    return { ok: false, message: result.result.diagnostics[0]?.message ?? "Dispatch rejected." };
  }
  return { ok: true, revision: result.revision };
}
