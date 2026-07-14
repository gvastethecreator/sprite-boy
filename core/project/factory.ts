import type { EntityId, ISO8601Timestamp, StudioProjectV1 } from "./schema";
import { isEntityId, isISO8601Timestamp } from "./primitives";

export type ProjectIdFactory = (() => EntityId) | { next: () => EntityId };
export type ProjectClock = (() => ISO8601Timestamp) | { now: () => ISO8601Timestamp };

export interface CreateEmptyStudioProjectOptions {
  /** Explicit project identity. Takes precedence over idFactory. */
  id?: EntityId;
  projectId?: EntityId;
  /** Stable name used for a newly-created untitled project. */
  name?: string;
  /** Clock injection for deterministic tests/migrations. */
  clock?: ProjectClock;
  /** A direct deterministic timestamp alternative to clock. */
  now?: ISO8601Timestamp;
  /** Optional identity source. No random/time based identity is generated. */
  idFactory?: ProjectIdFactory;
  createdAt?: ISO8601Timestamp;
  updatedAt?: ISO8601Timestamp;
}

const DEFAULT_PROJECT_ID = "project-empty";
const DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const DEFAULT_PROJECT_NAME = "Untitled project";

function nextProjectId(factory: ProjectIdFactory | undefined): EntityId {
  if (!factory) return DEFAULT_PROJECT_ID;
  return typeof factory === "function" ? factory() : factory.next();
}

function readTimestamp(options: CreateEmptyStudioProjectOptions): ISO8601Timestamp {
  if (options.now !== undefined) return options.now;
  if (!options.clock) return DEFAULT_TIMESTAMP;
  return typeof options.clock === "function" ? options.clock() : options.clock.now();
}

/**
 * Construct the smallest valid Studio document.  Defaults are deterministic;
 * callers creating durable user projects should inject an IdFactory and clock.
 */
export function createEmptyStudioProject(
  options: CreateEmptyStudioProjectOptions = {},
): StudioProjectV1 {
  const id = options.id ?? options.projectId ?? nextProjectId(options.idFactory);
  const timestamp = readTimestamp(options);
  const name = options.name ?? DEFAULT_PROJECT_NAME;
  const createdAt = options.createdAt ?? timestamp;
  const updatedAt = options.updatedAt ?? timestamp;

  if (!isEntityId(id)) throw new TypeError("Project ID must be a non-empty string.");
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new TypeError("Project name must be a non-empty string.");
  }
  if (!isISO8601Timestamp(createdAt) || !isISO8601Timestamp(updatedAt)) {
    throw new TypeError("Project timestamps must be valid ISO-8601 values with a timezone.");
  }

  return {
    schemaVersion: 1,
    id,
    name,
    createdAt,
    updatedAt,
    rootOrder: {
      assetIds: [],
      regionIds: [],
      compositionIds: [],
      sequenceIds: [],
    },
    assets: {},
    regions: {},
    layers: {},
    compositions: {},
    variantSets: {},
    cels: {},
    sequences: {},
    collisionSets: {},
    processingRecipes: {},
    generatedArtifacts: {},
    workspace: {},
  };
}
