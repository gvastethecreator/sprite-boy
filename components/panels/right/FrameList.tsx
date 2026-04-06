import React from "react";
import { FrameData, ImageMeta, DND_FRAME_TYPE, SlotData, BuilderAsset } from "../../../types";
import { Layers, Target, Scissors, Trash2, Eye, EyeOff, Box } from "lucide-react";

interface FrameListProps {
  frames: FrameData[];
  imageMeta: ImageMeta | null;
  selectedIndex: number | null;
  builderSlots?: Record<number, SlotData>;
  builderAssets?: BuilderAsset[];
  onSelectFrame: (index: number) => void;
  onDeleteFrame: (index: number) => void;
  onToAsset: (id: number) => void;
  onToggleVisibility?: (id: number) => void;
}

const FrameList: React.FC<FrameListProps> = ({
  frames,
  imageMeta,
  selectedIndex,
  builderSlots,
  builderAssets,
  onSelectFrame,
  onDeleteFrame,
  onToAsset,
  onToggleVisibility,
}) => {
  const handleDragStart = (e: React.DragEvent, frameId: number) => {
    e.dataTransfer.setData(DND_FRAME_TYPE, frameId.toString());
    e.dataTransfer.effectAllowed = "copy";

    const dragPreview = document.createElement("div");
    dragPreview.className =
      "w-12 h-12 bg-accent/50 border-2 border-accent rounded-lg fixed -top-40";
    document.body.appendChild(dragPreview);
    e.dataTransfer.setDragImage(dragPreview, 24, 24);
    setTimeout(() => document.body.removeChild(dragPreview), 0);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-panel-gradient">
      <div className="h-10 bg-white/5 flex items-center px-4 border-b border-white/5">
        <Layers size={14} className="text-accent mr-2" />
        <span className="text-[10px] font-bold text-textMuted uppercase tracking-wider">
          Workspace Resources ({frames.length})
        </span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
        {frames.length === 0 ? (
          <div className="py-10 text-center text-[10px] text-textMuted opacity-50 uppercase tracking-widest italic">
            Empty Workspace
          </div>
        ) : (
          frames.map((frame, idx) => {
            const isSelected = selectedIndex === idx;
            const isHidden = !!frame.hidden;
            const slot = builderSlots?.[frame.id];
            const asset = slot ? builderAssets?.find((a) => a.id === slot.assetId) : null;

            return (
              <div
                key={frame.id}
                onClick={() => onSelectFrame(idx)}
                draggable={!isHidden}
                onDragStart={(e) => handleDragStart(e, frame.id)}
                className={`
                                    group flex items-center gap-3 p-2 rounded-xl border transition-all cursor-grab active:cursor-grabbing
                                    ${isSelected ? "bg-accent/10 border-accent shadow-glow-sm" : "bg-black/20 border-white/5 hover:bg-white/5 hover:border-white/10"}
                                    ${isHidden ? "opacity-50 grayscale-[0.5]" : "opacity-100"}
                                `}
              >
                {/* Unificado: Thumbnail de Frame o de Asset en Slot */}
                <div className="w-12 h-12 bg-checkered rounded-lg border border-white/10 flex items-center justify-center overflow-hidden shrink-0 relative">
                  {asset ? (
                    <img
                      src={asset.src}
                      className="max-w-[85%] max-h-[85%] object-contain"
                      style={{
                        transform: `scaleX(${slot?.flipX ? -1 : 1}) scaleY(${slot?.flipY ? -1 : 1})`,
                      }}
                      alt=""
                    />
                  ) : imageMeta ? (
                    <div
                      style={{
                        position: "absolute",
                        width: `${(imageMeta.width / frame.w) * 100}%`,
                        height: "auto",
                        left: `${-(frame.x / frame.w) * 100}%`,
                        top: `${-(frame.y / frame.h) * (frame.h / frame.w) * 100}%`,
                        imageRendering: "pixelated",
                        aspectRatio: `${imageMeta.width} / ${imageMeta.height}`,
                      }}
                    >
                      <img src={imageMeta.src} className="w-full h-full block" alt="" />
                    </div>
                  ) : (
                    <div className="text-[10px] font-mono text-textMuted opacity-20">EMPTY</div>
                  )}
                </div>

                {/* Label */}
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold text-textMain truncate">
                    Frame #{frame.id}{" "}
                    {asset && (
                      <span className="text-[9px] text-accent font-normal">(Occupied)</span>
                    )}
                  </div>
                  <div className="text-[9px] text-textMuted font-mono uppercase tracking-tighter opacity-60">
                    {asset ? asset.name : `Geometry: ${frame.w}×${frame.h}`}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleVisibility?.(frame.id);
                    }}
                    className={`p-1.5 rounded-md transition-colors ${isHidden ? "text-accent hover:bg-accent/10" : "text-textMuted hover:text-white hover:bg-white/10"}`}
                  >
                    {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteFrame(idx);
                    }}
                    className="p-1.5 hover:bg-red-500/10 rounded-md text-textMuted hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default FrameList;
