import { describe, expect, it } from "vitest";
import { createProjectStore } from "../../core/stores";
import { DUAL_ENGINE_FREEZE_ACTIVE } from "../../core/studio";
import {
  addDefaultHitbox,
  ensureRegionCollisionSet,
  listCollisionSets,
} from "../../features/collision";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const NOW = "2026-07-24T12:00:00.000Z";

describe("canonical Collision workspace surface", () => {
  it("creates a collision set and hitbox on a region via ProjectStore only", () => {
    const store = createProjectStore(structuredClone(studioProjectV1Fixture), {
      context: {
        nextId: () => "gen-id",
        now: () => NOW,
      },
    });
    const ensure = ensureRegionCollisionSet(store, "region-hero", {
      collisionSetId: "collision-set-region-hero",
      commandId: "cmd-ensure",
      issuedAt: NOW,
    });
    expect(ensure.ok).toBe(true);
    if (!ensure.ok) return;
    const setId = ensure.collisionSetId;
    const beforeShapes = store.getSnapshot().project.collisionSets[setId]?.shapes.length ?? 0;
    const add = addDefaultHitbox(
      store,
      setId,
      "shape-new-host-safety",
      { x: 0, y: 0, width: 32, height: 32 },
      { commandId: "cmd-add", issuedAt: NOW },
    );
    expect(add.ok).toBe(true);
    const sets = listCollisionSets(store.getSnapshot().project);
    const target = sets.find((s) => s.id === setId);
    expect(target?.shapes.length).toBe(beforeShapes + 1);
    expect(target?.shapes.some((s) => s.id === "shape-new-host-safety" && s.type === "hitbox")).toBe(true);
  });

  it("keeps dual-engine freeze active", () => {
    expect(DUAL_ENGINE_FREEZE_ACTIVE).toBe(true);
  });
});
