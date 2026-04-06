import React, { useState, useEffect } from "react";
import {
  X,
  Copy,
  Download,
  Code,
  FileImage,
  Layers,
  Film,
  Sparkles,
  Check,
  Loader2,
} from "lucide-react";
import { ExportModalState, SpriteAnimation, CodeFormat } from "../types";
import { useProject } from "../contexts/ProjectContext";
import { useModalEntrance } from "../hooks/useGSAPAnimations";

interface ExportModalProps {
  onGenerateCode: (animId: string, scale: number, format: CodeFormat) => string;
  onExportPng: (includeGrid: boolean) => void;
  onExportZip: () => void;
  onExportGif: (animId: string) => Promise<void>;
  onCopyCode: (code: string) => void;
}

const ExportModal: React.FC<ExportModalProps> = ({
  onGenerateCode,
  onExportPng,
  onExportZip,
  onExportGif,
  onCopyCode,
}) => {
  const { exportModal, setExportModal, animations } = useProject();
  const { isOpen, type } = exportModal;
  const onClose = () => setExportModal({ ...exportModal, isOpen: false });

  if (!isOpen || !type) return null;

  const modalRef = useModalEntrance();

  const [pngGrid, setPngGrid] = useState(false);
  const [selectedAnimId, setSelectedAnimId] = useState<string>(animations[0]?.id || "");
  const [codeScale, setCodeScale] = useState(1);
  const [codeFormat, setCodeFormat] = useState<CodeFormat>("json_generic");
  const [generatedSnippet, setGeneratedSnippet] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (type === "code" && selectedAnimId) {
      setGeneratedSnippet(onGenerateCode(selectedAnimId, codeScale, codeFormat));
    }
  }, [type, selectedAnimId, codeScale, codeFormat, onGenerateCode]);

  const handleExportGifAction = async () => {
    if (!selectedAnimId) return;
    setIsProcessing(true);
    try {
      await onExportGif(selectedAnimId);
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const titles = {
    png: "Export Spritesheet",
    code: "Export Animation Data",
    zip: "Export Individual Frames",
    gif: "Export Animated GIF",
  };

  const Icons = {
    png: FileImage,
    code: Code,
    zip: Layers,
    gif: Film,
  };

  const Icon = Icons[type];

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <div
        data-modal-panel
        className="bg-panel border border-border rounded-xl shadow-modal w-full max-w-2xl flex flex-col overflow-hidden max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-panelHeader">
          <h2 className="text-sm font-bold text-white flex items-center gap-3">
            <div className="p-1.5 bg-accent/20 rounded-lg text-accent">
              <Icon size={18} />
            </div>
            {titles[type]}
          </h2>
          <button
            onClick={onClose}
            className="text-textMuted hover:text-white transition-colors p-1 hover:bg-white/5 rounded-full"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-8 overflow-y-auto bg-app">
          {/* PNG Mode */}
          {type === "png" && (
            <div className="space-y-6">
              <div className="bg-surface/30 p-6 rounded-xl border border-border/50">
                <label className="flex items-center gap-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pngGrid}
                    onChange={(e) => setPngGrid(e.target.checked)}
                    className="w-5 h-5 rounded border-border bg-input text-accent"
                  />
                  <div>
                    <span className="text-sm font-bold text-textMain block">
                      Include Grid Lines
                    </span>
                    <span className="text-xs text-textMuted block mt-0.5">
                      Recommended for manual slicing or debugging.
                    </span>
                  </div>
                </label>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={onClose}
                  className="px-5 py-2.5 text-xs font-bold text-textMuted hover:text-textMain transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onExportPng(pngGrid);
                    onClose();
                  }}
                  className="px-6 py-2.5 btn-primary rounded-xl text-xs font-bold flex items-center gap-2 shadow-glow-sm active:scale-95"
                >
                  <Download size={16} /> Download Spritesheet
                </button>
              </div>
            </div>
          )}

          {/* ZIP Mode */}
          {type === "zip" && (
            <div className="space-y-6 text-center">
              <div className="w-20 h-20 bg-accent/10 rounded-3xl flex items-center justify-center border border-accent/20 mx-auto mb-4">
                <Layers size={40} className="text-accent" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-textMain">Individual Frames Package</h3>
                <p className="text-sm text-textMuted mt-2 max-w-md mx-auto leading-relaxed">
                  We will extract each frame as a standalone transparent PNG and package them into a
                  single ZIP file for easy engine importing.
                </p>
              </div>
              <div className="flex justify-center gap-3 pt-4">
                <button onClick={onClose} className="px-5 py-2.5 text-xs font-bold text-textMuted">
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onExportZip();
                    onClose();
                  }}
                  className="px-8 py-3 btn-primary rounded-xl text-xs font-bold flex items-center gap-2 shadow-glow-sm active:scale-95"
                >
                  <Layers size={16} /> Generate & Download ZIP
                </button>
              </div>
            </div>
          )}

          {/* GIF Mode */}
          {type === "gif" && (
            <div className="space-y-6">
              <div className="space-y-4">
                <label className="text-xs font-bold text-textMuted uppercase tracking-wider block">
                  Sequence to Encode
                </label>
                <select
                  value={selectedAnimId}
                  onChange={(e) => setSelectedAnimId(e.target.value)}
                  className="w-full bg-input border border-border rounded-lg text-sm p-3 text-textMain outline-none focus:border-accent"
                >
                  {animations.length === 0 ? (
                    <option value="" disabled>
                      No animations available
                    </option>
                  ) : (
                    animations.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.keyframes.length} frames)
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="bg-purple-900/10 border border-purple-500/20 p-4 rounded-xl">
                <p className="text-xs text-purple-300 leading-relaxed">
                  <Sparkles size={12} className="inline mr-1 mb-0.5" /> GIFs will be exported with
                  the FPS set in the animation config. Ensure you have keyframes defined.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button onClick={onClose} className="px-5 py-2.5 text-xs font-bold text-textMuted">
                  Cancel
                </button>
                <button
                  onClick={handleExportGifAction}
                  disabled={isProcessing || !selectedAnimId}
                  className="px-8 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-glow-sm active:scale-95 disabled:opacity-50"
                >
                  {isProcessing ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Film size={16} />
                  )}
                  {isProcessing ? "Encoding..." : "Export GIF"}
                </button>
              </div>
            </div>
          )}

          {/* Code Mode */}
          {type === "code" && (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-textMuted uppercase tracking-wider">
                    Animation
                  </label>
                  <select
                    value={selectedAnimId}
                    onChange={(e) => setSelectedAnimId(e.target.value)}
                    className="w-full bg-input border border-border rounded-lg text-xs p-2 text-textMain outline-none focus:border-accent"
                  >
                    {animations.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-textMuted uppercase tracking-wider">
                    Scale
                  </label>
                  <select
                    value={codeScale}
                    onChange={(e) => setCodeScale(Number(e.target.value))}
                    className="w-full bg-input border border-border rounded-lg text-xs p-2 text-textMain outline-none focus:border-accent"
                  >
                    <option value={1}>1x (Standard)</option>
                    <option value={2}>2x (Retina)</option>
                    <option value={4}>4x (HD)</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-textMuted uppercase tracking-wider">
                    Format
                  </label>
                  <select
                    value={codeFormat}
                    onChange={(e) => setCodeFormat(e.target.value as CodeFormat)}
                    className="w-full bg-input border border-border rounded-lg text-xs p-2 text-textMain outline-none focus:border-accent"
                  >
                    <option value="json_generic">Generic JSON</option>
                    <option value="phaser">Phaser 3</option>
                    <option value="godot">Godot Engine</option>
                  </select>
                </div>
              </div>

              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-accent/20 to-purple-500/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <textarea
                  readOnly
                  value={generatedSnippet}
                  className="relative w-full h-64 bg-input border border-border rounded-lg p-4 text-[11px] font-mono text-textMain/80 resize-none outline-none focus:border-accent custom-scrollbar"
                />
                <div className="absolute top-3 right-3 flex gap-2">
                  <button
                    onClick={() => onCopyCode(generatedSnippet)}
                    className="p-2 bg-panel border border-border rounded-lg hover:bg-white/5 text-textMuted hover:text-white transition-all"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExportModal;
