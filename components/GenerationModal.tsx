
import React, { useState } from 'react';
import { X, Sparkles, ArrowRight, Layers, Image as ImageIcon, Grid } from 'lucide-react';
import { BuilderAsset, SlotData } from '../types';
import { useProject } from '../contexts/ProjectContext';

const GenerationModal: React.FC = () => {
    const { generationModal, setGenerationModal, builderAssets, builderSlots, handleGenerateSlot: onGenerate } = useProject();
    const { isOpen, targetSlotIndex } = generationModal;
    const onClose = () => setGenerationModal({ ...generationModal, isOpen: false });

    if (!isOpen || targetSlotIndex === null) return null;

    const [prompt, setPrompt] = useState('');
    const [contextType, setContextType] = useState<'neighbor' | 'library' | 'empty'>('neighbor');
    const [selectedAssetId, setSelectedAssetId] = useState<string>(builderAssets[0]?.id || '');

    // Determine neighbors for context suggestions
    // Assuming we don't have easy access to grid geometry here, we'll just offer "Previous Slot" as a simplified neighbor
    const prevSlot = builderSlots[targetSlotIndex - 1];
    const prevAsset = prevSlot ? builderAssets.find(a => a.id === prevSlot.assetId) : null;

    const handleGenerate = () => {
        onGenerate(targetSlotIndex, prompt, contextType, contextType === 'library' ? selectedAssetId : (prevAsset?.id));
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-panel border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-panelHeader">
                    <h2 className="text-lg font-semibold text-textMain flex items-center gap-2">
                        <Sparkles size={18} className="text-purple-400" /> Generate Frame
                    </h2>
                    <button onClick={onClose} className="text-textMuted hover:text-textMain transition-colors p-1 hover:bg-white/10 rounded-full">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    <div>
                        <label className="text-xs font-bold text-textMuted uppercase tracking-wider mb-2 block">Instruction</label>
                        <textarea 
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="Describe the variation (e.g., 'Make it look damaged', 'Change color to red', 'Add a glow effect')..."
                            className="w-full h-24 bg-input border border-border rounded-md p-3 text-sm text-textMain focus:border-accent focus:ring-1 focus:ring-accent outline-none resize-none"
                            autoFocus
                        />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-textMuted uppercase tracking-wider mb-3 block">Context Source</label>
                        <div className="grid grid-cols-1 gap-2">
                            {/* Neighbor Option */}
                            <button 
                                onClick={() => setContextType('neighbor')}
                                disabled={!prevAsset}
                                className={`flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${contextType === 'neighbor' ? 'bg-accent/10 border-accent ring-1 ring-accent' : 'bg-panel border-border hover:bg-tool'} ${!prevAsset ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <div className="w-10 h-10 bg-black/20 rounded flex items-center justify-center shrink-0 border border-border/50">
                                    {prevAsset ? <img src={prevAsset.src} className="max-w-full max-h-full p-1" alt="prev" /> : <Grid size={16} className="text-textMuted" />}
                                </div>
                                <div>
                                    <span className="text-sm font-medium text-textMain block">Use Neighboring Frame</span>
                                    <span className="text-xs text-textMuted block">{prevAsset ? `Based on "${prevAsset.name}"` : 'No previous frame found'}</span>
                                </div>
                                {contextType === 'neighbor' && <div className="ml-auto text-accent"><ArrowRight size={16} /></div>}
                            </button>

                            {/* Library Option */}
                            <button 
                                onClick={() => setContextType('library')}
                                disabled={builderAssets.length === 0}
                                className={`flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${contextType === 'library' ? 'bg-accent/10 border-accent ring-1 ring-accent' : 'bg-panel border-border hover:bg-tool'} ${builderAssets.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <div className="w-10 h-10 bg-black/20 rounded flex items-center justify-center shrink-0 border border-border/50">
                                    <ImageIcon size={18} className="text-textMuted" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <span className="text-sm font-medium text-textMain block">Select from Library</span>
                                    {contextType === 'library' && builderAssets.length > 0 && (
                                        <select 
                                            value={selectedAssetId} 
                                            onChange={(e) => setSelectedAssetId(e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                            className="mt-1 w-full bg-input border border-border rounded text-xs py-1 px-2 text-textMain outline-none"
                                        >
                                            {builderAssets.map(a => (
                                                <option key={a.id} value={a.id}>{a.name}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            </button>
                        </div>
                    </div>
                </div>

                <div className="p-4 bg-panel border-t border-border flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 text-xs font-medium text-textMuted hover:text-textMain transition-colors">Cancel</button>
                    <button 
                        onClick={handleGenerate}
                        className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded text-xs font-semibold shadow-lg shadow-purple-500/20 flex items-center gap-2 transition-all active:scale-95"
                    >
                        <Sparkles size={14} /> Generate Variation
                    </button>
                </div>
            </div>
        </div>
    );
};

export default GenerationModal;
