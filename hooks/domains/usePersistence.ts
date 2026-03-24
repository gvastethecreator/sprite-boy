import { useCallback } from 'react';
import { AppMode, ProjectState, GridConfig, TemplateConfig, OnionSkinConfig } from '../../types';

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
    notify: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function usePersistence(deps: PersistenceDeps) {
    const {
        project, slicerGrid, builderGrid, templateConfig, onionSkin, currentMode,
        setProject, setSlicerGrid, setBuilderGrid, setTemplateConfig, setCurrentMode, notify,
    } = deps;

    const handleSaveProject = useCallback(() => {
        const data = JSON.stringify({
            project,
            ui: { slicerGrid, builderGrid, templateConfig, onionSkin, currentMode },
        });
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `project_${project.imageMeta?.name || 'studio'}_${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(url);
        notify('Project saved', 'success');
    }, [project, slicerGrid, builderGrid, templateConfig, onionSkin, currentMode, notify]);

    const handleLoadProject = useCallback((file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target?.result as string);
                if (data.project) setProject(data.project);
                if (data.ui) {
                    if (data.ui.slicerGrid) setSlicerGrid(data.ui.slicerGrid);
                    if (data.ui.builderGrid) setBuilderGrid(data.ui.builderGrid);
                    if (data.ui.templateConfig) setTemplateConfig(data.ui.templateConfig);
                    if (data.ui.currentMode) setCurrentMode(data.ui.currentMode);
                }
                notify('Project loaded', 'success');
            } catch {
                notify('Invalid file', 'error');
            }
        };
        reader.readAsText(file);
    }, [setProject, setSlicerGrid, setBuilderGrid, setTemplateConfig, setCurrentMode, notify]);

    return { handleSaveProject, handleLoadProject };
}
