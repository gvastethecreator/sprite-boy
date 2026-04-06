import React from "react";
import { ZoomIn, ZoomOut, Focus, MousePointer2, Hand, Move, RefreshCcw } from "lucide-react";
import { DragMode, ViewportState } from "../../types";

interface CanvasStatusBarProps {
  dragMode: DragMode;
  mousePos: { x: number; y: number };
  viewport: ViewportState;
  setViewport: (v: ViewportState) => void;
  onResetView: () => void;
  modifiers: { shift: boolean; ctrl: boolean; alt: boolean };
  isHoveringInteractive: boolean;
}

const CanvasStatusBar: React.FC<CanvasStatusBarProps> = ({
  dragMode,
  mousePos,
  viewport,
  setViewport,
  onResetView,
  modifiers,
  isHoveringInteractive,
}) => {
  const getStatusMessage = () => {
    if (dragMode === DragMode.PAN) return { icon: Hand, text: "Panning view..." };
    if (dragMode === DragMode.SWAP_SLOTS)
      return { icon: RefreshCcw, text: "Release to swap slot contents" };
    if (dragMode === DragMode.MOVE_FRAME)
      return {
        icon: Move,
        text: modifiers.shift
          ? "Moving selection (Snapping active)"
          : "Moving selection (Hold Shift to snap)",
      };
    if (dragMode === DragMode.RESIZE_FRAME) return { icon: Move, text: "Resizing..." };

    if (isHoveringInteractive)
      return { icon: MousePointer2, text: "Click to select. Drag to move." };

    return { icon: MousePointer2, text: "Ready. Space+Drag to Pan. Scroll to Zoom." };
  };

  const status = getStatusMessage();
  const StatusIcon = status.icon;

  return (
    <div className="h-8 bg-panel border-t border-white/10 flex items-center justify-between px-3 select-none z-40 text-[10px] shrink-0">
      {/* LEFT: Contextual Help */}
      <div className="flex items-center gap-3 text-textMuted flex-1 min-w-0">
        <div className="flex items-center gap-2 text-textMain bg-white/5 px-2 py-0.5 rounded-full overflow-hidden">
          <StatusIcon size={12} className="text-accent shrink-0" />
          <span className="truncate font-medium">{status.text}</span>
        </div>

        {/* Modifier Indicators */}
        <div className="flex gap-1 opacity-70 hidden sm:flex">
          <span
            className={`px-1.5 py-px rounded border ${modifiers.ctrl ? "bg-white text-black border-white" : "bg-transparent border-white/20"}`}
          >
            CTRL
          </span>
          <span
            className={`px-1.5 py-px rounded border ${modifiers.shift ? "bg-white text-black border-white" : "bg-transparent border-white/20"}`}
          >
            SHIFT
          </span>
          <span
            className={`px-1.5 py-px rounded border ${modifiers.alt ? "bg-white text-black border-white" : "bg-transparent border-white/20"}`}
          >
            ALT
          </span>
        </div>
      </div>

      {/* CENTER: Coordinates */}
      <div className="flex items-center gap-4 font-mono text-textMuted/60 hidden md:flex">
        <div className="flex items-center gap-1">
          <span className="text-accent">X:</span> {Math.round(mousePos.x)}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-accent">Y:</span> {Math.round(mousePos.y)}
        </div>
      </div>

      {/* RIGHT: Zoom Controls */}
      <div className="flex items-center gap-2 flex-1 justify-end">
        <div className="flex items-center bg-black/20 rounded-md border border-white/5 overflow-hidden">
          <button
            onClick={() =>
              setViewport({ ...viewport, scale: Math.max(0.05, viewport.scale * 0.8) })
            }
            className="p-1.5 hover:bg-white/10 text-textMuted hover:text-white transition-colors active:bg-white/20"
            title="Zoom Out"
          >
            <ZoomOut size={12} />
          </button>
          <div className="w-10 text-center font-mono font-bold text-textMain border-x border-white/5 bg-white/5 py-0.5">
            {Math.round(viewport.scale * 100)}%
          </div>
          <button
            onClick={() => setViewport({ ...viewport, scale: Math.min(50, viewport.scale * 1.25) })}
            className="p-1.5 hover:bg-white/10 text-textMuted hover:text-white transition-colors active:bg-white/20"
            title="Zoom In"
          >
            <ZoomIn size={12} />
          </button>
        </div>
        <button
          onClick={onResetView}
          className="p-1.5 rounded-md hover:bg-white/10 text-textMuted hover:text-white transition-colors border border-transparent hover:border-white/10 active:scale-95"
          title="Reset View (Ctrl+0)"
        >
          <Focus size={14} />
        </button>
      </div>
    </div>
  );
};

export default CanvasStatusBar;
