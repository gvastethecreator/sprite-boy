import { describe, expect, it, vi } from "vitest";
import {
  AUTOSAVE_CHECKPOINT_STORE,
  AUTOSAVE_DATABASE_VERSION,
  AUTOSAVE_JOURNAL_FORMAT,
  AUTOSAVE_JOURNAL_STORE,
  AUTOSAVE_JOURNAL_VERSION,
  IndexedDbAutosaveStorage,
  type StoredAutosaveJournal,
  type StoredProjectCheckpoint,
} from "../../core/persistence";

const PROJECT_ID = "project-1";
const JOURNAL_ID = "project-1:1:journal";
const HASH = "a".repeat(64);

const journal: StoredAutosaveJournal = Object.freeze({
  format: AUTOSAVE_JOURNAL_FORMAT,
  formatVersion: AUTOSAVE_JOURNAL_VERSION,
  kind: "journal",
  projectId: PROJECT_ID,
  revision: 1,
  projectJson: "{\"id\":\"project-1\"}",
  sha256: HASH,
  byteSize: 18,
  journalId: JOURNAL_ID,
  baseRevision: 0,
  baseCheckpointId: null,
  stagedAt: "2026-07-26T12:00:00.000Z",
});

const checkpoint: StoredProjectCheckpoint = Object.freeze({
  format: AUTOSAVE_JOURNAL_FORMAT,
  formatVersion: AUTOSAVE_JOURNAL_VERSION,
  kind: "checkpoint",
  projectId: PROJECT_ID,
  revision: 1,
  projectJson: journal.projectJson,
  sha256: HASH,
  byteSize: journal.byteSize,
  checkpointId: JOURNAL_ID,
  parentCheckpointId: null,
  committedAt: "2026-07-26T12:01:00.000Z",
});

class RequestBox<T = unknown> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: ((event?: Event) => void) | null = null;
  onerror: ((event?: Event) => void) | null = null;

  succeed(value: T): void {
    this.result = value;
    this.onsuccess?.();
  }

  fail(error: DOMException): void {
    this.error = error;
    this.onerror?.();
  }
}

class StoreBox {
  readonly gets: Array<{ key: string; request: RequestBox }> = [];
  readonly puts: Array<{ value: unknown; request: RequestBox }> = [];
  readonly deletes: Array<{ key: string; request: RequestBox }> = [];

  get(key: string): IDBRequest {
    const request = new RequestBox();
    this.gets.push({ key, request });
    return request as unknown as IDBRequest;
  }

  put(value: unknown): IDBRequest {
    const request = new RequestBox();
    this.puts.push({ value, request });
    return request as unknown as IDBRequest;
  }

  delete(key: string): IDBRequest {
    const request = new RequestBox();
    this.deletes.push({ key, request });
    return request as unknown as IDBRequest;
  }
}

class TransactionBox {
  error: DOMException | null = null;
  oncomplete: ((event?: Event) => void) | null = null;
  onabort: ((event?: Event) => void) | null = null;
  onerror: ((event?: Event) => void) | null = null;
  readonly stores = new Map<string, StoreBox>();
  readonly abort = vi.fn(() => this.onabort?.());

  objectStore(name: string): IDBObjectStore {
    let store = this.stores.get(name);
    if (!store) {
      store = new StoreBox();
      this.stores.set(name, store);
    }
    return store as unknown as IDBObjectStore;
  }

  store(name: string): StoreBox {
    return this.stores.get(name) ?? (() => { throw new Error(`Missing store ${name}`); })();
  }

  complete(): void {
    this.oncomplete?.();
  }

  fail(error: DOMException): void {
    this.error = error;
    this.onerror?.();
    this.onabort?.();
  }
}

class OpenRequestBox extends RequestBox<IDBDatabase> {
  transaction: { abort: ReturnType<typeof vi.fn> } | null = null;
  onupgradeneeded: ((event?: IDBVersionChangeEvent) => void) | null = null;
  onblocked: ((event?: IDBVersionChangeEvent) => void) | null = null;

  upgrade(): void {
    this.onupgradeneeded?.();
  }

  block(): void {
    this.onblocked?.();
  }
}

class DeleteRequestBox extends RequestBox<undefined> {
  onblocked: ((event?: IDBVersionChangeEvent) => void) | null = null;

  block(): void {
    this.onblocked?.();
  }
}

interface DatabaseBox {
  database: IDBDatabase;
  close: ReturnType<typeof vi.fn>;
  createObjectStore: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
  setStores(names: string[]): void;
  versionChange(): void;
}

function createDatabaseBox(transactions: TransactionBox[] = []): DatabaseBox {
  const stores = new Set<string>();
  const close = vi.fn();
  const createObjectStore = vi.fn((name: string) => {
    stores.add(name);
    return {} as IDBObjectStore;
  });
  const transaction = vi.fn(() => {
    const next = transactions.shift();
    if (!next) throw new DOMException("transaction unavailable", "InvalidStateError");
    return next as unknown as IDBTransaction;
  });
  const database = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore,
    transaction,
    close,
    onversionchange: null as (() => void) | null,
  } as unknown as IDBDatabase;
  return {
    database,
    close,
    createObjectStore,
    transaction,
    setStores(names) {
      names.forEach((name) => stores.add(name));
    },
    versionChange() {
      database.onversionchange?.(new Event("versionchange") as IDBVersionChangeEvent);
    },
  };
}

interface FactoryBox {
  factory: IDBFactory;
  open: ReturnType<typeof vi.fn>;
  deleteDatabase: ReturnType<typeof vi.fn>;
  opens: OpenRequestBox[];
  deletes: DeleteRequestBox[];
}

function createFactoryBox(): FactoryBox {
  const opens: OpenRequestBox[] = [];
  const deletes: DeleteRequestBox[] = [];
  const open = vi.fn(() => {
    const request = new OpenRequestBox();
    opens.push(request);
    return request as unknown as IDBOpenDBRequest;
  });
  const deleteDatabase = vi.fn(() => {
    const request = new DeleteRequestBox();
    deletes.push(request);
    return request as unknown as IDBOpenDBRequest;
  });
  return {
    factory: { open, deleteDatabase } as unknown as IDBFactory,
    open,
    deleteDatabase,
    opens,
    deletes,
  };
}

async function flushOpen(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function startRead(
  storage: IndexedDbAutosaveStorage,
  factory: FactoryBox,
  database: IDBDatabase,
): Promise<{ pending: Promise<unknown>; transaction: TransactionBox }> {
  const pending = storage.readState(PROJECT_ID);
  const request = factory.opens.at(-1);
  if (!request) throw new Error("Expected an open request");
  request.succeed(database);
  await flushOpen();
  const transaction = (database.transaction as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
  if (!transaction) throw new Error("Expected a transaction");
  return { pending, transaction: transaction as TransactionBox };
}

describe("IndexedDbAutosaveStorage", () => {
  it.each([
    null,
    [],
    new Date(),
    { extra: true },
    { databaseName: "" },
    { databaseName: 42 },
    { factory: "indexed-db" },
    { now: "today" },
  ])("rejects invalid constructor options without opening IndexedDB: %o", (options) => {
    expect(() => new IndexedDbAutosaveStorage(options as never)).toThrowError(expect.objectContaining({
      code: "AUTOSAVE_INVALID_INPUT",
      operation: "open",
    }));
  });

  it("rejects unavailable storage, invalid IDs, and hostile operation options", async () => {
    const storage = new IndexedDbAutosaveStorage({ factory: null });
    await expect(storage.readState(PROJECT_ID)).rejects.toMatchObject({
      code: "AUTOSAVE_STORAGE_UNAVAILABLE",
      operation: "open",
    });
    await expect(storage.destroy()).rejects.toMatchObject({
      code: "AUTOSAVE_STORAGE_UNAVAILABLE",
      operation: "destroy",
    });
    await expect(storage.readState("" as never)).rejects.toMatchObject({
      code: "AUTOSAVE_INVALID_INPUT",
      operation: "inspect",
    });
    await expect(storage.commitJournal(PROJECT_ID, "")).rejects.toMatchObject({
      code: "AUTOSAVE_INVALID_INPUT",
      operation: "commit",
      projectId: PROJECT_ID,
    });
    await expect(storage.discardJournal(PROJECT_ID, JOURNAL_ID, [] as never)).rejects.toMatchObject({
      code: "AUTOSAVE_INVALID_INPUT",
      operation: "discard",
      projectId: PROJECT_ID,
    });

    let reads = 0;
    const options = {};
    Object.defineProperty(options, "signal", {
      enumerable: true,
      get() {
        reads += 1;
        return undefined;
      },
    });
    await expect(storage.readState(PROJECT_ID, options)).rejects.toMatchObject({
      code: "AUTOSAVE_INVALID_INPUT",
      operation: "inspect",
    });
    expect(reads).toBe(0);
  });

  it("rejects pre-aborted operations before the factory is called", async () => {
    const factory = createFactoryBox();
    const storage = new IndexedDbAutosaveStorage({ factory: factory.factory });
    const controller = new AbortController();
    controller.abort("stop before open");

    await expect(storage.readState(PROJECT_ID, { signal: controller.signal })).rejects.toMatchObject({
      code: "AUTOSAVE_ABORTED",
      operation: "inspect",
      projectId: PROJECT_ID,
      cause: "stop before open",
    });
    await expect(storage.stageJournal(journal, { signal: controller.signal })).rejects.toMatchObject({
      code: "AUTOSAVE_ABORTED",
      operation: "stage",
    });
    await expect(storage.commitJournal(PROJECT_ID, JOURNAL_ID, { signal: controller.signal }))
      .rejects.toMatchObject({ code: "AUTOSAVE_ABORTED", operation: "commit" });
    await expect(storage.discardJournal(PROJECT_ID, JOURNAL_ID, { signal: controller.signal }))
      .rejects.toMatchObject({ code: "AUTOSAVE_ABORTED", operation: "discard" });
    expect(factory.open).not.toHaveBeenCalled();
  });

  it("upgrades missing stores, reads both records, caches the connection, and reopens on version change", async () => {
    const firstTransaction = new TransactionBox();
    const cachedTransaction = new TransactionBox();
    const reopenedTransaction = new TransactionBox();
    const firstDatabase = createDatabaseBox([firstTransaction, cachedTransaction]);
    const secondDatabase = createDatabaseBox([reopenedTransaction]);
    const factory = createFactoryBox();
    const storage = new IndexedDbAutosaveStorage({
      databaseName: "autosave-test",
      factory: factory.factory,
    });

    const first = storage.readState(PROJECT_ID);
    const firstOpen = factory.opens[0]!;
    firstOpen.result = firstDatabase.database;
    firstOpen.upgrade();
    firstOpen.succeed(firstDatabase.database);
    await flushOpen();
    firstTransaction.store(AUTOSAVE_CHECKPOINT_STORE).gets[0]!.request.succeed(checkpoint);
    firstTransaction.store(AUTOSAVE_JOURNAL_STORE).gets[0]!.request.succeed(journal);
    firstTransaction.complete();
    await expect(first).resolves.toEqual({ checkpoint, journal });
    expect(factory.open).toHaveBeenCalledWith("autosave-test", AUTOSAVE_DATABASE_VERSION);
    expect(firstDatabase.createObjectStore).toHaveBeenNthCalledWith(1, AUTOSAVE_CHECKPOINT_STORE, {
      keyPath: "projectId",
    });
    expect(firstDatabase.createObjectStore).toHaveBeenNthCalledWith(2, AUTOSAVE_JOURNAL_STORE, {
      keyPath: "projectId",
    });

    const cached = storage.readState(PROJECT_ID);
    await flushOpen();
    cachedTransaction.store(AUTOSAVE_CHECKPOINT_STORE).gets[0]!.request.succeed(undefined);
    cachedTransaction.store(AUTOSAVE_JOURNAL_STORE).gets[0]!.request.succeed(undefined);
    cachedTransaction.complete();
    await expect(cached).resolves.toEqual({});
    expect(factory.open).toHaveBeenCalledTimes(1);

    firstDatabase.versionChange();
    expect(firstDatabase.close).toHaveBeenCalledOnce();
    const reopened = storage.readState(PROJECT_ID);
    factory.opens[1]!.succeed(secondDatabase.database);
    await flushOpen();
    reopenedTransaction.store(AUTOSAVE_CHECKPOINT_STORE).gets[0]!.request.succeed(undefined);
    reopenedTransaction.store(AUTOSAVE_JOURNAL_STORE).gets[0]!.request.succeed(undefined);
    reopenedTransaction.complete();
    await expect(reopened).resolves.toEqual({});
    expect(factory.open).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["error", "AUTOSAVE_QUOTA_EXCEEDED"],
    ["blocked", "AUTOSAVE_STORAGE_UNAVAILABLE"],
  ] as const)("reports an open %s event", async (event, code) => {
    const factory = createFactoryBox();
    const storage = new IndexedDbAutosaveStorage({ factory: factory.factory });
    const pending = storage.readState(PROJECT_ID);
    const request = factory.opens[0]!;
    if (event === "error") request.fail(new DOMException("quota", "QuotaExceededError"));
    else request.block();
    await expect(pending).rejects.toMatchObject({ code, operation: "open" });
  });

  it("normalizes a synchronous open failure", async () => {
    const factory = {
      open: vi.fn(() => { throw new DOMException("bad key", "DataError"); }),
    } as unknown as IDBFactory;
    const storage = new IndexedDbAutosaveStorage({ factory });
    await expect(storage.readState(PROJECT_ID)).rejects.toMatchObject({
      code: "AUTOSAVE_INVALID_INPUT",
      operation: "open",
    });
  });

  it("closes a connection that succeeds after close invalidated its open generation", async () => {
    const factory = createFactoryBox();
    const database = createDatabaseBox();
    const storage = new IndexedDbAutosaveStorage({ factory: factory.factory });
    const pending = storage.readState(PROJECT_ID);
    storage.close();
    factory.opens[0]!.succeed(database.database);

    await expect(pending).rejects.toMatchObject({
      code: "AUTOSAVE_ABORTED",
      operation: "open",
      cause: "Connection closed while opening.",
    });
    expect(database.close).toHaveBeenCalledOnce();
  });

  it("aborts an active transaction from its signal and preserves the abort reason", async () => {
    const factory = createFactoryBox();
    const transaction = new TransactionBox();
    const database = createDatabaseBox([transaction]);
    const storage = new IndexedDbAutosaveStorage({ factory: factory.factory });
    const controller = new AbortController();
    const pending = storage.readState(PROJECT_ID, { signal: controller.signal });
    factory.opens[0]!.succeed(database.database);
    await flushOpen();
    controller.abort("leave editor");

    await expect(pending).rejects.toMatchObject({
      code: "AUTOSAVE_ABORTED",
      operation: "inspect",
      projectId: PROJECT_ID,
      cause: "leave editor",
    });
    expect(transaction.abort).toHaveBeenCalledOnce();
  });

  it("reports transaction error, abort, missing result, and schema failures", async () => {
    const factory = createFactoryBox();
    const failedTransaction = new TransactionBox();
    const emptyTransaction = new TransactionBox();
    const database = createDatabaseBox([failedTransaction, emptyTransaction]);
    const storage = new IndexedDbAutosaveStorage({ factory: factory.factory });

    const failed = await startRead(storage, factory, database.database);
    failed.transaction.fail(new DOMException("quota", "QuotaExceededError"));
    await expect(failed.pending).rejects.toMatchObject({
      code: "AUTOSAVE_QUOTA_EXCEEDED",
      operation: "inspect",
    });

    const empty = storage.readState(PROJECT_ID);
    await flushOpen();
    emptyTransaction.complete();
    await expect(empty).rejects.toMatchObject({
      code: "AUTOSAVE_STORAGE_UNAVAILABLE",
      operation: "inspect",
      message: "Autosave transaction completed without a result.",
    });

    const schema = storage.readState(PROJECT_ID);
    await expect(schema).rejects.toMatchObject({
      code: "AUTOSAVE_STORAGE_UNAVAILABLE",
      operation: "inspect",
      projectId: PROJECT_ID,
    });
  });

  it("stages, commits, and discards journals through atomic transactions", async () => {
    const factory = createFactoryBox();
    const stageTransaction = new TransactionBox();
    const commitTransaction = new TransactionBox();
    const discardTransaction = new TransactionBox();
    const database = createDatabaseBox([stageTransaction, commitTransaction, discardTransaction]);
    database.setStores([AUTOSAVE_CHECKPOINT_STORE, AUTOSAVE_JOURNAL_STORE]);
    const storage = new IndexedDbAutosaveStorage({
      factory: factory.factory,
      now: () => "2026-07-26T12:01:00.000Z",
    });

    const staged = storage.stageJournal(journal);
    factory.opens[0]!.succeed(database.database);
    await flushOpen();
    stageTransaction.store(AUTOSAVE_CHECKPOINT_STORE).gets[0]!.request.succeed(undefined);
    stageTransaction.store(AUTOSAVE_JOURNAL_STORE).gets[0]!.request.succeed(undefined);
    const stagePut = stageTransaction.store(AUTOSAVE_JOURNAL_STORE).puts[0]!;
    expect(stagePut.value).toEqual(journal);
    stagePut.request.succeed(undefined);
    stageTransaction.complete();
    await expect(staged).resolves.toBeUndefined();

    const committed = storage.commitJournal(PROJECT_ID, JOURNAL_ID);
    await flushOpen();
    commitTransaction.store(AUTOSAVE_CHECKPOINT_STORE).gets[0]!.request.succeed(undefined);
    commitTransaction.store(AUTOSAVE_JOURNAL_STORE).gets[0]!.request.succeed(journal);
    const checkpointPut = commitTransaction.store(AUTOSAVE_CHECKPOINT_STORE).puts[0]!;
    expect(checkpointPut.value).toEqual(checkpoint);
    checkpointPut.request.succeed(undefined);
    const journalDelete = commitTransaction.store(AUTOSAVE_JOURNAL_STORE).deletes[0]!;
    expect(journalDelete.key).toBe(PROJECT_ID);
    journalDelete.request.succeed(undefined);
    commitTransaction.complete();
    await expect(committed).resolves.toEqual(checkpoint);

    const discarded = storage.discardJournal(PROJECT_ID, JOURNAL_ID);
    await flushOpen();
    discardTransaction.store(AUTOSAVE_JOURNAL_STORE).gets[0]!.request.succeed(journal);
    const discardDelete = discardTransaction.store(AUTOSAVE_JOURNAL_STORE).deletes[0]!;
    discardDelete.request.succeed(undefined);
    discardTransaction.complete();
    await expect(discarded).resolves.toBeUndefined();
  });

  it("waits through a blocked destroy and handles success, error, and synchronous failure", async () => {
    const factory = createFactoryBox();
    const storage = new IndexedDbAutosaveStorage({
      databaseName: "destroy-test",
      factory: factory.factory,
    });
    const destroyed = storage.destroy();
    const first = factory.deletes[0]!;
    first.block();
    expect(factory.deleteDatabase).toHaveBeenCalledWith("destroy-test");
    first.succeed(undefined);
    await expect(destroyed).resolves.toBeUndefined();

    const failed = storage.destroy();
    factory.deletes[1]!.fail(new DOMException("quota", "QuotaExceededError"));
    await expect(failed).rejects.toMatchObject({
      code: "AUTOSAVE_QUOTA_EXCEEDED",
      operation: "destroy",
    });

    const throwing = new IndexedDbAutosaveStorage({
      factory: {
        deleteDatabase: () => { throw new DOMException("bad key", "DataError"); },
      } as unknown as IDBFactory,
    });
    await expect(throwing.destroy()).rejects.toMatchObject({
      code: "AUTOSAVE_INVALID_INPUT",
      operation: "destroy",
    });
  });
});
