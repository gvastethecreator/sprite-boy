import { useState } from "react";
import { ProjectState, FrameData, UserPreferences } from "../../types";
import { detectSprites } from "../../utils/algorithms";
import { uiFeedback } from "../../utils/uiFeedback";

/** Legacy slicer mode: auto-detect sprites and manage frames. */
export function useSlicerLogic(
  project: ProjectState,
  setProject: (cb: (prev: ProjectState) => ProjectState) => void,
  setProjectEphemeral: (cb: (prev: ProjectState) => ProjectState) => void,
  preferences: UserPreferences,
  showToast: (msg: string, type?: "success" | "error" | "info") => void,
  setIsLoading: (loading: boolean) => void,
  setLoadingMessage: (msg: string) => void,
) {
  const [wandTolerance, setWandTolerance] = useState(30);

  const handleAutoSlice = async () => {
    if (!project.imageMeta) return;
    setIsLoading(true);
    setLoadingMessage("Analyzing pixels...");
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = project.imageMeta.src;
      await new Promise((r) => (img.onload = r));

      setLoadingMessage("Generating bounds...");
      const frames = await detectSprites(img);
      setProject((prev) => ({ ...prev, frames }));
      showToast(`Detected ${frames.length} sprites`, "success");
    } catch {
      showToast("Slice failed", "error");
    } finally {
      setIsLoading(false);
      setLoadingMessage("");
    }
  };

  const handleUpdateFrame = (id: number, data: Partial<FrameData>) => {
    setProject((prev) => ({
      ...prev,
      frames: prev.frames.map((f) => (f.id === id ? { ...f, ...data } : f)),
    }));
  };

  const handleUpdateFrameEphemeral = (id: number, data: Partial<FrameData>) => {
    setProjectEphemeral((prev) => ({
      ...prev,
      frames: prev.frames.map((f) => (f.id === id ? { ...f, ...data } : f)),
    }));
  };

  const handleAddFrame = (frame: FrameData) => {
    setProject((prev) => ({
      ...prev,
      frames: [...prev.frames, frame],
    }));
    if (preferences.soundEnabled) uiFeedback.play("pop");
  };

  const handleDuplicateFrame = (id: number, onSelect: (idx: number) => void) => {
    const frameIndex = project.frames.findIndex((f) => f.id === id);
    if (frameIndex === -1) return;

    const frame = project.frames[frameIndex];
    const maxId = project.frames.length > 0 ? Math.max(...project.frames.map((f) => f.id)) : 0;
    const newFrameId = maxId + 1;

    const newFrame = {
      ...frame,
      id: newFrameId,
      x: frame.x + 10,
      y: frame.y + 10,
    };

    setProject((prev) => ({ ...prev, frames: [...prev.frames, newFrame] }));

    setTimeout(() => {
      onSelect(project.frames.length);
      showToast(`Frame #${id} duplicated`, "success");
      if (preferences.soundEnabled) uiFeedback.play("pop");
    }, 0);
  };

  const handleMagicWandSelect = (rect: { x: number; y: number; w: number; h: number }) => {
    const maxId = project.frames.length > 0 ? Math.max(...project.frames.map((f) => f.id)) : -1;
    handleAddFrame({ id: maxId + 1, ...rect });
  };

  return {
    wandTolerance,
    setWandTolerance,
    handleAutoSlice,
    handleUpdateFrame,
    handleUpdateFrameEphemeral,
    handleAddFrame,
    handleDuplicateFrame,
    handleMagicWandSelect,
  };
}
