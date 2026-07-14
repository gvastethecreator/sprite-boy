import type {
  EntityId,
  ProjectRecordCollection,
  StudioProjectV1,
} from "./schema";
import { isEntityId } from "./primitives";

export type ProjectRevision = number;

export interface ProjectSnapshot {
  readonly project: StudioProjectV1;
  readonly revision: ProjectRevision;
}

export function createProjectSnapshot(
  project: StudioProjectV1,
  revision: ProjectRevision = 0,
): ProjectSnapshot {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new RangeError("Project revision must be a non-negative safe integer.");
  }
  return Object.freeze({ project, revision });
}

export function advanceProjectSnapshot(
  snapshot: ProjectSnapshot,
  project: StudioProjectV1,
): ProjectSnapshot {
  return createProjectSnapshot(project, snapshot.revision + 1);
}

export function getProjectEntity(
  project: StudioProjectV1,
  collection: ProjectRecordCollection,
  id: EntityId,
): StudioProjectV1[ProjectRecordCollection][EntityId] | undefined {
  return project[collection][id];
}

export function hasProjectEntity(
  project: StudioProjectV1,
  collection: ProjectRecordCollection,
  id: EntityId,
): boolean {
  return Object.prototype.hasOwnProperty.call(project[collection], id);
}

export function cloneStudioProject(project: StudioProjectV1): StudioProjectV1 {
  return JSON.parse(JSON.stringify(project)) as StudioProjectV1;
}

export function insertOrderedId(
  order: readonly EntityId[],
  id: EntityId,
  atIndex: number = order.length,
): EntityId[] {
  if (!isEntityId(id)) throw new TypeError("Ordered entity ID must be a non-empty string.");
  if (order.includes(id)) throw new Error(`Order already contains entity ${id}.`);
  if (!Number.isInteger(atIndex) || atIndex < 0 || atIndex > order.length) {
    throw new RangeError("Insertion index is outside the order bounds.");
  }
  return [...order.slice(0, atIndex), id, ...order.slice(atIndex)];
}

export function removeOrderedId(order: readonly EntityId[], id: EntityId): EntityId[] {
  if (!isEntityId(id)) throw new TypeError("Ordered entity ID must be a non-empty string.");
  const index = order.indexOf(id);
  if (index < 0) throw new Error(`Order does not contain entity ${id}.`);
  return [...order.slice(0, index), ...order.slice(index + 1)];
}

export function moveOrderedId(
  order: readonly EntityId[],
  id: EntityId,
  toIndex: number,
): EntityId[] {
  if (!isEntityId(id)) throw new TypeError("Ordered entity ID must be a non-empty string.");
  const fromIndex = order.indexOf(id);
  if (fromIndex < 0) throw new Error(`Order does not contain entity ${id}.`);
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= order.length) {
    throw new RangeError("Destination index is outside the order bounds.");
  }
  if (fromIndex === toIndex) return [...order];
  const next = [...order];
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, id);
  return next;
}
