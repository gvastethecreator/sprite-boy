import {
  ProjectState,
  SlotData,
  BuilderCanvasSize,
  UserPreferences,
  AIModelId,
  AIGenerationMode,
  BuilderAsset,
} from "../../types";
import { cropImage } from "../../utils/algorithms";
import { uiFeedback } from "../../utils/uiFeedback";
import { generateSprite } from "../../utils/aiService";
import { addAsset, deleteAsset, dataURIToBlob } from "../../utils/db";

const generateId = () => Math.random().toString(36).substr(2, 9);

/** Preset canvas ratios mapping name → pixel dimensions. */
export const RATIO_PRESETS: Record<string, { w: number; h: number }> = {
  "1:1": { w: 1024, h: 1024 },
  "3:2": { w: 1264, h: 848 },
  "3:4": { w: 896, h: 1200 },
  "4:3": { w: 1200, h: 896 },
  "4:5": { w: 928, h: 1152 },
  "5:4": { w: 1152, h: 928 },
  "9:16": { w: 768, h: 1376 },
  "16:9": { w: 1376, h: 768 },
  "21:9": { w: 1584, h: 672 },
  "2:3": { w: 848, h: 1264 },
};

/** Creates default slot data for a builder grid cell. */
export const DEFAULT_SLOT_DATA = (idx: number, assetId: string): SlotData => ({
  gridIndex: idx,
  assetId,
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
});

/** Builder mode: canvas CRUD, slot management, asset library, AI generation. */
export function useBuilderLogic(
  project: ProjectState,
  setProject: (cb: (prev: ProjectState) => ProjectState) => void,
  setProjectEphemeral: (cb: (prev: ProjectState) => ProjectState) => void,
  preferences: UserPreferences,
  showToast: (msg: string, type?: "success" | "error" | "info") => void,
  setIsLoading: (loading: boolean) => void,
  setLoadingMessage: (msg: string) => void,
) {
  const handleAddAsset = async (file: File) => {
    try {
      const newId = generateId();
      const tempAsset: BuilderAsset = {
        id: newId,
        src: URL.createObjectURL(file),
        name: file.name,
        width: 100,
        height: 100,
      };

      await addAsset({ name: file.name, width: 100, height: 100 }, newId, file);

      setProject((prev) => ({
        ...prev,
        builderAssets: [...prev.builderAssets, tempAsset],
      }));
    } catch (error) {
      console.error("Failed to add asset", error);
      showToast("Error saving asset to library.", "error");
    }
  };

  const handleDeleteAsset = async (id: string) => {
    const assetToDelete = project.builderAssets.find((a) => a.id === id);
    if (assetToDelete) {
      try {
        await deleteAsset(id);
        setProject((prev) => ({
          ...prev,
          builderAssets: prev.builderAssets.filter((a) => a.id !== id),
        }));
        if (assetToDelete.src.startsWith("blob:")) {
          URL.revokeObjectURL(assetToDelete.src);
        }
      } catch (error) {
        console.error("Failed to delete asset", error);
        showToast("Error deleting asset from library.", "error");
      }
    }
  };

  const handleUpdateSlot = (idx: number, data: SlotData | null) => {
    setProject((prev) => {
      const slots = { ...prev.builderSlots };
      if (data === null) delete slots[idx];
      else slots[idx] = data;
      return { ...prev, builderSlots: slots };
    });
  };

  const handleUpdateSlotEphemeral = (idx: number, data: SlotData | null) => {
    setProjectEphemeral((prev) => {
      const slots = { ...prev.builderSlots };
      if (data === null) delete slots[idx];
      else slots[idx] = data;
      return { ...prev, builderSlots: slots };
    });
  };

  const handleSwapSlots = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setProject((prev) => {
      const slots = { ...prev.builderSlots };
      const sourceData = slots[fromIndex];
      const targetData = slots[toIndex];
      if (!sourceData && !targetData) return prev;
      if (sourceData) slots[toIndex] = { ...sourceData, gridIndex: toIndex };
      else delete slots[toIndex];
      if (targetData) slots[fromIndex] = { ...targetData, gridIndex: fromIndex };
      else delete slots[fromIndex];
      return { ...prev, builderSlots: slots };
    });
    if (preferences.soundEnabled) uiFeedback.play("pop");
  };

  const handleFrameToAsset = async (id: number) => {
    const frame = project.frames.find((f) => f.id === id);
    if (!frame || !project.imageMeta) return;
    try {
      setIsLoading(true);
      setLoadingMessage("Cropping asset...");
      const croppedDataUrl = await cropImage(
        project.imageMeta.src,
        frame.x,
        frame.y,
        frame.w,
        frame.h,
      );
      const blob = dataURIToBlob(croppedDataUrl);
      const newId = generateId();
      const assetMetadata = { name: `Slice ${frame.id}`, width: frame.w, height: frame.h };

      await addAsset(assetMetadata, newId, blob);

      const tempAsset = {
        ...assetMetadata,
        id: newId,
        src: URL.createObjectURL(blob),
      };

      setProject((prev) => ({
        ...prev,
        builderAssets: [...prev.builderAssets, tempAsset],
      }));

      showToast(`Added Slice #${frame.id} to library`, "success");
      if (preferences.soundEnabled) uiFeedback.play("success");
    } catch (e) {
      showToast("Failed to crop frame", "error");
    } finally {
      setIsLoading(false);
      setLoadingMessage("");
    }
  };

  const runGeneration = async (
    prompt: string,
    contextImages: string[],
    targetSlotIdx: number | null,
    setSelectedIndex: (n: number) => void,
    model: AIModelId,
    mode: AIGenerationMode,
  ) => {
    setIsLoading(true);
    setLoadingMessage("AI Generating...");
    try {
      const newDataUrl = await generateSprite(contextImages, prompt, model, mode);
      const blob = dataURIToBlob(newDataUrl);
      const newId = generateId();
      const assetMetadata = { name: `AI: ${prompt.substring(0, 10)}...`, width: 100, height: 100 };

      await addAsset(assetMetadata, newId, blob);

      const newAsset: BuilderAsset = {
        ...assetMetadata,
        id: newId,
        src: URL.createObjectURL(blob),
      };

      setProject((prev) => ({
        ...prev,
        builderAssets: [...prev.builderAssets, newAsset],
      }));

      if (targetSlotIdx !== null) {
        handleUpdateSlot(targetSlotIdx, DEFAULT_SLOT_DATA(targetSlotIdx, newId));
        setSelectedIndex(targetSlotIdx);
      }
      showToast("Generation complete", "success");
      if (preferences.soundEnabled) uiFeedback.play("success");
    } catch (e: any) {
      showToast("Gen error: " + (e.message || "Unknown"), "error");
    } finally {
      setIsLoading(false);
      setLoadingMessage("");
    }
  };

  const handleSmartFillSlot = (
    slotIndex: number,
    gridCols: number,
    setSelectedIndex: (n: number) => void,
  ) => {
    const ref = project.builderSlots[slotIndex - 1] || project.builderSlots[slotIndex - gridCols];
    if (ref) {
      handleUpdateSlot(slotIndex, { ...ref, gridIndex: slotIndex });
      setSelectedIndex(slotIndex);
      showToast("Smart filled", "success");
    } else showToast("No neighbor to clone", "info");
  };

  return {
    handleAddAsset,
    handleDeleteAsset,
    handleUpdateSlot,
    handleUpdateSlotEphemeral,
    handleFrameToAsset,
    runGeneration,
    handleSmartFillSlot,
    handleSwapSlots,
  };
}
