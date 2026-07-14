import {
  applyProjectCommand,
  applyProjectCommandBatch,
  applyProjectCommandInverse,
  isEntityId,
  isISO8601Timestamp,
  type ProjectCommand,
  type ProjectCommandBatch,
  type ProjectDispatchCommand,
  type ProjectCommandContext,
  type ProjectCommandEnvelope,
  type ProjectCommandMetadata,
  type ProjectCommandInverse,
  type ProjectCommandResult,
} from "../project";
import { cloneDataOnly } from "../project/dataBoundary";
import { createProjectSnapshot, type ProjectRevision } from "../project/graph";
import type { StudioProjectV1 } from "../project/schema";
import { validateStudioProject } from "../project/validation";
import type {
  ProjectStore,
  ProjectStoreDispatchResult,
  ProjectStoreState,
  StoreListener,
} from "./contracts";

export interface CreateProjectStoreOptions {
  readonly context: ProjectCommandContext;
  readonly initialRevision?: ProjectRevision;
  readonly onSubscriberError?: (diagnostic: ProjectStoreSubscriberDiagnostic) => void;
}

export interface ProjectStoreSubscriberDiagnostic {
  readonly code: "PROJECT_STORE_SUBSCRIBER_FAILED";
  readonly message: string;
}

interface DataPropertyRead {
  readonly present: boolean;
  readonly value?: unknown;
}

interface NormalizedProjectStoreOptions {
  readonly context: ProjectCommandContext;
  readonly initialRevision: ProjectRevision;
  readonly onSubscriberError?: (diagnostic: ProjectStoreSubscriberDiagnostic) => void;
}

export interface ProjectStoreInternalCommitEvent {
  readonly before: ProjectStoreState;
  readonly after: ProjectStoreState;
  readonly result: Extract<ProjectCommandResult, { ok: true }>;
  readonly envelope?: {
    readonly command: ProjectDispatchCommand;
    readonly metadata: ProjectCommandMetadata;
  };
}

export type ProjectStoreInternalCommitHook = (
  event: ProjectStoreInternalCommitEvent,
) => void | (() => void);

export interface ProjectStoreRuntime {
  readonly store: ProjectStore;
  readonly applyInverse: (
    inverse: ProjectCommandInverse,
    onCommit?: ProjectStoreInternalCommitHook,
  ) => ProjectStoreDispatchResult;
}

type EnvelopeReadResult =
  | { readonly ok: true; readonly command: ProjectDispatchCommand; readonly metadata: ProjectCommandMetadata }
  | { readonly ok: false; readonly path: string; readonly message: string };

const SUBSCRIBER_FAILED_DIAGNOSTIC: ProjectStoreSubscriberDiagnostic = Object.freeze({
  code: "PROJECT_STORE_SUBSCRIBER_FAILED",
  message: "A ProjectStore subscriber failed while observing a committed revision.",
});

function deepFreezeData<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreezeData(descriptor.value, seen);
  }
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

function isDataOnlyGraph(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== "object") return true;
  if (seen.has(value)) return true;
  seen.add(value);
  try {
    const array = Array.isArray(value);
    if (!array) {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return false;
    }
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === "length") continue;
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return false;
      if (!isDataOnlyGraph(descriptor.value, seen)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function immutableDispatchResult(
  revision: ProjectRevision,
  result: ProjectCommandResult,
): ProjectStoreDispatchResult {
  return Object.freeze({ revision, result: deepFreezeData(result) });
}

function applyDispatchCommand(
  project: StudioProjectV1,
  command: ProjectDispatchCommand,
  context: ProjectCommandContext,
): ProjectCommandResult {
  try {
    if (command !== null && typeof command === "object") {
      const type = Object.getOwnPropertyDescriptor(command, "type");
      if (type && "value" in type && type.enumerable && type.value === "command.batch") {
        return applyProjectCommandBatch(project, command as ProjectCommandBatch, context);
      }
    }
  } catch {
    // The canonical reducer maps hostile command shapes to stable diagnostics.
  }
  return applyProjectCommand(project, command as ProjectCommand, context);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readDataProperty(record: object, key: string): DataPropertyRead | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return { present: false };
  if (!("value" in descriptor) || !descriptor.enumerable) return undefined;
  return { present: true, value: descriptor.value };
}

function normalizeOptions(options: unknown): NormalizedProjectStoreOptions | undefined {
  try {
    if (!isPlainRecord(options)) return undefined;
    const contextProperty = readDataProperty(options, "context");
    if (!contextProperty?.present || !isPlainRecord(contextProperty.value)) return undefined;

    const nextIdProperty = readDataProperty(contextProperty.value, "nextId");
    const nowProperty = readDataProperty(contextProperty.value, "now");
    if (
      !nextIdProperty?.present ||
      typeof nextIdProperty.value !== "function" ||
      !nowProperty?.present ||
      typeof nowProperty.value !== "function"
    ) {
      return undefined;
    }

    const initialRevisionProperty = readDataProperty(options, "initialRevision");
    if (!initialRevisionProperty) return undefined;
    const initialRevision = initialRevisionProperty.present && initialRevisionProperty.value !== undefined
      ? initialRevisionProperty.value
      : 0;
    if (!Number.isSafeInteger(initialRevision) || (initialRevision as number) < 0) return undefined;

    const subscriberErrorProperty = readDataProperty(options, "onSubscriberError");
    if (!subscriberErrorProperty) return undefined;
    const onSubscriberError = subscriberErrorProperty.present
      ? subscriberErrorProperty.value
      : undefined;
    if (onSubscriberError !== undefined && typeof onSubscriberError !== "function") return undefined;

    const contextTarget = contextProperty.value;
    const nextId = nextIdProperty.value;
    const now = nowProperty.value;
    const normalized: NormalizedProjectStoreOptions = {
      context: Object.freeze({
        nextId: () => Reflect.apply(nextId, contextTarget, []),
        now: () => Reflect.apply(now, contextTarget, []),
      }),
      initialRevision: initialRevision as ProjectRevision,
      ...(onSubscriberError
        ? {
            onSubscriberError: (diagnostic: ProjectStoreSubscriberDiagnostic) => {
              Reflect.apply(onSubscriberError, undefined, [diagnostic]);
            },
          }
        : {}),
    };
    return Object.freeze(normalized);
  } catch {
    return undefined;
  }
}

function invalidEnvelope(path: string, message: string): EnvelopeReadResult {
  return { ok: false, path, message };
}

function readEnvelope(envelope: unknown): EnvelopeReadResult {
  try {
    if (!isPlainRecord(envelope)) {
      return invalidEnvelope("$", "ProjectCommandEnvelope must be a plain object.");
    }
    const keys = Reflect.ownKeys(envelope);
    if (
      keys.length !== 2 ||
      keys.some((key) => typeof key !== "string" || (key !== "command" && key !== "metadata"))
    ) {
      return invalidEnvelope("$", "ProjectCommandEnvelope must contain only command and metadata.");
    }

    const commandProperty = readDataProperty(envelope, "command");
    if (!commandProperty?.present) {
      return invalidEnvelope("$.command", "Envelope command must be an own enumerable data property.");
    }
    const detachedCommand = cloneDataOnly(commandProperty.value);
    if (!detachedCommand.ok) {
      return invalidEnvelope(
        "$.command",
        "Envelope command must be a finite, dense, data-only graph without accessors.",
      );
    }
    const metadataProperty = readDataProperty(envelope, "metadata");
    if (!metadataProperty?.present || !isPlainRecord(metadataProperty.value)) {
      return invalidEnvelope("$.metadata", "Envelope metadata must be a plain data object.");
    }

    const allowedMetadataKeys = new Set([
      "commandId",
      "origin",
      "history",
      "transactionId",
      "issuedAt",
    ]);
    const metadataKeys = Reflect.ownKeys(metadataProperty.value);
    if (
      metadataKeys.some((key) => typeof key !== "string" || !allowedMetadataKeys.has(key))
    ) {
      return invalidEnvelope("$.metadata", "Envelope metadata contains an unsupported field.");
    }

    const commandIdProperty = readDataProperty(metadataProperty.value, "commandId");
    const originProperty = readDataProperty(metadataProperty.value, "origin");
    const historyProperty = readDataProperty(metadataProperty.value, "history");
    if (!commandIdProperty?.present || !isEntityId(commandIdProperty.value)) {
      return invalidEnvelope("$.metadata.commandId", "Metadata commandId must be an EntityId.");
    }
    if (
      !originProperty?.present ||
      !["user", "migration", "ai", "worker"].includes(originProperty.value as string)
    ) {
      return invalidEnvelope("$.metadata.origin", "Metadata origin is invalid.");
    }
    if (
      !historyProperty?.present ||
      !["record", "coalesce", "ignore"].includes(historyProperty.value as string)
    ) {
      return invalidEnvelope("$.metadata.history", "Metadata history policy is invalid.");
    }

    const transactionIdProperty = readDataProperty(metadataProperty.value, "transactionId");
    if (!transactionIdProperty) {
      return invalidEnvelope("$.metadata.transactionId", "Metadata transactionId must be data.");
    }
    if (
      transactionIdProperty.present &&
      !isEntityId(transactionIdProperty.value)
    ) {
      return invalidEnvelope("$.metadata.transactionId", "Metadata transactionId must be an EntityId.");
    }

    const issuedAtProperty = readDataProperty(metadataProperty.value, "issuedAt");
    if (!issuedAtProperty) {
      return invalidEnvelope("$.metadata.issuedAt", "Metadata issuedAt must be data.");
    }
    if (issuedAtProperty.present && !isISO8601Timestamp(issuedAtProperty.value)) {
      return invalidEnvelope("$.metadata.issuedAt", "Metadata issuedAt must be an ISO-8601 timestamp.");
    }

    if (historyProperty.value === "coalesce" && !transactionIdProperty.present) {
      return invalidEnvelope(
        "$.metadata.transactionId",
        "Coalesced commands require a transactionId.",
      );
    }

    return {
      ok: true,
      command: detachedCommand.value as ProjectDispatchCommand,
      metadata: {
        commandId: commandIdProperty.value,
        origin: originProperty.value as ProjectCommandMetadata["origin"],
        history: historyProperty.value as ProjectCommandMetadata["history"],
        ...(transactionIdProperty.present
          ? { transactionId: transactionIdProperty.value as string }
          : {}),
        ...(issuedAtProperty.present
          ? { issuedAt: issuedAtProperty.value as string }
          : {}),
      },
    };
  } catch {
    return invalidEnvelope("$", "ProjectCommandEnvelope could not be read safely.");
  }
}

function envelopeFailure(
  project: StudioProjectV1,
  path: string,
  message: string,
): ProjectCommandResult {
  return {
    ok: false,
    project,
    diagnostics: [{ code: "INVALID_PATCH", path, message }],
  };
}

function reentrantDispatchResult(project: StudioProjectV1): ProjectCommandResult {
  return {
    ok: false,
    project,
    diagnostics: [
      {
        code: "PRECONDITION_FAILED",
        path: "$.dispatch",
        message: "ProjectStore does not allow reentrant dispatch from a subscriber.",
      },
    ],
  };
}

function exhaustedRevisionResult(project: StudioProjectV1): ProjectCommandResult {
  return {
    ok: false,
    project,
    diagnostics: [
      {
        code: "PRECONDITION_FAILED",
        path: "$.revision",
        message: "Project revision cannot advance beyond Number.MAX_SAFE_INTEGER.",
      },
    ],
  };
}

/**
 * Create the canonical document store. History is layered on this dispatch
 * boundary by F4-04; no alternate setter is exposed.
 */
export function createProjectStoreRuntime(
  initialProject: StudioProjectV1,
  options: CreateProjectStoreOptions,
  onCommandCommit?: ProjectStoreInternalCommitHook,
): ProjectStoreRuntime {
  const normalizedOptions = normalizeOptions(options);
  if (!normalizedOptions) {
    throw new TypeError("ProjectStore options require a data-only ProjectCommandContext.");
  }
  let project: StudioProjectV1;
  try {
    if (!isDataOnlyGraph(initialProject)) throw new TypeError();
    const isolated = structuredClone(initialProject);
    const validation = validateStudioProject(isolated);
    if (!validation.valid) {
      const first = validation.diagnostics[0];
      throw new TypeError(
        `ProjectStore requires a valid StudioProjectV1${first ? `: ${first.code} at ${first.path}` : "."}`,
      );
    }
    project = deepFreezeData(isolated);
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith("ProjectStore requires")) throw error;
    throw new TypeError("ProjectStore could not isolate the initial StudioProjectV1.");
  }
  let state: ProjectStoreState = createProjectSnapshot(
    project,
    normalizedOptions.initialRevision,
  );
  const listeners = new Set<StoreListener>();
  let dispatching = false;

  const getSnapshot = (): ProjectStoreState => state;

  const subscribe = (listener: StoreListener): (() => void) => {
    if (typeof listener !== "function") {
      throw new TypeError("ProjectStore subscriber must be a function.");
    }
    listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      listeners.delete(listener);
    };
  };

  const notify = (): void => {
    const pendingListeners = Array.from(listeners);
    for (const listener of pendingListeners) {
      if (!listeners.has(listener)) continue;
      try {
        listener();
      } catch {
        try {
          normalizedOptions.onSubscriberError?.(SUBSCRIBER_FAILED_DIAGNOSTIC);
        } catch {
          // Observer diagnostics cannot change the semantics of a committed dispatch.
        }
      }
    }
  };

  const commitResult = (
    result: ProjectCommandResult,
    onCommit?: ProjectStoreInternalCommitHook,
    envelope?: ProjectStoreInternalCommitEvent["envelope"],
  ): ProjectStoreDispatchResult => {
    deepFreezeData(result);
    if (!result.ok || result.project === project) {
      return immutableDispatchResult(state.revision, result);
    }

    const before = state;
    const committedRevision = state.revision + 1;
    const after = createProjectSnapshot(result.project, committedRevision);
    const afterCommit = onCommit?.(Object.freeze({
      before,
      after,
      result,
      ...(envelope ? { envelope } : {}),
    }));

    project = result.project;
    state = after;
    const dispatchResult = immutableDispatchResult(committedRevision, result);
    afterCommit?.();
    notify();
    return dispatchResult;
  };

  const dispatch = (envelope: ProjectCommandEnvelope): ProjectStoreDispatchResult => {
    if (dispatching) {
      return immutableDispatchResult(state.revision, reentrantDispatchResult(project));
    }
    dispatching = true;
    try {
      const envelopeRead = readEnvelope(envelope);
      if (!envelopeRead.ok) {
        return immutableDispatchResult(
          state.revision,
          envelopeFailure(project, envelopeRead.path, envelopeRead.message),
        );
      }
      if (state.revision === Number.MAX_SAFE_INTEGER) {
        return immutableDispatchResult(state.revision, exhaustedRevisionResult(project));
      }

      const result = applyDispatchCommand(
        project,
        envelopeRead.command,
        normalizedOptions.context,
      );

      return commitResult(result, onCommandCommit, Object.freeze({
        command: envelopeRead.command,
        metadata: envelopeRead.metadata,
      }));
    } finally {
      dispatching = false;
    }
  };

  const store = Object.freeze({
    kind: "project",
    persistence: "durable",
    history: "command",
    getSnapshot,
    subscribe,
    dispatch,
  });

  const applyInverse = (
    inverse: ProjectCommandInverse,
    onCommit?: ProjectStoreInternalCommitHook,
  ): ProjectStoreDispatchResult => {
    if (dispatching) {
      return immutableDispatchResult(state.revision, reentrantDispatchResult(project));
    }
    dispatching = true;
    try {
      if (state.revision === Number.MAX_SAFE_INTEGER) {
        return immutableDispatchResult(state.revision, exhaustedRevisionResult(project));
      }
      const result = applyProjectCommandInverse(project, inverse, normalizedOptions.context);
      return commitResult(result, onCommit);
    } finally {
      dispatching = false;
    }
  };

  return Object.freeze({ store, applyInverse });
}

/** Create a ProjectStore without attaching a history controller. */
export function createProjectStore(
  initialProject: StudioProjectV1,
  options: CreateProjectStoreOptions,
): ProjectStore {
  return createProjectStoreRuntime(initialProject, options).store;
}
