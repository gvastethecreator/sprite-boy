import type {
  EntityId,
  ProjectCommandDiagnostic,
  ProjectCommandInverse,
  ProjectWorkspaceState,
  StudioProjectV1,
} from "../project";
import { validateStudioProject } from "../project";
import type {
  DeepReadonly,
  ProjectStore,
  ProjectStoreState,
  StoreListener,
} from "./contracts";
import {
  createProjectStoreRuntime,
  type CreateProjectStoreOptions,
  type ProjectStoreInternalCommitEvent,
  type ProjectStoreRuntime,
} from "./projectStore";

export interface ProjectHistoryEntrySummary {
  readonly mode: "record" | "coalesce";
  readonly commandIds: readonly EntityId[];
  readonly transactionId?: EntityId;
  readonly fromRevision: number;
  readonly toRevision: number;
}

export interface ProjectHistoryState {
  readonly undoEntries: readonly ProjectHistoryEntrySummary[];
  readonly redoEntries: readonly ProjectHistoryEntrySummary[];
}

export interface ProjectHistorySubscriberDiagnostic {
  readonly code: "PROJECT_HISTORY_SUBSCRIBER_FAILED";
  readonly message: string;
}

export type ProjectHistoryOperationResult =
  | { readonly ok: true; readonly revision: number }
  | {
      readonly ok: false;
      readonly revision: number;
      readonly reason: "empty" | "apply-failed" | "reentrant";
      readonly diagnostics?: readonly DeepReadonly<ProjectCommandDiagnostic>[];
    };

export interface ProjectHistoryController {
  getSnapshot(): DeepReadonly<ProjectHistoryState>;
  subscribe(listener: StoreListener): () => void;
  undo(): ProjectHistoryOperationResult;
  redo(): ProjectHistoryOperationResult;
  clear(): void;
}

export interface ProjectStoreWithHistory {
  readonly store: ProjectStore;
  readonly history: ProjectHistoryController;
}

export interface CreateProjectStoreWithHistoryOptions extends CreateProjectStoreOptions {
  readonly maxHistoryEntries?: number;
  readonly onHistorySubscriberError?: (
    diagnostic: ProjectHistorySubscriberDiagnostic,
  ) => void;
}

interface InternalHistoryEntry extends ProjectHistoryEntrySummary {
  readonly inverse: ProjectCommandInverse;
  readonly coalesceEpoch: number;
}

const HISTORY_SUBSCRIBER_FAILED: ProjectHistorySubscriberDiagnostic = Object.freeze({
  code: "PROJECT_HISTORY_SUBSCRIBER_FAILED",
  message: "A ProjectHistory subscriber failed while observing a committed stack.",
});

const DEFAULT_MAX_HISTORY_ENTRIES = 100;
const MAX_HISTORY_ENTRIES = 1_000;

const WORKSPACE_SELECTION_COLLECTIONS = Object.freeze({
  selectedAssetId: "assets",
  selectedRegionId: "regions",
  selectedCompositionId: "compositions",
  selectedLayerId: "layers",
  selectedVariantSetId: "variantSets",
  selectedSequenceId: "sequences",
} as const);

function hasOwn(record: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Preserve ignored workspace intent only where it remains valid in a historical snapshot. */
function rebaseIgnoredWorkspace(
  target: StudioProjectV1,
  currentWorkspace: DeepReadonly<ProjectWorkspaceState>,
  updatedAt: StudioProjectV1["updatedAt"],
): StudioProjectV1 | undefined {
  const workspace: ProjectWorkspaceState = {};
  if (currentWorkspace.activeWorkspace !== undefined) {
    workspace.activeWorkspace = currentWorkspace.activeWorkspace;
  }
  for (const [selection, collection] of Object.entries(
    WORKSPACE_SELECTION_COLLECTIONS,
  ) as Array<
    [keyof typeof WORKSPACE_SELECTION_COLLECTIONS, (typeof WORKSPACE_SELECTION_COLLECTIONS)[keyof typeof WORKSPACE_SELECTION_COLLECTIONS]]
  >) {
    const selectedId = currentWorkspace[selection];
    if (selectedId !== undefined && hasOwn(target[collection], selectedId)) {
      workspace[selection] = selectedId;
    }
  }
  if (currentWorkspace.selectedCelIds !== undefined) {
    workspace.selectedCelIds = currentWorkspace.selectedCelIds.filter((id) =>
      hasOwn(target.cels, id),
    );
  }

  const rebased: StudioProjectV1 = {
    ...target,
    updatedAt,
    workspace,
  };
  return validateStudioProject(rebased).valid ? rebased : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeHistoryObserver(
  options: CreateProjectStoreWithHistoryOptions,
): ((diagnostic: ProjectHistorySubscriberDiagnostic) => void) | undefined {
  try {
    if (!isPlainRecord(options)) throw new TypeError();
    const descriptor = Object.getOwnPropertyDescriptor(options, "onHistorySubscriberError");
    if (!descriptor) return undefined;
    if ("value" in descriptor && descriptor.enumerable && descriptor.value === undefined) {
      return undefined;
    }
    if (!("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value !== "function") {
      throw new TypeError();
    }
    const handler = descriptor.value;
    return (diagnostic) => Reflect.apply(handler, undefined, [diagnostic]);
  } catch {
    throw new TypeError("ProjectHistory options require a data-only subscriber reporter.");
  }
}

function normalizeHistoryEntryLimit(options: CreateProjectStoreWithHistoryOptions): number {
  try {
    if (!isPlainRecord(options)) throw new TypeError();
    const descriptor = Object.getOwnPropertyDescriptor(options, "maxHistoryEntries");
    if (!descriptor) return DEFAULT_MAX_HISTORY_ENTRIES;
    if ("value" in descriptor && descriptor.enumerable && descriptor.value === undefined) {
      return DEFAULT_MAX_HISTORY_ENTRIES;
    }
    if (!(
      "value" in descriptor &&
      descriptor.enumerable &&
      Number.isSafeInteger(descriptor.value) &&
      descriptor.value >= 1 &&
      descriptor.value <= MAX_HISTORY_ENTRIES
    )) {
      throw new TypeError();
    }
    return descriptor.value;
  } catch {
    throw new TypeError(
      `ProjectHistory maxHistoryEntries must be an enumerable data integer from 1 to ${MAX_HISTORY_ENTRIES}.`,
    );
  }
}

function createHistoryState(
  undoEntries: readonly InternalHistoryEntry[],
  redoEntries: readonly InternalHistoryEntry[],
): DeepReadonly<ProjectHistoryState> {
  const summarize = (entry: InternalHistoryEntry): ProjectHistoryEntrySummary => Object.freeze({
    mode: entry.mode,
    commandIds: Object.freeze([...entry.commandIds]),
    ...(entry.transactionId ? { transactionId: entry.transactionId } : {}),
    fromRevision: entry.fromRevision,
    toRevision: entry.toRevision,
  });
  return Object.freeze({
    undoEntries: Object.freeze(undoEntries.map(summarize)),
    redoEntries: Object.freeze(redoEntries.map(summarize)),
  });
}

function operationFailure(
  state: ProjectStoreState,
  reason: "empty" | "apply-failed" | "reentrant",
  diagnostics?: readonly DeepReadonly<ProjectCommandDiagnostic>[],
): ProjectHistoryOperationResult {
  return Object.freeze({
    ok: false,
    revision: state.revision,
    reason,
    ...(diagnostics ? { diagnostics } : {}),
  });
}

/** Create a canonical ProjectStore and its non-serializing history controller. */
export function createProjectStoreWithHistory(
  initialProject: StudioProjectV1,
  options: CreateProjectStoreWithHistoryOptions,
): ProjectStoreWithHistory {
  const onHistorySubscriberError = normalizeHistoryObserver(options);
  const maxHistoryEntries = normalizeHistoryEntryLimit(options);
  const historyListeners = new Set<StoreListener>();
  let undoEntries: readonly InternalHistoryEntry[] = Object.freeze([]);
  let redoEntries: readonly InternalHistoryEntry[] = Object.freeze([]);
  let historyState = createHistoryState(undoEntries, redoEntries);
  let historyNotificationDepth = 0;
  let coalesceEpoch = 0;

  const notifyHistory = (): void => {
    historyNotificationDepth += 1;
    try {
      for (const listener of Array.from(historyListeners)) {
        if (!historyListeners.has(listener)) continue;
        try {
          listener();
        } catch {
          try {
            onHistorySubscriberError?.(HISTORY_SUBSCRIBER_FAILED);
          } catch {
            // History observers cannot change a committed store/history transition.
          }
        }
      }
    } finally {
      historyNotificationDepth -= 1;
    }
  };

  const stageHistory = (
    nextUndo: readonly InternalHistoryEntry[],
    nextRedo: readonly InternalHistoryEntry[],
  ): (() => void) => {
    undoEntries = Object.freeze([...nextUndo]);
    redoEntries = Object.freeze([...nextRedo]);
    const nextState = createHistoryState(undoEntries, redoEntries);
    return () => {
      historyState = nextState;
      notifyHistory();
    };
  };

  const recordCommand = (event: ProjectStoreInternalCommitEvent): void | (() => void) => {
    const envelope = event.envelope;
    if (!envelope) return undefined;
    const metadata = envelope.metadata;
    if (metadata.history === "ignore") {
      coalesceEpoch += 1;
      if (envelope.command.type !== "workspace.update") {
        return undoEntries.length > 0 || redoEntries.length > 0
          ? stageHistory([], [])
          : undefined;
      }

      const workspace = event.after.project.workspace;
      const updatedAt = event.after.project.updatedAt;
      const rebasedUndo: InternalHistoryEntry[] = [];
      for (const entry of undoEntries) {
        if (entry.inverse.type !== "project.restoreSnapshot") {
          return stageHistory([], []);
        }
        const project = rebaseIgnoredWorkspace(entry.inverse.project, workspace, updatedAt);
        if (!project) return stageHistory([], []);
        rebasedUndo.push(Object.freeze({
          ...entry,
          inverse: Object.freeze({
            ...entry.inverse,
            project,
          }),
        }));
      }
      if (redoEntries.length > 0) return stageHistory(rebasedUndo, []);
      undoEntries = Object.freeze(rebasedUndo);
      return undefined;
    }

    const top = undoEntries.at(-1);
    let nextUndo: readonly InternalHistoryEntry[];
    if (
      metadata.history === "coalesce" &&
      top?.mode === "coalesce" &&
      top.transactionId === metadata.transactionId &&
      top.coalesceEpoch === coalesceEpoch
    ) {
      const coalesced: InternalHistoryEntry = Object.freeze({
        ...top,
        commandIds: Object.freeze([...top.commandIds, metadata.commandId]),
        toRevision: event.after.revision,
      });
      nextUndo = Object.freeze([...undoEntries.slice(0, -1), coalesced]);
    } else {
      const entry: InternalHistoryEntry = Object.freeze({
        mode: metadata.history,
        commandIds: Object.freeze([metadata.commandId]),
        ...(metadata.transactionId ? { transactionId: metadata.transactionId } : {}),
        fromRevision: event.before.revision,
        toRevision: event.after.revision,
        inverse: event.result.inverse,
        coalesceEpoch,
      });
      nextUndo = Object.freeze([...undoEntries, entry].slice(-maxHistoryEntries));
    }
    return stageHistory(nextUndo, []);
  };

  const runtime: ProjectStoreRuntime = createProjectStoreRuntime(
    initialProject,
    options,
    recordCommand,
  );

  const getSnapshot = (): DeepReadonly<ProjectHistoryState> => historyState;
  const subscribe = (listener: StoreListener): (() => void) => {
    if (typeof listener !== "function") {
      throw new TypeError("ProjectHistory subscriber must be a function.");
    }
    historyListeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      historyListeners.delete(listener);
    };
  };

  const runHistoryOperation = (direction: "undo" | "redo"): ProjectHistoryOperationResult => {
    if (historyNotificationDepth > 0) {
      return operationFailure(runtime.store.getSnapshot(), "reentrant");
    }
    const source = direction === "undo" ? undoEntries : redoEntries;
    const entry = source.at(-1);
    if (!entry) return operationFailure(runtime.store.getSnapshot(), "empty");

    const beforeRevision = runtime.store.getSnapshot().revision;
    const result = runtime.applyInverse(entry.inverse, (event) => {
      // A successful traversal closes the transaction branch. A future command
      // must never coalesce into an entry recovered through undo or redo.
      coalesceEpoch += 1;
      const reversed: InternalHistoryEntry = Object.freeze({
        ...entry,
        inverse: event.result.inverse,
      });
      return direction === "undo"
        ? stageHistory(undoEntries.slice(0, -1), [...redoEntries, reversed])
        : stageHistory([...undoEntries, reversed], redoEntries.slice(0, -1));
    });

    if (!result.result.ok) {
      const reason = result.result.diagnostics.some(
        (diagnostic) => diagnostic.path === "$.dispatch",
      )
        ? "reentrant"
        : "apply-failed";
      return operationFailure(
        runtime.store.getSnapshot(),
        reason,
        result.result.diagnostics,
      );
    }
    if (result.revision === beforeRevision) {
      return operationFailure(runtime.store.getSnapshot(), "apply-failed");
    }
    return Object.freeze({ ok: true, revision: result.revision });
  };

  const history: ProjectHistoryController = Object.freeze({
    getSnapshot,
    subscribe,
    undo: () => runHistoryOperation("undo"),
    redo: () => runHistoryOperation("redo"),
    clear: () => {
      if (historyNotificationDepth > 0) {
        throw new TypeError("ProjectHistory does not allow reentrant clear.");
      }
      if (undoEntries.length === 0 && redoEntries.length === 0) return;
      stageHistory([], [])();
    },
  });

  return Object.freeze({ store: runtime.store, history });
}
