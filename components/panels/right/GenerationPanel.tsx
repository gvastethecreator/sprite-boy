import React, { useState } from "react";
import {
  Sparkles,
  BrainCircuit,
  Target,
  Plus,
  ArrowRight,
  Maximize,
  X,
  Wand2,
  Paperclip,
} from "lucide-react";
import {
  GenerationPanelState,
  DND_ASSET_TYPE,
  DND_KEYFRAME_TYPE,
  DND_FRAME_TYPE,
  AIModelId,
  AIGenerationMode,
} from "../../../types";
import { SectionHeader } from "../../common/PanelComponents";

interface GenerationPanelProps {
  state: GenerationPanelState;
  setState: (s: GenerationPanelState) => void;
  onDrop: (idx: number, type: "asset" | "keyframe" | "frame", id: string) => void;
  onClear: (idx: number) => void;
  onRun: () => void;
}

const GenerationPanel: React.FC<GenerationPanelProps> = ({
  state,
  setState,
  onDrop,
  onClear,
  onRun,
}) => {
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIdx(index);
  };

  const handleDragLeave = () => {
    setDragOverIdx(null);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIdx(null);
    const assetId = e.dataTransfer.getData(DND_ASSET_TYPE);
    const kfIndex = e.dataTransfer.getData(DND_KEYFRAME_TYPE);
    const frameId = e.dataTransfer.getData(DND_FRAME_TYPE);

    if (assetId) onDrop(index, "asset", assetId);
    else if (kfIndex) onDrop(index, "keyframe", kfIndex);
    else if (frameId) onDrop(index, "frame", frameId);
  };

  const handleRunClick = async () => {
    if (state.model === "gemini-2.5-flash-image" || state.model === "imagen-4.0-generate-001") {
      try {
        const hasKey = await (window as any).aistudio?.hasSelectedApiKey();
        if (!hasKey) {
          await (window as any).aistudio?.openSelectKey();
        }
      } catch (e) {
        console.warn("API Key selection skipped or failed", e);
      }
    }
    onRun();
  };

  return (
    <div className="flex flex-col h-full bg-panel">
      <SectionHeader title="AI Creator" icon={Sparkles} colorClass="text-purple-400" />
      <div className="p-4 space-y-6 overflow-y-auto custom-scrollbar flex-1">
        <p className="text-[10px] text-textMuted leading-relaxed">
          Generate new sprites and assets. Results will be added to your{" "}
          <strong>Global Library</strong> automatically.
        </p>

        {/* Model Selector */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-textMuted uppercase flex items-center gap-2 tracking-wider">
            <BrainCircuit size={12} /> AI Engine
          </label>
          <select
            value={state.model}
            onChange={(e) => setState({ ...state, model: e.target.value as AIModelId })}
            className="w-full input-deep rounded-md p-2 text-xs text-textMain outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="gemini-3-pro-image-preview">Gemini 3 Pro (Vision)</option>
            <option value="gemini-2.5-flash-image">Gemini 2.5 Flash (Fast)</option>
            <option value="imagen-4.0-generate-001">Imagen 4 (High Quality Text)</option>
          </select>
        </div>

        {/* Mode Selector */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-textMuted uppercase flex items-center gap-2 tracking-wider">
            <Target size={12} /> Output Mode
          </label>
          <select
            value={state.mode}
            onChange={(e) => setState({ ...state, mode: e.target.value as AIGenerationMode })}
            className="w-full input-deep rounded-md p-2 text-xs text-textMain outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="new_image">New Asset (Text-to-Image)</option>
            <option value="variation">Variation of Attachments</option>
            <option value="inbetween">Generate In-between</option>
            <option value="full_sheet">Generate Complete Sheet</option>
          </select>
        </div>

        {/* Context / Attachments */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold text-textMuted uppercase tracking-wider flex items-center gap-2">
              <Paperclip size={12} /> Attachments
            </label>
            <span className="text-[9px] text-textMuted/60">Drag assets here</span>
          </div>

          <div className="grid grid-cols-3 gap-3 h-20">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                onDragOver={(e) => handleDragOver(e, i)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, i)}
                className={`
                                    relative rounded-lg border-2 border-dashed flex flex-col items-center justify-center transition-all overflow-hidden group cursor-pointer
                                    ${dragOverIdx === i ? "border-accent bg-accent/20 scale-105" : "border-white/10 bg-black/20 hover:border-white/30"}
                                `}
              >
                {state.contextSlots[i] ? (
                  <>
                    <div className="absolute inset-0 bg-checkered opacity-30"></div>
                    <img
                      src={state.contextSlots[i]!.previewSrc}
                      className="w-full h-full object-contain relative z-10 p-1"
                      alt="context"
                    />
                    <div className="absolute inset-0 z-20 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                      <button
                        onClick={() => onClear(i)}
                        className="p-1.5 bg-red-500 rounded-full text-white shadow-sm"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1 opacity-20 text-white">
                    <Plus size={16} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2 pt-2 border-t border-white/5">
          <label className="text-[10px] font-bold text-textMuted uppercase tracking-wider">
            Prompt / Instructions
          </label>
          <textarea
            value={state.prompt}
            onChange={(e) => setState({ ...state, prompt: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            className="w-full h-28 input-deep rounded-lg p-3 text-xs text-textMain resize-none outline-none focus:ring-1 focus:ring-accent placeholder:text-textMuted/30"
            placeholder={
              state.mode === "inbetween"
                ? "Describe the movement between attachments..."
                : state.mode === "new_image"
                  ? "Describe the asset to create (e.g., 'Pixel art sci-fi drone')..."
                  : "Enter generation prompt..."
            }
          />
        </div>

        <button
          onClick={handleRunClick}
          disabled={!state.prompt.trim() && state.mode === "new_image"}
          className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold shadow-glow-sm flex items-center justify-center gap-2 tracking-wide transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Wand2 size={16} /> Run Generator
        </button>
      </div>

      <div className="p-3 border-t border-white/5 text-center bg-black/20">
        <span className="text-[9px] text-textMuted font-mono opacity-50 uppercase tracking-widest">
          Local-First Neural Engine
        </span>
      </div>
    </div>
  );
};

export default GenerationPanel;
