import { useCallback } from "react";
import { AppMode, ProjectState, GridConfig, CodeFormat } from "../../types";
import {
  generateGenericJSON,
  generatePhaser3,
  generateGodotSpriteFrames,
} from "../../utils/exportFormats";
import { calculateGeometry } from "../../utils/renderUtils";
import JSZip from "jszip";
import gifshot from "gifshot";

interface ExportDeps {
  project: ProjectState;
  currentMode: AppMode;
  activeGrid: GridConfig;
  builderGrid: GridConfig;
  setIsLoading: (v: boolean) => void;
  setLoadingMessage: (v: string) => void;
  notify: (msg: string, type: "success" | "error" | "info") => void;
}

/** Handles ZIP, GIF, and code-generation exports. */
export function useExportLogic(deps: ExportDeps) {
  const { project, currentMode, activeGrid, builderGrid, setIsLoading, setLoadingMessage, notify } =
    deps;

  const handleExportZip = useCallback(
    async (canvasHandle: any) => {
      if (!canvasHandle) return;
      setIsLoading(true);
      setLoadingMessage("Packaging...");
      try {
        const zip = new JSZip();
        const folder = zip.folder("sprites");
        for (const frame of project.frames) {
          if (frame.hidden) continue;
          const dataUrl = await canvasHandle.exportFrame(frame.id);
          if (dataUrl) {
            const base64Data = dataUrl.split(",")[1];
            folder?.file(`frame_${frame.id}.png`, base64Data, { base64: true });
          }
        }
        const content = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(content);
        const link = document.createElement("a");
        link.href = url;
        link.download = `package_${Date.now()}.zip`;
        link.click();
        URL.revokeObjectURL(url);
        notify("ZIP downloaded", "success");
      } catch {
        notify("Failed to create ZIP", "error");
      } finally {
        setIsLoading(false);
      }
    },
    [project.frames, setIsLoading, setLoadingMessage, notify],
  );

  const handleExportGif = useCallback(
    async (animId: string, canvasHandle: any) => {
      const anim = project.animations.find((a) => a.id === animId);
      if (!anim || anim.keyframes.length === 0 || !canvasHandle) return;
      setIsLoading(true);
      setLoadingMessage("Encoding GIF...");
      try {
        const frameImages: string[] = [];
        for (const kf of anim.keyframes) {
          const dataUrl = await canvasHandle.exportFrame(kf.sourceIndex);
          if (dataUrl) frameImages.push(dataUrl);
        }
        return new Promise<void>((resolve, reject) => {
          gifshot.createGIF(
            {
              images: frameImages,
              interval: 1 / anim.fps,
              gifWidth: anim.keyframes[0]
                ? project.frames.find((f) => f.id === anim.keyframes[0].sourceIndex)?.w || 100
                : 100,
              gifHeight: anim.keyframes[0]
                ? project.frames.find((f) => f.id === anim.keyframes[0].sourceIndex)?.h || 100
                : 100,
            },
            (obj: any) => {
              if (!obj.error) {
                const link = document.createElement("a");
                link.href = obj.image;
                link.download = `${anim.name}.gif`;
                link.click();
                notify("GIF Exported", "success");
                resolve();
              } else {
                notify("GIF Encoding failed", "error");
                reject(obj.error);
              }
            },
          );
        });
      } catch {
        notify("GIF Generation Error", "error");
      } finally {
        setIsLoading(false);
      }
    },
    [project.animations, project.frames, setIsLoading, setLoadingMessage, notify],
  );

  const handleGenerateCode = useCallback(
    (animId: string, scale: number, format: CodeFormat): string => {
      const anim = project.animations.find((a) => a.id === animId);
      if (!anim) return "// Animation not found";
      const grid = currentMode === AppMode.BUILDER ? builderGrid : activeGrid;
      const w = project.imageMeta?.width || project.builderCanvas?.width || 512;
      const h = project.imageMeta?.height || project.builderCanvas?.height || 512;
      const geo = calculateGeometry(w, h, grid);
      switch (format) {
        case "phaser":
          return generatePhaser3(anim, project.frames, geo);
        case "godot":
          return generateGodotSpriteFrames(anim, project.frames, geo, w, h);
        case "unity_json":
        case "json_generic":
        default:
          return generateGenericJSON(anim, project.frames, geo, scale);
      }
    },
    [
      project.animations,
      project.frames,
      project.imageMeta,
      project.builderCanvas,
      currentMode,
      builderGrid,
      activeGrid,
    ],
  );

  return { handleExportZip, handleExportGif, handleGenerateCode };
}
