import type { EntityId, StudioProjectV1 } from "./schema";
import { cloneStudioProject } from "./graph";
import type {
  ChangedEntityIds,
  CommandImpact,
  EntityReference,
  ProjectCommandDiagnostic,
  ProjectCommandInverse,
  ProjectCommandResult,
} from "./commands";
import { validateStudioProject } from "./validation";

export function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function commandDiagnostic(
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

export function commandFailure(
  project: StudioProjectV1,
  diagnostics: ProjectCommandDiagnostic[],
): ProjectCommandResult {
  return { ok: false, project, diagnostics };
}

export function entityReference(
  collection: EntityReference["collection"],
  id: EntityId,
): EntityReference {
  return { collection, id };
}

export function directCommandImpact(direct: EntityReference[]): CommandImpact {
  return { direct, referencedBy: [], cascades: [], blockers: [] };
}

export function noChangeCommandResult(
  project: StudioProjectV1,
  impact: CommandImpact,
  inverse: ProjectCommandInverse,
): ProjectCommandResult {
  return {
    ok: true,
    project,
    changedIds: {},
    warnings: [{ code: "NO_CHANGES", message: "The command produced no document changes." }],
    impact,
    inverse,
  };
}

/** Compare JSON-domain values without depending on object key insertion order. */
export function jsonValuesEqual(
  left: unknown,
  right: unknown,
  seen = new WeakMap<object, WeakSet<object>>(),
): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;

  const knownRights = seen.get(left);
  if (knownRights?.has(right)) return true;
  const rights = knownRights ?? new WeakSet<object>();
  rights.add(right);
  if (!knownRights) seen.set(left, rights);

  const leftKeys = Reflect.ownKeys(left).sort((a, b) => String(a).localeCompare(String(b)));
  const rightKeys = Reflect.ownKeys(right).sort((a, b) => String(a).localeCompare(String(b)));
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    const leftKey = leftKeys[index];
    const rightKey = rightKeys[index];
    if (leftKey !== rightKey) return false;
    const leftDescriptor = Object.getOwnPropertyDescriptor(left, leftKey);
    const rightDescriptor = Object.getOwnPropertyDescriptor(right, rightKey);
    if (!leftDescriptor || !rightDescriptor) return false;
    if (!("value" in leftDescriptor) || !("value" in rightDescriptor)) return false;
    if (
      leftDescriptor.enumerable !== rightDescriptor.enumerable ||
      leftDescriptor.configurable !== rightDescriptor.configurable ||
      leftDescriptor.writable !== rightDescriptor.writable
    ) return false;
    if (!jsonValuesEqual(leftDescriptor.value, rightDescriptor.value, seen)) return false;
  }
  return true;
}

function invariantFailure(
  project: StudioProjectV1,
  validation: ReturnType<typeof validateStudioProject>,
): ProjectCommandResult {
  return commandFailure(
    project,
    validation.diagnostics.map((item) =>
      commandDiagnostic("INVARIANT_VIOLATION", item.message, item.path),
    ),
  );
}

export function finalizeCommandMutation(
  original: StudioProjectV1,
  candidate: StudioProjectV1,
  changedIds: ChangedEntityIds,
  impact: CommandImpact,
  inverse: ProjectCommandInverse,
): ProjectCommandResult {
  const validation = validateStudioProject(candidate);
  if (!validation.valid) return invariantFailure(original, validation);
  const semantic = inverse.type === "project.restoreSnapshot" ? inverse.semantic : inverse;
  return {
    ok: true,
    project: candidate,
    changedIds,
    warnings: [],
    impact,
    inverse: {
      type: "project.restoreSnapshot",
      project: cloneStudioProject(original),
      ...(semantic ? { semantic } : {}),
    },
  };
}

/** Clone a payload without invoking accessors or erasing unsupported values. */
export function cloneCommandPayload<T>(value: T, seen = new WeakMap<object, unknown>()): T {
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
      if ("value" in descriptor) descriptor.value = cloneCommandPayload(descriptor.value, seen);
      Object.defineProperty(target, key, descriptor);
    }
    return target as T;
  }

  const target = Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>;
  seen.set(objectValue, target);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if ("value" in descriptor) descriptor.value = cloneCommandPayload(descriptor.value, seen);
    Object.defineProperty(target, key, descriptor);
  }
  return target as T;
}

export function prepareCommandCandidate(
  project: StudioProjectV1,
): StudioProjectV1 | ProjectCommandResult {
  const baseline = validateStudioProject(project);
  if (!baseline.valid) return invariantFailure(project, baseline);
  try {
    return cloneStudioProject(project);
  } catch {
    return commandFailure(project, [
      commandDiagnostic(
        "INVARIANT_VIOLATION",
        "The project could not be cloned as a JSON-safe StudioProjectV1 document.",
        "$",
      ),
    ]);
  }
}

export function isCommandResult(
  value: StudioProjectV1 | ProjectCommandResult,
): value is ProjectCommandResult {
  return typeof value === "object" && "ok" in value;
}

export function commandInsertionIndex(
  value: unknown,
  length: number,
  path: string,
): number | ProjectCommandDiagnostic {
  if (value === undefined) return length;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > length) {
    return commandDiagnostic(
      "INVALID_ORDER",
      `Insertion index must be an integer between 0 and ${length}.`,
      path,
    );
  }
  return value;
}

export function commandReorderIndex(
  value: unknown,
  length: number,
  path: string,
): number | ProjectCommandDiagnostic {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= length) {
    return commandDiagnostic(
      "INVALID_ORDER",
      `Destination index must be an integer between 0 and ${Math.max(0, length - 1)}.`,
      path,
    );
  }
  return value;
}

export function duplicateEntityDiagnostic(
  collection: EntityReference["collection"],
  id: unknown,
  path: string,
): ProjectCommandDiagnostic {
  const entity = typeof id === "string" && id.length > 0
    ? entityReference(collection, id)
    : undefined;
  return commandDiagnostic(
    "ENTITY_ALREADY_EXISTS",
    `Entity ${String(id)} already exists in ${collection}.`,
    path,
    entity,
  );
}

export function missingEntityDiagnostic(
  collection: EntityReference["collection"],
  id: unknown,
  path: string,
): ProjectCommandDiagnostic {
  const entity = typeof id === "string" && id.length > 0
    ? entityReference(collection, id)
    : undefined;
  return commandDiagnostic(
    "ENTITY_NOT_FOUND",
    `Entity ${String(id)} was not found in ${collection}.`,
    path,
    entity,
  );
}

export function malformedCommandFailure(project: StudioProjectV1): ProjectCommandResult {
  return commandFailure(project, [
    commandDiagnostic(
      "INVALID_PATCH",
      "The command payload could not be read as a valid ProjectCommand.",
      "$",
    ),
  ]);
}
