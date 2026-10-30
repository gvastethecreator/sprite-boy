import { describe, expect, it } from "vitest";
import {
  STUDIO_COMMAND_IDS,
  STUDIO_FALLBACK_ROUTE,
  STUDIO_LANE_IDS,
  STUDIO_LANE_ROUTES,
  STUDIO_LANE_STEPS,
  STUDIO_TAB_IDS,
  STUDIO_WORKSPACE_IDS,
  deriveInvariants,
  deriveStepStates,
  getDefaultRoute,
  getLaneMount,
  getRouteForMount,
  isStudioLaneCommandId,
  parseStudioRouteHref,
  resolveStudioRoute,
  routeCommandId,
  routeFromCommandId,
  routeHref,
} from "../../core/studio";

describe("lane registry", () => {
  it("orders the four lanes and the Library", () => {
    expect(STUDIO_LANE_IDS).toEqual(["items", "grid", "animation", "tileset"]);
    expect(STUDIO_TAB_IDS).toEqual(["items", "grid", "animation", "tileset", "library"]);
  });

  it("keeps the step order from the skill workflow", () => {
    expect(STUDIO_LANE_STEPS.items).toEqual(["source", "separate", "review", "sheet", "deliver"]);
    expect(STUDIO_LANE_STEPS.grid).toEqual(["source", "separate", "review", "sheet", "deliver"]);
    expect(STUDIO_LANE_STEPS.animation).toEqual([
      "source", "separate", "registration", "timing", "review", "collision", "deliver",
    ]);
    expect(STUDIO_LANE_STEPS.tileset).toEqual(["source", "separate", "tiles", "review", "map", "deliver"]);
  });

  it("publishes one unique href and one unique command for every route", () => {
    const hrefs = STUDIO_LANE_ROUTES.map(routeHref);
    const commands = STUDIO_LANE_ROUTES.map(routeCommandId);
    expect(new Set(hrefs).size).toBe(STUDIO_LANE_ROUTES.length);
    expect(new Set(commands).size).toBe(STUDIO_LANE_ROUTES.length);
    expect(hrefs).toContain("#/studio/items/source");
    expect(hrefs).toContain("#/studio/library");
    for (const route of STUDIO_LANE_ROUTES) {
      expect(parseStudioRouteHref(routeHref(route))).toEqual(route);
      expect(routeFromCommandId(routeCommandId(route))).toEqual(route);
    }
  });

  it("registers exactly one command for every route", () => {
    const laneCommands = STUDIO_COMMAND_IDS.filter(isStudioLaneCommandId);
    expect(laneCommands).toEqual(STUDIO_LANE_ROUTES.map(routeCommandId));
    expect(STUDIO_COMMAND_IDS.some((id) => id.startsWith("workspace.open."))).toBe(false);
  });

  it("rejects old workspace routes, aliases and malformed hashes", () => {
    for (const bad of [
      "#/studio/slice",
      "#/studio/compose",
      "#/studio/export",
      "#/studio/items",
      "#/studio/items/",
      "#/studio/items/source?x=1",
      "#/studio/library/source",
      "#/studio/items/registration",
      "#/studio/tileset/collision",
      "items/source",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(parseStudioRouteHref(bad)).toBeNull();
    }
  });

  it("resolves untrusted tab and step input", () => {
    expect(resolveStudioRoute("items")).toEqual({ tab: "items", step: "source" });
    expect(resolveStudioRoute("animation", "timing")).toEqual({ tab: "animation", step: "timing" });
    expect(resolveStudioRoute("library")).toEqual({ tab: "library", step: null });
    expect(resolveStudioRoute("library", "source")).toBeNull();
    expect(resolveStudioRoute("grid", "map")).toBeNull();
    expect(resolveStudioRoute("slice")).toBeNull();
    expect(resolveStudioRoute(7)).toBeNull();
    expect(resolveStudioRoute("items", 3)).toBeNull();
  });

  it("starts each lane at its Source step and falls back to Items", () => {
    for (const lane of STUDIO_LANE_IDS) expect(getDefaultRoute(lane).step).toBe("source");
    expect(getDefaultRoute("library")).toEqual({ tab: "library", step: null });
    expect(STUDIO_FALLBACK_ROUTE).toEqual({ tab: "items", step: "source" });
  });

  it("keeps routes and registries immutable", () => {
    expect(Object.isFrozen(STUDIO_LANE_ROUTES)).toBe(true);
    expect(Object.isFrozen(STUDIO_LANE_STEPS)).toBe(true);
    for (const route of STUDIO_LANE_ROUTES) expect(Object.isFrozen(route)).toBe(true);
  });

  it("maps temporary mounts to old editors and back", () => {
    expect(getLaneMount({ tab: "items", step: "sheet" })).toBe("compose");
    expect(getLaneMount({ tab: "grid", step: "separate" })).toBe("slice");
    expect(getLaneMount({ tab: "grid", step: "deliver" })).toBe("export");
    expect(getLaneMount({ tab: "animation", step: "separate" })).toBe("animate");
    expect(getLaneMount({ tab: "animation", step: "collision" })).toBe("collision");
    expect(getLaneMount({ tab: "items", step: "source" })).toBeNull();
    expect(getLaneMount({ tab: "library", step: null })).toBeNull();
    for (const mount of STUDIO_WORKSPACE_IDS) {
      expect(getLaneMount(getRouteForMount(mount))).toBe(mount);
    }
  });
});

describe("lane state", () => {
  it("derives every step as empty and every invariant as unknown until a lane reports", () => {
    const states = deriveStepStates("animation");
    expect(Object.keys(states)).toEqual([...STUDIO_LANE_STEPS.animation]);
    expect(Object.values(states).every((state) => state === "empty")).toBe(true);

    const invariants = deriveInvariants("items");
    expect(invariants.map(({ id }) => id)).toEqual([
      "exact-rgba", "exclusive-ownership", "native-scale", "scoped-review", "bounded-pages",
    ]);
    expect(invariants.every(({ state }) => state === "unknown")).toBe(true);
  });

  it("uses lane signals when they exist", () => {
    const states = deriveStepStates("grid", { steps: { source: "ready", review: "invalidated" } });
    expect(states.source).toBe("ready");
    expect(states.review).toBe("invalidated");
    expect(states.separate).toBe("empty");

    const invariants = deriveInvariants("items", {
      invariants: { "native-scale": { state: "pass", reason: "The packer never scales." } },
    });
    expect(invariants.find(({ id }) => id === "native-scale")).toMatchObject({ state: "pass" });
  });
});
