import type {
  ProjectCommandEnvelope,
  ProjectCommandResult,
} from "../project/commands";
import type { ProjectRevision } from "../project/graph";
import type { EntityId, StudioProjectV1, WorkspaceId } from "../project/schema";
import type { JobSnapshot } from "../processing";

type Primitive = string | number | boolean | bigint | symbol | null | undefined;

/** Public snapshots cannot be mutated around their command/action boundary. */
export type DeepReadonly<T> = T extends Primitive | ((...args: never[]) => unknown)
  ? T
  : T extends readonly (infer TItem)[]
    ? readonly DeepReadonly<TItem>[]
    : { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> };

export const STUDIO_STORE_KINDS = Object.freeze([
  "project",
  "workspace",
  "interaction",
  "job",
  "playback",
] as const);

export type StudioStoreKind = (typeof STUDIO_STORE_KINDS)[number];
export type StorePersistence = "durable" | "partial" | "ephemeral";
export type StoreHistoryPolicy = "command" | "none";

/** Signals a synchronous local-store commit already in progress. */
export class LocalStoreDispatchBusyError extends TypeError {
  readonly code = "LOCAL_STORE_DISPATCH_BUSY" as const;
  readonly storeKind: StudioStoreKind;

  constructor(storeKind: StudioStoreKind) {
    super(`${storeKind} store does not allow reentrant dispatch.`);
    this.name = "LocalStoreDispatchBusyError";
    this.storeKind = storeKind;
  }
}

export interface StoreContractDefinition<
  TKind extends StudioStoreKind = StudioStoreKind,
  TPersistence extends StorePersistence = StorePersistence,
  THistory extends StoreHistoryPolicy = StoreHistoryPolicy,
> {
  readonly kind: TKind;
  readonly persistence: TPersistence;
  readonly history: THistory;
}

type StudioStoreContractMap = {
  readonly project: StoreContractDefinition<"project", "durable", "command">;
  readonly workspace: StoreContractDefinition<"workspace", "partial", "none">;
  readonly interaction: StoreContractDefinition<"interaction", "ephemeral", "none">;
  readonly job: StoreContractDefinition<"job", "ephemeral", "none">;
  readonly playback: StoreContractDefinition<"playback", "ephemeral", "none">;
};

/** Runtime-visible policy matrix used by architecture checks and diagnostics. */
export const STUDIO_STORE_CONTRACTS = Object.freeze({
  project: Object.freeze({
    kind: "project",
    persistence: "durable",
    history: "command",
  }),
  workspace: Object.freeze({
    kind: "workspace",
    persistence: "partial",
    history: "none",
  }),
  interaction: Object.freeze({
    kind: "interaction",
    persistence: "ephemeral",
    history: "none",
  }),
  job: Object.freeze({
    kind: "job",
    persistence: "ephemeral",
    history: "none",
  }),
  playback: Object.freeze({
    kind: "playback",
    persistence: "ephemeral",
    history: "none",
  }),
} as const satisfies StudioStoreContractMap);

export type StoreListener = () => void;
export type StoreUnsubscribe = () => void;

export interface ProjectStoreState {
  readonly project: DeepReadonly<StudioProjectV1>;
  readonly revision: ProjectRevision;
}

export interface ProjectStoreDispatchResult {
  /** Current revision after dispatch; failed/no-op commands retain it. */
  readonly revision: ProjectRevision;
  readonly result: DeepReadonly<ProjectCommandResult>;
}

export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

export interface CanvasRect extends CanvasPoint {
  readonly width: number;
  readonly height: number;
}

export interface WorkspaceViewport {
  readonly scale: number;
  readonly offset: CanvasPoint;
}

export type WorkspacePreferenceValue = string | number | boolean | null;

/**
 * Per-project/user view state. Active workspace and durable selections are
 * read from ProjectStore.project.workspace and are never duplicated here.
 */
export interface WorkspaceState {
  readonly panelSizes: Readonly<Partial<Record<string, number>>>;
  readonly viewports: Readonly<Partial<Record<WorkspaceId, WorkspaceViewport>>>;
  readonly preferences: Readonly<Partial<Record<string, WorkspacePreferenceValue>>>;
}

export type WorkspaceAction =
  | { readonly type: "workspace.setPanelSize"; readonly panelId: string; readonly size: number }
  | {
      readonly type: "workspace.setViewport";
      readonly workspaceId: WorkspaceId;
      readonly viewport: WorkspaceViewport;
    }
  | {
      readonly type: "workspace.setPreference";
      readonly key: string;
      readonly value: WorkspacePreferenceValue;
    }
  | { readonly type: "workspace.reset" };

export interface InteractionTarget {
  readonly surfaceId: string;
  readonly role: string;
  readonly entityId?: EntityId;
}

export interface InteractionDragSession {
  readonly pointerId: number;
  readonly transactionId: EntityId;
  readonly target: InteractionTarget;
  readonly origin: CanvasPoint;
  readonly current: CanvasPoint;
}

export interface InteractionGuide {
  readonly axis: "x" | "y";
  readonly position: number;
}

export interface InteractionContextMenu {
  readonly anchor: CanvasPoint;
  readonly target: InteractionTarget | null;
}

export interface InteractionState {
  readonly hoveredTarget: InteractionTarget | null;
  readonly dragSession: InteractionDragSession | null;
  readonly guides: readonly InteractionGuide[];
  readonly marquee: CanvasRect | null;
  readonly transientSelection: readonly EntityId[];
  readonly activeModalId: string | null;
  readonly contextMenu: InteractionContextMenu | null;
}

export type InteractionAction =
  | { readonly type: "interaction.setHover"; readonly target: InteractionTarget | null }
  | { readonly type: "interaction.setDrag"; readonly session: InteractionDragSession | null }
  | { readonly type: "interaction.setGuides"; readonly guides: readonly InteractionGuide[] }
  | { readonly type: "interaction.setMarquee"; readonly marquee: CanvasRect | null }
  | {
      readonly type: "interaction.setTransientSelection";
      readonly entityIds: readonly EntityId[];
    }
  | { readonly type: "interaction.setModal"; readonly modalId: string | null }
  | {
      readonly type: "interaction.setContextMenu";
      readonly contextMenu: InteractionContextMenu | null;
    }
  | { readonly type: "interaction.reset" };

/** Canonical F7 lifecycle snapshot; job state remains ephemeral and history-free. */
export type JobStoreEntry = JobSnapshot;

export interface JobStoreState {
  readonly jobs: Readonly<Partial<Record<EntityId, DeepReadonly<JobStoreEntry>>>>;
  readonly order: readonly EntityId[];
  /** Session tombstones prevent late messages from matching a recycled request identity. */
  readonly retiredRequestIds: readonly EntityId[];
  /** Job identities are single-use for the lifetime of a JobStore instance. */
  readonly retiredJobIds: readonly EntityId[];
  /** A terminal attempt can produce at most one retry, even after that child is removed. */
  readonly consumedRetrySourceIds: readonly EntityId[];
}

export type JobStoreAction =
  | { readonly type: "job.replace"; readonly job: DeepReadonly<JobStoreEntry> }
  | { readonly type: "job.remove"; readonly jobId: EntityId }
  | { readonly type: "job.reset" };

export interface PlaybackState {
  readonly sequenceId: EntityId | null;
  readonly playing: boolean;
  readonly cursorMs: number;
  readonly celIndex: number;
  readonly accumulatorMs: number;
  readonly droppedFrames: number;
}

export type PlaybackAction =
  | { readonly type: "playback.setSequence"; readonly sequenceId: EntityId | null }
  | { readonly type: "playback.setPlaying"; readonly playing: boolean }
  | {
      readonly type: "playback.seek";
      readonly cursorMs: number;
      readonly celIndex: number;
    }
  | {
      readonly type: "playback.advance";
      readonly cursorMs: number;
      readonly celIndex: number;
      readonly accumulatorMs: number;
      readonly droppedFrames: number;
    }
  | { readonly type: "playback.reset" };

export type StudioStoreStateMap = {
  readonly project: ProjectStoreState;
  readonly workspace: WorkspaceState;
  readonly interaction: InteractionState;
  readonly job: JobStoreState;
  readonly playback: PlaybackState;
};

export type StudioStoreActionMap = {
  readonly project: ProjectCommandEnvelope;
  readonly workspace: WorkspaceAction;
  readonly interaction: InteractionAction;
  readonly job: JobStoreAction;
  readonly playback: PlaybackAction;
};

interface StudioStoreBase<TKind extends StudioStoreKind> {
  readonly kind: TKind;
  readonly persistence: (typeof STUDIO_STORE_CONTRACTS)[TKind]["persistence"];
  readonly history: (typeof STUDIO_STORE_CONTRACTS)[TKind]["history"];
  getSnapshot(): DeepReadonly<StudioStoreStateMap[TKind]>;
  subscribe(listener: StoreListener): StoreUnsubscribe;
}

export type ProjectStore = StudioStoreBase<"project"> & {
  /** The only document mutation boundary exposed by the store. */
  dispatch(envelope: StudioStoreActionMap["project"]): ProjectStoreDispatchResult;
};

export type WorkspaceStore = StudioStoreBase<"workspace"> & {
  dispatch(action: StudioStoreActionMap["workspace"]): void;
};

export type InteractionStore = StudioStoreBase<"interaction"> & {
  dispatch(action: StudioStoreActionMap["interaction"]): void;
};

export type JobStore = StudioStoreBase<"job"> & {
  dispatch(action: StudioStoreActionMap["job"]): void;
};

export type PlaybackStore = StudioStoreBase<"playback"> & {
  dispatch(action: StudioStoreActionMap["playback"]): void;
};
