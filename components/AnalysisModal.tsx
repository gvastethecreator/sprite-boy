import React from "react";
import { X, BrainCircuit } from "lucide-react";
import { useModalEntrance } from "../hooks/useGSAPAnimations";

interface AnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysisResult: string | null;
}

const AnalysisModal: React.FC<AnalysisModalProps> = ({ isOpen, onClose, analysisResult }) => {
  const modalRef = useModalEntrance();
  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        data-modal-panel
        className="bg-panel border border-border rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-panelHeader">
          <h2 className="text-lg font-semibold text-textMain flex items-center gap-2">
            <BrainCircuit size={20} className="text-accent" /> Gemini Sheet Analysis
          </h2>
          <button
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
      </div>
    </div>
  );
};

export default AnalysisModal;
