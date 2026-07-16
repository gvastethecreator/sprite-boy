import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  IndexedDbAssetRepository,
  isAssetRepositoryError,
  reconcileProjectAssetRepository,
  type AssetRepository,
} from "../core/assets";
import {
  createEmptyStudioProject,
  type EntityId,
  type StudioProjectV1,
  type WorkspaceId,
} from "../core/project";
import {
  IndexedDbAutosaveStorage,
  ProjectAutosaveJournal,
} from "../core/persistence";
import {
  createProjectStoreWithHistory,
  type ProjectHistoryController,
  type ProjectStore,
  type ProjectStoreDispatchResult,
} from "../core/stores";

const ACTIVE_PROJECT_KEY = "sprite-boy-studio:active-project:v1";
const DEFAULT_ASSET_REPOSITORY_FACTORY = (projectId: EntityId): AssetRepository => (
  new IndexedDbAssetRepository(projectId)
);

export type CanonicalProjectPersistenceState =
  | "loading"
  | "saved"
  | "saving"
  | "error";

interface CanonicalProjectBundle {
  readonly store: ProjectStore;
  readonly history: ProjectHistoryController;
  readonly assets: AssetRepository;
}

export interface CanonicalProjectContextValue extends CanonicalProjectBundle {
  readonly persistenceState: CanonicalProjectPersistenceState;
  readonly persistenceMessage: string | null;
  readonly createProject: (name?: string) => Promise<void>;
  readonly renameProject: (name: string) => ProjectStoreDispatchResult;
  readonly setActiveWorkspace: (workspaceId: WorkspaceId) => ProjectStoreDispatchResult;
  readonly saveProject: () => Promise<void>;
  readonly reportAssetCleanupDebt: (
    projectId: EntityId,
    assetId: EntityId,
    pending: boolean,
  ) => void;
}

export interface CanonicalProjectProviderProps {
  readonly children: ReactNode;
  /** Deterministic test/host injection. Injected documents skip startup recovery. */
  readonly initialProject?: StudioProjectV1;
  readonly assetRepositoryFactory?: (projectId: EntityId) => AssetRepository;
  readonly autosave?: ProjectAutosaveJournal | null;
}

const CanonicalProjectContext = createContext<CanonicalProjectContextValue | null>(null);

let fallbackIdentity = 0;

function nextIdentity(prefix: string): EntityId {
  try {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID === "function") return `${prefix}-${randomUUID.call(globalThis.crypto)}`;
  } catch {
    // The monotonic fallback remains unique for this document lifetime.
  }
  fallbackIdentity += 1;
  return `${prefix}-${Date.now().toString(36)}-${fallbackIdentity.toString(36)}`;
}

function now(): string {
  return new Date().toISOString();
}

function readActiveProjectId(): EntityId | null {
  try {
    const value = globalThis.localStorage?.getItem(ACTIVE_PROJECT_KEY);
    return typeof value === "string" && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeActiveProjectId(projectId: EntityId): void {
  try {
    globalThis.localStorage?.setItem(ACTIVE_PROJECT_KEY, projectId);
  } catch {
    // IndexedDB remains authoritative; the pointer is only startup routing.
  }
}

function createUntitledProject(projectId = nextIdentity("project"), name = "Untitled project") {
  const timestamp = now();
  return createEmptyStudioProject({
    id: projectId,
    name,
    now: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function createBundle(
  project: StudioProjectV1,
  assetRepositoryFactory: (projectId: EntityId) => AssetRepository,
): CanonicalProjectBundle {
  const runtime = createProjectStoreWithHistory(project, {
    context: {
      nextId: () => nextIdentity("entity"),
      now,
    },
  });
  return Object.freeze({
    store: runtime.store,
    history: runtime.history,
    assets: assetRepositoryFactory(project.id),
  });
}

function safeDisposeAssets(repository: AssetRepository): void {
  try {
    repository.dispose();
  } catch {
    // Repository disposal is terminal and must not break a project switch.
  }
}

export function CanonicalProjectProvider({
  children,
  initialProject,
  assetRepositoryFactory = DEFAULT_ASSET_REPOSITORY_FACTORY,
  autosave: injectedAutosave,
}: CanonicalProjectProviderProps) {
  const ownsAutosave = injectedAutosave === undefined;
  const autosaveStorageRef = useRef<IndexedDbAutosaveStorage | null>(null);
  const autosaveRef = useRef<ProjectAutosaveJournal | null>(null);
  if (autosaveRef.current === null && injectedAutosave !== null) {
    if (injectedAutosave) {
      autosaveRef.current = injectedAutosave;
    } else {
      const storage = new IndexedDbAutosaveStorage();
      autosaveStorageRef.current = storage;
      autosaveRef.current = new ProjectAutosaveJournal(storage);
    }
  }

  const initialBundleRef = useRef<CanonicalProjectBundle | null>(null);
  if (initialBundleRef.current === null) {
    const startupId = initialProject?.id ?? readActiveProjectId() ?? nextIdentity("project");
    initialBundleRef.current = createBundle(
      initialProject ?? createUntitledProject(startupId),
      assetRepositoryFactory,
    );
  }

  const [bundle, setBundle] = useState(initialBundleRef.current);
  const [persistenceState, setPersistenceState] = useState<CanonicalProjectPersistenceState>(
    initialProject || injectedAutosave === null ? "saved" : "loading",
  );
  const [persistenceMessage, setPersistenceMessage] = useState<string | null>(null);
  const bundleRef = useRef(bundle);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const checkpointSequenceRef = useRef(0);
  const createProjectPromiseRef = useRef<Promise<void> | null>(null);
  const assetCleanupPendingRef = useRef(false);
  const assetCleanupIdsRef = useRef(new Set<EntityId>());
  const assetCleanupScanFailedRef = useRef(false);
  const generationRef = useRef(0);
  const lifecycleGenerationRef = useRef(0);
  bundleRef.current = bundle;

  const replaceBundle = useCallback((project: StudioProjectV1): void => {
    const previous = bundleRef.current;
    const replacement = createBundle(project, assetRepositoryFactory);
    generationRef.current += 1;
    bundleRef.current = replacement;
    setBundle(replacement);
    writeActiveProjectId(project.id);
    safeDisposeAssets(previous.assets);
  }, [assetRepositoryFactory]);

  useEffect(() => {
    if (initialProject || injectedAutosave === null) return;
    const autosave = autosaveRef.current;
    if (!autosave) return;
    const startup = bundleRef.current.store.getSnapshot().project as StudioProjectV1;
    let active = true;
    void (async () => {
      try {
        const inspection = await autosave.inspect(startup.id);
        if (!active) return;
        if (inspection.recoveryCandidate) {
          const recovered = await autosave.commit(
            startup.id,
            inspection.recoveryCandidate.record.journalId,
          );
          if (!active) return;
          replaceBundle(recovered.project);
        } else if (inspection.confirmed) {
          replaceBundle(inspection.confirmed.project);
        } else {
          await autosave.checkpoint(startup);
          if (!active) return;
          writeActiveProjectId(startup.id);
        }
        const activeBundle = bundleRef.current;
        const reconciliation = await reconcileProjectAssetRepository(
          activeBundle.assets,
          activeBundle.store.getSnapshot().project as StudioProjectV1,
        );
        if (!active) return;
        if (!reconciliation.complete) {
          assetCleanupIdsRef.current = new Set(reconciliation.pendingAssetIds);
          assetCleanupScanFailedRef.current = reconciliation.listFailed;
          assetCleanupPendingRef.current = true;
          setPersistenceState("error");
          setPersistenceMessage("Temporary asset cleanup is pending. Retry after storage access recovers.");
          return;
        }
        assetCleanupIdsRef.current.clear();
        assetCleanupScanFailedRef.current = false;
        assetCleanupPendingRef.current = false;
        setPersistenceState("saved");
        setPersistenceMessage(null);
      } catch {
        if (!active) return;
        setPersistenceState("error");
        setPersistenceMessage("Durable project storage is unavailable. Changes remain in this session.");
      }
    })();
    return () => {
      active = false;
    };
  }, [initialProject, injectedAutosave, replaceBundle]);

  const queueCheckpoint = useCallback((project: StudioProjectV1): Promise<void> => {
    const autosave = autosaveRef.current;
    if (!autosave) return Promise.resolve();
    const generation = generationRef.current;
    const checkpointSequence = ++checkpointSequenceRef.current;
    setPersistenceState("saving");
    const queued = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await autosave.checkpoint(project);
        if (generation !== generationRef.current) return;
        const current = bundleRef.current;
        if (assetCleanupScanFailedRef.current) {
          const history = current.history.getSnapshot();
          if (history.undoEntries.length === 0 && history.redoEntries.length === 0) {
            const reconciliation = await reconcileProjectAssetRepository(
              current.assets,
              current.store.getSnapshot().project as StudioProjectV1,
            );
            if (generation !== generationRef.current) return;
            if (!reconciliation.listFailed) {
              assetCleanupIdsRef.current = new Set(reconciliation.pendingAssetIds);
              assetCleanupScanFailedRef.current = false;
            }
          }
        }
        const resolvedCleanupIds: EntityId[] = [];
        for (const assetId of assetCleanupIdsRef.current) {
          try {
            await current.assets.remove(assetId, "release-and-remove");
            resolvedCleanupIds.push(assetId);
          } catch (error) {
            if (isAssetRepositoryError(error) && error.code === "ASSET_NOT_FOUND") {
              resolvedCleanupIds.push(assetId);
            }
            // Other failures keep the exact debt id for the next retry.
          }
        }
        if (generation !== generationRef.current) return;
        for (const assetId of resolvedCleanupIds) assetCleanupIdsRef.current.delete(assetId);
        assetCleanupPendingRef.current = assetCleanupScanFailedRef.current
          || assetCleanupIdsRef.current.size > 0;
        if (checkpointSequence !== checkpointSequenceRef.current) return;
        if (assetCleanupPendingRef.current) {
          setPersistenceState("error");
          setPersistenceMessage("Temporary asset cleanup is pending. Retry after storage access recovers.");
        } else {
          setPersistenceState("saved");
          setPersistenceMessage(null);
        }
      })
      .catch(() => {
        if (
          generation !== generationRef.current
          || checkpointSequence !== checkpointSequenceRef.current
        ) return;
        setPersistenceState("error");
        setPersistenceMessage(assetCleanupPendingRef.current
          ? "Temporary asset cleanup is pending. Retry after storage access recovers."
          : "Project changes could not be saved. Retry from the Project menu.");
      });
    saveQueueRef.current = queued;
    return queued;
  }, []);

  useEffect(() => {
    if (persistenceState === "loading") return;
    return bundle.store.subscribe(() => {
      const project = bundle.store.getSnapshot().project as StudioProjectV1;
      void queueCheckpoint(project);
    });
  }, [bundle.store, persistenceState, queueCheckpoint]);

  useEffect(() => {
    const lifecycleGeneration = ++lifecycleGenerationRef.current;
    return () => {
      // React Strict Mode replays effect cleanup/setup while the provider is
      // still mounted. Deferring terminal disposal lets the replayed setup
      // invalidate this cleanup while preserving real-unmount disposal.
      queueMicrotask(() => {
        if (lifecycleGenerationRef.current !== lifecycleGeneration) return;
        safeDisposeAssets(bundleRef.current.assets);
        if (ownsAutosave) autosaveStorageRef.current?.close();
      });
    };
  }, [ownsAutosave]);

  const createProject = useCallback((name = "Untitled project"): Promise<void> => {
    if (createProjectPromiseRef.current) return createProjectPromiseRef.current;
    const operation = Promise.resolve().then(async () => {
      const project = createUntitledProject(nextIdentity("project"), name);
      const autosave = autosaveRef.current;
      // A project transition supersedes completion UI from every queued
      // snapshot of the previous project, even before the new checkpoint lands.
      generationRef.current += 1;
      setPersistenceState("loading");
      let cleanupBlocked = false;
      try {
        await saveQueueRef.current.catch(() => undefined);
        const current = bundleRef.current;
        const reconciliation = await reconcileProjectAssetRepository(
          current.assets,
          current.store.getSnapshot().project as StudioProjectV1,
        );
        if (!reconciliation.complete) {
          cleanupBlocked = true;
          assetCleanupIdsRef.current = new Set(reconciliation.pendingAssetIds);
          assetCleanupScanFailedRef.current = reconciliation.listFailed;
          assetCleanupPendingRef.current = true;
          throw new Error("Asset cleanup pending");
        }
        assetCleanupIdsRef.current.clear();
        assetCleanupScanFailedRef.current = false;
        assetCleanupPendingRef.current = false;
        if (autosave) await autosave.checkpoint(project);
        replaceBundle(project);
        assetCleanupIdsRef.current.clear();
        assetCleanupScanFailedRef.current = false;
        assetCleanupPendingRef.current = false;
        setPersistenceState("saved");
        setPersistenceMessage(null);
      } catch (error) {
        setPersistenceState("error");
        setPersistenceMessage(cleanupBlocked
          ? "Temporary asset cleanup must finish before creating a new project."
          : "A new project could not be created in durable storage.");
        throw error;
      }
    }).finally(() => {
      if (createProjectPromiseRef.current === operation) createProjectPromiseRef.current = null;
    });
    createProjectPromiseRef.current = operation;
    return operation;
  }, [replaceBundle]);

  const renameProject = useCallback((name: string): ProjectStoreDispatchResult => (
    bundleRef.current.store.dispatch({
      command: { type: "project.rename", name, updatedAt: now() },
      metadata: {
        commandId: nextIdentity("project-rename"),
        origin: "user",
        history: "record",
        issuedAt: now(),
      },
    })
  ), []);

  const setActiveWorkspace = useCallback((workspaceId: WorkspaceId): ProjectStoreDispatchResult => (
    bundleRef.current.store.dispatch({
      command: { type: "workspace.update", patch: { activeWorkspace: workspaceId } },
      metadata: {
        commandId: nextIdentity("workspace"),
        origin: "user",
        history: "ignore",
        issuedAt: now(),
      },
    })
  ), []);

  const saveProject = useCallback(async (): Promise<void> => {
    await queueCheckpoint(
      bundleRef.current.store.getSnapshot().project as StudioProjectV1,
    );
  }, [queueCheckpoint]);

  const reportAssetCleanupDebt = useCallback((
    projectId: EntityId,
    assetId: EntityId,
    pending: boolean,
  ): void => {
    // Async cleanup can finish after Compose unmounts and New replaces the
    // canonical bundle. Never attribute old-project debt to the active repo.
    if (bundleRef.current.assets.projectId !== projectId) return;
    if (pending) assetCleanupIdsRef.current.add(assetId);
    else assetCleanupIdsRef.current.delete(assetId);
    const hasPending = assetCleanupScanFailedRef.current || assetCleanupIdsRef.current.size > 0;
    assetCleanupPendingRef.current = hasPending;
    if (hasPending) {
      setPersistenceState("error");
      setPersistenceMessage("Temporary asset cleanup is pending. Retry after storage access recovers.");
      return;
    }
    const project = bundleRef.current.store.getSnapshot().project as StudioProjectV1;
    if (autosaveRef.current) void queueCheckpoint(project);
    else {
      setPersistenceState("saved");
      setPersistenceMessage(null);
    }
  }, [queueCheckpoint]);

  const value = useMemo<CanonicalProjectContextValue>(() => Object.freeze({
    ...bundle,
    persistenceState,
    persistenceMessage,
    createProject,
    renameProject,
    setActiveWorkspace,
    saveProject,
    reportAssetCleanupDebt,
  }), [
    bundle,
    createProject,
    persistenceMessage,
    persistenceState,
    renameProject,
    reportAssetCleanupDebt,
    saveProject,
    setActiveWorkspace,
  ]);

  return (
    <CanonicalProjectContext.Provider value={value}>
      {children}
    </CanonicalProjectContext.Provider>
  );
}

export function useCanonicalProject(): CanonicalProjectContextValue {
  const value = useContext(CanonicalProjectContext);
  if (!value) throw new Error("Canonical project runtime requires CanonicalProjectProvider.");
  return value;
}
