import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Film, Grid, Play, Pause, SkipBack, SkipForward, ChevronUp, ChevronDown, Clock, Layers, Square, X, PlusCircle, Box, Scissors } from 'lucide-react';
import { FrameData, ImageMeta, AppMode, SlotData, BuilderAsset, BuilderCanvasSize, SpriteAnimation, Keyframe, DND_KEYFRAME_TYPE, DND_ASSET_TYPE, DND_FRAME_TYPE } from '../types';
import { useProject } from '../contexts/ProjectContext';

const Timeline: React.FC = () => {
  const {
      frames, slicerImage: imageMeta, selectedIndex, setSelectedIndex, currentMode,
      builderAssets, builderSlots, animations, activeAnimationId, handleAddKeyframe: onAddKeyframe,
      handleReorderFrames: onReorderFrames, playbackFrameIndex, setPlaybackFrameIndex,
      isPlaying, setIsPlaying, handleStepFrame: onStepFrame, handleAddKeyframeFromAsset: onAddKeyframeFromAsset
  } = useProject();

  const activeAnimation = activeAnimationId ? animations.find(a => a.id === activeAnimationId) : undefined;
  const selectedFrameIndex = activeAnimation ? playbackFrameIndex : selectedIndex;
  const onSelectFrame = activeAnimation ? setPlaybackFrameIndex : setSelectedIndex;

  const [showTray, setShowTray] = useState(false);
  const [sourceType, setSourceType] = useState<'slicer' | 'builder'>('slicer');
  const [draggedKeyframeIndex, setDraggedKeyframeIndex] = useState<number | null>(null);
  const [isDragOverTimeline, setIsDragOverTimeline] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const isAnimationMode = !!activeAnimation;

  useEffect(() => {
    if (isAnimationMode && isPlaying && scrollContainerRef.current && playbackFrameIndex !== undefined) {
        const container = scrollContainerRef.current;
        const activeEl = container.children[0]?.children[playbackFrameIndex] as HTMLElement;
        if (activeEl) {
            const containerRect = container.getBoundingClientRect();
            const elRect = activeEl.getBoundingClientRect();
            if (elRect.left < containerRect.left || elRect.right > containerRect.right) {
                activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        }
    }
  }, [playbackFrameIndex, isAnimationMode, isPlaying]);

  // Slicer Sources: Representan la grilla base. Ahora son reactivos a los slots.
  const slicerSources = useMemo(() => {
    return frames.map((f) => {
        const slot = builderSlots?.[f.id];
        const asset = slot ? builderAssets?.find(a => a.id === slot.assetId) : null;
        return {
            id: f.id,
            type: asset ? 'slot' : 'frame', // Si hay asset, se comporta como un slot renderizable
            src: asset ? asset.src : imageMeta?.src,
            flipX: slot?.flipX,
            flipY: slot?.flipY,
            frameData: f
        };
    });
  }, [frames, imageMeta, builderSlots, builderAssets]);

  const builderSources = useMemo(() => {
    return Object.values(builderSlots || {}).map((slot: SlotData) => ({
        id: slot.gridIndex,
        type: 'slot',
        src: builderAssets?.find(a => a.id === slot.assetId)?.src || '',
        flipX: slot.flipX,
        flipY: slot.flipY,
        frameData: null 
    }));
  }, [builderSlots, builderAssets]);

  const availableSources = sourceType === 'slicer' ? slicerSources : builderSources;

  const handleDragStart = (e: React.DragEvent, index: number) => {
      setDraggedKeyframeIndex(index);
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData(DND_KEYFRAME_TYPE, index.toString());
      const div = document.createElement('div');
      div.style.width = '1px'; div.style.height = '1px';
      document.body.appendChild(div);
      e.dataTransfer.setDragImage(div, 0, 0);
      setTimeout(() => document.body.removeChild(div), 0);
  };

  const handleDragOver = (e: React.DragEvent, index?: number) => {
      e.preventDefault();
      if (draggedKeyframeIndex !== null && index !== undefined) {
         e.dataTransfer.dropEffect = 'move';
      }
  };
  
  const handleContainerDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      const types = e.dataTransfer.types;
      const isValid = types.includes(DND_ASSET_TYPE.toLowerCase()) || 
                      types.includes(DND_ASSET_TYPE) ||
                      types.includes(DND_FRAME_TYPE.toLowerCase()) ||
                      types.includes(DND_FRAME_TYPE);

      if (isValid) { 
          setIsDragOverTimeline(true);
          e.dataTransfer.dropEffect = 'copy';
      }
  };
  
  const handleContainerDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOverTimeline(false);
      
      const assetId = e.dataTransfer.getData(DND_ASSET_TYPE);
      const frameId = e.dataTransfer.getData(DND_FRAME_TYPE);

      if (assetId && onAddKeyframeFromAsset && isAnimationMode) {
          onAddKeyframeFromAsset(assetId);
      } else if (frameId && onAddKeyframe && isAnimationMode) {
          onAddKeyframe(parseInt(frameId));
      }
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
      e.preventDefault();
      e.stopPropagation();
      if (draggedKeyframeIndex === null || !activeAnimation || !onReorderFrames) return;
      if (draggedKeyframeIndex === dropIndex) return;
      const newKeyframes = [...activeAnimation.keyframes];
      const [removed] = newKeyframes.splice(draggedKeyframeIndex, 1);
      newKeyframes.splice(dropIndex, 0, removed);
      onReorderFrames(newKeyframes);
      setDraggedKeyframeIndex(null);
      if (playbackFrameIndex === draggedKeyframeIndex) setPlaybackFrameIndex?.(dropIndex);
  };

  const renderSourceThumbnail = (source: any) => {
      if (source.type === 'slot') {
          return (
             <div className="w-full h-full flex items-center justify-center p-0.5">
                <img 
                   src={source.src} 
                   className="max-w-full max-h-full object-contain filter drop-shadow-md"
                   style={{ transform: `scaleX(${source.flipX ? -1 : 1}) scaleY(${source.flipY ? -1 : 1})` }}
                   alt=""
                />
            </div>
          );
      } else {
          const f = source.frameData;
          if (!source.src || !imageMeta) return <div className="text-[8px] opacity-20">EMPTY</div>;
          return (
              <div className="w-full h-full flex items-center justify-center">
                  <div style={{ width: '100%', position: 'relative', aspectRatio: `${f.w} / ${f.h}`, overflow: 'hidden' }}>
                      <img
                          src={source.src}
                          alt={`frame ${f.id}`}
                          className="pointer-events-none select-none filter drop-shadow-md"
                          draggable={false}
                          style={{
                              position: 'absolute',
                              top: 0, left: 0, maxWidth: 'none',
                              width: `${(imageMeta.width / f.w) * 100}%`,
                              height: 'auto',
                              transform: `translate3d(-${(f.x / imageMeta.width) * 100}%, -${(f.y / imageMeta.height) * 100}%, 0)`,
                              imageRendering: 'pixelated',
                          }}
                      />
                  </div>
              </div>
          );
      }
  };

  return (
    <div className="h-full flex flex-col relative bg-panel z-10 shadow-3d-hover border-t border-white/5 timeline-area">
      
      <div className="h-10 bg-surface border-b border-white/5 flex items-center justify-between px-4 shrink-0 select-none">
         <div className="flex items-center gap-3 text-textMuted">
            {isAnimationMode ? <Clock size={16} className="text-accent" /> : <Grid size={16} />}
            <span className="text-xs font-bold uppercase tracking-widest text-textMain">
                {isAnimationMode && activeAnimation ? activeAnimation.name : 'Frame Selection'}
            </span>
             {isAnimationMode && activeAnimation && <span className="text-textMain font-mono text-sm px-2">{(playbackFrameIndex! + 1).toString().padStart(2, '0')}<span className="opacity-50">/</span>{activeAnimation.keyframes.length.toString().padStart(2, '0')}</span>}
         </div>
         
         {isAnimationMode && (
             <div className="flex items-center gap-2 bg-input p-1 rounded-md border border-white/5">
                <button onClick={() => onStepFrame?.(-1)} className="p-1.5 hover:bg-white/10 rounded-sm text-textMuted hover:text-white transition-all active:scale-90"><SkipBack size={12} /></button>
                <button onClick={() => setIsPlaying?.(!isPlaying)} className={`w-6 h-6 rounded-sm flex items-center justify-center transition-all ${isPlaying ? 'bg-accent text-white' : 'text-textMain hover:bg-white/10'}`}>
                    {isPlaying ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" className="ml-0.5" />}
                </button>
                <button onClick={() => { setIsPlaying?.(false); onStepFrame?.(-9999); }} className="p-1.5 hover:bg-white/10 rounded-sm text-textMuted hover:text-white transition-all active:scale-90"><Square size={10} fill="currentColor" /></button>
                <button onClick={() => onStepFrame?.(1)} className="p-1.5 hover:bg-white/10 rounded-sm text-textMuted hover:text-white transition-all active:scale-90"><SkipForward size={12} /></button>
            </div>
         )}

         {isAnimationMode && (
             <button 
                onClick={() => setShowTray(!showTray)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all duration-200 border ${showTray ? 'border-accent text-accent bg-accent/10' : 'border-transparent text-textMuted hover:bg-white/5'}`}
             >
                 {showTray ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                 Add Frames
             </button>
         )}
      </div>

      <div 
        ref={scrollContainerRef}
        className={`flex-1 bg-input overflow-x-auto p-4 flex items-center relative transition-colors duration-200 ${isDragOverTimeline ? 'bg-accent/5' : ''}`}
        onDragOver={handleContainerDragOver}
        onDragLeave={() => setIsDragOverTimeline(false)}
        onDrop={handleContainerDrop}
      >
         {isDragOverTimeline && (
             <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
                 <div className="bg-accent text-white px-6 py-4 rounded-xl shadow-lg font-bold text-sm flex items-center gap-3 border border-white/20">
                     <PlusCircle size={24} /> Drop to Add Keyframe
                 </div>
             </div>
         )}
         
         <div className="flex gap-2 h-full min-w-full items-center px-4 z-10 pb-4">
            {isAnimationMode && activeAnimation ? (
                 activeAnimation.keyframes.length === 0 ? (
                    <div className="w-full h-32 flex flex-col items-center justify-center border border-dashed border-white/10 rounded-lg bg-white/5 hover:bg-white/10 hover:border-accent/50 group cursor-pointer transition-all select-none" onClick={() => setShowTray(true)}>
                        <div className="p-4 rounded-full bg-surface mb-3"><Layers size={24} className="text-textMuted group-hover:text-accent transition-colors" /></div>
                        <span className="text-sm font-medium text-textMain">Timeline is Empty</span>
                        <div className="flex items-center gap-1 text-xs text-textMuted mt-1"><span>Drag frames/assets here or click "Add Frames"</span></div>
                    </div>
                 ) : (
                     activeAnimation.keyframes.map((kf, idx) => {
                         const source = slicerSources.find(s => s.id === kf.sourceIndex) || builderSources.find(s => s.id === kf.sourceIndex);
                         const isPlayingFrame = playbackFrameIndex === idx;
                         const isSelected = selectedFrameIndex === idx; 
                         return (
                            <div 
                                key={kf.uid} draggable onDragStart={(e) => handleDragStart(e, idx)} onDragOver={(e) => handleDragOver(e, idx)} onDrop={(e) => handleDrop(e, idx)}
                                onClick={() => { onSelectFrame(idx); setPlaybackFrameIndex?.(idx); }}
                                className={`relative group flex-shrink-0 w-[80px] h-[100px] cursor-pointer select-none flex flex-col transition-all duration-200 ${isPlayingFrame ? 'z-10 -translate-y-2' : 'z-0'} ${draggedKeyframeIndex === idx ? 'opacity-20' : 'opacity-100'}`}
                            >   
                                <div className={`absolute -top-3 left-1/2 -translate-x-1/2 transition-opacity duration-200 ${isPlayingFrame ? 'opacity-100' : 'opacity-0'}`}>
                                    <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-accent"></div>
                                </div>
                                <div className={`flex-1 rounded-lg flex flex-col overflow-hidden transition-all duration-200 border ${isPlayingFrame ? 'bg-surface border-accent ring-1 ring-accent' : isSelected ? 'bg-panel border-white/40' : 'bg-panel border-white/10 hover:border-white/30'}`}>
                                    <div className="flex-1 relative p-2 bg-checkered">{source ? renderSourceThumbnail(source) : <div className="w-full h-full flex items-center justify-center text-red-500 text-xs">!</div>}</div>
                                    <div className={`h-6 text-[10px] font-mono flex items-center justify-center border-t border-white/5 font-bold ${isPlayingFrame ? 'bg-accent text-white' : 'bg-surface text-textMuted'}`}>{idx + 1}</div>
                                </div>
                            </div>
                         );
                     })
                 )
            ) : (
                slicerSources.length === 0 ? (
                    <div className="w-full h-full flex flex-col items-center justify-center text-sm text-textMuted opacity-50 select-none">
                         <Layers size={36} className="mb-2 opacity-50" />
                         <span className="italic">Workspace grid is not initialized.</span>
                    </div>
                ) : (
                    slicerSources.map((source) => (
                        <div key={source.id} onClick={() => onSelectFrame(source.id)} className="relative group flex-shrink-0 w-[72px] h-[90px] cursor-pointer select-none flex flex-col">
                            <div className={`flex-1 rounded-lg flex flex-col overflow-hidden transition-all duration-200 border ${selectedFrameIndex === source.id ? 'bg-panel border-accent ring-1 ring-accent shadow-sm' : 'bg-panel border-white/10 hover:border-white/30'}`}>
                                 <div className="flex-1 relative p-1.5 bg-checkered">{renderSourceThumbnail(source)}</div>
                                 <div className={`h-5 text-[10px] font-mono flex items-center justify-center border-t border-white/5 ${selectedFrameIndex === source.id ? 'bg-accent text-white' : 'bg-surface text-textMuted'}`}>{source.id}</div>
                            </div>
                        </div>
                    ))
                )
            )}
         </div>
      </div>

      {isAnimationMode && showTray && (
          <div className="absolute bottom-full left-2 right-2 h-[210px] bg-panel border border-white/10 shadow-xl z-30 flex flex-col rounded-t-xl animate-slide-up origin-bottom">
              <div className="h-10 bg-surface px-4 flex items-center justify-between border-b border-white/5 rounded-t-xl select-none">
                  <div className="flex items-center gap-4">
                      <span className="text-xs font-bold text-textMain uppercase tracking-wider flex items-center gap-2"><Grid size={14} className="text-accent" /> Frame Picker</span>
                      <div className="flex bg-black/40 rounded-lg p-0.5 border border-white/5">
                          <button 
                            onClick={() => setSourceType('slicer')}
                            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${sourceType === 'slicer' ? 'bg-accent text-white shadow-sm' : 'text-textMuted hover:text-white'}`}
                          >
                              <Scissors size={12} /> Slicer / Grid
                          </button>
                          <button 
                            onClick={() => setSourceType('builder')}
                            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${sourceType === 'builder' ? 'bg-accent text-white shadow-sm' : 'text-textMuted hover:text-white'}`}
                          >
                              <Box size={12} /> Builder Slots
                          </button>
                      </div>
                  </div>
                  <button onClick={() => setShowTray(false)} className="hover:bg-white/10 p-1.5 rounded-full active:scale-90 transition-transform"><X size={14} className="text-textMuted hover:text-white"/></button>
              </div>
              <div className="flex-1 overflow-x-auto p-4 flex gap-3 bg-black/40 custom-scrollbar items-center">
                  {availableSources.length === 0 ? (
                      <div className="w-full text-center text-xs text-textMuted py-8">
                          No {sourceType === 'slicer' ? 'frames' : 'builder slots'} found. 
                      </div>
                  ) : availableSources.map((source, i) => (
                    <div 
                        key={source.id}
                        onClick={() => onAddKeyframe?.(source.id)}
                        className="relative group flex-shrink-0 w-[64px] h-[64px] bg-panel border border-white/10 hover:border-accent hover:shadow-sm hover:-translate-y-1 transition-all cursor-pointer rounded-md overflow-hidden animate-fade-in"
                        style={{ animationDelay: `${i * 20}ms` }}
                    >
                         <div className="absolute inset-0 bg-checkered opacity-50"></div>
                         <div className="absolute inset-0 p-1 z-10">{renderSourceThumbnail(source)}</div>
                         <div className="absolute inset-0 bg-accent/80 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity z-20 font-bold text-lg backdrop-blur-sm">
                             <PlusCircle size={24} />
                         </div>
                         <div className="absolute bottom-0 right-0 px-1 bg-black/60 text-[8px] text-white font-mono z-30">#{source.id}</div>
                    </div>
                  ))}
              </div>
          </div>
      )}
    </div>
  );
};

export default Timeline;