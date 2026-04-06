import React from "react";
import { X, Keyboard, Command } from "lucide-react";
import { useModalEntrance } from "../hooks/useGSAPAnimations";

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ShortcutRow = ({ keys, desc }: { keys: string[]; desc: string }) => (
  <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
    <span className="text-sm text-textMain">{desc}</span>
    <div className="flex gap-1">
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono border border-white/20 text-white min-w-[24px] text-center"
        >
          {k}
        </kbd>
      ))}
    </div>
  </div>
);

const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  const modalRef = useModalEntrance();
  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        data-modal-panel
        className="bg-panel border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-panelHeader">
          <h2 className="text-lg font-semibold text-textMain flex items-center gap-2">
            <Keyboard size={20} className="text-accent" /> Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="text-textMuted hover:text-textMain transition-colors p-1 hover:bg-white/10 rounded-full"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[70vh] custom-scrollbar bg-app">
          <h3 className="text-xs font-bold text-textMuted uppercase tracking-wider mb-3 flex items-center gap-2">
            <Command size={12} /> Canvas & Navigation
          </h3>
          <div className="mb-6 space-y-1">
            <ShortcutRow keys={["Space + Drag"]} desc="Pan View" />
            <ShortcutRow keys={["Wheel"]} desc="Scroll Vertical" />
            <ShortcutRow keys={["Ctrl", "Wheel"]} desc="Zoom In / Out" />
            <ShortcutRow keys={["Ctrl", "0"]} desc="Reset View" />
          </div>

          <h3 className="text-xs font-bold text-textMuted uppercase tracking-wider mb-3 flex items-center gap-2">
            <Command size={12} /> Editing
          </h3>
          <div className="mb-6 space-y-1">
            <ShortcutRow keys={["Ctrl", "Z"]} desc="Undo" />
            <ShortcutRow keys={["Ctrl", "Y"]} desc="Redo" />
            <ShortcutRow keys={["Delete"]} desc="Delete Selection" />
            <ShortcutRow keys={["Arrows"]} desc="Nudge Selection (1px)" />
            <ShortcutRow keys={["Shift", "Arrows"]} desc="Nudge Selection (10px)" />
          </div>

          <h3 className="text-xs font-bold text-textMuted uppercase tracking-wider mb-3 flex items-center gap-2">
            <Command size={12} /> Animation
          </h3>
          <div className="mb-6 space-y-1">
            <ShortcutRow keys={["Space"]} desc="Play / Pause" />
            <ShortcutRow keys={["←", "→"]} desc="Prev / Next Frame" />
          </div>

          <h3 className="text-xs font-bold text-textMuted uppercase tracking-wider mb-3 flex items-center gap-2">
            <Command size={12} /> Hitboxes
          </h3>
          <div className="space-y-1">
            <ShortcutRow keys={["Ctrl", "C"]} desc="Copy Hitboxes (from frame)" />
            <ShortcutRow keys={["Ctrl", "V"]} desc="Paste Hitboxes (to frame)" />
          </div>
        </div>

        <div className="p-4 bg-panel border-t border-border flex justify-center text-[10px] text-textMuted">
          Press <kbd className="mx-1 px-1 bg-white/10 rounded">ESC</kbd> to close any modal
        </div>
      </div>
    </div>
  );
};

export default HelpModal;
