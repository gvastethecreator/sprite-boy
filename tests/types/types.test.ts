import { describe, it, expect } from "vitest";
import type { GridConfig } from "../../types/config";
import type { FrameData, SpriteAnimation, Keyframe, ProjectState } from "../../types/core";
import { AppMode, HitboxType } from "../../types/enums";

describe("Type definitions", () => {
  it("GridConfig has correct shape", () => {
    const grid: GridConfig = {
      rows: 4,
      cols: 4,
      marginX: 0,
      marginY: 0,
      paddingX: 2,
      paddingY: 2,
    };
    expect(grid.rows).toBe(4);
    expect(grid.paddingX).toBe(2);
  });

  it("FrameData supports optional hitboxes", () => {
    const frame: FrameData = { id: 0, x: 0, y: 0, w: 64, h: 64 };
    expect(frame.hitboxes).toBeUndefined();

    const frameWithHitbox: FrameData = {
      id: 1,
      x: 0,
      y: 0,
      w: 64,
      h: 64,
      hitboxes: [{ id: "hb1", x: 5, y: 5, w: 54, h: 54, type: HitboxType.HURTBOX, tag: "body" }],
    };
    expect(frameWithHitbox.hitboxes).toHaveLength(1);
  });

  it("AppMode enum values are correct", () => {
    expect(AppMode.BUILDER).toBeDefined();
    expect(AppMode.ANIMATION).toBeDefined();
  });

  it("Keyframe supports optional transform properties", () => {
    const kf: Keyframe = {
      uid: "k1",
      sourceIndex: 0,
      pivotX: 0.5,
      pivotY: 0.5,
    };
    expect(kf.rotation).toBeUndefined();
    expect(kf.scaleX).toBeUndefined();

    const kfFull: Keyframe = {
      uid: "k2",
      sourceIndex: 1,
      pivotX: 0.5,
      pivotY: 1.0,
      rotation: 45,
      scaleX: 2,
      scaleY: 2,
      opacity: 0.8,
    };
    expect(kfFull.rotation).toBe(45);
    expect(kfFull.opacity).toBe(0.8);
  });

  it("SpriteAnimation has required fields", () => {
    const anim: SpriteAnimation = {
      id: "a1",
      name: "idle",
      fps: 8,
      loop: true,
      keyframes: [],
    };
    expect(anim.fps).toBe(8);
    expect(anim.keyframes).toHaveLength(0);
  });
});
