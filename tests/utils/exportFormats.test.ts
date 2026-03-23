import { describe, it, expect } from "vitest";
import {
  generateGenericJSON,
  generatePhaser3,
  generateGodotSpriteFrames,
} from "../../utils/exportFormats";
import type { SpriteAnimation, FrameData, Keyframe } from "../../types/core";

const mockGeometry = {
  rows: 4,
  cols: 4,
  marginX: 0,
  marginY: 0,
  paddingX: 0,
  paddingY: 0,
  cellW: 64,
  cellH: 64,
};

const mockFrames: FrameData[] = [
  { id: 0, x: 0, y: 0, w: 64, h: 64 },
  { id: 1, x: 64, y: 0, w: 64, h: 64 },
  { id: 2, x: 128, y: 0, w: 64, h: 64 },
];

const mockKeyframes: Keyframe[] = [
  { uid: "k1", sourceIndex: 0, pivotX: 0.5, pivotY: 1.0 },
  { uid: "k2", sourceIndex: 1, pivotX: 0.5, pivotY: 1.0 },
  { uid: "k3", sourceIndex: 2, pivotX: 0.5, pivotY: 1.0 },
];

const mockAnim: SpriteAnimation = {
  id: "anim1",
  name: "walk",
  fps: 12,
  loop: true,
  keyframes: mockKeyframes,
};

describe("generateGenericJSON", () => {
  it("produces valid JSON with correct structure", () => {
    const json = generateGenericJSON(mockAnim, mockFrames, mockGeometry, 1);
    const parsed = JSON.parse(json);

    expect(parsed.meta.app).toBe("SpriteSlice Studio");
    expect(parsed.animation.name).toBe("walk");
    expect(parsed.animation.framerate).toBe(12);
    expect(parsed.animation.loop).toBe(true);
    expect(parsed.animation.frames).toHaveLength(3);
  });

  it("includes frame coordinates from source frames", () => {
    const json = generateGenericJSON(mockAnim, mockFrames, mockGeometry, 1);
    const parsed = JSON.parse(json);

    expect(parsed.animation.frames[0].x).toBe(0);
    expect(parsed.animation.frames[1].x).toBe(64);
  });

  it("includes pivot data", () => {
    const json = generateGenericJSON(mockAnim, mockFrames, mockGeometry, 1);
    const parsed = JSON.parse(json);

    expect(parsed.animation.frames[0].pivot).toEqual({ x: 0.5, y: 1.0 });
  });

  it("includes collision data when hitboxes present", () => {
    const framesWithHitbox: FrameData[] = [
      {
        id: 0,
        x: 0,
        y: 0,
        w: 64,
        h: 64,
        hitboxes: [{ id: "hb1", x: 10, y: 10, w: 44, h: 44, type: "hurt" as any, tag: "body" }],
      },
    ];
    const anim: SpriteAnimation = {
      ...mockAnim,
      keyframes: [mockKeyframes[0]],
    };
    const json = generateGenericJSON(anim, framesWithHitbox, mockGeometry, 1);
    const parsed = JSON.parse(json);

    expect(parsed.animation.frames[0].collision).toBeDefined();
    expect(parsed.animation.frames[0].collision[0].label).toBe("body");
  });
});

describe("generatePhaser3", () => {
  it("produces Phaser 3 animation config string", () => {
    const result = generatePhaser3(mockAnim, mockFrames, mockGeometry);
    expect(result).toContain("this.anims.create");
    expect(result).toContain('"walk"');
  });
});

describe("generateGodotSpriteFrames", () => {
  it("produces valid Godot JSON with SpriteFrames resource type", () => {
    const json = generateGodotSpriteFrames(
      mockAnim,
      mockFrames,
      mockGeometry,
      256,
      256,
    );
    const parsed = JSON.parse(json);

    expect(parsed.resource_type).toBe("SpriteFrames");
    expect(parsed.anim_name).toBe("walk");
    expect(parsed.fps).toBe(12);
    expect(parsed.frames).toHaveLength(3);
    expect(parsed.texture_size).toEqual({ w: 256, h: 256 });
  });

  it("calculates correct offsets from pivot", () => {
    const json = generateGodotSpriteFrames(
      mockAnim,
      mockFrames,
      mockGeometry,
      256,
      256,
    );
    const parsed = JSON.parse(json);
    // pivot(0.5, 1.0) → offset = (64*(0.5-0.5), 64*(1.0-0.5)) = (0, 32)
    expect(parsed.frames[0].offset.x).toBe(0);
    expect(parsed.frames[0].offset.y).toBe(32);
  });
});
