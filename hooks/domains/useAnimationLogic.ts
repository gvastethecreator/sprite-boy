import { useState, useEffect } from "react";
import { ProjectState, SpriteAnimation, Keyframe, UserPreferences } from "../../types";
import { uiFeedback } from "../../utils/uiFeedback";

const generateId = () => Math.random().toString(36).substr(2, 9);

/** Animation CRUD, keyframe management, playback control, and step navigation. */
export function useAnimationLogic(
  project: ProjectState,
  setProject: (cb: (prev: ProjectState) => ProjectState) => void,
  preferences: UserPreferences,
) {
  const [activeAnimationId, setActiveAnimationId] = useState<string | null>(null);
  const [playbackFrameIndex, setPlaybackFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying && activeAnimationId) {
      const anim = project.animations.find((a) => a.id === activeAnimationId);
      if (anim && anim.keyframes.length > 0) {
        interval = setInterval(() => {
          setPlaybackFrameIndex((prev) => {
            const next = prev + 1;
            if (next >= anim.keyframes.length) {
              if (anim.loop) return 0;
              setIsPlaying(false);
              return prev;
            }
            return next;
          });
        }, 1000 / anim.fps);
      }
    }
    return () => clearInterval(interval);
  }, [isPlaying, activeAnimationId, project.animations]);

  const handleAddAnimation = () => {
    const id = generateId();
    const newAnim: SpriteAnimation = {
      id,
      name: `Anim ${project.animations.length + 1}`,
      fps: preferences.defaultFps,
      loop: true,
      keyframes: [],
    };
    setProject((prev) => ({ ...prev, animations: [...prev.animations, newAnim] }));
    setActiveAnimationId(id);
  };

  const handleUpdateAnimation = (id: string, data: Partial<SpriteAnimation>) => {
    setProject((prev) => ({
      ...prev,
      animations: prev.animations.map((a) => (a.id === id ? { ...a, ...data } : a)),
    }));
  };

  const handleDeleteAnimation = (id: string) => {
    setProject((prev) => ({
      ...prev,
      animations: prev.animations.filter((a) => a.id !== id),
    }));
    if (activeAnimationId === id) setActiveAnimationId(null);
    if (preferences.soundEnabled) uiFeedback.play("delete");
  };

  const handleDuplicateAnimation = (id: string) => {
    const anim = project.animations.find((a) => a.id === id);
    if (anim) {
      const newAnim = { ...anim, id: generateId(), name: `${anim.name} (Copy)` };
      setProject((prev) => ({ ...prev, animations: [...prev.animations, newAnim] }));
    }
  };

  const handleAddKeyframe = (sourceIndex: number) => {
    if (!activeAnimationId) return;
    setProject((prev) => ({
      ...prev,
      animations: prev.animations.map((a) => {
        if (a.id !== activeAnimationId) return a;
        return {
          ...a,
          keyframes: [
            ...a.keyframes,
            {
              uid: generateId(),
              sourceIndex,
              pivotX: 0.5,
              pivotY: 0.5,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              opacity: 1,
            },
          ],
        };
      }),
    }));
    if (preferences.soundEnabled) uiFeedback.play("pop");
  };

  const handleDeleteKeyframe = (index: number) => {
    if (!activeAnimationId) return;
    setProject((prev) => ({
      ...prev,
      animations: prev.animations.map((a) => {
        if (a.id !== activeAnimationId) return a;
        const newKfs = [...a.keyframes];
        newKfs.splice(index, 1);
        return { ...a, keyframes: newKfs };
      }),
    }));
    if (preferences.soundEnabled) uiFeedback.play("delete");
  };

  const handleUpdateKeyframe = (index: number, data: Partial<Keyframe>) => {
    if (!activeAnimationId) return;
    setProject((prev) => ({
      ...prev,
      animations: prev.animations.map((a) => {
        if (a.id !== activeAnimationId) return a;
        const newKfs = [...a.keyframes];
        if (newKfs[index]) newKfs[index] = { ...newKfs[index], ...data };
        return { ...a, keyframes: newKfs };
      }),
    }));
  };

  const handleDuplicateKeyframe = (index: number) => {
    if (!activeAnimationId) return;
    setProject((prev) => ({
      ...prev,
      animations: prev.animations.map((a) => {
        if (a.id !== activeAnimationId) return a;
        const kf = a.keyframes[index];
        if (!kf) return a;
        const newKfs = [...a.keyframes];
        newKfs.splice(index + 1, 0, { ...kf, uid: generateId() });
        return { ...a, keyframes: newKfs };
      }),
    }));
    if (preferences.soundEnabled) uiFeedback.play("pop");
  };

  const handleReorderFrames = (frames: Keyframe[]) => {
    if (!activeAnimationId) return;
    setProject((prev) => ({
      ...prev,
      animations: prev.animations.map((a) =>
        a.id === activeAnimationId ? { ...a, keyframes: frames } : a,
      ),
    }));
  };

  const handleStepFrame = (dir: number) => {
    if (!activeAnimationId) return;
    const anim = project.animations.find((a) => a.id === activeAnimationId);
    if (!anim) return;
    setPlaybackFrameIndex((prev) => {
      let next = prev + dir;
      if (next < 0) next = anim.keyframes.length - 1;
      if (next >= anim.keyframes.length) next = 0;
      return next;
    });
  };

  return {
    activeAnimationId,
    setActiveAnimationId,
    playbackFrameIndex,
    setPlaybackFrameIndex,
    isPlaying,
    setIsPlaying,
    handleAddAnimation,
    handleUpdateAnimation,
    handleDeleteAnimation,
    handleDuplicateAnimation,
    handleAddKeyframe,
    handleDeleteKeyframe,
    handleDuplicateKeyframe,
    handleUpdateKeyframe,
    handleReorderFrames,
    handleStepFrame,
  };
}
