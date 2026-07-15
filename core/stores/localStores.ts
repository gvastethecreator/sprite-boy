import { WORKSPACE_IDS, isEntityId, type WorkspaceId } from "../project";
import {
  STUDIO_STORE_CONTRACTS,
  type DeepReadonly,
  type InteractionAction,
  type InteractionContextMenu,
  type InteractionDragSession,
  type InteractionGuide,
  type InteractionState,
  type InteractionStore,
  type InteractionTarget,
  type JobStore,
  type JobStoreAction,
  type JobStoreEntry,
  type JobStoreState,
  type PlaybackAction,
  type PlaybackState,
  type PlaybackStore,
  type StoreListener,
  type StudioStoreActionMap,
  type StudioStoreStateMap,
  type WorkspaceAction,
  type WorkspacePreferenceValue,
  type WorkspaceState,
  type WorkspaceStore,
  type WorkspaceViewport,
} from "./contracts";

type LocalStoreKind = "workspace" | "interaction" | "job" | "playback";
type LocalStore = WorkspaceStore | InteractionStore | JobStore | PlaybackStore;

export interface LocalStoreSubscriberDiagnostic {
  readonly code: "LOCAL_STORE_SUBSCRIBER_FAILED";
  readonly storeKind: LocalStoreKind;
  readonly message: string;
}

export interface CreateLocalStoreOptions {
  readonly onSubscriberError?: (diagnostic: LocalStoreSubscriberDiagnostic) => void;
}

type LocalReducer<TKind extends LocalStoreKind> = (
  state: DeepReadonly<StudioStoreStateMap[TKind]>,
  action: DeepReadonly<StudioStoreActionMap[TKind]>,
) => DeepReadonly<StudioStoreStateMap[TKind]>;

const DELETE_RECORD_VALUE = Symbol("delete-record-value");
const LOCAL_INPUT_ERRORS = new WeakSet<object>();

function throwLocalInputError(message: string): never {
  const error = new TypeError(message);
  LOCAL_INPUT_ERRORS.add(error);
  throw error;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneRuntimeData(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throwLocalInputError("Local store actions require finite canonical numbers.");
    }
    return value;
  }
  if (typeof value !== "object") {
    throwLocalInputError("Local store actions must contain data-only values.");
  }
  if (seen.has(value)) throwLocalInputError("Local store actions cannot contain cycles.");
  seen.add(value);

  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.some((key) =>
        key !== "length" &&
        (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))
    ) {
      throwLocalInputError("Local store arrays cannot contain custom properties.");
    }
    const cloned: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throwLocalInputError("Local store arrays must be dense data arrays.");
      }
      cloned.push(cloneRuntimeData(descriptor.value, seen));
    }
    seen.delete(value);
    return Object.freeze(cloned);
  }

  if (!isPlainRecord(value)) {
    throwLocalInputError("Local store actions must use plain data objects.");
  }
  const cloned = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throwLocalInputError("Local store actions cannot contain symbol fields.");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throwLocalInputError("Local store actions require enumerable data properties.");
    }
    Object.defineProperty(cloned, key, {
      configurable: false,
      enumerable: true,
      writable: false,
      value: cloneRuntimeData(descriptor.value, seen),
    });
  }
  seen.delete(value);
  return Object.freeze(cloned);
}

function runtimeDataEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => runtimeDataEqual(item, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) =>
      key === rightKeys[index] &&
      runtimeDataEqual(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      ),
  );
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Reflect.ownKeys(record);
  return keys.length === allowed.length &&
    keys.every((key) => typeof key === "string" && allowed.includes(key));
}

function exactKeysWithOptional(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(record);
  return required.every((key) => Object.prototype.hasOwnProperty.call(record, key)) &&
    keys.every(
      (key) => typeof key === "string" && (required.includes(key) || optional.includes(key)),
    );
}

function requireActionRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value) || typeof value.type !== "string") {
    throw new TypeError("Local store action must be a typed plain object.");
  }
  return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, field: string, minimum?: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Object.is(value, -0) ||
    (minimum !== undefined && value < minimum)
  ) {
    throw new TypeError(`${field} must be a finite canonical number.`);
  }
  return value;
}

function requireInteger(value: unknown, field: string, minimum = 0): number {
  const number = requireFiniteNumber(value, field, minimum);
  if (!Number.isSafeInteger(number)) throw new TypeError(`${field} must be a safe integer.`);
  return number;
}

function updateRecord<T>(
  record: Readonly<Partial<Record<string, T>>>,
  key: string,
  value: T | typeof DELETE_RECORD_VALUE,
): Readonly<Partial<Record<string, T>>> {
  const next = Object.create(null) as Record<string, T>;
  for (const currentKey of Object.keys(record)) {
    const current = record[currentKey];
    if (current !== undefined && currentKey !== key) {
      Object.defineProperty(next, currentKey, {
        enumerable: true,
        value: current,
      });
    }
  }
  if (value !== DELETE_RECORD_VALUE) {
    Object.defineProperty(next, key, { enumerable: true, value });
  }
  return Object.freeze(next);
}

function requirePoint(value: unknown, field: string): DeepReadonly<{ x: number; y: number }> {
  if (!isPlainRecord(value) || !exactKeys(value, ["x", "y"])) {
    throw new TypeError(`${field} must be a point.`);
  }
  requireFiniteNumber(value.x, `${field}.x`);
  requireFiniteNumber(value.y, `${field}.y`);
  return value as unknown as DeepReadonly<{ x: number; y: number }>;
}

function requireTarget(value: unknown, field: string): DeepReadonly<InteractionTarget> {
  if (!isPlainRecord(value) || !exactKeysWithOptional(value, ["surfaceId", "role"], ["entityId"])) {
    throw new TypeError(`${field} must be an InteractionTarget.`);
  }
  requireNonEmptyString(value.surfaceId, `${field}.surfaceId`);
  requireNonEmptyString(value.role, `${field}.role`);
  if (Object.prototype.hasOwnProperty.call(value, "entityId") && !isEntityId(value.entityId)) {
    throw new TypeError(`${field}.entityId must be an EntityId.`);
  }
  return value as unknown as DeepReadonly<InteractionTarget>;
}

function requireDragSession(value: unknown): DeepReadonly<InteractionDragSession> {
  if (
    !isPlainRecord(value) ||
    !exactKeys(value, ["pointerId", "transactionId", "target", "origin", "current"])
  ) {
    throw new TypeError("interaction.setDrag session is invalid.");
  }
  requireInteger(value.pointerId, "session.pointerId");
  if (!isEntityId(value.transactionId)) throw new TypeError("session.transactionId is invalid.");
  requireTarget(value.target, "session.target");
  requirePoint(value.origin, "session.origin");
  requirePoint(value.current, "session.current");
  return value as unknown as DeepReadonly<InteractionDragSession>;
}

function requireGuide(value: unknown): DeepReadonly<InteractionGuide> {
  if (!isPlainRecord(value) || !exactKeys(value, ["axis", "position"])) {
    throw new TypeError("Interaction guide is invalid.");
  }
  if (value.axis !== "x" && value.axis !== "y") throw new TypeError("Guide axis is invalid.");
  requireFiniteNumber(value.position, "guide.position");
  return value as unknown as DeepReadonly<InteractionGuide>;
}

function requireContextMenu(value: unknown): DeepReadonly<InteractionContextMenu> {
  if (!isPlainRecord(value) || !exactKeys(value, ["anchor", "target"])) {
    throw new TypeError("Interaction context menu is invalid.");
  }
  requirePoint(value.anchor, "contextMenu.anchor");
  if (value.target !== null) requireTarget(value.target, "contextMenu.target");
  return value as unknown as DeepReadonly<InteractionContextMenu>;
}

function normalizeObserver(
  options: CreateLocalStoreOptions | undefined,
): ((diagnostic: LocalStoreSubscriberDiagnostic) => void) | undefined {
  if (options === undefined) return undefined;
  try {
    if (!isPlainRecord(options)) throw new TypeError("Local store options must be data-only.");
    const keys = Reflect.ownKeys(options);
    if (keys.some((key) => key !== "onSubscriberError")) {
      throw new TypeError("Local store options contain an unsupported field.");
    }
    const descriptor = Object.getOwnPropertyDescriptor(options, "onSubscriberError");
    if (!descriptor) return undefined;
    if (!("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value !== "function") {
      throw new TypeError("onSubscriberError must be an enumerable data method.");
    }
    const handler = descriptor.value;
    return (diagnostic) => Reflect.apply(handler, undefined, [diagnostic]);
  } catch {
    throw new TypeError("Local store options must be data-only.");
  }
}

function createLocalStore<TKind extends LocalStoreKind>(
  kind: TKind,
  initialState: DeepReadonly<StudioStoreStateMap[TKind]>,
  reducer: LocalReducer<TKind>,
  options?: CreateLocalStoreOptions,
): Extract<LocalStore, { kind: TKind }> {
  const onSubscriberError = normalizeObserver(options);
  const listeners = new Set<StoreListener>();
  let state = initialState;
  let dispatching = false;

  const getSnapshot = () => state;
  const subscribe = (listener: StoreListener): (() => void) => {
    if (typeof listener !== "function") throw new TypeError("Local store subscriber must be a function.");
    listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      listeners.delete(listener);
    };
  };
  const notify = (): void => {
    const diagnostic = Object.freeze({
      code: "LOCAL_STORE_SUBSCRIBER_FAILED" as const,
      storeKind: kind,
      message: "A local store subscriber failed while observing a committed snapshot.",
    });
    for (const listener of Array.from(listeners)) {
      if (!listeners.has(listener)) continue;
      try {
        listener();
      } catch {
        try {
          onSubscriberError?.(diagnostic);
        } catch {
          // Observer diagnostics cannot change a committed local-store update.
        }
      }
    }
  };
  const dispatch = (action: StudioStoreActionMap[TKind]): void => {
    if (dispatching) throw new TypeError(`${kind} store does not allow reentrant dispatch.`);
    dispatching = true;
    try {
      let normalizedAction: DeepReadonly<StudioStoreActionMap[TKind]>;
      try {
        normalizedAction = cloneRuntimeData(action) as DeepReadonly<StudioStoreActionMap[TKind]>;
      } catch (error) {
        if (error !== null && typeof error === "object" && LOCAL_INPUT_ERRORS.has(error)) throw error;
        throw new TypeError(`${kind} store action could not be read safely.`);
      }
      const next = reducer(state, normalizedAction);
      if (next === state) return;
      state = next;
      notify();
    } finally {
      dispatching = false;
    }
  };

  const contract = STUDIO_STORE_CONTRACTS[kind];
  return Object.freeze({
    kind,
    persistence: contract.persistence,
    history: contract.history,
    getSnapshot,
    subscribe,
    dispatch,
  }) as unknown as Extract<LocalStore, { kind: TKind }>;
}

function createInitialWorkspaceState(): DeepReadonly<WorkspaceState> {
  return Object.freeze({
    panelSizes: Object.freeze(Object.create(null) as Record<string, number>),
    viewports: Object.freeze(Object.create(null) as Partial<Record<WorkspaceId, WorkspaceViewport>>),
    preferences: Object.freeze(Object.create(null) as Record<string, WorkspacePreferenceValue>),
  });
}

function reduceWorkspace(
  state: DeepReadonly<WorkspaceState>,
  value: DeepReadonly<WorkspaceAction>,
): DeepReadonly<WorkspaceState> {
  const action = requireActionRecord(value);
  switch (action.type) {
    case "workspace.setPanelSize": {
      if (!exactKeys(action, ["type", "panelId", "size"])) throw new TypeError("Invalid panel action.");
      const panelId = requireNonEmptyString(action.panelId, "panelId");
      const size = requireFiniteNumber(action.size, "size", 0);
      if (state.panelSizes[panelId] === size) return state;
      return Object.freeze({ ...state, panelSizes: updateRecord(state.panelSizes, panelId, size) });
    }
    case "workspace.setViewport": {
      if (!exactKeys(action, ["type", "workspaceId", "viewport"])) {
        throw new TypeError("Invalid viewport action.");
      }
      if (!WORKSPACE_IDS.includes(action.workspaceId as WorkspaceId)) {
        throw new TypeError("workspaceId is invalid.");
      }
      if (!isPlainRecord(action.viewport) || !exactKeys(action.viewport, ["scale", "offset"])) {
        throw new TypeError("viewport is invalid.");
      }
      requireFiniteNumber(action.viewport.scale, "viewport.scale", Number.MIN_VALUE);
      requirePoint(action.viewport.offset, "viewport.offset");
      const workspaceId = action.workspaceId as WorkspaceId;
      const viewport = action.viewport as unknown as DeepReadonly<WorkspaceViewport>;
      const current = state.viewports[workspaceId];
      if (
        current?.scale === viewport.scale &&
        current.offset.x === viewport.offset.x &&
        current.offset.y === viewport.offset.y
      ) return state;
      return Object.freeze({
        ...state,
        viewports: updateRecord(state.viewports, workspaceId, viewport),
      });
    }
    case "workspace.setPreference": {
      if (!exactKeys(action, ["type", "key", "value"])) throw new TypeError("Invalid preference action.");
      const key = requireNonEmptyString(action.key, "key");
      const preference = action.value;
      if (
        preference !== null &&
        typeof preference !== "string" &&
        typeof preference !== "boolean" &&
        typeof preference !== "number"
      ) throw new TypeError("Preference value must be a primitive.");
      if (state.preferences[key] === preference) return state;
      return Object.freeze({
        ...state,
        preferences: updateRecord(state.preferences, key, preference as WorkspacePreferenceValue),
      });
    }
    case "workspace.reset":
      if (!exactKeys(action, ["type"])) throw new TypeError("Invalid workspace reset action.");
      return Object.keys(state.panelSizes).length === 0 &&
          Object.keys(state.viewports).length === 0 &&
          Object.keys(state.preferences).length === 0
        ? state
        : createInitialWorkspaceState();
    default:
      throw new TypeError("Unsupported WorkspaceStore action.");
  }
}

function createInitialInteractionState(): DeepReadonly<InteractionState> {
  return Object.freeze({
    hoveredTarget: null,
    dragSession: null,
    guides: Object.freeze([]),
    marquee: null,
    transientSelection: Object.freeze([]),
    activeModalId: null,
    contextMenu: null,
  });
}

function reduceInteraction(
  state: DeepReadonly<InteractionState>,
  value: DeepReadonly<InteractionAction>,
): DeepReadonly<InteractionState> {
  const action = requireActionRecord(value);
  switch (action.type) {
    case "interaction.setHover": {
      if (!exactKeys(action, ["type", "target"])) throw new TypeError("Invalid hover action.");
      const target = action.target === null ? null : requireTarget(action.target, "target");
      if (runtimeDataEqual(state.hoveredTarget, target)) return state;
      return Object.freeze({ ...state, hoveredTarget: target });
    }
    case "interaction.setDrag": {
      if (!exactKeys(action, ["type", "session"])) throw new TypeError("Invalid drag action.");
      const dragSession = action.session === null ? null : requireDragSession(action.session);
      if (runtimeDataEqual(state.dragSession, dragSession)) return state;
      return Object.freeze({ ...state, dragSession });
    }
    case "interaction.setGuides": {
      if (!exactKeys(action, ["type", "guides"]) || !Array.isArray(action.guides)) {
        throw new TypeError("Invalid guides action.");
      }
      const guides = action.guides.map(requireGuide);
      if (runtimeDataEqual(state.guides, guides)) return state;
      return Object.freeze({ ...state, guides: Object.freeze(guides) });
    }
    case "interaction.setMarquee": {
      if (!exactKeys(action, ["type", "marquee"])) throw new TypeError("Invalid marquee action.");
      if (action.marquee === null) return state.marquee === null ? state : Object.freeze({ ...state, marquee: null });
      if (!isPlainRecord(action.marquee) || !exactKeys(action.marquee, ["x", "y", "width", "height"])) {
        throw new TypeError("Marquee must be a rectangle.");
      }
      requireFiniteNumber(action.marquee.x, "marquee.x");
      requireFiniteNumber(action.marquee.y, "marquee.y");
      requireFiniteNumber(action.marquee.width, "marquee.width", 0);
      requireFiniteNumber(action.marquee.height, "marquee.height", 0);
      if (runtimeDataEqual(state.marquee, action.marquee)) return state;
      return Object.freeze({
        ...state,
        marquee: action.marquee as unknown as DeepReadonly<InteractionState["marquee"]>,
      });
    }
    case "interaction.setTransientSelection": {
      if (!exactKeys(action, ["type", "entityIds"]) || !Array.isArray(action.entityIds)) {
        throw new TypeError("Invalid transient selection action.");
      }
      if (!action.entityIds.every(isEntityId) || new Set(action.entityIds).size !== action.entityIds.length) {
        throw new TypeError("Transient selection requires unique EntityIds.");
      }
      if (runtimeDataEqual(state.transientSelection, action.entityIds)) return state;
      return Object.freeze({ ...state, transientSelection: action.entityIds });
    }
    case "interaction.setModal": {
      if (!exactKeys(action, ["type", "modalId"])) throw new TypeError("Invalid modal action.");
      const activeModalId = action.modalId === null
        ? null
        : requireNonEmptyString(action.modalId, "modalId");
      if (activeModalId === state.activeModalId) return state;
      return Object.freeze({ ...state, activeModalId });
    }
    case "interaction.setContextMenu": {
      if (!exactKeys(action, ["type", "contextMenu"])) throw new TypeError("Invalid context-menu action.");
      const contextMenu = action.contextMenu === null ? null : requireContextMenu(action.contextMenu);
      if (runtimeDataEqual(contextMenu, state.contextMenu)) return state;
      return Object.freeze({ ...state, contextMenu });
    }
    case "interaction.reset":
      if (!exactKeys(action, ["type"])) throw new TypeError("Invalid interaction reset action.");
      return state.hoveredTarget === null &&
          state.dragSession === null &&
          state.guides.length === 0 &&
          state.marquee === null &&
          state.transientSelection.length === 0 &&
          state.activeModalId === null &&
          state.contextMenu === null
        ? state
        : createInitialInteractionState();
    default:
      throw new TypeError("Unsupported InteractionStore action.");
  }
}

function createInitialJobState(): DeepReadonly<JobStoreState> {
  return Object.freeze({
    jobs: Object.freeze(Object.create(null) as Record<string, JobStoreEntry>),
    order: Object.freeze([]),
  });
}

function reduceJob(
  state: DeepReadonly<JobStoreState>,
  value: DeepReadonly<JobStoreAction>,
): DeepReadonly<JobStoreState> {
  const action = requireActionRecord(value);
  switch (action.type) {
    case "job.replace": {
      if (!exactKeys(action, ["type", "job"]) || !isPlainRecord(action.job)) {
        throw new TypeError("Invalid job replacement action.");
      }
      if (!isEntityId(action.job.id)) throw new TypeError("job.id must be an EntityId.");
      requireNonEmptyString(action.job.kind, "job.kind");
      if (
        Object.prototype.hasOwnProperty.call(action.job, "project") ||
        Object.prototype.hasOwnProperty.call(action.job, "revision")
      ) {
        throw new TypeError("JobStore entries cannot contain project or revision state.");
      }
      if (runtimeDataEqual(state.jobs[action.job.id], action.job)) return state;
      const exists = state.jobs[action.job.id] !== undefined;
      return Object.freeze({
        jobs: updateRecord(state.jobs, action.job.id, action.job as DeepReadonly<JobStoreEntry>),
        order: exists ? state.order : Object.freeze([...state.order, action.job.id]),
      });
    }
    case "job.remove": {
      if (!exactKeys(action, ["type", "jobId"]) || !isEntityId(action.jobId)) {
        throw new TypeError("Invalid job removal action.");
      }
      if (state.jobs[action.jobId] === undefined) return state;
      return Object.freeze({
        jobs: updateRecord<DeepReadonly<JobStoreEntry>>(
          state.jobs,
          action.jobId,
          DELETE_RECORD_VALUE,
        ),
        order: Object.freeze(state.order.filter((id) => id !== action.jobId)),
      });
    }
    case "job.reset":
      if (!exactKeys(action, ["type"])) throw new TypeError("Invalid job reset action.");
      return state.order.length === 0 && Object.keys(state.jobs).length === 0
        ? state
        : createInitialJobState();
    default:
      throw new TypeError("Unsupported JobStore action.");
  }
}

function createInitialPlaybackState(): DeepReadonly<PlaybackState> {
  return Object.freeze({
    sequenceId: null,
    playing: false,
    cursorMs: 0,
    celIndex: 0,
    accumulatorMs: 0,
    droppedFrames: 0,
  });
}

function reducePlayback(
  state: DeepReadonly<PlaybackState>,
  value: DeepReadonly<PlaybackAction>,
): DeepReadonly<PlaybackState> {
  const action = requireActionRecord(value);
  switch (action.type) {
    case "playback.setSequence": {
      if (!exactKeys(action, ["type", "sequenceId"])) throw new TypeError("Invalid sequence action.");
      if (action.sequenceId !== null && !isEntityId(action.sequenceId)) {
        throw new TypeError("sequenceId must be an EntityId or null.");
      }
      if (action.sequenceId === state.sequenceId) return state;
      return Object.freeze({ ...createInitialPlaybackState(), sequenceId: action.sequenceId });
    }
    case "playback.setPlaying": {
      if (!exactKeys(action, ["type", "playing"]) || typeof action.playing !== "boolean") {
        throw new TypeError("Invalid playing action.");
      }
      if (action.playing && state.sequenceId === null) {
        throw new TypeError("Playback requires an active sequence.");
      }
      if (action.playing === state.playing) return state;
      return Object.freeze({ ...state, playing: action.playing });
    }
    case "playback.seek": {
      if (!exactKeys(action, ["type", "cursorMs", "celIndex"])) throw new TypeError("Invalid seek action.");
      if (state.sequenceId === null) throw new TypeError("Playback seek requires an active sequence.");
      const cursorMs = requireFiniteNumber(action.cursorMs, "cursorMs", 0);
      const celIndex = requireInteger(action.celIndex, "celIndex");
      if (cursorMs === state.cursorMs && celIndex === state.celIndex) return state;
      return Object.freeze({ ...state, cursorMs, celIndex, accumulatorMs: 0 });
    }
    case "playback.advance": {
      if (!exactKeys(action, ["type", "cursorMs", "celIndex", "accumulatorMs", "droppedFrames"])) {
        throw new TypeError("Invalid playback advance action.");
      }
      if (state.sequenceId === null || !state.playing) {
        throw new TypeError("Playback advance requires a playing sequence.");
      }
      const cursorMs = requireFiniteNumber(action.cursorMs, "cursorMs", 0);
      const celIndex = requireInteger(action.celIndex, "celIndex");
      const accumulatorMs = requireFiniteNumber(action.accumulatorMs, "accumulatorMs", 0);
      const droppedFrames = requireInteger(action.droppedFrames, "droppedFrames");
      if (
        cursorMs === state.cursorMs &&
        celIndex === state.celIndex &&
        accumulatorMs === state.accumulatorMs &&
        droppedFrames === state.droppedFrames
      ) return state;
      return Object.freeze({ ...state, cursorMs, celIndex, accumulatorMs, droppedFrames });
    }
    case "playback.reset":
      if (!exactKeys(action, ["type"])) throw new TypeError("Invalid playback reset action.");
      return state.sequenceId === null &&
          !state.playing &&
          state.cursorMs === 0 &&
          state.celIndex === 0 &&
          state.accumulatorMs === 0 &&
          state.droppedFrames === 0
        ? state
        : createInitialPlaybackState();
    default:
      throw new TypeError("Unsupported PlaybackStore action.");
  }
}

export function createWorkspaceStore(options?: CreateLocalStoreOptions): WorkspaceStore {
  return createLocalStore("workspace", createInitialWorkspaceState(), reduceWorkspace, options);
}

export function createInteractionStore(options?: CreateLocalStoreOptions): InteractionStore {
  return createLocalStore("interaction", createInitialInteractionState(), reduceInteraction, options);
}

export function createJobStore(options?: CreateLocalStoreOptions): JobStore {
  return createLocalStore("job", createInitialJobState(), reduceJob, options);
}

export function createPlaybackStore(options?: CreateLocalStoreOptions): PlaybackStore {
  return createLocalStore("playback", createInitialPlaybackState(), reducePlayback, options);
}
