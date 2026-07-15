import { WORKSPACE_IDS, type WorkspaceId } from "../project";

/** Top-level destinations exposed by the unified Studio shell, in navigation order. */
export const STUDIO_WORKSPACE_IDS = Object.freeze([
  "slice",
  "compose",
  "animate",
  "collision",
  "export",
] as const satisfies readonly WorkspaceId[]);

/**
 * Canonical contexts that support the Studio without becoming primary
 * destinations. Assets are reached through the shared Asset Library.
 */
export const STUDIO_SUPPORT_CONTEXT_IDS = Object.freeze([
  "assets",
] as const satisfies readonly WorkspaceId[]);

export type StudioWorkspaceId = (typeof STUDIO_WORKSPACE_IDS)[number];
export type StudioSupportContextId = (typeof STUDIO_SUPPORT_CONTEXT_IDS)[number];
export type StudioWorkspaceHref = `#/studio/${StudioWorkspaceId}`;
export type StudioWorkspaceCommandId = `workspace.open.${StudioWorkspaceId}`;

type MissingWorkspaceId = Exclude<
  WorkspaceId,
  StudioWorkspaceId | StudioSupportContextId
>;
type ExhaustiveWorkspacePartition = MissingWorkspaceId extends never ? true : never;

// Compile-time tripwire: adding a canonical WorkspaceId requires classifying it here.
const WORKSPACE_PARTITION_IS_EXHAUSTIVE: ExhaustiveWorkspacePartition = true;
void WORKSPACE_PARTITION_IS_EXHAUSTIVE;

export type StudioWorkspaceRenderSource =
  | "asset-or-region"
  | "composition"
  | "timeline";

export type StudioWorkspaceInteraction = "edit" | "preview";
export type StudioWorkspaceTimeline = "hidden" | "editable" | "read-only";

export interface StudioWorkspaceCapabilities {
  /** Root-selection policy already implemented by the canonical scene projector. */
  readonly renderSource: StudioWorkspaceRenderSource;
  /** Whether pointer/keyboard surfaces may issue project mutations. */
  readonly interaction: StudioWorkspaceInteraction;
  /** Timeline presentation required by this destination. */
  readonly timeline: StudioWorkspaceTimeline;
}

export interface StudioWorkspaceDefinition<
  TId extends StudioWorkspaceId = StudioWorkspaceId,
> {
  readonly id: TId;
  readonly order: number;
  readonly label: string;
  readonly description: string;
  readonly href: `#/studio/${TId}`;
  readonly commandId: `workspace.open.${TId}`;
  readonly capabilities: StudioWorkspaceCapabilities;
}

interface WorkspaceDefinitionInput {
  readonly label: string;
  readonly description: string;
  readonly capabilities: StudioWorkspaceCapabilities;
}

function defineWorkspace<TId extends StudioWorkspaceId>(
  id: TId,
  order: number,
  input: WorkspaceDefinitionInput,
): StudioWorkspaceDefinition<TId> {
  return Object.freeze({
    id,
    order,
    label: input.label,
    description: input.description,
    href: `#/studio/${id}` as const,
    commandId: `workspace.open.${id}` as const,
    capabilities: Object.freeze({ ...input.capabilities }),
  });
}

const REGISTRY = {
  slice: defineWorkspace("slice", 0, {
    label: "Slice",
    description: "Cut sprites from source art.",
    capabilities: {
      renderSource: "asset-or-region",
      interaction: "edit",
      timeline: "hidden",
    },
  }),
  compose: defineWorkspace("compose", 1, {
    label: "Compose",
    description: "Build frames from layered assets.",
    capabilities: {
      renderSource: "composition",
      interaction: "edit",
      timeline: "hidden",
    },
  }),
  animate: defineWorkspace("animate", 2, {
    label: "Animate",
    description: "Sequence cels and preview timing.",
    capabilities: {
      renderSource: "timeline",
      interaction: "edit",
      timeline: "editable",
    },
  }),
  collision: defineWorkspace("collision", 3, {
    label: "Collision",
    description: "Author collision shapes on sprite sources.",
    capabilities: {
      renderSource: "timeline",
      interaction: "edit",
      timeline: "hidden",
    },
  }),
  export: defineWorkspace("export", 4, {
    label: "Export",
    description: "Validate and package project outputs.",
    capabilities: {
      renderSource: "timeline",
      interaction: "preview",
      timeline: "read-only",
    },
  }),
} satisfies Record<StudioWorkspaceId, StudioWorkspaceDefinition>;

export const STUDIO_WORKSPACE_REGISTRY: Readonly<
  Record<StudioWorkspaceId, StudioWorkspaceDefinition>
> = Object.freeze(REGISTRY);

export const STUDIO_WORKSPACES: readonly StudioWorkspaceDefinition[] = Object.freeze(
  STUDIO_WORKSPACE_IDS.map((id) => STUDIO_WORKSPACE_REGISTRY[id]),
);

const WORKSPACE_ID_SET: ReadonlySet<string> = new Set(STUDIO_WORKSPACE_IDS);
const WORKSPACE_BY_HREF: ReadonlyMap<string, StudioWorkspaceId> = new Map(
  STUDIO_WORKSPACES.map((workspace) => [workspace.href, workspace.id]),
);

export function isStudioWorkspaceId(value: unknown): value is StudioWorkspaceId {
  return typeof value === "string" && WORKSPACE_ID_SET.has(value);
}

export function getStudioWorkspace(
  workspaceId: StudioWorkspaceId,
): StudioWorkspaceDefinition {
  return STUDIO_WORKSPACE_REGISTRY[workspaceId];
}

/** Parse only canonical hashes. Query/suffix aliases cannot create hidden routes. */
export function parseStudioWorkspaceHref(value: unknown): StudioWorkspaceId | null {
  if (typeof value !== "string") return null;
  return WORKSPACE_BY_HREF.get(value) ?? null;
}

/**
 * Convert optional/support project context into a visible shell destination.
 * F6-03 owns dispatching the matching canonical workspace.update transition.
 */
export function resolveStudioWorkspaceId(
  value: unknown,
  fallback: StudioWorkspaceId = "slice",
): StudioWorkspaceId {
  return isStudioWorkspaceId(value) ? value : fallback;
}

/** Runtime mirror of the compile-time partition, exposed for contract diagnostics. */
export const STUDIO_WORKSPACE_PARTITION = Object.freeze({
  primary: STUDIO_WORKSPACE_IDS,
  support: STUDIO_SUPPORT_CONTEXT_IDS,
  canonical: WORKSPACE_IDS,
});
