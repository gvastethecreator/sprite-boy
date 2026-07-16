import { useCallback } from "react";
import { AppMode, ProjectState, GridConfig, TemplateConfig, OnionSkinConfig } from "../../types";

interface PersistenceDeps {
  project: ProjectState;
  slicerGrid: GridConfig;
  builderGrid: GridConfig;
  templateConfig: TemplateConfig;
  onionSkin: OnionSkinConfig;
  currentMode: AppMode;
  setProject: (state: ProjectState | ((prev: ProjectState) => ProjectState)) => void;
  setSlicerGrid: (g: GridConfig) => void;
  setBuilderGrid: (g: GridConfig) => void;
  setTemplateConfig: (t: TemplateConfig) => void;
  setCurrentMode: (m: AppMode) => void;
  notify: (msg: string, type: "success" | "error" | "info") => void;
}

/** Project save (JSON download) and load (JSON file upload). */
export function usePersistence(deps: PersistenceDeps) {
  const {
    project,
    slicerGrid,
    builderGrid,
    templateConfig,
    onionSkin,
    currentMode,
    setProject,
    setSlicerGrid,
    setBuilderGrid,
    setTemplateConfig,
    setCurrentMode,
    notify,
  } = deps;

  const handleSaveProject = useCallback(() => {
    const data = JSON.stringify({
      project,
      ui: { slicerGrid, builderGrid, templateConfig, onionSkin, currentMode },
    });
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `project_${project.imageMeta?.name || "studio"}_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    notify("Project saved", "success");
  }, [project, slicerGrid, builderGrid, templateConfig, onionSkin, currentMode, notify]);

  const handleLoadProject = useCallback(
    (file: File): Promise<boolean> => new Promise((resolve) => {
      const reader = new FileReader();
      let settled = false;
      const finish = (loaded: boolean): void => {
        if (settled) return;
        settled = true;
        reader.onload = null;
        reader.onerror = null;
        reader.onabort = null;
        resolve(loaded);
      };
      const fail = (): void => {
        try {
          notify("Invalid file", "error");
        } finally {
          finish(false);
        }
      };
      reader.onerror = fail;
      reader.onabort = fail;
      reader.onload = () => {
        try {
          const result = reader.result;
          if (typeof result !== "string") {
            fail();
            return;
          }
          const data: unknown = JSON.parse(result);
          if (
            data === null || typeof data !== "object" ||
            !("project" in data) || !data.project || typeof data.project !== "object"
          ) {
            fail();
            return;
          }
          const projectData = data as {
            project: ProjectState;
            ui?: Partial<{
              slicerGrid: GridConfig;
              builderGrid: GridConfig;
              templateConfig: TemplateConfig;
              currentMode: AppMode;
            }>;
          };
          setProject(projectData.project);
          if (projectData.ui) {
            if (projectData.ui.slicerGrid) setSlicerGrid(projectData.ui.slicerGrid);
            if (projectData.ui.builderGrid) setBuilderGrid(projectData.ui.builderGrid);
            if (projectData.ui.templateConfig) setTemplateConfig(projectData.ui.templateConfig);
            if (projectData.ui.currentMode) setCurrentMode(projectData.ui.currentMode);
          }
          finish(true);
          try {
            notify("Project loaded", "success");
          } catch {
            // Feedback is best effort after the project transaction commits.
          }
        } catch {
          fail();
        }
      };
      try {
        reader.readAsText(file);
      } catch {
        fail();
      }
    }),
    [setProject, setSlicerGrid, setBuilderGrid, setTemplateConfig, setCurrentMode, notify],
  );

  return { handleSaveProject, handleLoadProject };
}
