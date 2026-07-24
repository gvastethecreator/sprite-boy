import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUndo } from "../../hooks/useUndo";
import { projectStateHistoryKey } from "../../utils/hostProjectPolicy";
import { HitboxType, type ProjectState, type SlotData, type BuilderFreeObject } from "../../types";

function base(): ProjectState {
  return {
    imageMeta: null,
    builderCanvas: null,
    frames: [],
    builderSlots: {},
    builderFreeObjects: [],
    animations: [],
    builderAssets: [],
  };
}

const slot = (overrides: Partial<SlotData> = {}): SlotData => ({
  gridIndex: 0,
  assetId: "asset-1",
  fitMode: "fit",
  alignment: "center",
  scaleX: 1,
  scaleY: 1,
  lockAspect: true,
  rotation: 0,
  opacity: 1,
  offsetX: 0,
  offsetY: 0,
  flipX: false,
  flipY: false,
  ...overrides,
});

const freeObject = (overrides: Partial<BuilderFreeObject> = {}): BuilderFreeObject => ({
  id: "free-1",
  assetId: "asset-1",
  x: 0,
  y: 0,
  w: 16,
  h: 16,
  rotation: 0,
  flipX: false,
  flipY: false,
  opacity: 1,
  zIndex: 0,
  ...overrides,
});

describe("useUndo with projectStateHistoryKey", () => {
  it("does not stack history when only data URL payload content would differ by stringify cost", () => {
    const hugeA = "data:image/png;base64," + "A".repeat(50_000);
    const hugeB = "data:image/png;base64," + "B".repeat(50_000);
    const { result } = renderHook(() =>
      useUndo(base(), { historyKey: projectStateHistoryKey }),
    );
    act(() => {
      result.current.set({
        ...base(),
        imageMeta: { src: hugeA, width: 1, height: 1, name: "x", fileSize: 1 },
      });
    });
    expect(result.current.canUndo).toBe(true);
    act(() => {
      result.current.set({
        ...base(),
        imageMeta: { src: hugeB, width: 1, height: 1, name: "x", fileSize: 1 },
      });
    });
    // Different payload fingerprints should still create a step, but keys stay small.
    expect(projectStateHistoryKey(result.current.state).length).toBeLessThan(2000);
    expect(result.current.canUndo).toBe(true);
  });

  it("skips history when historyKey is unchanged", () => {
    const { result } = renderHook(() =>
      useUndo(base(), { historyKey: projectStateHistoryKey }),
    );
    const next = { ...base(), frames: [{ id: 1, x: 0, y: 0, w: 1, h: 1 }] };
    act(() => result.current.set(next));
    act(() => result.current.set({ ...next }));
    expect(result.current.history.past.length).toBe(1);
  });

  it("stacks history for keyframe property edits and reorders (same count)", () => {
    const { result } = renderHook(() =>
      useUndo(base(), { historyKey: projectStateHistoryKey }),
    );
    const withAnim: ProjectState = {
      ...base(),
      animations: [{
        id: "walk",
        name: "walk",
        fps: 12,
        loop: true,
        keyframes: [
          { uid: "k1", sourceIndex: 0, pivotX: 0.5, pivotY: 0.5 },
          { uid: "k2", sourceIndex: 1, pivotX: 0.5, pivotY: 0.5 },
        ],
      }],
    };
    act(() => result.current.set(withAnim));
    // Same-length keyframe edit (sourceIndex) must not be a silent no-op.
    act(() => {
      result.current.set((prev) => ({
        ...prev,
        animations: prev.animations.map((a) =>
          a.id === "walk"
            ? {
                ...a,
                keyframes: a.keyframes.map((k, i) =>
                  i === 0 ? { ...k, sourceIndex: 2, pivotX: 0.25 } : k,
                ),
              }
            : a,
        ),
      }));
    });
    expect(result.current.state.animations[0].keyframes[0].sourceIndex).toBe(2);
    expect(result.current.state.animations[0].keyframes[0].pivotX).toBe(0.25);
    expect(result.current.history.past.length).toBe(2);

    // Reorder keyframes (same set, different order) must stack.
    act(() => {
      result.current.set((prev) => {
        const anim = prev.animations[0];
        return {
          ...prev,
          animations: [{
            ...anim,
            keyframes: [anim.keyframes[1], anim.keyframes[0]],
          }],
        };
      });
    });
    expect(result.current.state.animations[0].keyframes.map((k) => k.uid)).toEqual([
      "k2",
      "k1",
    ]);
    expect(result.current.history.past.length).toBe(3);
  });

  it("stacks history for hitbox geometry/type/tag without length change", () => {
    const { result } = renderHook(() =>
      useUndo(base(), { historyKey: projectStateHistoryKey }),
    );
    const withHitbox: ProjectState = {
      ...base(),
      frames: [{
        id: 1,
        x: 0,
        y: 0,
        w: 32,
        h: 32,
        hitboxes: [{
          id: "hb1",
          x: 0,
          y: 0,
          w: 16,
          h: 16,
          type: HitboxType.HITBOX,
          tag: "body",
        }],
      }],
    };
    act(() => result.current.set(withHitbox));
    act(() => {
      result.current.set((prev) => ({
        ...prev,
        frames: prev.frames.map((f) => ({
          ...f,
          hitboxes: f.hitboxes?.map((h) =>
            h.id === "hb1"
              ? { ...h, x: 4, y: 8, w: 12, h: 10, type: HitboxType.HURTBOX, tag: "head" }
              : h,
          ),
        })),
      }));
    });
    const box = result.current.state.frames[0].hitboxes?.[0];
    expect(box).toMatchObject({
      x: 4,
      y: 8,
      w: 12,
      h: 10,
      type: HitboxType.HURTBOX,
      tag: "head",
    });
    expect(result.current.history.past.length).toBe(2);
  });

  it("stacks history for slot transform and free-object property edits", () => {
    const { result } = renderHook(() =>
      useUndo(base(), { historyKey: projectStateHistoryKey }),
    );
    const initial: ProjectState = {
      ...base(),
      builderSlots: { 0: slot() },
      builderFreeObjects: [freeObject()],
    };
    act(() => result.current.set(initial));
    act(() => {
      result.current.set((prev) => ({
        ...prev,
        builderSlots: {
          0: slot({ scaleX: 2, opacity: 0.5, flipX: true, fitMode: "fill" }),
        },
      }));
    });
    expect(result.current.state.builderSlots[0]).toMatchObject({
      scaleX: 2,
      opacity: 0.5,
      flipX: true,
      fitMode: "fill",
    });
    act(() => {
      result.current.set((prev) => ({
        ...prev,
        builderFreeObjects: [
          freeObject({ rotation: 45, opacity: 0.3, zIndex: 3, flipY: true }),
        ],
      }));
    });
    expect(result.current.state.builderFreeObjects[0]).toMatchObject({
      rotation: 45,
      opacity: 0.3,
      zIndex: 3,
      flipY: true,
    });
    expect(result.current.history.past.length).toBe(3);
  });
});
