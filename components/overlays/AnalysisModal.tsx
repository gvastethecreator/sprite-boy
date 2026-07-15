import React from "react";
import { X, BrainCircuit } from "lucide-react";
import { StudioDialog } from "../studio/StudioDialog";

interface AnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysisResult: string | null;
}

const AnalysisModal: React.FC<AnalysisModalProps> = ({ isOpen, onClose, analysisResult }) => {
  return (
    <StudioDialog
      isOpen={isOpen}
      onClose={onClose}
      labelledBy="studio-analysis-title"
      backdropClassName="items-center pt-4"
      panelClassName="max-w-2xl border-border"
    >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-panelHeader">
          <h2 id="studio-analysis-title" className="text-lg font-semibold text-textMain flex items-center gap-2">
            <BrainCircuit size={20} className="text-accent" /> Gemini Sheet Analysis
          </h2>
          <button
            type="button"
            aria-label="Close analysis"
            onClick={onClose}
            className="text-textMuted hover:text-textMain transition-colors p-1 hover:bg-white/10 rounded-full"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar bg-app">
          {analysisResult ? (
            <div className="prose prose-invert prose-sm max-w-none">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-textMain/90">
                {analysisResult}
              </pre>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-textMuted">
              <BrainCircuit size={48} className="mb-4 opacity-50 animate-pulse" />
              <p>Waiting for analysis...</p>
            </div>
          )}
        </div>

        <div className="p-4 bg-panel border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-textMain text-app hover:bg-white font-semibold rounded-sm shadow-depth-sm btn-tactile"
          >
            Close
          </button>
        </div>
    </StudioDialog>
  );
};

export default AnalysisModal;
