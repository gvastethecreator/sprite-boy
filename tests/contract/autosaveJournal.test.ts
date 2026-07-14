import { describe, expect, it } from "vitest";
import type { StudioProjectV1 } from "../../core/project";
import {
  AUTOSAVE_CHECKPOINT_STORE,
  AUTOSAVE_JOURNAL_STORE,
  AUTOSAVE_JOURNAL_FORMAT,
  AUTOSAVE_JOURNAL_VERSION,
  AutosaveJournalError,
  IndexedDbAutosaveStorage,
  ProjectAutosaveJournal,
} from "../../core/persistence";
import type {
  AutosaveContentIdentity,
  AutosaveJournalStorage,
  AutosaveOperationOptions,
  AutosaveStorageSnapshot,
  StoredAutosaveJournal,
  StoredProjectCheckpoint,
} from "../../core/persistence";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

class MemoryAutosaveStorage implements AutosaveJournalStorage {
  readonly checkpoints = new Map<string, StoredProjectCheckpoint>();
  readonly journals = new Map<string, StoredAutosaveJournal>();
  failNextCommit = false;

  async readState(projectId: string): Promise<AutosaveStorageSnapshot> {
    const checkpoint = this.checkpoints.get(projectId);
    const journal = this.journals.get(projectId);
    return {
      ...(checkpoint ? { checkpoint } : {}),
      ...(journal ? { journal } : {}),
    };
  }

  async stageJournal(journal: StoredAutosaveJournal): Promise<void> {
    if (this.journals.has(journal.projectId)) {
      throw new AutosaveJournalError("AUTOSAVE_CONFLICT", "pending journal", {
        operation: "stage",
        projectId: journal.projectId,
        journalId: journal.journalId,
      });
    }
    const checkpoint = this.checkpoints.get(journal.projectId);
    const matches = checkpoint
      ? checkpoint.revision === journal.baseRevision
        && checkpoint.checkpointId === journal.baseCheckpointId
      : journal.baseRevision === 0 && journal.baseCheckpointId === null;
    if (!matches) {
      throw new AutosaveJournalError("AUTOSAVE_CONFLICT", "stale base", {
        operation: "stage",
        projectId: journal.projectId,
        journalId: journal.journalId,
      });
    }
    this.journals.set(journal.projectId, journal);
  }

  async commitJournal(projectId: string, journalId: string): Promise<StoredProjectCheckpoint> {
    const journal = this.journals.get(projectId);
    if (!journal) {
      throw new AutosaveJournalError("AUTOSAVE_JOURNAL_MISSING", "missing", {
        operation: "commit",
        projectId,
        journalId,
      });
    }
    const checkpoint = this.checkpoints.get(projectId);
    const matches = journal.journalId === journalId && (checkpoint
      ? checkpoint.revision === journal.baseRevision
        && checkpoint.checkpointId === journal.baseCheckpointId
      : journal.baseRevision === 0 && journal.baseCheckpointId === null);
    if (!matches) {
      throw new AutosaveJournalError("AUTOSAVE_CONFLICT", "stale journal", {
        operation: "commit",
        projectId,
        journalId,
      });
    }
    const next: StoredProjectCheckpoint = Object.freeze({
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
      committedAt: "2026-07-14T12:00:01.000Z",
    });
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new DOMException("simulated partial write", "UnknownError");
    }
    this.checkpoints.set(projectId, next);
    this.journals.delete(projectId);
    return next;
  }

  async discardJournal(projectId: string, journalId: string): Promise<void> {
    const journal = this.journals.get(projectId);
    if (!journal) {
      throw new AutosaveJournalError("AUTOSAVE_JOURNAL_MISSING", "missing", {
        operation: "discard",
        projectId,
        journalId,
      });
    }
    if (journal.journalId !== journalId) {
      throw new AutosaveJournalError("AUTOSAVE_CONFLICT", "changed", {
        operation: "discard",
        projectId,
        journalId,
      });
    }
    this.journals.delete(projectId);
  }
}

function updatedProject(name: string, updatedAt: string): StudioProjectV1 {
  return { ...studioProjectV1Fixture, name, updatedAt };
}

async function identityFor(projectJson: string): Promise<AutosaveContentIdentity> {
  const bytes = new TextEncoder().encode(projectJson);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return {
    sha256: [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    byteSize: bytes.byteLength,
  };
}

interface FakeIdbHarness {
  factory: IDBFactory;
  checkpoints: Map<string, StoredProjectCheckpoint>;
  journals: Map<string, StoredAutosaveJournal>;
  transactions: Array<{ stores: string[]; mode: IDBTransactionMode }>;
  failNextDelete?: DOMException;
}

function createFakeIdbHarness(): FakeIdbHarness {
  const harness: FakeIdbHarness = {
    factory: undefined as unknown as IDBFactory,
    checkpoints: new Map(),
    journals: new Map(),
    transactions: [],
  };
  const database = {
    objectStoreNames: { contains: () => true },
    close() {},
    onversionchange: null,
    transaction(storeNames: string | string[], mode: IDBTransactionMode) {
      const names = typeof storeNames === "string" ? [storeNames] : [...storeNames];
      harness.transactions.push({ stores: names, mode });
      const checkpointWork = new Map(harness.checkpoints);
      const journalWork = new Map(harness.journals);
      let pending = 0;
      let aborted = false;
      let completionVersion = 0;
      const transaction = {
        error: null as DOMException | null,
        oncomplete: null as (() => void) | null,
        onabort: null as (() => void) | null,
        onerror: null as (() => void) | null,
        abort() {
          if (aborted) throw new DOMException("already aborted", "InvalidStateError");
          aborted = true;
          completionVersion += 1;
          queueMicrotask(() => transaction.onabort?.());
        },
        objectStore(storeName: string) {
          const work = (storeName === AUTOSAVE_CHECKPOINT_STORE
            ? checkpointWork
            : journalWork) as Map<string, StoredProjectCheckpoint | StoredAutosaveJournal>;
          const request = (
            action: "get" | "put" | "delete",
            key: string,
            value?: StoredProjectCheckpoint | StoredAutosaveJournal,
          ): IDBRequest => {
            const result = {
              result: undefined as unknown,
              error: null as DOMException | null,
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null,
            };
            pending += 1;
            completionVersion += 1;
            queueMicrotask(() => {
              if (aborted) return;
              try {
                if (action === "get") result.result = work.get(key);
                if (action === "put" && value) work.set(key, value);
                if (action === "delete") {
                  if (harness.failNextDelete) {
                    const failure = harness.failNextDelete;
                    harness.failNextDelete = undefined;
                    throw failure;
                  }
                  work.delete(key);
                }
                result.onsuccess?.();
              } catch (error) {
                result.error = error as DOMException;
                transaction.error = result.error;
                result.onerror?.();
                if (!aborted) transaction.abort();
              } finally {
                pending -= 1;
                scheduleCompletion();
              }
            });
            return result as unknown as IDBRequest;
          };
          return {
            get(key: string) {
              return request("get", key);
            },
            put(value: StoredProjectCheckpoint | StoredAutosaveJournal) {
              return request("put", value.projectId, value);
            },
            delete(key: string) {
              return request("delete", key);
            },
          };
        },
      };
      const scheduleCompletion = (): void => {
        if (aborted || pending !== 0) return;
        const version = ++completionVersion;
        queueMicrotask(() => {
          if (aborted || pending !== 0 || version !== completionVersion) return;
          harness.checkpoints.clear();
          checkpointWork.forEach((value, key) => harness.checkpoints.set(key, value));
          harness.journals.clear();
          journalWork.forEach((value, key) => harness.journals.set(key, value));
          transaction.oncomplete?.();
        });
      };
      scheduleCompletion();
      return transaction as unknown as IDBTransaction;
    },
  };
  harness.factory = {
    open() {
      const request = {
        result: database,
        transaction: null,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onblocked: null as (() => void) | null,
        error: null,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request as unknown as IDBOpenDBRequest;
    },
    deleteDatabase() {
      throw new Error("not used by focused transaction proof");
    },
  } as unknown as IDBFactory;
  return harness;
}

describe("ProjectAutosaveJournal (F3-05)", () => {
  it("stages and atomically promotes a canonical checkpoint", async () => {
    const storage = new MemoryAutosaveStorage();
    const autosave = new ProjectAutosaveJournal(storage, {
      now: () => "2026-07-14T12:00:00.000Z",
    });

    const checkpoint = await autosave.checkpoint(studioProjectV1Fixture);

    expect(checkpoint.record).toMatchObject({
      projectId: studioProjectV1Fixture.id,
      revision: 1,
      parentCheckpointId: null,
    });
    expect(checkpoint.project).toEqual(studioProjectV1Fixture);
    expect(storage.journals.size).toBe(0);
    const inspection = await autosave.inspect(studioProjectV1Fixture.id);
    expect(inspection.confirmed?.project).toEqual(studioProjectV1Fixture);
    expect(inspection.recoveryCandidate).toBeUndefined();
  });

  it("exposes a staged crash residue as a recovery candidate and can promote it", async () => {
    const storage = new MemoryAutosaveStorage();
    const autosave = new ProjectAutosaveJournal(storage, {
      now: () => "2026-07-14T12:00:00.000Z",
    });
    await autosave.checkpoint(studioProjectV1Fixture);
    const changed = updatedProject("Recovered draft", "2026-07-14T12:01:00.000Z");

    const journal = await autosave.stage(changed);
    const interrupted = await autosave.inspect(changed.id);

    expect(interrupted.confirmed?.project.name).toBe("Contract project");
    expect(interrupted.recoveryCandidate?.project.name).toBe("Recovered draft");
    expect(interrupted.recoveryCandidate?.record).toMatchObject({
      baseRevision: 1,
      revision: 2,
      baseCheckpointId: interrupted.confirmed?.record.checkpointId,
    });
    const recovered = await autosave.commit(changed.id, journal.journalId);
    expect(recovered.record.revision).toBe(2);
    expect(recovered.project.name).toBe("Recovered draft");
    expect((await autosave.inspect(changed.id)).recoveryCandidate).toBeUndefined();
  });

  it("keeps the confirmed checkpoint and pending journal after a failed commit", async () => {
    const storage = new MemoryAutosaveStorage();
    const autosave = new ProjectAutosaveJournal(storage, {
      now: () => "2026-07-14T12:00:00.000Z",
    });
    await autosave.checkpoint(studioProjectV1Fixture);
    const changed = updatedProject("Partial write draft", "2026-07-14T12:02:00.000Z");
    const journal = await autosave.stage(changed);
    const confirmedBefore = storage.checkpoints.get(changed.id);
    storage.failNextCommit = true;

    await expect(autosave.commit(changed.id, journal.journalId)).rejects.toMatchObject({
      code: "AUTOSAVE_STORAGE_UNAVAILABLE",
      operation: "commit",
    });

    expect(storage.checkpoints.get(changed.id)).toBe(confirmedBefore);
    const inspection = await autosave.inspect(changed.id);
    expect(inspection.confirmed?.project.name).toBe("Contract project");
    expect(inspection.recoveryCandidate?.project.name).toBe("Partial write draft");
  });

  it("promotes and rolls back checkpoint+journal atomically in one IndexedDB transaction", async () => {
    const idb = createFakeIdbHarness();
    const storage = new IndexedDbAutosaveStorage({
      factory: idb.factory,
      now: () => "2026-07-14T12:00:01.000Z",
    });
    const autosave = new ProjectAutosaveJournal(storage, {
      now: () => "2026-07-14T12:00:00.000Z",
    });
    const confirmed = await autosave.checkpoint(studioProjectV1Fixture);
    expect(idb.checkpoints.get(studioProjectV1Fixture.id)?.checkpointId)
      .toBe(confirmed.record.checkpointId);
    expect(idb.journals.has(studioProjectV1Fixture.id)).toBe(false);

    const changed = updatedProject("Atomic rollback draft", "2026-07-14T12:02:00.000Z");
    const journal = await autosave.stage(changed);
    const confirmedBefore = idb.checkpoints.get(changed.id)?.checkpointId;
    idb.failNextDelete = new DOMException("private quota detail", "QuotaExceededError");
    let failure: AutosaveJournalError | undefined;
    try {
      await autosave.commit(changed.id, journal.journalId);
    } catch (error) {
      failure = error as AutosaveJournalError;
    }
    expect(failure).toMatchObject({ code: "AUTOSAVE_QUOTA_EXCEEDED", operation: "commit" });
    expect(failure?.toDiagnostic()).not.toHaveProperty("cause");
    expect(JSON.stringify(failure?.toDiagnostic())).not.toContain("private quota detail");
    expect(idb.checkpoints.get(changed.id)?.checkpointId).toBe(confirmedBefore);
    expect(idb.journals.get(changed.id)?.journalId).toBe(journal.journalId);
    expect(idb.transactions.at(-1)).toEqual({
      stores: [AUTOSAVE_CHECKPOINT_STORE, AUTOSAVE_JOURNAL_STORE],
      mode: "readwrite",
    });
  });

  it("preserves an unresolved recovery candidate instead of overwriting it", async () => {
    const storage = new MemoryAutosaveStorage();
    const autosave = new ProjectAutosaveJournal(storage, {
      now: () => "2026-07-14T12:00:00.000Z",
    });
    const first = await autosave.stage(studioProjectV1Fixture);
    const replacement = updatedProject("Must not replace", "2026-07-14T12:03:00.000Z");

    await expect(autosave.stage(replacement)).rejects.toMatchObject({
      code: "AUTOSAVE_CONFLICT",
      journalId: first.journalId,
    });
    expect((await autosave.inspect(first.projectId)).recoveryCandidate?.project.name)
      .toBe("Contract project");

    await autosave.discard(first.projectId, first.journalId);
    expect((await autosave.inspect(first.projectId)).recoveryCandidate).toBeUndefined();
  });

  it("rejects tampered journal bytes without presenting them as recoverable project data", async () => {
    const storage = new MemoryAutosaveStorage();
    const autosave = new ProjectAutosaveJournal(storage, {
      now: () => "2026-07-14T12:00:00.000Z",
    });
    const journal = await autosave.stage(studioProjectV1Fixture);
    storage.journals.set(journal.projectId, {
      ...journal,
      projectJson: journal.projectJson.replace("Contract project", "Tampered project"),
    });

    await expect(autosave.inspect(journal.projectId)).rejects.toMatchObject({
      code: "AUTOSAVE_INTEGRITY_MISMATCH",
      operation: "inspect",
      projectId: journal.projectId,
      journalId: journal.journalId,
    });

    const nonCanonical = JSON.stringify(JSON.parse(journal.projectJson), null, 2);
    const identity = await identityFor(nonCanonical);
    storage.journals.set(journal.projectId, {
      ...journal,
      projectJson: nonCanonical,
      ...identity,
    });
    await expect(autosave.inspect(journal.projectId)).rejects.toMatchObject({
      code: "AUTOSAVE_INTEGRITY_MISMATCH",
      operation: "inspect",
      journalId: journal.journalId,
    });
  });

  it("rejects a stale journal that does not descend from the confirmed checkpoint", async () => {
    const storage = new MemoryAutosaveStorage();
    const autosave = new ProjectAutosaveJournal(storage, {
      now: () => "2026-07-14T12:00:00.000Z",
    });
    await autosave.checkpoint(studioProjectV1Fixture);
    const journal = await autosave.stage(
      updatedProject("Stale", "2026-07-14T12:04:00.000Z"),
    );
    storage.journals.set(journal.projectId, { ...journal, baseCheckpointId: "other" });

    await expect(autosave.inspect(journal.projectId)).rejects.toMatchObject({
      code: "AUTOSAVE_CONFLICT",
      operation: "inspect",
    });
  });

  it("settles promptly when a non-cooperative identity provider is aborted", async () => {
    const storage = new MemoryAutosaveStorage();
    let calls = 0;
    const autosave = new ProjectAutosaveJournal(storage, {
      identityProvider: () => {
        calls += 1;
        return new Promise(() => undefined);
      },
    });
    const controller = new AbortController();
    const pending = autosave.stage(studioProjectV1Fixture, { signal: controller.signal });
    for (let turn = 0; turn < 10 && calls === 0; turn += 1) await Promise.resolve();
    expect(calls).toBe(1);
    controller.abort("cancel stuck hash");
    await expect(pending).rejects.toMatchObject({
      code: "AUTOSAVE_ABORTED",
      operation: "stage",
    });

    const openController = new AbortController();
    const inertRequest = {} as IDBOpenDBRequest;
    const stuckStorage = new IndexedDbAutosaveStorage({
      factory: { open: () => inertRequest } as unknown as IDBFactory,
    });
    const stuckOpen = stuckStorage.readState(studioProjectV1Fixture.id, {
      signal: openController.signal,
    });
    await Promise.resolve();
    openController.abort("cancel stuck open");
    await expect(stuckOpen).rejects.toMatchObject({
      code: "AUTOSAVE_ABORTED",
      operation: "inspect",
    });
  });

  it("contains hostile option and storage accessors without executing them", async () => {
    const storage = new MemoryAutosaveStorage();
    const autosave = new ProjectAutosaveJournal(storage);
    let optionReads = 0;
    const options = {} as AutosaveOperationOptions;
    Object.defineProperty(options, "signal", {
      enumerable: true,
      get() {
        optionReads += 1;
        return undefined;
      },
    });

    await expect(autosave.inspect(studioProjectV1Fixture.id, options)).rejects.toMatchObject({
      code: "AUTOSAVE_INVALID_INPUT",
      operation: "inspect",
    });
    expect(optionReads).toBe(0);

    let storageReads = 0;
    const hostileStorage = {
      get readState() {
        storageReads += 1;
        return storage.readState.bind(storage);
      },
      stageJournal: storage.stageJournal.bind(storage),
      commitJournal: storage.commitJournal.bind(storage),
      discardJournal: storage.discardJournal.bind(storage),
    };
    expect(() => new ProjectAutosaveJournal(hostileStorage)).toThrow(AutosaveJournalError);
    expect(storageReads).toBe(0);

    let identityThenReads = 0;
    const hostileIdentityResult = {};
    // oxlint-disable-next-line unicorn/no-thenable -- hostile accessor fixture must never be assimilated
    Object.defineProperty(hostileIdentityResult, "then", {
      enumerable: true,
      get() {
        identityThenReads += 1;
        return undefined;
      },
    });
    const hostileIdentity = new ProjectAutosaveJournal(new MemoryAutosaveStorage(), {
      identityProvider: () => hostileIdentityResult as PromiseLike<AutosaveContentIdentity>,
    });
    await expect(hostileIdentity.stage(studioProjectV1Fixture)).rejects.toMatchObject({
      code: "AUTOSAVE_INTEGRITY_MISMATCH",
    });
    expect(identityThenReads).toBe(0);

    let portThenReads = 0;
    const hostilePortResult = {};
    // oxlint-disable-next-line unicorn/no-thenable -- hostile accessor fixture must never be assimilated
    Object.defineProperty(hostilePortResult, "then", {
      enumerable: true,
      get() {
        portThenReads += 1;
        return undefined;
      },
    });
    const hostilePort: AutosaveJournalStorage = {
      readState: () => hostilePortResult as Promise<AutosaveStorageSnapshot>,
      stageJournal: async () => undefined,
      commitJournal: async () => { throw new Error("not used"); },
      discardJournal: async () => undefined,
    };
    await expect(new ProjectAutosaveJournal(hostilePort).inspect(studioProjectV1Fixture.id))
      .rejects.toMatchObject({ code: "AUTOSAVE_INVALID_INPUT" });
    expect(portThenReads).toBe(0);
  });

  it("types unavailable IndexedDB and direct hostile adapter options", async () => {
    const storage = new IndexedDbAutosaveStorage({ factory: null });
    await expect(storage.readState(studioProjectV1Fixture.id)).rejects.toMatchObject({
      code: "AUTOSAVE_STORAGE_UNAVAILABLE",
      operation: "open",
    });

    let reads = 0;
    const options = {} as AutosaveOperationOptions;
    Object.defineProperty(options, "signal", {
      enumerable: true,
      get() {
        reads += 1;
        return undefined;
      },
    });
    await expect(storage.readState(studioProjectV1Fixture.id, options)).rejects.toMatchObject({
      code: "AUTOSAVE_INVALID_INPUT",
      operation: "inspect",
    });
    expect(reads).toBe(0);

    let constructorReads = 0;
    const hostileConstructorOptions: Record<string, unknown> = {};
    Object.defineProperty(hostileConstructorOptions, "databaseName", {
      enumerable: true,
      get() {
        constructorReads += 1;
        return "hostile";
      },
    });
    expect(() => new IndexedDbAutosaveStorage(hostileConstructorOptions as never))
      .toThrow(AutosaveJournalError);
    expect(constructorReads).toBe(0);
  });
});
