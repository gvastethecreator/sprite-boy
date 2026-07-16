import { describe, expect, it, vi } from "vitest";

import {
  replaceSliceSourceProjectState,
  resetSliceSourceProjectState,
  revokeSliceOwnedRuntimeUrls,
  runSliceTerminalEffects,
} from "../../hooks/useProjectController";
import type { ProjectState } from "../../types";

describe("Slice source reset project boundary (G0-04)", () => {
  it("clears the source-derived graph while preserving unrelated assets and canvas preference", () => {
    const asset = { id: "asset-1", src: "blob:asset", name: "kept.png", width: 8, height: 8 };
    const project: ProjectState = {
      imageMeta: { src: "blob:source", width: 32, height: 16, name: "sheet.png", fileSize: 42 },
      builderCanvas: { width: 32, height: 16 },
      frames: [{ id: 1, x: 0, y: 0, w: 16, h: 16 }],
      builderSlots: { 0: { gridIndex: 0, assetId: "asset-1" } as never },
      builderFreeObjects: [{ id: "object-1", assetId: "asset-1" } as never],
      animations: [{ id: "walk", name: "Walk", fps: 12, loop: true, keyframes: [] }],
      builderAssets: [asset],
      aspectRatio: "16:9",
    };

    const reset = resetSliceSourceProjectState(project);
    expect(reset).toMatchObject({
      imageMeta: null,
      builderCanvas: null,
      frames: [],
      builderSlots: {},
      builderFreeObjects: [],
      animations: [],
      aspectRatio: "16:9",
    });
    expect(reset.builderAssets).toBe(project.builderAssets);
    expect(project.imageMeta?.name).toBe("sheet.png");
  });

  it("installs a replacement through the same clean source-derived boundary", () => {
    const asset = { id: "asset-1", src: "blob:asset-kept", name: "kept.png", width: 8, height: 8 };
    const previous: ProjectState = {
      imageMeta: { src: "blob:old-source", width: 32, height: 16, name: "old.png", fileSize: 42 },
      builderCanvas: { width: 32, height: 16 },
      frames: [{ id: 1, x: 0, y: 0, w: 16, h: 16 }],
      builderSlots: { 0: { gridIndex: 0, assetId: "asset-1" } as never },
      builderFreeObjects: [{ id: "object-1", assetId: "asset-1" } as never],
      animations: [{ id: "walk", name: "Walk", fps: 12, loop: true, keyframes: [] }],
      builderAssets: [asset],
      aspectRatio: "16:9",
    };
    const replacement = replaceSliceSourceProjectState(previous, {
      imageMeta: { src: "data:image/png;base64,new", width: 48, height: 24, name: "new.png", fileSize: 84 },
      builderCanvas: { width: 48, height: 24 },
      frames: [{ id: 0, x: 0, y: 0, w: 24, h: 12 }],
    });

    expect(replacement).toMatchObject({
      imageMeta: { name: "new.png", width: 48, height: 24 },
      builderCanvas: { width: 48, height: 24 },
      builderSlots: {},
      builderFreeObjects: [],
      animations: [],
      aspectRatio: "16:9",
    });
    expect(replacement.frames).toHaveLength(1);
    expect(replacement.builderAssets).toBe(previous.builderAssets);
  });

  it("revokes only the two owned runtime URL roles, deduplicated exactly once", () => {
    const revokeObjectURL = vi.fn();
    const released = revokeSliceOwnedRuntimeUrls({
      source: "blob:shared-source-preview",
      backgroundPreview: "blob:shared-source-preview",
    }, { revokeObjectURL });

    expect(released).toBe(1);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:shared-source-preview");
    expect(revokeObjectURL).not.toHaveBeenCalledWith("blob:asset-kept");
    expect(revokeSliceOwnedRuntimeUrls({
      source: "data:image/png;base64,kept",
      backgroundPreview: null,
    }, { revokeObjectURL })).toBe(0);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("contains a hostile revoke host without retrying or losing terminal ownership", () => {
    const revokeObjectURL = vi.fn(() => { throw new Error("revoked host object"); });
    expect(() => revokeSliceOwnedRuntimeUrls({
      source: "blob:old-source",
      backgroundPreview: "blob:old-background-preview",
    }, { revokeObjectURL })).not.toThrow();
    expect(revokeObjectURL.mock.calls).toEqual([
      ["blob:old-source"],
      ["blob:old-background-preview"],
    ]);
  });

  it("protects preserved asset aliases for both source and BG preview roles", () => {
    const revokeObjectURL = vi.fn();
    const released = revokeSliceOwnedRuntimeUrls({
      source: "blob:asset-source-alias",
      backgroundPreview: "blob:asset-bg-alias",
      protectedAssetUrls: ["blob:asset-source-alias", "blob:asset-bg-alias"],
    }, { revokeObjectURL });

    expect(released).toBe(0);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("runs every terminal effect once even when earlier setters throw", () => {
    const calls: string[] = [];
    expect(() => runSliceTerminalEffects([
      () => { calls.push("selection"); throw new Error("setter failed"); },
      () => { calls.push("playback"); },
      () => { calls.push("cleanup"); throw new Error("cleanup failed"); },
      () => { calls.push("resolve"); },
    ])).not.toThrow();
    expect(calls).toEqual(["selection", "playback", "cleanup", "resolve"]);
  });
});
