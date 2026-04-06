import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAnimationLogic } from "../../hooks/domains/useAnimationLogic";
import { ProjectState, UserPreferences, DEFAULT_PREFERENCES } from "../../types";

// Mock uiFeedback to avoid DOM audio calls
vi.mock("../../utils/uiFeedback", () => ({
  uiFeedback: { play: vi.fn() },
}));

const makeProject = (overrides?: Partial<ProjectState>): ProjectState => ({
  imageMeta: null,
  builderCanvas: null,
  frames: [],
  builderSlots: {},
  builderFreeObjects: [],
  animations: [],
  builderAssets: [],
  aspectRatio: "1:1",
  ...overrides,
});

describe("useAnimationLogic", () => {
  let project: ProjectState;
  let setProject: (cb: (prev: ProjectState) => ProjectState) => void;
  let prefs: UserPreferences;

  beforeEach(() => {
    project = makeProject();
    setProject = vi.fn((cb: (prev: ProjectState) => ProjectState) => {
      project = cb(project);
    });
    prefs = { ...DEFAULT_PREFERENCES, soundEnabled: false };
  });

  const hook = () => renderHook(() => useAnimationLogic(project, setProject, prefs));

  it("starts with no active animation", () => {
    const { result } = hook();
    expect(result.current.activeAnimationId).toBeNull();
    expect(result.current.isPlaying).toBe(false);
  });

  it("handleAddAnimation creates a new animation and activates it", () => {
    const { result } = hook();
    act(() => result.current.handleAddAnimation());
    expect(setProject).toHaveBeenCalled();
    expect(project.animations).toHaveLength(1);
    expect(project.animations[0].name).toBe("Anim 1");
    expect(project.animations[0].loop).toBe(true);
    expect(project.animations[0].fps).toBe(prefs.defaultFps);
    expect(result.current.activeAnimationId).toBe(project.animations[0].id);
  });

  it("handleUpdateAnimation patches animation data", () => {
    // Seed an animation
    project = makeProject({
      animations: [{ id: "a1", name: "Walk", fps: 12, loop: true, keyframes: [] }],
    });
    const { result } = hook();
    act(() => result.current.handleUpdateAnimation("a1", { name: "Run", fps: 24 }));
    expect(project.animations[0].name).toBe("Run");
    expect(project.animations[0].fps).toBe(24);
  });

  it("handleDeleteAnimation removes from list", () => {
    project = makeProject({
      animations: [
        { id: "a1", name: "Walk", fps: 12, loop: true, keyframes: [] },
        { id: "a2", name: "Jump", fps: 8, loop: false, keyframes: [] },
      ],
    });
    const { result } = hook();
    act(() => result.current.setActiveAnimationId("a1"));
    act(() => result.current.handleDeleteAnimation("a1"));
    expect(project.animations).toHaveLength(1);
    expect(project.animations[0].id).toBe("a2");
    expect(result.current.activeAnimationId).toBeNull();
  });

  it("handleDuplicateAnimation copies animation with new id", () => {
    project = makeProject({
      animations: [
        {
          id: "a1",
          name: "Idle",
          fps: 10,
          loop: true,
          keyframes: [
            {
              uid: "k1",
              sourceIndex: 0,
              pivotX: 0.5,
              pivotY: 0.5,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              opacity: 1,
            },
          ],
        },
      ],
    });
    const { result } = hook();
    act(() => result.current.handleDuplicateAnimation("a1"));
    expect(project.animations).toHaveLength(2);
    expect(project.animations[1].name).toBe("Idle (Copy)");
    expect(project.animations[1].id).not.toBe("a1");
    expect(project.animations[1].keyframes).toHaveLength(1);
  });

  it("handleAddKeyframe adds keyframe to active animation", () => {
    project = makeProject({
      animations: [{ id: "a1", name: "Walk", fps: 12, loop: true, keyframes: [] }],
    });
    const { result } = hook();
    act(() => result.current.setActiveAnimationId("a1"));
    act(() => result.current.handleAddKeyframe(5));
    expect(project.animations[0].keyframes).toHaveLength(1);
    expect(project.animations[0].keyframes[0].sourceIndex).toBe(5);
    expect(project.animations[0].keyframes[0].pivotX).toBe(0.5);
  });

  it("handleAddKeyframe does nothing without active animation", () => {
    const { result } = hook();
    act(() => result.current.handleAddKeyframe(0));
    expect(setProject).not.toHaveBeenCalled();
  });

  it("handleDeleteKeyframe removes keyframe at index", () => {
    project = makeProject({
      animations: [
        {
          id: "a1",
          name: "Walk",
          fps: 12,
          loop: true,
          keyframes: [
            {
              uid: "k1",
              sourceIndex: 0,
              pivotX: 0.5,
              pivotY: 0.5,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              opacity: 1,
            },
            {
              uid: "k2",
              sourceIndex: 1,
              pivotX: 0.5,
              pivotY: 0.5,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              opacity: 1,
            },
          ],
        },
      ],
    });
    const { result } = hook();
    act(() => result.current.setActiveAnimationId("a1"));
    act(() => result.current.handleDeleteKeyframe(0));
    expect(project.animations[0].keyframes).toHaveLength(1);
    expect(project.animations[0].keyframes[0].uid).toBe("k2");
  });

  it("handleDuplicateKeyframe inserts copy at index+1", () => {
    project = makeProject({
      animations: [
        {
          id: "a1",
          name: "Walk",
          fps: 12,
          loop: true,
          keyframes: [
            {
              uid: "k1",
              sourceIndex: 0,
              pivotX: 0.5,
              pivotY: 0.5,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              opacity: 1,
            },
          ],
        },
      ],
    });
    const { result } = hook();
    act(() => result.current.setActiveAnimationId("a1"));
    act(() => result.current.handleDuplicateKeyframe(0));
    expect(project.animations[0].keyframes).toHaveLength(2);
    expect(project.animations[0].keyframes[1].sourceIndex).toBe(0);
    expect(project.animations[0].keyframes[1].uid).not.toBe("k1");
  });

  it("handleUpdateKeyframe patches keyframe at index", () => {
    project = makeProject({
      animations: [
        {
          id: "a1",
          name: "Walk",
          fps: 12,
          loop: true,
          keyframes: [
            {
              uid: "k1",
              sourceIndex: 0,
              pivotX: 0.5,
              pivotY: 0.5,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              opacity: 1,
            },
          ],
        },
      ],
    });
    const { result } = hook();
    act(() => result.current.setActiveAnimationId("a1"));
    act(() => result.current.handleUpdateKeyframe(0, { rotation: 90, opacity: 0.5 }));
    expect(project.animations[0].keyframes[0].rotation).toBe(90);
    expect(project.animations[0].keyframes[0].opacity).toBe(0.5);
  });

  it("handleReorderFrames replaces keyframes for active animation", () => {
    const kf1 = {
      uid: "k1",
      sourceIndex: 0,
      pivotX: 0.5,
      pivotY: 0.5,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
    };
    const kf2 = {
      uid: "k2",
      sourceIndex: 1,
      pivotX: 0.5,
      pivotY: 0.5,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
    };
    project = makeProject({
      animations: [{ id: "a1", name: "Walk", fps: 12, loop: true, keyframes: [kf1, kf2] }],
    });
    const { result } = hook();
    act(() => result.current.setActiveAnimationId("a1"));
    act(() => result.current.handleReorderFrames([kf2, kf1]));
    expect(project.animations[0].keyframes[0].uid).toBe("k2");
    expect(project.animations[0].keyframes[1].uid).toBe("k1");
  });

  it("handleStepFrame cycles through keyframes", () => {
    project = makeProject({
      animations: [
        {
          id: "a1",
          name: "Walk",
          fps: 12,
          loop: true,
          keyframes: [
            {
              uid: "k1",
              sourceIndex: 0,
              pivotX: 0.5,
              pivotY: 0.5,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              opacity: 1,
            },
            {
              uid: "k2",
              sourceIndex: 1,
              pivotX: 0.5,
              pivotY: 0.5,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              opacity: 1,
            },
            {
              uid: "k3",
              sourceIndex: 2,
              pivotX: 0.5,
              pivotY: 0.5,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              opacity: 1,
            },
          ],
        },
      ],
    });
    const { result } = hook();
    act(() => result.current.setActiveAnimationId("a1"));
    act(() => result.current.handleStepFrame(1));
    expect(result.current.playbackFrameIndex).toBe(1);
    act(() => result.current.handleStepFrame(1));
    expect(result.current.playbackFrameIndex).toBe(2);
    // Wrap around forward
    act(() => result.current.handleStepFrame(1));
    expect(result.current.playbackFrameIndex).toBe(0);
    // Wrap around backward
    act(() => result.current.handleStepFrame(-1));
    expect(result.current.playbackFrameIndex).toBe(2);
  });
});
