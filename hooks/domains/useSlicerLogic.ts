
import { useState } from 'react';
import { ProjectState, FrameData, UserPreferences } from '../../types';
import { detectSprites, removeBackground } from '../../utils/algorithms';
import { uiFeedback } from '../../utils/uiFeedback';

const generateId = () => Math.random().toString(36).substr(2, 9);

/** Slicer mode: auto-detect sprites, manage frames, background removal. */
export function useSlicerLogic(
    project: ProjectState,
    setProject: (cb: (prev: ProjectState) => ProjectState) => void,
    setProjectEphemeral: (cb: (prev: ProjectState) => ProjectState) => void,
    preferences: UserPreferences,
    showToast: (msg: string, type?: 'success' | 'error' | 'info') => void,
    setIsLoading: (loading: boolean) => void,
    setLoadingMessage: (msg: string) => void
) {
    const [wandTolerance, setWandTolerance] = useState(30);

    const handleAutoSlice = async () => {
        if (!project.imageMeta) return;
        setIsLoading(true);
        setLoadingMessage('Analyzing pixels...');
        try {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = project.imageMeta.src;
            await new Promise(r => img.onload = r);
            
            setLoadingMessage('Generating bounds...');
            const frames = await detectSprites(img);
            setProject(prev => ({ ...prev, frames }));
            showToast(`Detected ${frames.length} sprites`, 'success');
        } catch (e) {
            showToast("Slice failed", "error");
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };

    const handleUpdateFrame = (id: number, data: Partial<FrameData>) => {
        setProject(prev => ({
            ...prev,
            frames: prev.frames.map(f => f.id === id ? { ...f, ...data } : f)
        }));
    };

    const handleUpdateFrameEphemeral = (id: number, data: Partial<FrameData>) => {
        setProjectEphemeral(prev => ({
            ...prev,
            frames: prev.frames.map(f => f.id === id ? { ...f, ...data } : f)
        }));
    };

    const handleAddFrame = (frame: FrameData) => {
        setProject(prev => ({
            ...prev,
            frames: [...prev.frames, frame]
        }));
        if(preferences.soundEnabled) uiFeedback.play('pop');
    };

    const handleDuplicateFrame = (id: number, onSelect: (idx: number) => void) => {
        const frameIndex = project.frames.findIndex(f => f.id === id);
        if(frameIndex === -1) return;
        
        const frame = project.frames[frameIndex];
        const maxId = project.frames.length > 0 ? Math.max(...project.frames.map(f => f.id)) : 0;
        const newFrameId = maxId + 1;
        
        const newFrame = { 
            ...frame, 
            id: newFrameId, 
            x: frame.x + 10, 
            y: frame.y + 10
        };
        
        setProject(prev => ({ ...prev, frames: [...prev.frames, newFrame] }));
        
        setTimeout(() => {
            onSelect(project.frames.length);
            showToast(`Frame #${id} duplicated`, 'success');
            if(preferences.soundEnabled) uiFeedback.play('pop');
        }, 0);
    };

    const handleRemoveBackground = async (color: string, tolerance: number, softness: number) => {
        if (!project.imageMeta) return;
        setIsLoading(true);
        setLoadingMessage('Removing background...');
        try {
            const blob = await removeBackground(project.imageMeta.src, color, tolerance, softness);
            if (blob) {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64data = reader.result as string;
                    setProject(prev => ({
                        ...prev,
                        imageMeta: prev.imageMeta ? { ...prev.imageMeta, src: base64data } : null
                    }));
                    showToast("Background removed successfully", "success");
                };
                reader.readAsDataURL(blob);
            }
        } catch (e) {
            showToast("Failed to remove background", "error");
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };

    const handlePreviewBackground = async (color: string, tolerance: number, softness: number, setPreviewUrl: (url: string | null) => void) => {
        if (!project.imageMeta) return;
        try {
            const blob = await removeBackground(project.imageMeta.src, color, tolerance, softness);
            if (blob) {
                const url = URL.createObjectURL(blob);
                setPreviewUrl(url);
            }
        } catch (e) {
            console.error("Preview failed", e);
        }
    };

    const handleMagicWandSelect = (rect: {x:number, y:number, w:number, h:number}) => {
        const maxId = project.frames.length > 0 ? Math.max(...project.frames.map(f => f.id)) : -1;
        handleAddFrame({ id: maxId + 1, ...rect });
    };

    return {
        wandTolerance, setWandTolerance,
        handleAutoSlice, handleUpdateFrame, handleUpdateFrameEphemeral, handleAddFrame, handleDuplicateFrame,
        handleRemoveBackground, handlePreviewBackground,
        handleMagicWandSelect
    };
}
