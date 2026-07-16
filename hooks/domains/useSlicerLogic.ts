import { useState } from "react";
import { ProjectState, FrameData, UserPreferences } from "../../types";
import { detectSprites, removeBackground } from "../../utils/algorithms";
import { uiFeedback } from "../../utils/uiFeedback";

/** Slicer mode: auto-detect sprites, manage frames, background removal. */
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

  const handleRemoveBackground = async (
    color: string,
    tolerance: number,
    softness: number,
    options: { readonly signal?: AbortSignal } = {},
  ) => {
    const signal = options.signal;
    if (!project.imageMeta || signal?.aborted) return;
    setIsLoading(true);
    setLoadingMessage("Removing background...");
    try {
      const blob = await removeBackground(project.imageMeta.src, color, tolerance, softness);
      if (blob && !signal?.aborted) {
        const reader = new FileReader();
        await new Promise<void>((resolve, reject) => {
          const finish = (): void => {
            signal?.removeEventListener("abort", onAbort);
            reader.onloadend = null;
            reader.onerror = null;
            reader.onabort = null;
          };
          const onAbort = (): void => {
            try { reader.abort(); } catch {}
            finish();
            resolve();
          };
          reader.onloadend = () => {
            const base64data = reader.result;
            finish();
            if (!signal?.aborted && typeof base64data === "string") {
              setProject((prev) => ({
                ...prev,
                imageMeta: prev.imageMeta ? { ...prev.imageMeta, src: base64data } : null,
              }));
              showToast("Background removed successfully", "success");
            }
            resolve();
          };
          reader.onerror = () => {
            const error = reader.error ?? new Error("Background reader failed.");
            finish();
            reject(error);
          };
          reader.onabort = () => {
            finish();
            resolve();
          };
          signal?.addEventListener("abort", onAbort, { once: true });
          if (signal?.aborted) onAbort();
          else reader.readAsDataURL(blob);
        });
      }
    } catch {
      if (!signal?.aborted) showToast("Failed to remove background", "error");
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
        setLoadingMessage("");
      }
    }
  };

  const handlePreviewBackground = async (
    color: string,
    tolerance: number,
    softness: number,
    setPreviewUrl: (url: string | null) => void,
    options: { readonly signal?: AbortSignal } = {},
  ) => {
    const signal = options.signal;
    if (!project.imageMeta || signal?.aborted) return;
    try {
      const blob = await removeBackground(project.imageMeta.src, color, tolerance, softness);
      if (blob && !signal?.aborted) {
        const url = URL.createObjectURL(blob);
        if (signal?.aborted) URL.revokeObjectURL(url);
        else setPreviewUrl(url);
      }
    } catch {
      // Preview failures are intentionally silent and never expose provider payloads.
    }
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
    handleRemoveBackground,
    handlePreviewBackground,
    handleMagicWandSelect,
  };
}
