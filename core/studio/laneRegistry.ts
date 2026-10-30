import type { StudioWorkspaceId } from "./workspaceRegistry";

export const STUDIO_LANE_IDS = Object.freeze([
  "items",
  "grid",
  "animation",
  "tileset",
] as const);

export const STUDIO_TAB_IDS = Object.freeze([...STUDIO_LANE_IDS, "library"] as const);

export type StudioLaneId = (typeof STUDIO_LANE_IDS)[number];
export type StudioTabId = (typeof STUDIO_TAB_IDS)[number];

const COMMON_STEPS = ["source", "separate", "review", "sheet", "deliver"] as const;

/** Step order for each lane, as published by the spritesheet-expert workflow. */
export const STUDIO_LANE_STEPS = Object.freeze({
  items: COMMON_STEPS,
  grid: COMMON_STEPS,
  animation: [
    "source",
    "separate",
    "registration",
    "timing",
    "review",
    "collision",
    "deliver",
  ],
  tileset: ["source", "separate", "tiles", "review", "map", "deliver"],
} as const);

type LaneSteps = typeof STUDIO_LANE_STEPS;
export type StudioLaneStepId<L extends StudioLaneId = StudioLaneId> = LaneSteps[L][number];

export type StudioLaneRoute =
  | { [L in StudioLaneId]: { readonly tab: L; readonly step: StudioLaneStepId<L> } }[StudioLaneId]
  | { readonly tab: "library"; readonly step: null };

export type StudioRouteKey =
  | { [L in StudioLaneId]: `${L}.${StudioLaneStepId<L>}` }[StudioLaneId]
  | "library";
export type StudioLaneCommandId = `lane.go.${StudioRouteKey}`;
export type StudioRouteHref = `#/studio/${string}`;

export const STUDIO_LANE_LABELS: Readonly<Record<StudioTabId, string>> = Object.freeze({
  items: "Items",
  grid: "Grid",
  animation: "Animation",
  tileset: "Tileset",
  library: "Library",
});

export const STUDIO_LANE_DESCRIPTIONS: Readonly<Record<StudioTabId, string>> = Object.freeze({
  items: "Separate irregular items without a grid.",
  grid: "Slice an exact grid or a variant set.",
  animation: "Register frames and set timing.",
  tileset: "Build tiles and repeat textures.",
  library: "Sources, approved items and sheets.",
});

export const STUDIO_STEP_LABELS: Readonly<Record<StudioLaneStepId, string>> = Object.freeze({
  source: "Source",
  separate: "Separate",
  review: "Review",
  sheet: "Sheet",
  deliver: "Deliver",
  registration: "Registration",
  timing: "Timing",
  collision: "Collision",
  tiles: "Tiles",
  map: "Map",
});

/** Steps that a lane can skip without blocking delivery. */
export const STUDIO_OPTIONAL_STEPS: ReadonlySet<string> = new Set(["animation.collision"]);

export interface StudioLaneInvariant {
  readonly id: string;
  readonly label: string;
}

/** Invariants from `workflow-lanes.json` in the spritesheet-expert skill. */
export const STUDIO_LANE_INVARIANTS: Readonly<Record<StudioLaneId, readonly StudioLaneInvariant[]>> =
  Object.freeze({
    items: [
      { id: "exact-rgba", label: "Exact RGBA" },
      { id: "exclusive-ownership", label: "Exclusive pixel ownership" },
      { id: "native-scale", label: "Native scale" },
      { id: "scoped-review", label: "Scoped review" },
      { id: "bounded-pages", label: "Bounded pages" },
    ],
    grid: [
      { id: "declared-slots", label: "Declared slots" },
      { id: "native-alpha-first", label: "Native alpha first" },
      { id: "inventory", label: "Inventory" },
      { id: "projection", label: "Projection" },
      { id: "identity-when-applicable", label: "Identity, when applicable" },
    ],
    animation: [
      { id: "chronology", label: "Chronology" },
      { id: "timing", label: "Timing" },
      { id: "identity", label: "Identity" },
      { id: "contacts", label: "Contacts" },
      { id: "explicit-registration", label: "Explicit registration" },
      { id: "playback-review", label: "Playback review" },
    ],
    tileset: [
      { id: "adjacency-or-repeat", label: "Adjacency or repeat" },
      { id: "projection", label: "Projection" },
      { id: "pivot", label: "Pivot" },
      { id: "map-proof", label: "Map proof" },
    ],
  });

export function getLaneSteps<L extends StudioLaneId>(lane: L): readonly StudioLaneStepId<L>[] {
  return STUDIO_LANE_STEPS[lane];
}

function buildRoutes(): readonly StudioLaneRoute[] {
  const routes: StudioLaneRoute[] = [];
  for (const lane of STUDIO_LANE_IDS) {
    for (const step of STUDIO_LANE_STEPS[lane]) {
      routes.push(Object.freeze({ tab: lane, step }) as StudioLaneRoute);
    }
  }
  routes.push(Object.freeze({ tab: "library", step: null }));
  return Object.freeze(routes);
}

/** Every reachable route in navigation order. */
export const STUDIO_LANE_ROUTES: readonly StudioLaneRoute[] = buildRoutes();

export function routeKey(route: StudioLaneRoute): StudioRouteKey {
  return (route.step === null ? "library" : `${route.tab}.${route.step}`) as StudioRouteKey;
}

export function routeHref(route: StudioLaneRoute): StudioRouteHref {
  return route.step === null ? "#/studio/library" : `#/studio/${route.tab}/${route.step}`;
}

export function routeCommandId(route: StudioLaneRoute): StudioLaneCommandId {
  return `lane.go.${routeKey(route)}`;
}

const ROUTE_BY_HREF: ReadonlyMap<string, StudioLaneRoute> = new Map(
  STUDIO_LANE_ROUTES.map((route) => [routeHref(route), route]),
);
const ROUTE_BY_COMMAND: ReadonlyMap<string, StudioLaneRoute> = new Map(
  STUDIO_LANE_ROUTES.map((route) => [routeCommandId(route), route]),
);

/** Parse only canonical hashes. Query strings, suffixes and old workspace routes are rejected. */
export function parseStudioRouteHref(value: unknown): StudioLaneRoute | null {
  return typeof value === "string" ? ROUTE_BY_HREF.get(value) ?? null : null;
}

export function isStudioLaneCommandId(value: unknown): value is StudioLaneCommandId {
  return typeof value === "string" && ROUTE_BY_COMMAND.has(value);
}

export function routeFromCommandId(commandId: StudioLaneCommandId): StudioLaneRoute {
  const route = ROUTE_BY_COMMAND.get(commandId);
  if (!route) throw new RangeError(`Unknown lane command: ${String(commandId)}.`);
  return route;
}

export function isStudioTabId(value: unknown): value is StudioTabId {
  return typeof value === "string" && (STUDIO_TAB_IDS as readonly string[]).includes(value);
}

export function isStudioLaneId(value: unknown): value is StudioLaneId {
  return typeof value === "string" && (STUDIO_LANE_IDS as readonly string[]).includes(value);
}

/** First step of a lane, or the Library itself. */
export function getDefaultRoute(tab: StudioTabId): StudioLaneRoute {
  if (tab === "library") return Object.freeze({ tab: "library", step: null });
  return Object.freeze({ tab, step: STUDIO_LANE_STEPS[tab][0] }) as StudioLaneRoute;
}

/** Validate an untrusted tab and optional step into a route. */
export function resolveStudioRoute(tab: unknown, step?: unknown): StudioLaneRoute | null {
  if (!isStudioTabId(tab)) return null;
  if (tab === "library") return step === undefined || step === null ? getDefaultRoute(tab) : null;
  if (step === undefined) return getDefaultRoute(tab);
  const found = ROUTE_BY_HREF.get(`#/studio/${tab}/${String(step)}`);
  return found ?? null;
}

export const STUDIO_FALLBACK_ROUTE: StudioLaneRoute = getDefaultRoute("items");

/**
 * Old workspace editors that a lane step still mounts. A `null` mount means the
 * step has no editor yet and shows the native lane view.
 */
const MOUNT_BY_ROUTE: Readonly<Record<string, StudioWorkspaceId>> = Object.freeze({
  "items.sheet": "compose",
  "grid.source": "slice",
  "grid.separate": "slice",
  "grid.deliver": "export",
  "animation.source": "slice",
  "animation.separate": "animate",
  "animation.collision": "collision",
});

export function getLaneMount(route: StudioLaneRoute): StudioWorkspaceId | null {
  return MOUNT_BY_ROUTE[routeKey(route)] ?? null;
}

const ROUTE_BY_MOUNT: Readonly<Record<StudioWorkspaceId, StudioLaneRoute>> = Object.freeze({
  slice: Object.freeze({ tab: "grid", step: "source" }),
  compose: Object.freeze({ tab: "items", step: "sheet" }),
  animate: Object.freeze({ tab: "animation", step: "separate" }),
  collision: Object.freeze({ tab: "animation", step: "collision" }),
  export: Object.freeze({ tab: "grid", step: "deliver" }),
});

/** Route that shows an old workspace editor. */
export function getRouteForMount(mount: StudioWorkspaceId): StudioLaneRoute {
  return ROUTE_BY_MOUNT[mount];
}
