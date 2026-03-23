import { useEffect } from 'react';
import { AppMode, FrameData, HitboxData } from '../types';

interface ShortcutsConfig {
    // Actions
    undo: () => void;
    redo: () => void;
    deleteSelection: () => void;
    nudge: (dx: number, dy: number) => void;
    copyHitboxes: () => void;
    pasteHitboxes: () => void;
    togglePlay: () => void;
    stepFrame: (dir: number) => void;
    toggleCommandPalette: () => void;
    resetView: () => void;
    closeModals: () => void;
    
    // State Checks
    currentMode: AppMode;
    canUndo: boolean;
    canRedo: boolean;
    isModalOpen: boolean;
    activeAnimationId: string | null;
}

export const useKeyboardShortcuts = ({
    undo, redo, deleteSelection, nudge, copyHitboxes, pasteHitboxes,
    togglePlay, stepFrame, toggleCommandPalette, resetView, closeModals,
    currentMode, canUndo, canRedo, isModalOpen, activeAnimationId
}: ShortcutsConfig) => {

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // STRICT INPUT GUARD: Ignore if focus is on any input-like element
            const activeElement = document.activeElement;
            const isInput = 
                activeElement instanceof HTMLInputElement || 
                activeElement instanceof HTMLTextAreaElement || 
                activeElement instanceof HTMLSelectElement || 
                (activeElement as HTMLElement)?.isContentEditable;
            
            if (isInput) return;

            // Global: Escape to close modals or menus
            if (e.key === 'Escape') {
                closeModals();
                return;
            }

            // Global: Command Palette (Ctrl+K or Cmd+K)
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                toggleCommandPalette();
                return;
            }

            // If a modal is open (Settings, Export, etc.), ignore other shortcuts
            if (isModalOpen) return;

            // Global: Undo / Redo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    if (canRedo) redo();
                } else {
                    if (canUndo) undo();
                }
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                if (canRedo) redo();
                return;
            }

            // Global: Reset View (Ctrl+0)
            if ((e.ctrlKey || e.metaKey) && e.code === 'Digit0') {
                e.preventDefault();
                resetView();
                return;
            }

            // Animation Mode Shortcuts
            if (activeAnimationId) {
                if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-1); return; }
                if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(1); return; }
                if (e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
            }

            // Editor Mode Shortcuts (Slicer/Collision/Builder)
            if (!activeAnimationId) {
                const multiplier = e.shiftKey ? 10 : 1;
                
                // Nudge
                if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -1 * multiplier); }
                else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, 1 * multiplier); }
                else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-1 * multiplier, 0); }
                else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(1 * multiplier, 0); }
                
                // Delete
                if (e.key === 'Delete' || e.key === 'Backspace') {
                    deleteSelection();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        undo, redo, deleteSelection, nudge, copyHitboxes, pasteHitboxes, 
        togglePlay, stepFrame, toggleCommandPalette, resetView, closeModals,
        currentMode, canUndo, canRedo, isModalOpen, activeAnimationId
    ]);
};
