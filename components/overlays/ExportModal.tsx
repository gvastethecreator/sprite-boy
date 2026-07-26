import React, { useState, useEffect } from "react";
import {
  X,
  Copy,
  Download,
  Code,
  FileImage,
  Layers,
  Film,
  Loader2,
} from "lucide-react";
import type { CodeFormat } from "../../types";
import { useProject } from "../../contexts/ProjectContext";
import { StudioDialog } from "../studio/StudioDialog";
import { SelectControl } from "../toolcraft";

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
  const [pngGrid, setPngGrid] = useState(false);
  const [selectedAnimId, setSelectedAnimId] = useState<string>(animations[0]?.id || "");
  const [codeScale, setCodeScale] = useState(1);
  const [codeFormat, setCodeFormat] = useState<CodeFormat>("json_generic");
  const [generatedSnippet, setGeneratedSnippet] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const resolvedAnimationId = animations.some(({ id }) => id === selectedAnimId)
    ? selectedAnimId
    : animations[0]?.id || "";

  useEffect(() => {
    if (type !== "code") return;
    setGeneratedSnippet(
      resolvedAnimationId ? onGenerateCode(resolvedAnimationId, codeScale, codeFormat) : "",
    );
  }, [type, resolvedAnimationId, codeScale, codeFormat, onGenerateCode]);

  const handleExportGifAction = async () => {
    if (!resolvedAnimationId) return;
    setExportError(null);
    setIsProcessing(true);
    try {
      await onExportGif(resolvedAnimationId);
      onClose();
    } catch {
      setExportError("GIF export failed. Check the sequence and try again.");
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

  if (!isOpen || !type) return null;

  const Icon = Icons[type];

  return (
    <StudioDialog
      isOpen={isOpen}
      onClose={onClose}
      labelledBy="studio-export-title"
      backdropClassName="items-center bg-black/80 pt-4"
      panelClassName="max-h-[90vh] max-w-2xl border-border shadow-modal"
    >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border bg-panelHeader px-4 py-3 sm:px-6 sm:py-4">
          <h2 id="studio-export-title" className="flex min-w-0 items-center gap-3 text-sm font-bold text-white">
            <div className="shrink-0 rounded-lg bg-accent/20 p-1.5 text-accent">
              <Icon size={18} aria-hidden="true" />
            </div>
            <span className="truncate">{titles[type]}</span>
          </h2>
          <button
            type="button"
            aria-label="Close export"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-textMuted transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="custom-scrollbar overflow-y-auto bg-app p-4 sm:p-8">
          {/* PNG Mode */}
          {type === "png" && (
            <div className="space-y-6">
              <div className="rounded-xl border border-border/50 bg-surface/30 p-4 sm:p-6">
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

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-10 rounded-md px-5 py-2.5 text-xs font-bold text-textMuted transition-colors hover:bg-white/5 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onExportPng(pngGrid);
                    onClose();
                  }}
                  className="btn-primary flex min-h-10 items-center justify-center gap-2 rounded-lg px-6 py-2.5 text-xs font-bold shadow-glow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-app active:scale-95"
                >
                  <Download size={16} aria-hidden="true" /> Download Spritesheet
                </button>
              </div>
            </div>
          )}

          {/* ZIP Mode */}
          {type === "zip" && (
            <div className="space-y-6 text-center">
              <div className="w-20 h-20 bg-accent/10 rounded-3xl flex items-center justify-center border border-accent/20 mx-auto mb-4">
                <Layers size={40} className="text-accent" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-textMain">PNG sequence (ZIP)</h3>
              </div>
              <div className="flex flex-col-reverse gap-2 pt-4 sm:flex-row sm:justify-center sm:gap-3">
                <button type="button" onClick={onClose} className="min-h-10 rounded-md px-5 py-2.5 text-xs font-bold text-textMuted hover:bg-white/5 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onExportZip();
                    onClose();
                  }}
                  className="btn-primary flex min-h-10 items-center justify-center gap-2 rounded-lg px-8 py-3 text-xs font-bold shadow-glow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-95"
                >
                  <Layers size={16} aria-hidden="true" /> Generate & Download ZIP
                </button>
              </div>
            </div>
          )}

          {/* GIF Mode */}
          {type === "gif" && (
            <div className="space-y-6">
              <div className="space-y-4">
                <SelectControl
                  name="Sequence to encode"
                  value={resolvedAnimationId}
                  disabled={animations.length === 0}
                  options={animations.map((animation) => ({
                    label: `${animation.name} (${animation.keyframes.length} frames)`,
                    value: animation.id,
                  }))}
                  onValueChange={setSelectedAnimId}
                />
                {animations.length === 0 ? (
                  <p className="text-xs text-textMuted">Create a sequence before exporting a GIF.</p>
                ) : null}
              </div>

              {exportError ? (
                <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
                  {exportError}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-2 pt-4 sm:flex-row sm:justify-end sm:gap-3">
                <button type="button" onClick={onClose} className="min-h-10 rounded-md px-5 py-2.5 text-xs font-bold text-textMuted hover:bg-white/5 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExportGifAction}
                  disabled={isProcessing || !resolvedAnimationId}
                  className="flex min-h-10 items-center justify-center gap-2 rounded-lg bg-purple-600 px-8 py-3 text-xs font-bold text-white shadow-glow-sm hover:bg-purple-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
                >
                  {isProcessing ? (
                    <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  ) : (
                    <Film size={16} aria-hidden="true" />
                  )}
                  {isProcessing ? "Encoding…" : "Export GIF"}
                </button>
              </div>
            </div>
          )}

          {/* Code Mode */}
          {type === "code" && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <SelectControl
                  name="Animation"
                  value={resolvedAnimationId}
                  disabled={animations.length === 0}
                  options={animations.map((animation) => ({
                    label: animation.name,
                    value: animation.id,
                  }))}
                  onValueChange={setSelectedAnimId}
                />
                <SelectControl
                  name="Scale"
                  value={String(codeScale)}
                  options={[
                    { value: "1", label: "1x (Standard)" },
                    { value: "2", label: "2x (Retina)" },
                    { value: "4", label: "4x (HD)" },
                  ]}
                  onValueChange={(scale) => setCodeScale(Number(scale))}
                />
                <SelectControl
                  name="Format"
                  value={codeFormat}
                  options={[
                    { value: "json_generic", label: "Generic JSON" },
                    { value: "phaser", label: "Phaser 3" },
                    { value: "godot", label: "Godot Engine" },
                  ]}
                  onValueChange={(format) => setCodeFormat(format as CodeFormat)}
                />
              </div>

              {animations.length === 0 ? (
                <p className="text-xs text-textMuted">
                  Create a sequence before exporting animation data.
                </p>
              ) : null}

              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-accent/20 to-purple-500/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <textarea
                  aria-label="Generated animation data"
                  readOnly
                  value={generatedSnippet}
                  className="relative w-full h-64 bg-input border border-border rounded-lg p-4 text-[11px] font-mono text-textMain/80 resize-none outline-none focus:border-accent custom-scrollbar"
                />
                <div className="absolute top-3 right-3 flex gap-2">
                  <button
                    type="button"
                    aria-label="Copy generated animation data"
                    disabled={!generatedSnippet}
                    onClick={() => onCopyCode(generatedSnippet)}
                    className="rounded-lg border border-border bg-panel p-2 text-textMuted transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Copy size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
    </StudioDialog>
  );
};

export default ExportModal;
