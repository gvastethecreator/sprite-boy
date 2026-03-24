
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Monitor, Plus, Layers, LayoutGrid,
    Maximize2, Box, RotateCw, RotateCcw, Ghost,
    AlignLeft, AlignCenter, AlignRight, AlignStartVertical, AlignEndVertical, AlignCenterVertical,
    Target, Shield, Zap, Info, FlipHorizontal, FlipVertical, GripHorizontal
} from 'lucide-react';
import {
    AppMode, BuilderCanvasSize, BuilderAsset, SpriteAnimation, Keyframe,
    TemplateConfig, OnionSkinConfig, GenerationPanelState,
    SlotData, FrameData, ImageMeta, GridConfig, SlotAlignment, HitboxType
} from '../../types';
import NumberControl from '../common/NumberControl';
import FrameProperties from '../panels/right/FrameProperties';
import AnimationProperties from '../panels/right/AnimationProperties';
import FrameList from '../panels/right/FrameList';
import AssetLibrary from '../panels/left/AssetLibrary';
import { SectionHeader } from '../common/PanelComponents';
import { ASPECT_RATIOS } from '../canvas/CanvasToolbar';
import { RATIO_PRESETS, DEFAULT_SLOT_DATA } from '../../hooks/domains/useBuilderLogic';
import { useProject } from '../../contexts/ProjectContext';

const ALIGNMENTS: { id: SlotAlignment, icon: any }[] = [
    { id: 'top-left', icon: AlignStartVertical }, { id: 'top-center', icon: AlignCenterVertical }, { id: 'top-right', icon: AlignEndVertical },
    { id: 'middle-left', icon: AlignLeft }, { id: 'center', icon: AlignCenter }, { id: 'middle-right', icon: AlignRight },
    { id: 'bottom-left', icon: AlignStartVertical }, { id: 'bottom-center', icon: AlignCenterVertical }, { id: 'bottom-right', icon: AlignEndVertical }
];

const RightSidebar: React.FC = () => {
    const {
        currentMode, slicerImage: imageMeta, frames, selectedIndex: selectedFrameIndex,
        setSelectedIndex: onSelectFrame, handleUpdateFrame: onUpdateFrame,
        handleUpdateFrameEphemeral: onUpdateFrameEphemeral, handleDeleteFrame: onDeleteFrame,
        handleDuplicateFrame: onDuplicateFrame, handleToggleFrameVisibility: onToggleFrameVisibility,
        handleFrameToAsset: onFrameToAsset, builderCanvas, handleCreateCanvas: onCreateCanvas,
        selectedIndex: selectedSlotIndex, builderSlots, builderAssets, handleAddAsset: onAddAsset,
        handleDeleteAsset: onDeleteAsset, handleUpdateSlot: onUpdateSlot, animations,
        activeAnimationId, handleUpdateAnimation: onUpdateAnimation,
        playbackFrameIndex: selectedKeyframeIndex, handleUpdateKeyframe: onUpdateKeyframe,
        handleDeleteKeyframe: onDeleteKeyframe, handleDuplicateKeyframe: onDuplicateKeyframe,
        onionSkin, setOnionSkin
    } = useProject();

    const selectedFrame = selectedFrameIndex !== null ? frames[selectedFrameIndex] : null;
    const activeAnimation = activeAnimationId ? animations.find(a => a.id === activeAnimationId) : null;

    const [customW, setCustomW] = useState('1024');
    const [customH, setCustomH] = useState('1024');
    const [selectedRatio, setSelectedRatio] = useState('1:1');
    const [activeTab, setActiveTab] = useState<'layers' | 'source' | 'library'>('layers');

    // Resizing Logic
    const [bottomPanelHeight, setBottomPanelHeight] = useState(280);
    const isResizingRef = useRef(false);

    const startResizing = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isResizingRef.current = true;
        const startY = e.clientY;
        const startHeight = bottomPanelHeight;

        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizingRef.current) return;
            const delta = startY - e.clientY;
            const newHeight = Math.min(Math.max(100, startHeight + delta), window.innerHeight - 150);
            setBottomPanelHeight(newHeight);
        };

        const handleMouseUp = () => {
            isResizingRef.current = false;
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
        };

        document.body.style.cursor = 'row-resize';
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }, [bottomPanelHeight]);

    // Handle Component
    const ResizeHandle = () => (
        <div
            onMouseDown={startResizing}
            className="h-2 bg-panel border-y border-white/5 cursor-row-resize flex items-center justify-center hover:bg-white/5 group transition-colors shrink-0 z-20"
        >
            <GripHorizontal size={12} className="text-textMuted/20 group-hover:text-textMuted transition-colors" />
        </div>
    );

    useEffect(() => {
        if (builderCanvas) {
            setCustomW(builderCanvas.width.toString());
            setCustomH(builderCanvas.height.toString());
        }
    }, [builderCanvas]);

    const handleRatioChange = (ratio: string) => {
        setSelectedRatio(ratio);
        const preset = RATIO_PRESETS[ratio];
        if (preset) {
            setCustomW(preset.w.toString());
            setCustomH(preset.h.toString());
        }
    };

    const hasWorkspace = !!builderCanvas || !!imageMeta;

    if (currentMode === AppMode.BUILDER && !hasWorkspace) {
        return (
            <aside className="h-full flex flex-col items-center justify-center p-8 text-center bg-panel border-l border-white/5">
                <div className="w-full animate-slide-in-right">
                    <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mb-6 border border-white/10 mx-auto">
                        <Monitor size={32} className="text-textMuted" />
                    </div>
                    <h3 className="text-sm font-bold text-textMain mb-2 uppercase tracking-widest">Init Workspace</h3>
                    <div className="space-y-4 w-full text-left">
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-textMuted uppercase tracking-widest flex items-center gap-2">
                                <Maximize2 size={12} className="text-accent" /> Aspect Ratio
                            </label>
                            <select
                                value={selectedRatio}
                                onChange={(e) => handleRatioChange(e.target.value)}
                                className="w-full bg-input border border-white/10 rounded-lg text-xs p-2.5 text-textMain outline-none transition-all"
                            >
                                {ASPECT_RATIOS.map(group => (
                                    <optgroup key={group.label} label={group.label}>
                                        {group.items.map(ratio => <option key={ratio} value={ratio}>{ratio}</option>)}
                                    </optgroup>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-center gap-2">
                            <NumberControl value={parseInt(customW)} onChange={(v) => setCustomW(v.toString())} unit="w" className="flex-1" labelClassName="hidden" />
                            <NumberControl value={parseInt(customH)} onChange={(v) => setCustomH(v.toString())} unit="h" className="flex-1" labelClassName="hidden" />
                        </div>
                        <button onClick={() => onCreateCanvas?.(parseInt(customW) || 1024, parseInt(customH) || 1024)} className="w-full py-2.5 btn-primary text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 shadow-glow-sm active:scale-95">
                            <Plus size={16} /> Create Workspace
                        </button>
                    </div>
                </div>
            </aside>
        );
    }

    // COLLISION MODE
    if (currentMode === AppMode.COLLISION) {
        return (
            <aside className="h-full flex flex-col bg-panel border-l border-white/5 overflow-hidden">
                <SectionHeader title="Collision Box" icon={Target} colorClass="text-red-500" />
                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
                    {selectedFrame ? (
                        <div className="space-y-6 animate-fade-in">
                            <div className="bg-black/30 p-3 rounded-lg border border-white/5 flex items-center gap-3">
                                <div className="w-8 h-8 rounded bg-red-500/20 flex items-center justify-center text-red-500">
                                    <Shield size={16} />
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-textMuted uppercase">Active Frame</div>
                                    <div className="text-xs font-mono text-textMain">ID #{selectedFrame.id}</div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <label className="text-[10px] font-bold text-textMuted uppercase tracking-wider">Physics Boxes</label>
                                <div className="grid grid-cols-1 gap-2">
                                    <button className="w-full flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5 hover:border-red-500/50 transition-all group">
                                        <div className="flex items-center gap-3">
                                            <Zap size={14} className="text-red-500" />
                                            <span className="text-xs text-textMain">Add Damage Box</span>
                                        </div>
                                        <Plus size={14} className="opacity-0 group-hover:opacity-100 text-red-500 transition-opacity" />
                                    </button>
                                    <button className="w-full flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5 hover:border-blue-500/50 transition-all group">
                                        <div className="flex items-center gap-3">
                                            <Shield size={14} className="text-blue-500" />
                                            <span className="text-xs text-textMain">Add Guard Box</span>
                                        </div>
                                        <Plus size={14} className="opacity-0 group-hover:opacity-100 text-blue-500 transition-opacity" />
                                    </button>
                                </div>
                            </div>

                            <div className="bg-yellow-500/10 border border-yellow-500/20 p-4 rounded-xl flex gap-3">
                                <Info size={16} className="text-yellow-500 shrink-0" />
                                <p className="text-[10px] text-yellow-200/80 leading-relaxed">
                                    Collision metadata allows your game engine to detect interactions. Export as JSON to link these regions to your physics logic.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-textMuted opacity-30 text-center py-20">
                            <Target size={40} className="mb-4" />
                            <p className="text-[10px] font-bold uppercase tracking-widest">Select frame to add col</p>
                        </div>
                    )}
                </div>

                <ResizeHandle />

                <div style={{ height: bottomPanelHeight }} className="shrink-0 border-t border-white/5">
                    <FrameList
                        frames={frames || []}
                        imageMeta={imageMeta || null}
                        selectedIndex={selectedFrameIndex ?? null}
                        onSelectFrame={(idx) => onSelectFrame?.(idx)}
                        onDeleteFrame={(idx) => onDeleteFrame?.(idx)}
                        onToAsset={(id) => onFrameToAsset?.(id)}
                    />
                </div>
            </aside>
        );
    }

    if (activeAnimation && onUpdateAnimation) {
        return (
            <aside className="h-full flex flex-col bg-panel border-l border-white/5 overflow-hidden">
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    <AnimationProperties animation={activeAnimation} keyframeIndex={selectedKeyframeIndex ?? null} onUpdateAnim={onUpdateAnimation} onUpdateKeyframe={onUpdateKeyframe} onDeleteKeyframe={onDeleteKeyframe} onDuplicateKeyframe={onDuplicateKeyframe} onionSkin={onionSkin} setOnionSkin={setOnionSkin} />
                </div>

                <ResizeHandle />

                <div style={{ height: bottomPanelHeight }} className="shrink-0 border-t border-white/5">
                    <FrameList
                        frames={frames || []}
                        imageMeta={imageMeta || null}
                        builderSlots={builderSlots}
                        builderAssets={builderAssets}
                        selectedIndex={selectedFrameIndex ?? null}
                        onSelectFrame={(idx) => onSelectFrame?.(idx)}
                        onDeleteFrame={(idx) => onDeleteFrame?.(idx)}
                        onToAsset={(id) => onFrameToAsset?.(id)}
                        onToggleVisibility={onToggleFrameVisibility}
                    />
                </div>
            </aside>
        );
    }

    if (currentMode === AppMode.BUILDER) {
        const selectedSlotData = selectedSlotIndex !== null ? builderSlots?.[selectedSlotIndex!] : null;

        const updateSlot = (patch: Partial<SlotData>) => {
            if (selectedSlotData) {
                let newData = { ...selectedSlotData, ...patch };
                if (patch.scaleX !== undefined && selectedSlotData.lockAspect) newData.scaleY = patch.scaleX;
                if (patch.scaleY !== undefined && selectedSlotData.lockAspect) newData.scaleX = patch.scaleY;
                onUpdateSlot?.(selectedSlotData.gridIndex, newData);
            }
        };

        const resetSlot = () => {
            if (selectedSlotData) {
                onUpdateSlot?.(selectedSlotData.gridIndex, DEFAULT_SLOT_DATA(selectedSlotData.gridIndex, selectedSlotData.assetId));
            }
        };

        return (
            <div className="h-full flex flex-col bg-panel border-l border-white/5 overflow-hidden">
                <SectionHeader title="Slot Inspector" icon={LayoutGrid} action={selectedSlotData && <button onClick={resetSlot} className="p-1 hover:bg-white/10 rounded text-textMuted hover:text-white transition-colors" title="Reset Slot"><RotateCcw size={14} /></button>} />

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {selectedSlotData ? (
                        <div className="p-4 space-y-6 animate-fade-in">
                            <div className="flex items-center gap-3 bg-black/30 p-2 rounded-lg border border-white/5">
                                <div className="w-10 h-10 bg-checkered rounded overflow-hidden shrink-0 flex items-center justify-center border border-white/10">
                                    {builderAssets?.find(a => a.id === selectedSlotData.assetId) && <img src={builderAssets.find(a => a.id === selectedSlotData.assetId)!.src} className="max-w-full max-h-full object-contain" alt="asset" />}
                                </div>
                                <div className="min-w-0">
                                    <div className="text-[10px] font-bold text-accent uppercase tracking-widest">Cell #{selectedSlotData.gridIndex}</div>
                                    <div className="text-[9px] text-textMuted truncate">{builderAssets?.find(a => a.id === selectedSlotData.assetId)?.name || 'Unknown Asset'}</div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[9px] font-bold text-textMuted uppercase tracking-widest flex items-center gap-2">Alignment Point</label>
                                <div className="grid grid-cols-3 gap-1 bg-black/20 p-1 rounded-lg w-fit mx-auto border border-white/5">
                                    {ALIGNMENTS.map((align, i) => (
                                        <button
                                            key={i}
                                            onClick={() => updateSlot({ alignment: align.id })}
                                            className={`w-10 h-10 rounded flex items-center justify-center transition-all ${selectedSlotData.alignment === align.id ? 'bg-accent text-white shadow-sm' : 'text-textMuted hover:bg-white/5'}`}
                                        >
                                            <align.icon size={16} className={align.id === 'center' ? '' : 'opacity-60'} />
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-3 pt-4 border-t border-white/5">
                                <div className="flex items-center justify-between">
                                    <label className="text-[9px] font-bold text-textMuted uppercase tracking-wider flex items-center gap-2">
                                        Transform
                                    </label>
                                </div>

                                {/* Enhanced Rotation Controls */}
                                <div className="flex items-center gap-2">
                                    <div className="flex-1">
                                        <NumberControl icon={RotateCw} label="Rot" value={selectedSlotData.rotation} onChange={(v) => updateSlot({ rotation: v })} min={-360} max={360} unit="°" labelClassName="w-8 text-[9px]" />
                                    </div>
                                    <button
                                        onClick={() => updateSlot({ rotation: (selectedSlotData.rotation - 90) })}
                                        className="p-2 bg-surface hover:bg-white/10 rounded-md border border-white/5 text-textMuted hover:text-white transition-colors active:scale-95"
                                        title="-90°"
                                    >
                                        <RotateCcw size={14} />
                                    </button>
                                    <button
                                        onClick={() => updateSlot({ rotation: (selectedSlotData.rotation + 90) })}
                                        className="p-2 bg-surface hover:bg-white/10 rounded-md border border-white/5 text-textMuted hover:text-white transition-colors active:scale-95"
                                        title="+90°"
                                    >
                                        <RotateCw size={14} />
                                    </button>
                                </div>

                                <NumberControl icon={Ghost} label="Opacity" value={selectedSlotData.opacity * 100} onChange={(v) => updateSlot({ opacity: v / 100 })} min={0} max={100} slider unit="%" labelClassName="w-16 text-[9px]" />
                            </div>

                            <div className="space-y-3 pt-4 border-t border-white/5">
                                <label className="text-[9px] font-bold text-textMuted uppercase tracking-wider block">Geometry</label>

                                {/* New Flip Controls */}
                                <div className="grid grid-cols-2 gap-2 mb-3">
                                    <button
                                        onClick={() => updateSlot({ flipX: !selectedSlotData.flipX })}
                                        className={`py-2 px-3 rounded-lg flex items-center justify-center gap-2 text-[10px] font-bold border transition-all active:scale-95 ${selectedSlotData.flipX ? 'bg-accent text-white border-accent' : 'bg-surface border-white/10 text-textMuted hover:text-white hover:bg-white/5'}`}
                                    >
                                        <FlipHorizontal size={14} /> Flip Hor
                                    </button>
                                    <button
                                        onClick={() => updateSlot({ flipY: !selectedSlotData.flipY })}
                                        className={`py-2 px-3 rounded-lg flex items-center justify-center gap-2 text-[10px] font-bold border transition-all active:scale-95 ${selectedSlotData.flipY ? 'bg-accent text-white border-accent' : 'bg-surface border-white/10 text-textMuted hover:text-white hover:bg-white/5'}`}
                                    >
                                        <FlipVertical size={14} /> Flip Ver
                                    </button>
                                </div>

                                <select
                                    value={selectedSlotData.fitMode}
                                    onChange={(e) => updateSlot({ fitMode: e.target.value as any })}
                                    className="w-full bg-input border border-white/10 rounded-lg text-[10px] p-2.5 focus:border-accent text-textMain outline-none transition-all"
                                >
                                    <option value="fit">Contain (Fit)</option><option value="fill">Cover (Fill)</option><option value="original">Original Size</option><option value="stretch">Stretch to Cell</option>
                                </select>
                            </div>
                        </div>
                    ) : selectedFrame ? (
                        <div className="animate-fade-in">
                            <FrameProperties
                                frame={selectedFrame}
                                onUpdate={onUpdateFrame!}
                                onCommit={onUpdateFrame!}
                                onToAsset={onFrameToAsset}
                                onDuplicate={onDuplicateFrame}
                            />
                        </div>
                    ) : (
                        <div className="p-10 text-center flex flex-col items-center justify-center h-full opacity-30">
                            <Box size={32} className="mb-2" />
                            <p className="text-[10px] font-bold uppercase tracking-widest">Select cell or frame</p>
                        </div>
                    )}
                </div>

                <ResizeHandle />

                <div className="flex items-center gap-1 p-1 bg-white/5 border-b border-white/5 shrink-0">
                    <button onClick={() => setActiveTab('layers')} className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-[10px] font-bold uppercase transition-all ${activeTab === 'layers' ? 'bg-accent text-white' : 'text-textMuted hover:bg-white/5'}`}><Layers size={12} /> Composition</button>
                    <button onClick={() => setActiveTab('library')} className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-[10px] font-bold uppercase transition-all ${activeTab === 'library' ? 'bg-accent text-white' : 'text-textMuted hover:bg-white/5'}`}><Box size={12} /> Library</button>
                </div>

                <div style={{ height: bottomPanelHeight }} className="overflow-y-auto custom-scrollbar bg-black/10 shrink-0">
                    {activeTab === 'layers' && (
                        <FrameList
                            frames={frames || []}
                            imageMeta={imageMeta || null}
                            builderSlots={builderSlots}
                            builderAssets={builderAssets}
                            selectedIndex={selectedFrameIndex ?? null}
                            onSelectFrame={(idx) => onSelectFrame?.(idx)}
                            onDeleteFrame={(idx) => onDeleteFrame?.(idx)}
                            onToAsset={(id) => onFrameToAsset?.(id)}
                            onToggleVisibility={onToggleFrameVisibility}
                        />
                    )}
                    {activeTab === 'library' && (
                        <div className="animate-fade-in h-full">
                            <AssetLibrary builderAssets={builderAssets} onAddAsset={onAddAsset} onDeleteAsset={onDeleteAsset} />
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <aside className="h-full flex flex-col items-center justify-center p-8 text-center bg-panel border-l border-white/5 opacity-40">
            <Box size={48} className="mb-4 text-textMuted stroke-1" />
            <p className="text-[10px] font-bold uppercase tracking-widest">Select workspace resource</p>
        </aside>
    );
};

export default RightSidebar;
