import type { StudioCommandId } from "./commandRegistry";
import {
  getStudioWorkspace,
  type StudioWorkspaceId,
} from "./workspaceRegistry";

export interface StudioWorkspaceAvailability {
  readonly sourceAvailable: boolean;
  readonly compositionAvailable: boolean;
  readonly frameCount: number;
  readonly animationCount: number;
}

export interface StudioWorkspaceFailure {
  readonly message: string;
  readonly retryCommandId?: StudioCommandId;
}

export interface ResolveStudioWorkspaceStateInput {
  readonly workspaceId: StudioWorkspaceId;
  readonly availability: StudioWorkspaceAvailability;
  readonly loading?: boolean;
  readonly loadingMessage?: string;
  readonly failure?: StudioWorkspaceFailure | null;
}

export interface StudioWorkspaceResolutionAction {
  readonly commandId: StudioCommandId;
  readonly label: string;
}

interface StudioWorkspaceStateBase {
  readonly workspaceId: StudioWorkspaceId;
  readonly workspaceLabel: string;
}

export interface StudioWorkspaceReadyState extends StudioWorkspaceStateBase {
  readonly kind: "ready";
}

export interface StudioWorkspaceLoadingState extends StudioWorkspaceStateBase {
  readonly kind: "loading";
  readonly title: string;
  readonly description: string;
}

export interface StudioWorkspaceErrorState extends StudioWorkspaceStateBase {
  readonly kind: "error";
  readonly title: string;
  readonly description: string;
  readonly retryCommandId?: StudioCommandId;
}

export interface StudioWorkspaceEmptyState extends StudioWorkspaceStateBase {
  readonly kind: "empty";
  readonly title: string;
  readonly description: string;
  readonly primaryAction: StudioWorkspaceResolutionAction;
  readonly secondaryAction?: StudioWorkspaceResolutionAction;
}

export type StudioWorkspaceState =
  | StudioWorkspaceReadyState
  | StudioWorkspaceLoadingState
  | StudioWorkspaceErrorState
  | StudioWorkspaceEmptyState;

interface EmptyStateDefinition {
  readonly title: string;
  readonly description: string;
  readonly primaryAction: StudioWorkspaceResolutionAction;
  readonly secondaryAction?: StudioWorkspaceResolutionAction;
}

const EMPTY_STATE_DEFINITIONS: Readonly<Record<StudioWorkspaceId, EmptyStateDefinition>> =
  Object.freeze({
    slice: Object.freeze({
      title: "Bring in a spritesheet",
      description: "Import PNG, JPEG or WebP source art to detect and refine sprite regions.",
      primaryAction: Object.freeze({ commandId: "asset.import", label: "Import source art" }),
    }),
    compose: Object.freeze({
      title: "Start a composition",
      description: "Import artwork to create the first canvas and arrange reusable sprite layers.",
      primaryAction: Object.freeze({ commandId: "asset.import", label: "Import artwork" }),
      secondaryAction: Object.freeze({ commandId: "workspace.open.slice", label: "Go to Slice" }),
    }),
    animate: Object.freeze({
      title: "Add artwork before animating",
      description: "Create a source or composition first, then sequence frames from the Animate tools.",
      primaryAction: Object.freeze({ commandId: "asset.import", label: "Import artwork" }),
      secondaryAction: Object.freeze({ commandId: "workspace.open.compose", label: "Go to Compose" }),
    }),
    collision: Object.freeze({
      title: "Create frames before hitboxes",
      description: "Collision shapes attach to sliced frames. Prepare at least one frame in Slice.",
      primaryAction: Object.freeze({ commandId: "workspace.open.slice", label: "Go to Slice" }),
      secondaryAction: Object.freeze({ commandId: "asset.import", label: "Import source art" }),
    }),
    export: Object.freeze({
      title: "Build something to export",
      description: "Import or compose artwork before validating and packaging project outputs.",
      primaryAction: Object.freeze({ commandId: "asset.import", label: "Import artwork" }),
      secondaryAction: Object.freeze({ commandId: "workspace.open.compose", label: "Go to Compose" }),
    }),
  });

function normalizeCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function hasRequiredInput(
  workspaceId: StudioWorkspaceId,
  availability: StudioWorkspaceAvailability,
): boolean {
  const sceneAvailable = availability.sourceAvailable || availability.compositionAvailable;
  switch (workspaceId) {
    case "slice":
      return availability.sourceAvailable;
    case "compose":
      return availability.compositionAvailable;
    case "animate":
    case "export":
      return sceneAvailable;
    case "collision":
      return normalizeCount(availability.frameCount) > 0;
  }
}

function stableMessage(value: string | undefined, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : fallback;
}

/** Resolve shell presentation without creating another project or interaction store. */
export function resolveStudioWorkspaceState(
  input: ResolveStudioWorkspaceStateInput,
): StudioWorkspaceState {
  const workspace = getStudioWorkspace(input.workspaceId);
  const base = {
    workspaceId: workspace.id,
    workspaceLabel: workspace.label,
  } as const;

  if (input.loading === true) {
    return Object.freeze({
      ...base,
      kind: "loading",
      title: `Preparing ${workspace.label}`,
      description: stableMessage(input.loadingMessage, "Loading project resources…"),
    });
  }

  if (input.failure) {
    return Object.freeze({
      ...base,
      kind: "error",
      title: `${workspace.label} could not finish`,
      description: stableMessage(input.failure.message, "The Studio command failed."),
      ...(input.failure.retryCommandId
        ? { retryCommandId: input.failure.retryCommandId }
        : {}),
    });
  }

  if (hasRequiredInput(input.workspaceId, input.availability)) {
    return Object.freeze({ ...base, kind: "ready" });
  }

  const definition = EMPTY_STATE_DEFINITIONS[input.workspaceId];
  return Object.freeze({
    ...base,
    kind: "empty",
    title: definition.title,
    description: definition.description,
    primaryAction: definition.primaryAction,
    ...(definition.secondaryAction ? { secondaryAction: definition.secondaryAction } : {}),
  });
}
