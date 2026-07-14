import { computeAssetContentIdentity } from "../assets";
import type { EntityId, StudioProjectV1 } from "../project";
import { isEntityId, isISO8601Timestamp } from "../project/primitives";
import { projectCodec } from "./projectCodec";

export const AUTOSAVE_JOURNAL_FORMAT = "spriteboy-autosave-journal" as const;
export const AUTOSAVE_JOURNAL_VERSION = 1 as const;

export type AutosaveJournalOperation =
  | "open"
  | "inspect"
  | "stage"
  | "commit"
  | "discard"
  | "destroy";

export type AutosaveJournalErrorCode =
  | "AUTOSAVE_INVALID_INPUT"
  | "AUTOSAVE_STORAGE_UNAVAILABLE"
  | "AUTOSAVE_QUOTA_EXCEEDED"
  | "AUTOSAVE_ABORTED"
  | "AUTOSAVE_CONFLICT"
  | "AUTOSAVE_JOURNAL_MISSING"
  | "AUTOSAVE_INTEGRITY_MISMATCH";

export interface AutosaveJournalDiagnostic {
  code: AutosaveJournalErrorCode;
  operation: AutosaveJournalOperation;
  message: string;
  projectId?: EntityId;
  journalId?: string;
  recoverable: boolean;
}

interface AutosaveJournalErrorOptions {
  operation: AutosaveJournalOperation;
  projectId?: EntityId;
  journalId?: string;
  recoverable?: boolean;
  cause?: unknown;
}

const DEFAULT_RECOVERABLE: Readonly<Record<AutosaveJournalErrorCode, boolean>> = {
  AUTOSAVE_INVALID_INPUT: false,
  AUTOSAVE_STORAGE_UNAVAILABLE: true,
  AUTOSAVE_QUOTA_EXCEEDED: true,
  AUTOSAVE_ABORTED: true,
  AUTOSAVE_CONFLICT: true,
  AUTOSAVE_JOURNAL_MISSING: true,
  AUTOSAVE_INTEGRITY_MISMATCH: true,
};

export class AutosaveJournalError extends Error {
  readonly code: AutosaveJournalErrorCode;
  readonly operation: AutosaveJournalOperation;
  readonly projectId?: EntityId;
  readonly journalId?: string;
  readonly recoverable: boolean;
  override readonly cause?: unknown;

  constructor(
    code: AutosaveJournalErrorCode,
    message: string,
    options: AutosaveJournalErrorOptions,
  ) {
    super(message);
    this.name = "AutosaveJournalError";
    this.code = code;
    this.operation = options.operation;
    this.projectId = options.projectId;
    this.journalId = options.journalId;
    this.recoverable = options.recoverable ?? DEFAULT_RECOVERABLE[code];
    this.cause = options.cause;
  }

  toDiagnostic(): AutosaveJournalDiagnostic {
    return {
      code: this.code,
      operation: this.operation,
      message: this.message,
      ...(this.projectId ? { projectId: this.projectId } : {}),
      ...(this.journalId ? { journalId: this.journalId } : {}),
      recoverable: this.recoverable,
    };
  }
}

export function isAutosaveJournalError(value: unknown): value is AutosaveJournalError {
  try {
    return value instanceof AutosaveJournalError;
  } catch {
    return false;
  }
}

function safeErrorName(error: unknown): string | undefined {
  try {
    if (error === null || typeof error !== "object") return undefined;
    if (typeof DOMException !== "undefined") {
      const nativeName = Object.getOwnPropertyDescriptor(DOMException.prototype, "name")?.get;
      if (nativeName) {
        try {
          const name = Reflect.apply(nativeName, error, []);
          if (typeof name === "string") return name;
        } catch {
          // Fall through to descriptor-only Error-like inspection.
        }
      }
    }
    let current: object | null = error;
    const seen = new Set<object>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const descriptor = Object.getOwnPropertyDescriptor(current, "name");
      if (descriptor) {
        return "value" in descriptor && typeof descriptor.value === "string"
          ? descriptor.value
          : undefined;
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function normalizeAutosaveJournalError(
  error: unknown,
  options: Pick<AutosaveJournalErrorOptions, "operation" | "projectId" | "journalId">,
): AutosaveJournalError {
  if (isAutosaveJournalError(error)) return error;
  const name = safeErrorName(error);
  const code: AutosaveJournalErrorCode = name === "QuotaExceededError"
    ? "AUTOSAVE_QUOTA_EXCEEDED"
    : name === "AbortError"
      ? "AUTOSAVE_ABORTED"
      : name === "DataError" || name === "DataCloneError" || name === "TypeError"
        ? "AUTOSAVE_INVALID_INPUT"
        : "AUTOSAVE_STORAGE_UNAVAILABLE";
  return new AutosaveJournalError(
    code,
    `Project autosave ${options.operation} failed${options.projectId ? ` for ${options.projectId}` : ""}.`,
    { ...options, cause: error },
  );
}

interface StoredAutosaveBase {
  format: typeof AUTOSAVE_JOURNAL_FORMAT;
  formatVersion: typeof AUTOSAVE_JOURNAL_VERSION;
  projectId: EntityId;
  revision: number;
  projectJson: string;
  sha256: string;
  byteSize: number;
}

export interface StoredProjectCheckpoint extends StoredAutosaveBase {
  kind: "checkpoint";
  checkpointId: string;
  parentCheckpointId: string | null;
  committedAt: string;
}

export interface StoredAutosaveJournal extends StoredAutosaveBase {
  kind: "journal";
  journalId: string;
  baseRevision: number;
  baseCheckpointId: string | null;
  stagedAt: string;
}

export interface AutosaveStorageSnapshot {
  checkpoint?: StoredProjectCheckpoint;
  journal?: StoredAutosaveJournal;
}

export interface AutosaveOperationOptions {
  signal?: AbortSignal;
}

/** Storage port. Implementations must compare-and-write each method atomically. */
export interface AutosaveJournalStorage {
  readState(
    projectId: EntityId,
    options?: AutosaveOperationOptions,
  ): Promise<AutosaveStorageSnapshot>;
  stageJournal(
    journal: StoredAutosaveJournal,
    options?: AutosaveOperationOptions,
  ): Promise<void>;
  commitJournal(
    projectId: EntityId,
    journalId: string,
    options?: AutosaveOperationOptions,
  ): Promise<StoredProjectCheckpoint>;
  discardJournal(
    projectId: EntityId,
    journalId: string,
    options?: AutosaveOperationOptions,
  ): Promise<void>;
}

export interface AutosaveContentIdentity {
  sha256: string;
  byteSize: number;
}

export type AutosaveContentIdentityProvider = (
  projectJson: string,
  options?: AutosaveOperationOptions,
) => PromiseLike<AutosaveContentIdentity>;

export interface ProjectAutosaveJournalOptions {
  identityProvider?: AutosaveContentIdentityProvider;
  now?: () => string;
}

export interface AutosaveCheckpoint {
  record: StoredProjectCheckpoint;
  project: StudioProjectV1;
}

export interface AutosaveRecoveryCandidate {
  record: StoredAutosaveJournal;
  project: StudioProjectV1;
}

export interface AutosaveInspection {
  projectId: EntityId;
  confirmed?: AutosaveCheckpoint;
  recoveryCandidate?: AutosaveRecoveryCandidate;
}

interface NormalizedStorage {
  receiver: object;
  readState: AutosaveJournalStorage["readState"];
  stageJournal: AutosaveJournalStorage["stageJournal"];
  commitJournal: AutosaveJournalStorage["commitJournal"];
  discardJournal: AutosaveJournalStorage["discardJournal"];
}

interface SignalLease {
  signal?: AbortSignal;
  release(): void;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function autosaveError(
  code: AutosaveJournalErrorCode,
  operation: AutosaveJournalOperation,
  message: string,
  options: Omit<AutosaveJournalErrorOptions, "operation"> = {},
): AutosaveJournalError {
  return new AutosaveJournalError(code, message, { operation, ...options });
}

function readMethod<T extends (...args: never[]) => unknown>(
  value: object,
  key: string,
): T {
  const seen = new Set<object>();
  let current: object | null = value;
  while (current && !seen.has(current)) {
    seen.add(current);
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) {
      if (!Object.prototype.hasOwnProperty.call(descriptor, "value")
        || typeof descriptor.value !== "function") {
        throw new TypeError(`${key} must be a data method.`);
      }
      return descriptor.value as T;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  throw new TypeError(`${key} is missing.`);
}

interface PromiseResultBox<T> {
  value: T;
}

/** Assimilate a port result without consulting a hostile `then` accessor. */
function boxPromiseLike<T>(value: unknown): Promise<PromiseResultBox<T>> {
  return new Promise((resolve, reject) => {
    try {
      if (value === null || (typeof value !== "object" && typeof value !== "function")) {
        throw new TypeError("Port result must be Promise-like.");
      }
      const then = readMethod<(
        onFulfilled: (result: T) => void,
        onRejected: (error: unknown) => void,
      ) => unknown>(value as object, "then");
      Reflect.apply(then, value, [
        (result: T) => resolve({ value: result }),
        (error: unknown) => reject(error),
      ]);
    } catch (cause) {
      reject(cause);
    }
  });
}

function normalizeStorage(value: unknown): NormalizedStorage {
  try {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) {
      throw new TypeError("Storage must be an object.");
    }
    const receiver = value as object;
    return {
      receiver,
      readState: readMethod(receiver, "readState"),
      stageJournal: readMethod(receiver, "stageJournal"),
      commitJournal: readMethod(receiver, "commitJournal"),
      discardJournal: readMethod(receiver, "discardJournal"),
    };
  } catch (cause) {
    throw autosaveError(
      "AUTOSAVE_INVALID_INPUT",
      "open",
      "Autosave storage does not implement the required data-method contract.",
      { cause },
    );
  }
}

function nativeSignalValue(signal: AbortSignal, key: "aborted" | "reason"): unknown {
  const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, key)?.get;
  if (!getter) throw new TypeError(`AbortSignal.${key} is unavailable.`);
  return Reflect.apply(getter, signal, []);
}

function callNativeSignalListener(
  signal: AbortSignal,
  method: "addEventListener" | "removeEventListener",
  listener: EventListener,
): void {
  let current: object | null = Object.getPrototypeOf(signal) as object | null;
  const seen = new Set<object>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const descriptor = Object.getOwnPropertyDescriptor(current, method);
    if (descriptor && "value" in descriptor && typeof descriptor.value === "function") {
      Reflect.apply(descriptor.value, signal, ["abort", listener]);
      return;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  throw new TypeError(`AbortSignal.${method} is unavailable.`);
}

function signalLease(value: unknown, operation: AutosaveJournalOperation): SignalLease {
  if (value === undefined) return { release() {} };
  try {
    const source = value as AbortSignal;
    const controller = new AbortController();
    if (nativeSignalValue(source, "aborted") === true) {
      controller.abort(nativeSignalValue(source, "reason"));
      return { signal: controller.signal, release() {} };
    }
    const onAbort: EventListener = () => controller.abort(nativeSignalValue(source, "reason"));
    callNativeSignalListener(source, "addEventListener", onAbort);
    if (nativeSignalValue(source, "aborted") === true) onAbort(new Event("abort"));
    return {
      signal: controller.signal,
      release() {
        try {
          callNativeSignalListener(source, "removeEventListener", onAbort);
        } catch {
          // A native signal may only fail cleanup during host teardown.
        }
      },
    };
  } catch (cause) {
    throw autosaveError(
      "AUTOSAVE_INVALID_INPUT",
      operation,
      "Autosave signal must be a native AbortSignal.",
      { cause },
    );
  }
}

function normalizeOperationOptions(
  value: unknown,
  operation: AutosaveJournalOperation,
): SignalLease {
  try {
    if (value === undefined) return { release() {} };
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Options must be a plain object.");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Options must be a plain object.");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => key !== "signal")) throw new TypeError("Unsupported option.");
    const descriptor = Object.getOwnPropertyDescriptor(value, "signal");
    if (descriptor && (!descriptor.enumerable || !("value" in descriptor))) {
      throw new TypeError("signal must be an enumerable data property.");
    }
    return signalLease(descriptor && "value" in descriptor ? descriptor.value : undefined, operation);
  } catch (cause) {
    if (isAutosaveJournalError(cause)) throw cause;
    throw autosaveError(
      "AUTOSAVE_INVALID_INPUT",
      operation,
      "Autosave operation options are invalid.",
      { cause },
    );
  }
}

function throwIfAborted(
  signal: AbortSignal | undefined,
  operation: AutosaveJournalOperation,
  projectId?: EntityId,
): void {
  if (!signal || nativeSignalValue(signal, "aborted") !== true) return;
  throw autosaveError("AUTOSAVE_ABORTED", operation, "Project autosave was aborted.", {
    projectId,
    cause: nativeSignalValue(signal, "reason"),
  });
}

function raceAbort<T>(
  work: PromiseLike<T>,
  signal: AbortSignal | undefined,
  operation: AutosaveJournalOperation,
  projectId?: EntityId,
): Promise<T> {
  if (!signal) return Promise.resolve(work);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => callNativeSignalListener(signal, "removeEventListener", onAbort);
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = (): void => finish(() => reject(autosaveError(
      "AUTOSAVE_ABORTED",
      operation,
      "Project autosave was aborted.",
      { projectId, cause: nativeSignalValue(signal, "reason") },
    )));
    callNativeSignalListener(signal, "addEventListener", onAbort);
    Promise.resolve(work).then(
      (result) => finish(() => resolve(result)),
      (error: unknown) => finish(() => reject(error)),
    );
    if (nativeSignalValue(signal, "aborted") === true) onAbort();
  });
}

function readDataRecord(
  value: unknown,
  allowedKeys: readonly string[],
  operation: AutosaveJournalOperation,
  label: string,
): Readonly<Record<string, unknown>> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(`${label} must be an object.`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} must be a plain data object.`);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))) {
      throw new TypeError(`${label} has unsupported fields.`);
    }
    const result: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${label}.${key} must be an enumerable data property.`);
      }
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: descriptor.value,
      });
    }
    return result;
  } catch (cause) {
    if (isAutosaveJournalError(cause)) throw cause;
    throw autosaveError(
      "AUTOSAVE_INTEGRITY_MISMATCH",
      operation,
      `Stored ${label} is structurally invalid.`,
      { cause },
    );
  }
}

function requireString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new TypeError(`${key} must be a string.`);
  return value;
}

function requireSafeInteger(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${key} must be a non-negative safe integer.`);
  }
  return value as number;
}

const BASE_KEYS = [
  "format",
  "formatVersion",
  "kind",
  "projectId",
  "revision",
  "projectJson",
  "sha256",
  "byteSize",
] as const;

function validateBase(
  record: Readonly<Record<string, unknown>>,
  expectedProjectId: EntityId | undefined,
): StoredAutosaveBase {
  const projectId = requireString(record, "projectId");
  const revision = requireSafeInteger(record, "revision");
  const projectJson = requireString(record, "projectJson");
  const sha256 = requireString(record, "sha256");
  const byteSize = requireSafeInteger(record, "byteSize");
  if (record.format !== AUTOSAVE_JOURNAL_FORMAT
    || record.formatVersion !== AUTOSAVE_JOURNAL_VERSION
    || !isEntityId(projectId)
    || (expectedProjectId !== undefined && projectId !== expectedProjectId)
    || revision < 1
    || !HASH_PATTERN.test(sha256)) {
    throw new TypeError("Stored autosave identity is invalid.");
  }
  return {
    format: AUTOSAVE_JOURNAL_FORMAT,
    formatVersion: AUTOSAVE_JOURNAL_VERSION,
    projectId,
    revision,
    projectJson,
    sha256,
    byteSize,
  };
}

export function validateStoredProjectCheckpoint(
  value: unknown,
  expectedProjectId?: EntityId,
  operation: AutosaveJournalOperation = "inspect",
): StoredProjectCheckpoint {
  try {
    const record = readDataRecord(
      value,
      [...BASE_KEYS, "checkpointId", "parentCheckpointId", "committedAt"],
      operation,
      "checkpoint",
    );
    const base = validateBase(record, expectedProjectId);
    const checkpointId = requireString(record, "checkpointId");
    const parentCheckpointId = record.parentCheckpointId;
    const committedAt = requireString(record, "committedAt");
    if (record.kind !== "checkpoint"
      || !isEntityId(checkpointId)
      || (parentCheckpointId !== null && !isEntityId(parentCheckpointId))
      || !isISO8601Timestamp(committedAt)) {
      throw new TypeError("Stored checkpoint metadata is invalid.");
    }
    return Object.freeze({
      ...base,
      kind: "checkpoint" as const,
      checkpointId,
      parentCheckpointId: parentCheckpointId as string | null,
      committedAt,
    });
  } catch (cause) {
    if (isAutosaveJournalError(cause)) throw cause;
    throw autosaveError(
      "AUTOSAVE_INTEGRITY_MISMATCH",
      operation,
      "Stored checkpoint is invalid.",
      { projectId: expectedProjectId, cause },
    );
  }
}

export function validateStoredAutosaveJournal(
  value: unknown,
  expectedProjectId?: EntityId,
  operation: AutosaveJournalOperation = "inspect",
): StoredAutosaveJournal {
  try {
    const record = readDataRecord(
      value,
      [...BASE_KEYS, "journalId", "baseRevision", "baseCheckpointId", "stagedAt"],
      operation,
      "journal",
    );
    const base = validateBase(record, expectedProjectId);
    const journalId = requireString(record, "journalId");
    const baseRevision = requireSafeInteger(record, "baseRevision");
    const baseCheckpointId = record.baseCheckpointId;
    const stagedAt = requireString(record, "stagedAt");
    if (record.kind !== "journal"
      || !isEntityId(journalId)
      || base.revision !== baseRevision + 1
      || (baseCheckpointId !== null && !isEntityId(baseCheckpointId))
      || (baseRevision === 0) !== (baseCheckpointId === null)
      || !isISO8601Timestamp(stagedAt)) {
      throw new TypeError("Stored journal metadata is invalid.");
    }
    return Object.freeze({
      ...base,
      kind: "journal" as const,
      journalId,
      baseRevision,
      baseCheckpointId: baseCheckpointId as string | null,
      stagedAt,
    });
  } catch (cause) {
    if (isAutosaveJournalError(cause)) throw cause;
    throw autosaveError(
      "AUTOSAVE_INTEGRITY_MISMATCH",
      operation,
      "Stored autosave journal is invalid.",
      { projectId: expectedProjectId, cause },
    );
  }
}

export function validateAutosaveStorageSnapshot(
  value: unknown,
  projectId: EntityId,
  operation: AutosaveJournalOperation,
): AutosaveStorageSnapshot {
  const record = readDataRecord(value, ["checkpoint", "journal"], operation, "storage snapshot");
  const checkpoint = record.checkpoint === undefined
    ? undefined
    : validateStoredProjectCheckpoint(record.checkpoint, projectId, operation);
  const journal = record.journal === undefined
    ? undefined
    : validateStoredAutosaveJournal(record.journal, projectId, operation);
  return Object.freeze({ ...(checkpoint ? { checkpoint } : {}), ...(journal ? { journal } : {}) });
}

function assertProjectId(projectId: unknown, operation: AutosaveJournalOperation): asserts projectId is EntityId {
  if (!isEntityId(projectId)) {
    throw autosaveError(
      "AUTOSAVE_INVALID_INPUT",
      operation,
      "Autosave project id must be a non-empty string.",
    );
  }
}

function assertJournalId(
  journalId: unknown,
  operation: AutosaveJournalOperation,
  projectId: EntityId,
): asserts journalId is string {
  if (!isEntityId(journalId)) {
    throw autosaveError(
      "AUTOSAVE_INVALID_INPUT",
      operation,
      "Autosave journal id must be a non-empty string.",
      { projectId },
    );
  }
}

function normalizeIdentity(value: unknown, operation: AutosaveJournalOperation): AutosaveContentIdentity {
  try {
    const record = readDataRecord(value, ["sha256", "byteSize"], operation, "content identity");
    const sha256 = requireString(record, "sha256");
    const byteSize = requireSafeInteger(record, "byteSize");
    if (!HASH_PATTERN.test(sha256)) throw new TypeError("sha256 is invalid.");
    return Object.freeze({ sha256, byteSize });
  } catch (cause) {
    if (isAutosaveJournalError(cause)) throw cause;
    throw autosaveError(
      "AUTOSAVE_INTEGRITY_MISMATCH",
      operation,
      "Autosave content identity is invalid.",
      { cause },
    );
  }
}

async function defaultIdentityProvider(
  projectJson: string,
  options?: AutosaveOperationOptions,
): Promise<AutosaveContentIdentity> {
  const identity = await computeAssetContentIdentity(
    new Blob([projectJson], { type: "application/json" }),
    options,
  );
  return { sha256: identity.contentHash, byteSize: identity.byteSize };
}

function normalizeJournalOptions(value: unknown): {
  identityProvider: AutosaveContentIdentityProvider;
  now: () => string;
} {
  try {
    if (value === undefined) {
      return { identityProvider: defaultIdentityProvider, now: () => new Date().toISOString() };
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Journal options must be an object.");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Journal options must be a plain object.");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => key !== "identityProvider" && key !== "now")) {
      throw new TypeError("Journal options contain unsupported fields.");
    }
    const readFunction = <T extends (...args: never[]) => unknown>(key: string, fallback: T): T => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) return fallback;
      if (!descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "function") {
        throw new TypeError(`${key} must be an enumerable data function.`);
      }
      return descriptor.value as T;
    };
    return {
      identityProvider: readFunction("identityProvider", defaultIdentityProvider),
      now: readFunction("now", () => new Date().toISOString()),
    };
  } catch (cause) {
    throw autosaveError(
      "AUTOSAVE_INVALID_INPUT",
      "open",
      "Project autosave journal options are invalid.",
      { cause },
    );
  }
}

function readTimestamp(now: () => string, operation: AutosaveJournalOperation): string {
  let value: unknown;
  try {
    value = Reflect.apply(now, undefined, []);
  } catch (cause) {
    throw autosaveError("AUTOSAVE_INVALID_INPUT", operation, "Autosave clock failed.", { cause });
  }
  if (!isISO8601Timestamp(value)) {
    throw autosaveError("AUTOSAVE_INVALID_INPUT", operation, "Autosave clock returned an invalid timestamp.");
  }
  return value;
}

function journalId(projectId: EntityId, revision: number, sha256: string): string {
  return `${projectId}:${revision}:${sha256}`;
}

function assertJournalMatchesCheckpoint(
  checkpoint: StoredProjectCheckpoint | undefined,
  journal: StoredAutosaveJournal,
  operation: AutosaveJournalOperation,
): void {
  const matches = checkpoint
    ? journal.baseRevision === checkpoint.revision
      && journal.baseCheckpointId === checkpoint.checkpointId
    : journal.baseRevision === 0 && journal.baseCheckpointId === null;
  if (!matches) {
    throw autosaveError(
      "AUTOSAVE_CONFLICT",
      operation,
      "Pending autosave journal does not descend from the confirmed checkpoint.",
      { projectId: journal.projectId, journalId: journal.journalId },
    );
  }
}

/** Canonical autosave coordinator. It never replaces the active UI project. */
export class ProjectAutosaveJournal {
  private readonly storage: NormalizedStorage;
  private readonly identityProvider: AutosaveContentIdentityProvider;
  private readonly now: () => string;

  constructor(storage: AutosaveJournalStorage, options?: ProjectAutosaveJournalOptions) {
    this.storage = normalizeStorage(storage);
    const normalized = normalizeJournalOptions(options);
    this.identityProvider = normalized.identityProvider;
    this.now = normalized.now;
  }

  private async identity(
    projectJson: string,
    operation: AutosaveJournalOperation,
    signal: AbortSignal | undefined,
    projectId: EntityId,
  ): Promise<AutosaveContentIdentity> {
    try {
      const work = Reflect.apply(this.identityProvider, undefined, [
        projectJson,
        signal ? { signal } : undefined,
      ]);
      const boxed = await raceAbort(
        boxPromiseLike<AutosaveContentIdentity>(work),
        signal,
        operation,
        projectId,
      );
      return normalizeIdentity(boxed.value, operation);
    } catch (cause) {
      if (isAutosaveJournalError(cause)) throw cause;
      throwIfAborted(signal, operation, projectId);
      throw autosaveError(
        "AUTOSAVE_INTEGRITY_MISMATCH",
        operation,
        "Autosave content could not be hashed.",
        { projectId, cause },
      );
    }
  }

  private async readState(
    projectId: EntityId,
    operation: AutosaveJournalOperation,
    signal: AbortSignal | undefined,
  ): Promise<AutosaveStorageSnapshot> {
    try {
      const work = Reflect.apply(this.storage.readState, this.storage.receiver, [
        projectId,
        signal ? { signal } : undefined,
      ]);
      const boxed = await raceAbort(
        boxPromiseLike<AutosaveStorageSnapshot>(work),
        signal,
        operation,
        projectId,
      );
      return validateAutosaveStorageSnapshot(
        boxed.value,
        projectId,
        operation,
      );
    } catch (cause) {
      if (isAutosaveJournalError(cause)) throw cause;
      throwIfAborted(signal, operation, projectId);
      throw normalizeAutosaveJournalError(cause, { operation, projectId });
    }
  }

  private async verifyRecord(
    record: StoredProjectCheckpoint | StoredAutosaveJournal,
    operation: AutosaveJournalOperation,
    signal: AbortSignal | undefined,
  ): Promise<StudioProjectV1> {
    const identity = await this.identity(record.projectJson, operation, signal, record.projectId);
    if (identity.sha256 !== record.sha256 || identity.byteSize !== record.byteSize) {
      throw autosaveError(
        "AUTOSAVE_INTEGRITY_MISMATCH",
        operation,
        "Stored autosave bytes do not match their recorded identity.",
        {
          projectId: record.projectId,
          ...(record.kind === "journal" ? { journalId: record.journalId } : {}),
        },
      );
    }
    try {
      const project = projectCodec.decode(record.projectJson);
      if (project.id !== record.projectId) {
        throw new TypeError("Stored project id does not match its autosave key.");
      }
      if (projectCodec.encode(project) !== record.projectJson) {
        throw new TypeError("Stored project bytes are valid JSON but not canonical codec output.");
      }
      return project;
    } catch (cause) {
      if (isAutosaveJournalError(cause)) throw cause;
      throw autosaveError(
        "AUTOSAVE_INTEGRITY_MISMATCH",
        operation,
        "Stored autosave document is not a valid canonical project.",
        {
          projectId: record.projectId,
          ...(record.kind === "journal" ? { journalId: record.journalId } : {}),
          cause,
        },
      );
    }
  }

  async inspect(
    projectId: EntityId,
    options?: AutosaveOperationOptions,
  ): Promise<AutosaveInspection> {
    assertProjectId(projectId, "inspect");
    const lease = normalizeOperationOptions(options, "inspect");
    try {
      throwIfAborted(lease.signal, "inspect", projectId);
      const snapshot = await this.readState(projectId, "inspect", lease.signal);
      const confirmed = snapshot.checkpoint
        ? {
            record: snapshot.checkpoint,
            project: await this.verifyRecord(snapshot.checkpoint, "inspect", lease.signal),
          }
        : undefined;
      let recoveryCandidate: AutosaveRecoveryCandidate | undefined;
      if (snapshot.journal) {
        assertJournalMatchesCheckpoint(snapshot.checkpoint, snapshot.journal, "inspect");
        recoveryCandidate = {
          record: snapshot.journal,
          project: await this.verifyRecord(snapshot.journal, "inspect", lease.signal),
        };
      }
      return Object.freeze({
        projectId,
        ...(confirmed ? { confirmed: Object.freeze(confirmed) } : {}),
        ...(recoveryCandidate ? { recoveryCandidate: Object.freeze(recoveryCandidate) } : {}),
      });
    } finally {
      lease.release();
    }
  }

  async stage(
    project: StudioProjectV1,
    options?: AutosaveOperationOptions,
  ): Promise<StoredAutosaveJournal> {
    const lease = normalizeOperationOptions(options, "stage");
    let projectId: EntityId | undefined;
    try {
      throwIfAborted(lease.signal, "stage");
      let projectJson: string;
      let canonicalProject: StudioProjectV1;
      try {
        projectJson = projectCodec.encode(project);
        canonicalProject = projectCodec.decode(projectJson);
        projectId = canonicalProject.id;
      } catch (cause) {
        throw autosaveError(
          "AUTOSAVE_INVALID_INPUT",
          "stage",
          "Autosave requires a valid canonical Studio project.",
          { projectId, cause },
        );
      }
      const snapshot = await this.readState(projectId, "stage", lease.signal);
      if (snapshot.journal) {
        throw autosaveError(
          "AUTOSAVE_CONFLICT",
          "stage",
          "A pending recovery candidate must be committed or discarded before another autosave.",
          { projectId, journalId: snapshot.journal.journalId },
        );
      }
      if (snapshot.checkpoint) {
        await this.verifyRecord(snapshot.checkpoint, "stage", lease.signal);
      }
      const identity = await this.identity(projectJson, "stage", lease.signal, projectId);
      const revision = (snapshot.checkpoint?.revision ?? 0) + 1;
      const id = journalId(projectId, revision, identity.sha256);
      const record = validateStoredAutosaveJournal(Object.freeze({
        format: AUTOSAVE_JOURNAL_FORMAT,
        formatVersion: AUTOSAVE_JOURNAL_VERSION,
        kind: "journal",
        projectId,
        revision,
        projectJson,
        sha256: identity.sha256,
        byteSize: identity.byteSize,
        journalId: id,
        baseRevision: snapshot.checkpoint?.revision ?? 0,
        baseCheckpointId: snapshot.checkpoint?.checkpointId ?? null,
        stagedAt: readTimestamp(this.now, "stage"),
      }), projectId, "stage");
      try {
        const work = Reflect.apply(this.storage.stageJournal, this.storage.receiver, [
          record,
          lease.signal ? { signal: lease.signal } : undefined,
        ]);
        await raceAbort(boxPromiseLike<void>(work), lease.signal, "stage", projectId);
      } catch (cause) {
        if (isAutosaveJournalError(cause)) throw cause;
        throwIfAborted(lease.signal, "stage", projectId);
        throw normalizeAutosaveJournalError(cause, {
          operation: "stage",
          projectId,
          journalId: record.journalId,
        });
      }
      return record;
    } finally {
      lease.release();
    }
  }

  async commit(
    projectId: EntityId,
    journalIdValue: string,
    options?: AutosaveOperationOptions,
  ): Promise<AutosaveCheckpoint> {
    assertProjectId(projectId, "commit");
    assertJournalId(journalIdValue, "commit", projectId);
    const lease = normalizeOperationOptions(options, "commit");
    try {
      throwIfAborted(lease.signal, "commit", projectId);
      let raw: unknown;
      try {
        const work = Reflect.apply(this.storage.commitJournal, this.storage.receiver, [
          projectId,
          journalIdValue,
          lease.signal ? { signal: lease.signal } : undefined,
        ]);
        raw = (await raceAbort(
          boxPromiseLike<StoredProjectCheckpoint>(work),
          lease.signal,
          "commit",
          projectId,
        )).value;
      } catch (cause) {
        if (isAutosaveJournalError(cause)) throw cause;
        throwIfAborted(lease.signal, "commit", projectId);
        throw normalizeAutosaveJournalError(cause, {
          operation: "commit",
          projectId,
          journalId: journalIdValue,
        });
      }
      const record = validateStoredProjectCheckpoint(raw, projectId, "commit");
      if (record.checkpointId !== journalIdValue) {
        throw autosaveError(
          "AUTOSAVE_INTEGRITY_MISMATCH",
          "commit",
          "Committed checkpoint identity does not match the requested journal.",
          { projectId, journalId: journalIdValue },
        );
      }
      return Object.freeze({
        record,
        project: await this.verifyRecord(record, "commit", lease.signal),
      });
    } finally {
      lease.release();
    }
  }

  async checkpoint(
    project: StudioProjectV1,
    options?: AutosaveOperationOptions,
  ): Promise<AutosaveCheckpoint> {
    const lease = normalizeOperationOptions(options, "stage");
    try {
      const nested = lease.signal ? { signal: lease.signal } : undefined;
      const journal = await this.stage(project, nested);
      return await this.commit(journal.projectId, journal.journalId, nested);
    } finally {
      lease.release();
    }
  }

  async discard(
    projectId: EntityId,
    journalIdValue: string,
    options?: AutosaveOperationOptions,
  ): Promise<void> {
    assertProjectId(projectId, "discard");
    assertJournalId(journalIdValue, "discard", projectId);
    const lease = normalizeOperationOptions(options, "discard");
    try {
      throwIfAborted(lease.signal, "discard", projectId);
      try {
        const work = Reflect.apply(this.storage.discardJournal, this.storage.receiver, [
          projectId,
          journalIdValue,
          lease.signal ? { signal: lease.signal } : undefined,
        ]);
        await raceAbort(boxPromiseLike<void>(work), lease.signal, "discard", projectId);
      } catch (cause) {
        if (isAutosaveJournalError(cause)) throw cause;
        throwIfAborted(lease.signal, "discard", projectId);
        throw normalizeAutosaveJournalError(cause, {
          operation: "discard",
          projectId,
          journalId: journalIdValue,
        });
      }
    } finally {
      lease.release();
    }
  }
}
