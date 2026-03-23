
import React, { useRef, useState, useCallback } from 'react';
import Header from './Header';
import LeftSidebar from './LeftSidebar';
import RightSidebar from './RightSidebar';
import CanvasArea from './CanvasArea';
import Timeline from './Timeline';
import ExportModal from './ExportModal';
import SettingsModal from './SettingsModal';
import HelpModal from './HelpModal';
import ToastContainer from './ToastContainer';
import CommandPalette from './CommandPalette';
import GenerationModal from './GenerationModal';
import AnalysisModal from './AnalysisModal';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useProject } from '../contexts/ProjectContext';
import { AppMode, CanvasHandle } from '../types';
import { GripHorizontal } from 'lucide-react';

const AppLayout: React.FC = () => {
    const controller = useProject();
    const {
        preferences, setPreferences, isSettingsOpen, setIsSettingsOpen, isHelpOpen, setIsHelpOpen,
        isCommandPaletteOpen, setIsCommandPaletteOpen, commands,
        currentMode, handleSetMode,
        isLoading, loadingMessage, toasts, removeToast,
        slicerImage, activeGrid, builderGrid, frames, builderSlots, animations, builderAssets,
        activeAnimationId, setActiveAnimationId,
        playbackFrameIndex, setPlaybackFrameIndex, isPlaying, setIsPlaying,
        templateConfig, setTemplateConfig, exportModal, setExportModal,
        selectedIndex, setSelectedIndex, builderCanvas, setBuilderCanvas,
        undo, redo, canUndo, canRedo,
        handleSetGridConfig, handleUpdateFrame, handleUpdateFrameEphemeral, handleAddFrame, handleUpload, handleAutoSlice,
        handleRemoveBackground, handlePreviewBackground, handleCancelPreview,
        handleCreateCanvas, handleAddAsset, handleDeleteAsset, handleUpdateSlot, handleUpdateSlotEphemeral,
        handleAddAnimation, handleDeleteAnimation, handleDuplicateAnimation,
        handleAddKeyframe, handleDeleteKeyframe, handleUpdateAnimation,
        handleUpdateKeyframe, handleReorderFrames, handleStepFrame,
        handleGenerateCode, onionSkin, setOnionSkin,
        showToast, isEyedropperActive, setIsEyedropperActive, eyedropperColor, setEyedropperColor,
        isMagicWandActive, setIsMagicWandActive, wandTolerance, setWandTolerance,
        handleDeleteSelection, handleFrameToAsset, handleSyncGrid, handleAddKeyframeFromAsset,
        handleDuplicateFrame,
        generationModal, setGenerationModal, handleGenerateSlot, handleSmartFillSlot,
        handleSwapSlots, genPanel, setGenPanel, isPreviewActive, bgPreviewBlobUrl, handleSaveProject, handleLoadProject, handleNewProject,
        analysisResult, setAnalysisResult, handleAnalyzeSheet,
        viewport, setViewport, currentAspectRatio, handleSetAspectRatio: onSetAspectRatio,
        handleToggleFrameVisibility,
        handleExportZip, handleExportGif, handleDeleteFrame,
        handleRunAIProjectGen, handleDropContextToAI, handleClearAIContext,
        handleMagicWandSelect
    } = controller;

    const canvasRef = useRef<CanvasHandle>(null);
    const activeAnim = activeAnimationId ? animations.find((a: any) => a.id === activeAnimationId) : null;
    const hasWorkspace = !!slicerImage || !!builderCanvas;

    const activeImageSource = isPreviewActive && bgPreviewBlobUrl && slicerImage
        ? { ...slicerImage, src: bgPreviewBlobUrl }
        : slicerImage;

    // Timeline Resize Logic
    const [timelineHeight, setTimelineHeight] = useState(220);
    const isResizingTimeline = useRef(false);

    const startTimelineResize = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isResizingTimeline.current = true;
        const startY = e.clientY;
        const startHeight = timelineHeight;

        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizingTimeline.current) return;
            const delta = startY - e.clientY;
            const newHeight = Math.min(Math.max(120, startHeight + delta), 500);
            setTimelineHeight(newHeight);
        };

        const handleMouseUp = () => {
            isResizingTimeline.current = false;
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
        };

        document.body.style.cursor = 'row-resize';
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }, [timelineHeight]);

    useKeyboardShortcuts({
        undo, redo, deleteSelection: handleDeleteSelection, nudge: (dx: number, dy: number) => { if (selectedIndex !== null) handleUpdateFrame(frames[selectedIndex].id, { x: frames[selectedIndex].x + dx, y: frames[selectedIndex].y + dy }); },
        copyHitboxes: () => { },
        pasteHitboxes: () => { },
        togglePlay: () => setIsPlaying(!isPlaying), stepFrame: handleStepFrame, toggleCommandPalette: () => setIsCommandPaletteOpen(!isCommandPaletteOpen), resetView: () => canvasRef.current?.resetView(), closeModals: () => { controller.closeAllModals(); },
        currentMode, canUndo, canRedo, isModalOpen: isSettingsOpen || isHelpOpen || exportModal.isOpen || generationModal.isOpen || isCommandPaletteOpen || !!analysisResult, activeAnimationId
    });

    return (
        <div className="h-screen w-screen flex flex-col bg-app text-textMain overflow-hidden p-2 gap-2 select-none">
            <Header onAnalyzeSheet={async () => {
                try {
                    const hasKey = await (window as any).aistudio?.hasSelectedApiKey();
                    if (!hasKey) {
                        await (window as any).aistudio?.openSelectKey();
                    }
                } catch (e) {
                    console.warn("API Key selection skipped or failed", e);
                }
                const b = await canvasRef.current?.exportSnapshot(false);
                if (b) handleAnalyzeSheet(b);
            }} />

            <div className="flex-1 flex min-h-0 gap-2">
                {hasWorkspace && (
                    <div className="w-[280px] bg-panel rounded-panel flex flex-col shrink-0 border border-border/20 overflow-hidden animate-fade-in">
                        <LeftSidebar />
                    </div>
                )}

                <div className="flex-1 flex flex-col min-w-0 gap-2">
                    <div className="flex-1 relative overflow-hidden bg-workspace rounded-panel border border-border/20">
                        <CanvasArea ref={canvasRef} />
                    </div>
                    {hasWorkspace && currentMode !== AppMode.BUILDER && (
                        <div
                            style={{ height: timelineHeight }}
                            className="bg-panel rounded-panel shrink-0 flex flex-col border border-border/20 overflow-hidden animate-slide-up relative"
                        >
                            <div
                                onMouseDown={startTimelineResize}
                                className="absolute top-0 left-0 right-0 h-1.5 cursor-row-resize hover:bg-accent/20 z-20 group flex justify-center items-center"
                            >
                                <GripHorizontal size={10} className="text-transparent group-hover:text-textMuted opacity-50" />
                            </div>
                            <Timeline />
                        </div>
                    )}
                </div>

                {hasWorkspace && (
                    <div className="w-[280px] bg-panel rounded-panel flex flex-col shrink-0 border border-border/20 overflow-hidden animate-fade-in">
                        <RightSidebar />
                    </div>
                )}
            </div>

            <ToastContainer toasts={toasts} onRemove={removeToast} />
            <CommandPalette isOpen={isCommandPaletteOpen} onClose={() => setIsCommandPaletteOpen(false)} commands={commands} />
            <ExportModal
                onGenerateCode={handleGenerateCode}
                onExportPng={async g => { const b = await canvasRef.current?.exportSnapshot(g); if (b) { const u = URL.createObjectURL(b); const l = document.createElement('a'); l.href = u; l.download = 'export.png'; l.click(); } }}
                onExportZip={() => handleExportZip(canvasRef.current)}
                onExportGif={(aid) => handleExportGif(aid, canvasRef.current)}
                onCopyCode={c => { navigator.clipboard.writeText(c); showToast('Copied!', 'success'); }}
            />
            <GenerationModal />
            <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} preferences={preferences} onUpdatePreferences={setPreferences} />
            <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
            <AnalysisModal isOpen={!!analysisResult} onClose={() => setAnalysisResult(null)} analysisResult={analysisResult} />
        </div>
    );
};

export default AppLayout;
