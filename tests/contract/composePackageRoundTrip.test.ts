import { describe, expect, it, vi } from "vitest";
import {
  exportSpriteBoyPackage,
  importSpriteBoyPackage,
} from "../../core/persistence";
import { createEmptyStudioProject, validateStudioProject } from "../../core/project";
import { createProjectStore } from "../../core/stores";
import { openCompositionFromSource } from "../../features/compose/project/compositionEntry";
import { handoffRegionToCompose } from "../../features/slice/handoff/sliceToComposeHandoff";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const NOW = "2026-07-24T15:00:00.000Z";
const HASH = "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8";

describe("A1-04-class first composition package portability", () => {
  it("round-trips a composition created from an asset through SpriteBoy package", async () => {
    const base = createEmptyStudioProject({
      id: "compose-package-project",
      name: "Compose portable",
      now: NOW,
    });
    base.assets["asset-a"] = {
      id: "asset-a",
      name: "sprite.png",
      blobKey: `sha256:${HASH}`,
      contentHash: HASH,
    mimeType: "image/png",
    media: { type: "image" },
      width: 16,
      height: 16,
      byteSize: 5,
      createdAt: NOW,
      updatedAt: NOW,
      provenance: { source: "test" },
    };
    base.rootOrder.assetIds.push("asset-a");

    const store = createProjectStore(base, {
      context: { nextId: () => "unused", now: () => NOW },
    });
    const opened = openCompositionFromSource(store, {
      source: { type: "asset", id: "asset-a" },
      commandId: "cmd-compose-create",
      issuedAt: NOW,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const snap = store.getSnapshot();
    expect(Object.keys(snap.project.compositions).length).toBeGreaterThan(0);
    const compositionId = opened.compositionId;
    expect(snap.project.compositions[compositionId]).toBeDefined();

    const getBlob = vi.fn(async (assetId: string) => {
      if (assetId === "asset-a") return new Blob(["alpha"], { type: "image/png" });
      throw new Error(`missing ${assetId}`);
    });

    const pkgBlob = await exportSpriteBoyPackage(snap.project as ReturnType<typeof createEmptyStudioProject>, {
      getBlob,
    });
    expect(pkgBlob.size).toBeGreaterThan(0);

    const imported = await importSpriteBoyPackage(pkgBlob);
    const validated = validateStudioProject(imported.project);
    expect(validated.valid).toBe(true);
    if (!validated.valid || !validated.project) return;
    const project = validated.project;
    expect(project.compositions[compositionId]).toBeDefined();
    expect(project.assets["asset-a"]).toBeDefined();
    if (opened.layerId) {
      expect(project.layers[opened.layerId]).toBeDefined();
    }
  });
});

describe("Slice→Compose handoff without reimport", () => {
  it("opens an existing region as composition without inventing a new asset", () => {
    const store = createProjectStore(structuredClone(studioProjectV1Fixture), {
      context: { nextId: () => "unused", now: () => NOW },
    });
    const beforeAssets = Object.keys(store.getSnapshot().project.assets).sort();
    const result = handoffRegionToCompose(store, {
      regionId: "region-hero",
      commandId: "cmd-handoff",
      issuedAt: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = store.getSnapshot().project;
    expect(Object.keys(after.assets).sort()).toEqual(beforeAssets);
    expect(after.compositions[result.compositionId]).toBeDefined();
    // Layer source must remain the region, not a new imported asset.
    const layerId = result.layerId;
    if (layerId) {
      const layer = after.layers[layerId];
      expect(layer?.source).toEqual({ type: "region", id: "region-hero" });
    }
  });
});
