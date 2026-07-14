import type { EntityId } from "../project";
import { isEntityId, isISO8601Timestamp } from "../project/primitives";
import {
  AUTOSAVE_JOURNAL_FORMAT,
  AUTOSAVE_JOURNAL_VERSION,
  AutosaveJournalError,
  isAutosaveJournalError,
  normalizeAutosaveJournalError,
  validateStoredAutosaveJournal,
  validateStoredProjectCheckpoint,
} from "./autosaveJournal";
import type {
  AutosaveJournalOperation,
  AutosaveJournalStorage,
  AutosaveOperationOptions,
  AutosaveStorageSnapshot,
  StoredAutosaveJournal,
  StoredProjectCheckpoint,
} from "./autosaveJournal";

export const AUTOSAVE_DATABASE_NAME = "sprite-boy-studio-projects";
export const AUTOSAVE_DATABASE_VERSION = 1;
export const AUTOSAVE_CHECKPOINT_STORE = "project-checkpoints";
export const AUTOSAVE_JOURNAL_STORE = "project-autosave-journal";

export interface IndexedDbAutosaveStorageOptions {
  databaseName?: string;
  factory?: IDBFactory | null;
  now?: () => string;
}

interface TransactionMonitor<T> {
  promise: Promise<T>;
  setResult(value: T): void;
  fail(error: AutosaveJournalError): void;
}

interface NormalizedOperationOptions {
  signal?: AbortSignal;
}

interface NormalizedStorageOptions {
  databaseName: string;
  factory: IDBFactory | null;
  now: () => string;
}

function storageError(
  operation: AutosaveJournalOperation,
  message: string,
  projectId?: EntityId,
  cause?: unknown,
): AutosaveJournalError {
  return new AutosaveJournalError("AUTOSAVE_STORAGE_UNAVAILABLE", message, {
    operation,
    projectId,
    cause,
  });
}

function conflictError(
  operation: AutosaveJournalOperation,
  projectId: EntityId,
  message: string,
  journalId?: string,
): AutosaveJournalError {
  return new AutosaveJournalError("AUTOSAVE_CONFLICT", message, {
    operation,
    projectId,
    journalId,
  });
}

function abortedError(
  operation: AutosaveJournalOperation,
  projectId?: EntityId,
  cause?: unknown,
): AutosaveJournalError {
  return new AutosaveJournalError("AUTOSAVE_ABORTED", "Project autosave transaction was aborted.", {
    operation,
    projectId,
    cause,
  });
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

function normalizeOperationOptions(
  value: unknown,
  operation: AutosaveJournalOperation,
  projectId?: EntityId,
): NormalizedOperationOptions {
  try {
    if (value === undefined) return {};
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
    if (!descriptor) return {};
    if (!descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError("signal must be an enumerable data property.");
    }
    if (descriptor.value === undefined) return {};
    nativeSignalValue(descriptor.value as AbortSignal, "aborted");
    return { signal: descriptor.value as AbortSignal };
  } catch (cause) {
    throw new AutosaveJournalError(
      "AUTOSAVE_INVALID_INPUT",
      "IndexedDB autosave options are invalid.",
      { operation, projectId, cause },
    );
  }
}

function throwIfAborted(
  options: NormalizedOperationOptions,
  operation: AutosaveJournalOperation,
  projectId?: EntityId,
): void {
  if (!options.signal || nativeSignalValue(options.signal, "aborted") !== true) return;
  throw abortedError(operation, projectId, nativeSignalValue(options.signal, "reason"));
}

function raceDatabaseOpen<T>(
  work: Promise<T>,
  options: NormalizedOperationOptions,
  operation: AutosaveJournalOperation,
  projectId?: EntityId,
): Promise<T> {
  const signal = options.signal;
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => callNativeSignalListener(signal, "removeEventListener", onAbort);
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = (): void => finish(() => reject(abortedError(
      operation,
      projectId,
      nativeSignalValue(signal, "reason"),
    )));
    callNativeSignalListener(signal, "addEventListener", onAbort);
    work.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
    if (nativeSignalValue(signal, "aborted") === true) onAbort();
  });
}

function normalizeStorageOptions(value: unknown): NormalizedStorageOptions {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("IndexedDB autosave options must be a plain object.");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("IndexedDB autosave options must be a plain object.");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => (
      typeof key !== "string"
      || !["databaseName", "factory", "now"].includes(key)
    ))) {
      throw new TypeError("IndexedDB autosave options contain unsupported fields.");
    }
    const read = (key: string): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) return undefined;
      if (!descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${key} must be an enumerable data property.`);
      }
      return descriptor.value;
    };
    const databaseName = read("databaseName") ?? AUTOSAVE_DATABASE_NAME;
    const factory = read("factory");
    const now = read("now") ?? (() => new Date().toISOString());
    if (typeof databaseName !== "string" || databaseName.length === 0) {
      throw new TypeError("databaseName must be a non-empty string.");
    }
    if (factory !== undefined && factory !== null && typeof factory !== "object") {
      throw new TypeError("factory must be an IDBFactory or null.");
    }
    if (typeof now !== "function") throw new TypeError("now must be a function.");
    return {
      databaseName,
      factory: factory === undefined
        ? (typeof indexedDB === "undefined" ? null : indexedDB)
        : factory as IDBFactory | null,
      now: now as () => string,
    };
  } catch (cause) {
    throw new AutosaveJournalError(
      "AUTOSAVE_INVALID_INPUT",
      "IndexedDB autosave storage options are invalid.",
      { operation: "open", cause },
    );
  }
}

function createTransaction(
  database: IDBDatabase,
  storeNames: string | string[],
  mode: IDBTransactionMode,
  operation: AutosaveJournalOperation,
  projectId?: EntityId,
): IDBTransaction {
  try {
    return database.transaction(storeNames, mode);
  } catch (cause) {
    throw storageError(operation, "Autosave database schema is unavailable.", projectId, cause);
  }
}

function monitorTransaction<T>(
  transaction: IDBTransaction,
  operation: AutosaveJournalOperation,
  projectId: EntityId | undefined,
  options: NormalizedOperationOptions,
): TransactionMonitor<T> {
  let result: T | undefined;
  let hasResult = false;
  let customError: AutosaveJournalError | undefined;
  let observedError: DOMException | null = null;
  let settled = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const signal = options.signal;
  const cleanup = (): void => {
    if (!signal) return;
    try {
      callNativeSignalListener(signal, "removeEventListener", onAbort);
    } catch {
      // A validated signal may only fail cleanup during host teardown.
    }
  };
  const rejectOnce = (error: unknown): void => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectPromise(error);
  };
  const onAbort = (): void => {
    customError = abortedError(operation, projectId, signal && nativeSignalValue(signal, "reason"));
    try {
      transaction.abort();
    } catch {
      rejectOnce(customError);
    }
  };
  transaction.oncomplete = () => {
    if (settled) return;
    if (customError || observedError) {
      rejectOnce(customError ?? normalizeAutosaveJournalError(observedError, { operation, projectId }));
      return;
    }
    if (!hasResult) {
      rejectOnce(storageError(operation, "Autosave transaction completed without a result.", projectId));
      return;
    }
    settled = true;
    cleanup();
    resolvePromise(result as T);
  };
  transaction.onabort = () => {
    rejectOnce(customError ?? normalizeAutosaveJournalError(
      transaction.error ?? observedError,
      { operation, projectId },
    ));
  };
  transaction.onerror = () => {
    observedError = transaction.error;
  };
  if (signal) {
    callNativeSignalListener(signal, "addEventListener", onAbort);
    if (nativeSignalValue(signal, "aborted") === true) onAbort();
  }
  return {
    promise,
    setResult(value) {
      result = value;
      hasResult = true;
    },
    fail(error) {
      if (customError) return;
      customError = error;
      try {
        transaction.abort();
      } catch {
        rejectOnce(error);
      }
    },
  };
}

function assertProjectId(projectId: unknown, operation: AutosaveJournalOperation): asserts projectId is EntityId {
  if (!isEntityId(projectId)) {
    throw new AutosaveJournalError("AUTOSAVE_INVALID_INPUT", "Project id must be a non-empty string.", {
      operation,
    });
  }
}

function assertJournalId(
  journalId: unknown,
  operation: AutosaveJournalOperation,
  projectId: EntityId,
): asserts journalId is string {
  if (!isEntityId(journalId)) {
    throw new AutosaveJournalError("AUTOSAVE_INVALID_INPUT", "Journal id must be a non-empty string.", {
      operation,
      projectId,
    });
  }
}

function checkpointMatchesJournal(
  checkpoint: StoredProjectCheckpoint | undefined,
  journal: StoredAutosaveJournal,
): boolean {
  return checkpoint
    ? journal.baseRevision === checkpoint.revision
      && journal.baseCheckpointId === checkpoint.checkpointId
    : journal.baseRevision === 0 && journal.baseCheckpointId === null;
}

function requestFailure(
  operation: AutosaveJournalOperation,
  projectId: EntityId,
  request: IDBRequest,
): AutosaveJournalError {
  return normalizeAutosaveJournalError(request.error, { operation, projectId });
}

/** IndexedDB adapter with compare-and-write stage and atomic journal promotion. */
export class IndexedDbAutosaveStorage implements AutosaveJournalStorage {
  readonly databaseName: string;
  private readonly factory: IDBFactory | null;
  private readonly now: () => string;
  private database?: IDBDatabase;
  private databasePromise?: Promise<IDBDatabase>;
  private openGeneration = 0;

  constructor(options: IndexedDbAutosaveStorageOptions = {}) {
    const normalized = normalizeStorageOptions(options);
    this.databaseName = normalized.databaseName;
    this.factory = normalized.factory;
    this.now = normalized.now;
  }

  private getDatabase(): Promise<IDBDatabase> {
    if (this.database) return Promise.resolve(this.database);
    if (this.databasePromise) return this.databasePromise;
    if (!this.factory) {
      return Promise.reject(storageError("open", "IndexedDB is unavailable in this environment."));
    }
    const generation = this.openGeneration;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      let settled = false;
      const rejectOnce = (error: unknown): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      try {
        request = this.factory!.open(this.databaseName, AUTOSAVE_DATABASE_VERSION);
      } catch (cause) {
        rejectOnce(normalizeAutosaveJournalError(cause, { operation: "open" }));
        return;
      }
      request.onupgradeneeded = () => {
        try {
          const database = request.result;
          if (!database.objectStoreNames.contains(AUTOSAVE_CHECKPOINT_STORE)) {
            database.createObjectStore(AUTOSAVE_CHECKPOINT_STORE, { keyPath: "projectId" });
          }
          if (!database.objectStoreNames.contains(AUTOSAVE_JOURNAL_STORE)) {
            database.createObjectStore(AUTOSAVE_JOURNAL_STORE, { keyPath: "projectId" });
          }
        } catch (cause) {
          try {
            request.transaction?.abort();
          } catch {
            rejectOnce(storageError("open", "Autosave database upgrade failed.", undefined, cause));
          }
        }
      };
      request.onerror = () => rejectOnce(normalizeAutosaveJournalError(request.error, { operation: "open" }));
      request.onblocked = () => rejectOnce(storageError(
        "open",
        "Autosave database upgrade is blocked by another connection.",
      ));
      request.onsuccess = () => {
        const database = request.result;
        if (settled || generation !== this.openGeneration) {
          database.close();
          rejectOnce(abortedError("open", undefined, "Connection closed while opening."));
          return;
        }
        settled = true;
        this.database = database;
        database.onversionchange = () => {
          database.close();
          if (this.database === database) {
            this.database = undefined;
            this.databasePromise = undefined;
            this.openGeneration += 1;
          }
        };
        resolve(database);
      };
    });
    const tracked = opening.catch((error: unknown) => {
      if (this.databasePromise === tracked) this.databasePromise = undefined;
      throw error;
    });
    this.databasePromise = tracked;
    return tracked;
  }

  async readState(
    projectId: EntityId,
    options?: AutosaveOperationOptions,
  ): Promise<AutosaveStorageSnapshot> {
    assertProjectId(projectId, "inspect");
    const normalized = normalizeOperationOptions(options, "inspect", projectId);
    throwIfAborted(normalized, "inspect", projectId);
    const database = await raceDatabaseOpen(this.getDatabase(), normalized, "inspect", projectId);
    throwIfAborted(normalized, "inspect", projectId);
    const transaction = createTransaction(
      database,
      [AUTOSAVE_CHECKPOINT_STORE, AUTOSAVE_JOURNAL_STORE],
      "readonly",
      "inspect",
      projectId,
    );
    const monitor = monitorTransaction<AutosaveStorageSnapshot>(
      transaction,
      "inspect",
      projectId,
      normalized,
    );
    try {
      const checkpointRequest = transaction.objectStore(AUTOSAVE_CHECKPOINT_STORE).get(projectId);
      const journalRequest = transaction.objectStore(AUTOSAVE_JOURNAL_STORE).get(projectId);
      let checkpointReady = false;
      let journalReady = false;
      let checkpoint: unknown;
      let journal: unknown;
      const complete = (): void => {
        if (!checkpointReady || !journalReady) return;
        monitor.setResult({
          ...(checkpoint !== undefined ? { checkpoint: checkpoint as StoredProjectCheckpoint } : {}),
          ...(journal !== undefined ? { journal: journal as StoredAutosaveJournal } : {}),
        });
      };
      checkpointRequest.onsuccess = () => {
        checkpoint = checkpointRequest.result;
        checkpointReady = true;
        complete();
      };
      journalRequest.onsuccess = () => {
        journal = journalRequest.result;
        journalReady = true;
        complete();
      };
      checkpointRequest.onerror = () => monitor.fail(requestFailure("inspect", projectId, checkpointRequest));
      journalRequest.onerror = () => monitor.fail(requestFailure("inspect", projectId, journalRequest));
    } catch (cause) {
      monitor.fail(storageError("inspect", "Autosave state could not be read.", projectId, cause));
    }
    return monitor.promise;
  }

  async stageJournal(
    journalValue: StoredAutosaveJournal,
    options?: AutosaveOperationOptions,
  ): Promise<void> {
    const journal = validateStoredAutosaveJournal(journalValue, undefined, "stage");
    const { projectId } = journal;
    const normalized = normalizeOperationOptions(options, "stage", projectId);
    throwIfAborted(normalized, "stage", projectId);
    const database = await raceDatabaseOpen(this.getDatabase(), normalized, "stage", projectId);
    throwIfAborted(normalized, "stage", projectId);
    const transaction = createTransaction(
      database,
      [AUTOSAVE_CHECKPOINT_STORE, AUTOSAVE_JOURNAL_STORE],
      "readwrite",
      "stage",
      projectId,
    );
    const monitor = monitorTransaction<void>(transaction, "stage", projectId, normalized);
    try {
      const checkpointStore = transaction.objectStore(AUTOSAVE_CHECKPOINT_STORE);
      const journalStore = transaction.objectStore(AUTOSAVE_JOURNAL_STORE);
      const checkpointRequest = checkpointStore.get(projectId);
      const pendingRequest = journalStore.get(projectId);
      let checkpointReady = false;
      let pendingReady = false;
      let checkpointValue: unknown;
      let pendingValue: unknown;
      const compareAndPut = (): void => {
        if (!checkpointReady || !pendingReady) return;
        try {
          if (pendingValue !== undefined) {
            const pending = validateStoredAutosaveJournal(pendingValue, projectId, "stage");
            throw conflictError(
              "stage",
              projectId,
              "A pending autosave journal already exists.",
              pending.journalId,
            );
          }
          const checkpoint = checkpointValue === undefined
            ? undefined
            : validateStoredProjectCheckpoint(checkpointValue, projectId, "stage");
          if (!checkpointMatchesJournal(checkpoint, journal)) {
            throw conflictError(
              "stage",
              projectId,
              "Autosave base checkpoint changed before the journal was staged.",
              journal.journalId,
            );
          }
          const putRequest = journalStore.put(journal);
          putRequest.onsuccess = () => monitor.setResult(undefined);
          putRequest.onerror = () => monitor.fail(requestFailure("stage", projectId, putRequest));
        } catch (cause) {
          monitor.fail(isAutosaveJournalError(cause)
            ? cause
            : storageError("stage", "Autosave journal could not be staged.", projectId, cause));
        }
      };
      checkpointRequest.onsuccess = () => {
        checkpointValue = checkpointRequest.result;
        checkpointReady = true;
        compareAndPut();
      };
      pendingRequest.onsuccess = () => {
        pendingValue = pendingRequest.result;
        pendingReady = true;
        compareAndPut();
      };
      checkpointRequest.onerror = () => monitor.fail(requestFailure("stage", projectId, checkpointRequest));
      pendingRequest.onerror = () => monitor.fail(requestFailure("stage", projectId, pendingRequest));
    } catch (cause) {
      monitor.fail(storageError("stage", "Autosave stage transaction could not start.", projectId, cause));
    }
    return monitor.promise;
  }

  async commitJournal(
    projectId: EntityId,
    journalId: string,
    options?: AutosaveOperationOptions,
  ): Promise<StoredProjectCheckpoint> {
    assertProjectId(projectId, "commit");
    assertJournalId(journalId, "commit", projectId);
    const normalized = normalizeOperationOptions(options, "commit", projectId);
    throwIfAborted(normalized, "commit", projectId);
    const database = await raceDatabaseOpen(this.getDatabase(), normalized, "commit", projectId);
    throwIfAborted(normalized, "commit", projectId);
    const transaction = createTransaction(
      database,
      [AUTOSAVE_CHECKPOINT_STORE, AUTOSAVE_JOURNAL_STORE],
      "readwrite",
      "commit",
      projectId,
    );
    const monitor = monitorTransaction<StoredProjectCheckpoint>(
      transaction,
      "commit",
      projectId,
      normalized,
    );
    try {
      const checkpointStore = transaction.objectStore(AUTOSAVE_CHECKPOINT_STORE);
      const journalStore = transaction.objectStore(AUTOSAVE_JOURNAL_STORE);
      const checkpointRequest = checkpointStore.get(projectId);
      const journalRequest = journalStore.get(projectId);
      let checkpointReady = false;
      let journalReady = false;
      let checkpointValue: unknown;
      let journalValue: unknown;
      const promote = (): void => {
        if (!checkpointReady || !journalReady) return;
        try {
          if (journalValue === undefined) {
            throw new AutosaveJournalError(
              "AUTOSAVE_JOURNAL_MISSING",
              "Pending autosave journal was not found.",
              { operation: "commit", projectId, journalId },
            );
          }
          const journal = validateStoredAutosaveJournal(journalValue, projectId, "commit");
          if (journal.journalId !== journalId) {
            throw conflictError(
              "commit",
              projectId,
              "Pending autosave journal identity changed before commit.",
              journalId,
            );
          }
          const checkpoint = checkpointValue === undefined
            ? undefined
            : validateStoredProjectCheckpoint(checkpointValue, projectId, "commit");
          if (!checkpointMatchesJournal(checkpoint, journal)) {
            throw conflictError(
              "commit",
              projectId,
              "Confirmed checkpoint changed before journal commit.",
              journalId,
            );
          }
          const committedAt = Reflect.apply(this.now, undefined, []) as unknown;
          if (!isISO8601Timestamp(committedAt)) {
            throw new TypeError("Autosave clock returned an invalid timestamp.");
          }
          const next = validateStoredProjectCheckpoint({
            format: AUTOSAVE_JOURNAL_FORMAT,
            formatVersion: AUTOSAVE_JOURNAL_VERSION,
            kind: "checkpoint",
            projectId,
            revision: journal.revision,
            projectJson: journal.projectJson,
            sha256: journal.sha256,
            byteSize: journal.byteSize,
            checkpointId: journal.journalId,
            parentCheckpointId: journal.baseCheckpointId,
            committedAt,
          }, projectId, "commit");
          const putRequest = checkpointStore.put(next);
          putRequest.onerror = () => monitor.fail(requestFailure("commit", projectId, putRequest));
          putRequest.onsuccess = () => {
            try {
              const deleteRequest = journalStore.delete(projectId);
              deleteRequest.onerror = () => monitor.fail(requestFailure("commit", projectId, deleteRequest));
              deleteRequest.onsuccess = () => monitor.setResult(next);
            } catch (cause) {
              monitor.fail(storageError("commit", "Autosave journal cleanup failed.", projectId, cause));
            }
          };
        } catch (cause) {
          monitor.fail(isAutosaveJournalError(cause)
            ? cause
            : storageError("commit", "Autosave journal could not be committed.", projectId, cause));
        }
      };
      checkpointRequest.onsuccess = () => {
        checkpointValue = checkpointRequest.result;
        checkpointReady = true;
        promote();
      };
      journalRequest.onsuccess = () => {
        journalValue = journalRequest.result;
        journalReady = true;
        promote();
      };
      checkpointRequest.onerror = () => monitor.fail(requestFailure("commit", projectId, checkpointRequest));
      journalRequest.onerror = () => monitor.fail(requestFailure("commit", projectId, journalRequest));
    } catch (cause) {
      monitor.fail(storageError("commit", "Autosave commit transaction could not start.", projectId, cause));
    }
    return monitor.promise;
  }

  async discardJournal(
    projectId: EntityId,
    journalId: string,
    options?: AutosaveOperationOptions,
  ): Promise<void> {
    assertProjectId(projectId, "discard");
    assertJournalId(journalId, "discard", projectId);
    const normalized = normalizeOperationOptions(options, "discard", projectId);
    throwIfAborted(normalized, "discard", projectId);
    const database = await raceDatabaseOpen(this.getDatabase(), normalized, "discard", projectId);
    throwIfAborted(normalized, "discard", projectId);
    const transaction = createTransaction(
      database,
      AUTOSAVE_JOURNAL_STORE,
      "readwrite",
      "discard",
      projectId,
    );
    const monitor = monitorTransaction<void>(transaction, "discard", projectId, normalized);
    try {
      const store = transaction.objectStore(AUTOSAVE_JOURNAL_STORE);
      const request = store.get(projectId);
      request.onerror = () => monitor.fail(requestFailure("discard", projectId, request));
      request.onsuccess = () => {
        try {
          if (request.result === undefined) {
            throw new AutosaveJournalError(
              "AUTOSAVE_JOURNAL_MISSING",
              "Pending autosave journal was not found.",
              { operation: "discard", projectId, journalId },
            );
          }
          const journal = validateStoredAutosaveJournal(request.result, projectId, "discard");
          if (journal.journalId !== journalId) {
            throw conflictError(
              "discard",
              projectId,
              "Pending autosave journal identity changed before discard.",
              journalId,
            );
          }
          const deleteRequest = store.delete(projectId);
          deleteRequest.onerror = () => monitor.fail(requestFailure("discard", projectId, deleteRequest));
          deleteRequest.onsuccess = () => monitor.setResult(undefined);
        } catch (cause) {
          monitor.fail(isAutosaveJournalError(cause)
            ? cause
            : storageError("discard", "Autosave journal could not be discarded.", projectId, cause));
        }
      };
    } catch (cause) {
      monitor.fail(storageError("discard", "Autosave discard transaction could not start.", projectId, cause));
    }
    return monitor.promise;
  }

  close(): void {
    this.openGeneration += 1;
    this.database?.close();
    this.database = undefined;
    this.databasePromise = undefined;
  }

  async destroy(): Promise<void> {
    this.close();
    if (!this.factory) {
      throw storageError("destroy", "IndexedDB is unavailable in this environment.");
    }
    await new Promise<void>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = this.factory!.deleteDatabase(this.databaseName);
      } catch (cause) {
        reject(normalizeAutosaveJournalError(cause, { operation: "destroy" }));
        return;
      }
      request.onsuccess = () => resolve();
      request.onerror = () => reject(normalizeAutosaveJournalError(request.error, { operation: "destroy" }));
      request.onblocked = () => {
        // A blocked request can later succeed or fail; wait for its terminal event.
      };
    });
  }
}
