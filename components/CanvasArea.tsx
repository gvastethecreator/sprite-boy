
import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle, useLayoutEffect, useCallback } from 'react';
import { AppMode, GridConfig, ImageMeta, FrameData, BuilderCanvasSize, BuilderAsset, SlotData, SpriteAnimation, TemplateConfig, Keyframe, OnionSkinConfig, CanvasHandle, HitboxData, DragMode, FrameLabelConfig, DND_ASSET_TYPE, ViewportState } from '../types';
import { ImagePlus, Upload, Plus, Maximize2, Monitor } from 'lucide-react';
import { CanvasRenderer } from '../utils/renderUtils';
import { rgbToHex } from '../utils/algorithms';
import { getGridIndexFromPos } from '../utils/canvasMath';
import { ASPECT_RATIOS } from './CanvasToolbar';
import { RATIO_PRESETS } from '../hooks/domains/useBuilderLogic';
import CanvasToolbar from './CanvasToolbar';
import CanvasStatusBar from './CanvasStatusBar';
import NumberControl from './NumberControl';
import { useProject } from '../contexts/ProjectContext';

const CanvasArea = forwardRef<CanvasHandle, {}>((props, ref) => {
  const {
      currentMode, slicerImage: imageMeta, activeGrid: gridConfig, builderGrid, frames,
      selectedIndex: selectedFrameIndex, setSelectedIndex: onSelectFrame, handleUpload: onUpload,
      builderCanvas, handleCreateCanvas: onCreateCanvas, builderAssets, builderSlots,
      handleUpdateSlot: onUpdateSlot, handleUpdateSlotEphemeral: onUpdateSlotEphemeral,
      activeAnimationId, animations, playbackFrameIndex = 0, isPlaying = false, onionSkin,
      templateConfig, isLoading, loadingMessage, isEyedropperActive, setEyedropperColor: onPickColor,
      isMagicWandActive, wandTolerance: magicWandTolerance, handleUpdateFrame: onUpdateFrame,
      handleUpdateFrameEphemeral: onUpdateFrameEphemeral, handleAddFrame: onAddFrame,
      handleSwapSlots: onSwapSlots, viewport, setViewport, currentAspectRatio, handleSetAspectRatio: onSetAspectRatio,
      preferences, handleMagicWandSelect: onMagicWandSelect, handleDeleteSelection: onDeleteSelection
  } = useProject();

  const activeAnimation = activeAnimationId ? animations.find(a => a.id === activeAnimationId) : null;
  const labelConfig = preferences.frameLabel;
  const snapEnabled = preferences.snapEnabled;
  const snapThreshold = preferences.snapThreshold;
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const localInputRef = useRef<HTMLInputElement>(null);
  const lastSourceRef = useRef<string | null>(null);

  const [canvasDims, setCanvasDims] = useState({ w: 0, h: 0 });
  const [dragMode, setDragMode] = useState<DragMode>(DragMode.NONE);
  const [startMousePos, setStartMousePos] = useState({ x: 0, y: 0 });
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [dragSelectionRect, setDragSelectionRect] = useState<{x:number, y:number, w:number, h:number} | null>(null);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [mousePos, setMousePos] = useState({x: 0, y: 0});
  const [slicerImgObj, setSlicerImgObj] = useState<HTMLImageElement | null>(null);
  const [assetCache, setAssetCache] = useState<Record<string, HTMLImageElement>>({});
  const [modifiers, setModifiers] = useState({ shift: false, ctrl: false, alt: false });
  const [dragHoverSlot, setDragHoverSlot] = useState<number | null>(null);
  const [isDragOverCanvas, setIsDragOverCanvas] = useState(false);
  const [dragStartSlot, setDragStartSlot] = useState<number | null>(null);

  const [initW, setInitW] = useState('1024');
  const [initH, setInitH] = useState('1024');
  const [initRatio, setInitRatio] = useState('1:1');

  const propsRef = useRef({
      currentMode, imageMeta, gridConfig, builderGrid, frames, selectedFrameIndex, onSelectFrame, onUpload, builderCanvas, onCreateCanvas, builderAssets, builderSlots, onUpdateSlot, onUpdateSlotEphemeral, activeAnimation, playbackFrameIndex, isPlaying, onionSkin, templateConfig, isLoading, loadingMessage, isEyedropperActive, onPickColor, onUpdateFrame, onUpdateFrameEphemeral, onAddFrame, onSwapSlots, viewport, setViewport, currentAspectRatio, onSetAspectRatio, isMagicWandActive, magicWandTolerance, labelConfig, snapEnabled, snapThreshold, onMagicWandSelect, onDeleteSelection
  });
  const stateRef = useRef({ viewport, dragMode, mousePos, dragSelectionRect, dragHoverSlot, isDragOverCanvas, dragStartSlot });

  const isEmpty = !imageMeta && !builderCanvas;

  useLayoutEffect(() => { 
    propsRef.current = {
        currentMode, imageMeta, gridConfig, builderGrid, frames, selectedFrameIndex, onSelectFrame, onUpload, builderCanvas, onCreateCanvas, builderAssets, builderSlots, onUpdateSlot, onUpdateSlotEphemeral, activeAnimation, playbackFrameIndex, isPlaying, onionSkin, templateConfig, isLoading, loadingMessage, isEyedropperActive, onPickColor, onUpdateFrame, onUpdateFrameEphemeral, onAddFrame, onSwapSlots, viewport, setViewport, currentAspectRatio, onSetAspectRatio, isMagicWandActive, magicWandTolerance, labelConfig, snapEnabled, snapThreshold, onMagicWandSelect, onDeleteSelection
    }; 
    stateRef.current = { viewport, dragMode, mousePos, dragSelectionRect, dragHoverSlot, isDragOverCanvas, dragStartSlot }; 
  });

  useEffect(() => {
    const c = canvasRef.current;
    if (c && canvasDims.w > 0 && canvasDims.h > 0) {
        const dpr = window.devicePixelRatio || 1;
        c.width = canvasDims.w * dpr;
        c.height = canvasDims.h * dpr;
        c.style.width = `${canvasDims.w}px`;
        c.style.height = `${canvasDims.h}px`;
    }
  }, [canvasDims]);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((e) => {
        if (e[0]) setCanvasDims({ w: e[0].contentRect.width, h: e[0].contentRect.height });
    });
    obs.observe(containerRef.current); 
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      setModifiers(p => ({ shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey }));
      if (!(e.target instanceof HTMLInputElement)) {
          if (e.code === 'Space') { e.preventDefault(); setIsSpacePressed(true); }
      }
    };
    const up = (e: KeyboardEvent) => { 
        if (e.code === 'Space') setIsSpacePressed(false); 
        setModifiers(p => ({ shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey })); 
    };
    window.addEventListener('keydown', down); 
    window.addEventListener('keyup', up); 
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  useEffect(() => {
    if (imageMeta) { 
        const img = new Image(); 
        img.crossOrigin = "anonymous"; 
        img.src = imageMeta.src; 
        img.onload = () => setSlicerImgObj(img); 
    } else setSlicerImgObj(null);
  }, [imageMeta]); 

  useEffect(() => {
    builderAssets?.forEach(a => { 
        if (!assetCache[a.id]) { 
            const img = new Image(); 
            img.crossOrigin = "anonymous"; 
            img.src = a.src; 
            img.onload = () => setAssetCache(prev => ({ ...prev, [a.id]: img })); 
        } 
    });
  }, [builderAssets, assetCache]); 

  const handleResetView = useCallback(() => { 
    const w = builderCanvas?.width || imageMeta?.width || 1024;
    const h = builderCanvas?.height || imageMeta?.height || 1024; 
    
    if (containerRef.current) { 
        const { clientWidth: cw, clientHeight: ch } = containerRef.current; 
        if (cw === 0 || ch === 0) return;
        const pad = 80; 
        const isDualView = currentMode === AppMode.ANIMATION && !!activeAnimation;
        const availableWidth = isDualView ? cw * 0.6 : cw;
        const avW = availableWidth - pad;
        const avH = ch - pad;
        const s = Math.min(avW/w, avH/h, 1); 
        setViewport({ 
            scale: s, 
            offset: { 
                x: (availableWidth - w*s)/2, 
                y: (ch - h*s)/2 
            } 
        }); 
    } 
  }, [builderCanvas, imageMeta, currentMode, activeAnimation, setViewport]);

  useEffect(() => {
      const currentSource = imageMeta?.src || (builderCanvas ? `builder-${builderCanvas.width}-${builderCanvas.height}` : null);
      const modeKey = `${currentMode}-${activeAnimation?.id || 'none'}`;
      const changeKey = `${currentSource}-${modeKey}`;
      if (currentSource && changeKey !== lastSourceRef.current) {
          lastSourceRef.current = changeKey;
          setTimeout(handleResetView, 50);
      }
  }, [imageMeta, builderCanvas, currentMode, activeAnimation, handleResetView]);

  useImperativeHandle(ref, () => ({
    resetView: handleResetView,
    exportSnapshot: async (includeGrid: boolean) => {
        const w = builderCanvas?.width || imageMeta?.width || 100, h = builderCanvas?.height || imageMeta?.height || 100;
        const off = document.createElement('canvas'); off.width = w; off.height = h; const ctx = off.getContext('2d'); if (!ctx) return null;
        CanvasRenderer.render({ ctx, width: w, height: h, scale: 1, offset: { x: 0, y: 0 }, currentMode, slicerImgObj, assetCache, frames, builderSlots: builderSlots || {}, activeAnimation: null, gridConfig, builderGrid: builderGrid || gridConfig, templateConfig, onionSkin, selectedFrameIndex: null, playbackFrameIndex: 0, isPlaying: false, isDraggingPivot: false, tempPivot: null, isHoveringBuilderSlot: null, selectedHitboxId: null, isExport: true, includeGridInExport: includeGrid, dragSelectionRect: null, guides: [], isDragOverCanvas: false });
        return new Promise<Blob | null>((resolve) => off.toBlob(resolve, 'image/png'));
    },
    exportFrame: async (frameId: number) => {
        const frame = frames.find(f => f.id === frameId);
        if (!frame) return null;
        const off = document.createElement('canvas'); off.width = frame.w; off.height = frame.h; const ctx = off.getContext('2d'); if (!ctx) return null;
        if (currentMode === AppMode.BUILDER) {
            CanvasRenderer.render({ ctx, width: frame.w, height: frame.h, scale: 1, offset: { x: -frame.x, y: -frame.y }, currentMode, slicerImgObj, assetCache, frames, builderSlots: builderSlots || {}, activeAnimation: null, gridConfig, builderGrid: builderGrid || gridConfig, templateConfig: undefined, onionSkin: undefined, selectedFrameIndex: null, playbackFrameIndex: 0, isPlaying: false, isDraggingPivot: false, tempPivot: null, isHoveringBuilderSlot: null, selectedHitboxId: null, isExport: true, includeGridInExport: false, dragSelectionRect: null, guides: [], isDragOverCanvas: false });
        } else {
            if (slicerImgObj) ctx.drawImage(slicerImgObj, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
        }
        return off.toDataURL('image/png');
    }
  }));

  useEffect(() => {
    let rid: number;
    const loop = () => {
        const c = canvasRef.current, p = propsRef.current, s = stateRef.current;
        if (c && canvasDims.w > 0) {
            const ctx = c.getContext('2d');
            if (ctx) {
                const dpr = window.devicePixelRatio || 1;
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.scale(dpr, dpr);
                CanvasRenderer.render({ ctx, width: p.builderCanvas?.width || p.imageMeta?.width || 100, height: p.builderCanvas?.height || p.imageMeta?.height || 100, scale: s.viewport.scale, offset: s.viewport.offset, currentMode: p.currentMode, slicerImgObj, assetCache, frames: p.frames, builderSlots: p.builderSlots || {}, activeAnimation: p.activeAnimation || null, gridConfig: p.gridConfig, builderGrid: p.builderGrid || p.gridConfig, templateConfig: p.templateConfig, onionSkin: p.onionSkin, selectedFrameIndex: p.selectedFrameIndex, playbackFrameIndex: p.playbackFrameIndex || 0, isPlaying: p.isPlaying || false, isDraggingPivot: false, tempPivot: null, isHoveringBuilderSlot: s.dragHoverSlot, draggingSlotIndex: s.dragStartSlot, mousePos: s.mousePos, selectedHitboxId: null, isExport: false, includeGridInExport: false, dragSelectionRect: s.dragSelectionRect, guides: [], labelConfig: p.labelConfig, isDragOverCanvas: s.isDragOverCanvas });
            }
        }
        rid = requestAnimationFrame(loop);
    };
    rid = requestAnimationFrame(loop); 
    return () => cancelAnimationFrame(rid);
  }, [canvasDims, slicerImgObj, assetCache]);

  const handleRatioSelect = (ratio: string) => {
      setInitRatio(ratio);
      const preset = RATIO_PRESETS[ratio];
      if (preset) {
          setInitW(preset.w.toString());
          setInitH(preset.h.toString());
      }
  };

  const getRelMouse = (cx: number, cy: number) => { if (!containerRef.current) return { x: 0, y: 0 }; const r = containerRef.current.getBoundingClientRect(); return { x: (cx - r.left - viewport.offset.x) / viewport.scale, y: (cy - r.top - viewport.offset.y) / viewport.scale }; };
  
  const handleDragOver = (e: React.DragEvent) => { 
      e.preventDefault(); 
      setIsDragOverCanvas(true); 
      if (currentMode === AppMode.BUILDER && builderCanvas) { 
          const { x, y } = getRelMouse(e.clientX, e.clientY); 
          const idx = getGridIndexFromPos(x, y, builderCanvas.width, builderCanvas.height, gridConfig); 
          setDragHoverSlot(idx !== -1 ? idx : null); 
      } 
  };
  
  const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOverCanvas(false);
      setDragHoverSlot(null);
      if (e.dataTransfer.files.length) {
          onUpload(e.dataTransfer.files[0]);
          return;
      }
      const aid = e.dataTransfer.getData(DND_ASSET_TYPE);
      if (!aid || currentMode !== AppMode.BUILDER || !builderCanvas) return;
      const { x, y } = getRelMouse(e.clientX, e.clientY);
      const idx = getGridIndexFromPos(x, y, builderCanvas.width, builderCanvas.height, gridConfig);
      if (idx !== -1) {
          onUpdateSlot?.(idx, {
              gridIndex: idx,
              assetId: aid,
              fitMode: 'fit',
              alignment: 'center',
              scaleX: 1,
              scaleY: 1,
              lockAspect: true,
              rotation: 0,
              opacity: 1,
              offsetX: 0,
              offsetY: 0,
              flipX: false,
              flipY: false
          });
      }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isEmpty) return; 
    
    // --- EYEDROPPER LOGIC (ROBUST) ---
    if (isEyedropperActive && onPickColor && canvasRef.current) {
        e.stopPropagation();
        e.preventDefault();
        
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        
        // Map mouse coordinates specifically to the canvas element scaling
        // This handles cases where CSS size != internal resolution
        const x = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (canvas.height / rect.height);
        
        const ctx = canvas.getContext('2d');
        if (ctx) {
            try {
                // Ensure we are reading inside bounds
                const ix = Math.floor(Math.max(0, Math.min(x, canvas.width - 1)));
                const iy = Math.floor(Math.max(0, Math.min(y, canvas.height - 1)));
                
                const pixel = ctx.getImageData(ix, iy, 1, 1).data;
                const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);
                onPickColor(hex);
            } catch(err) {
                console.warn("Could not pick color:", err);
            }
        }
        return; 
    }

    const { x, y } = getRelMouse(e.clientX, e.clientY); 
    setStartMousePos({ x, y }); 
    setLastMousePos({ x, y });
    
    if (e.button === 1 || (isSpacePressed && e.button === 0)) { 
        setDragMode(DragMode.PAN); 
        return; 
    }

    if (currentMode === AppMode.BUILDER && builderCanvas) {
        const idx = getGridIndexFromPos(x, y, builderCanvas.width, builderCanvas.height, gridConfig);
        if (idx !== -1) { 
            onSelectFrame(idx); 
            if (builderSlots?.[idx]) { 
                setDragMode(DragMode.SWAP_SLOTS); 
                setDragStartSlot(idx); 
            }
        }
    } else if (imageMeta) {
        const idx = frames.findIndex(f => x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h);
        if (idx !== -1) { 
            onSelectFrame(idx); 
            setDragMode(DragMode.MOVE_FRAME); 
        }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { x, y } = getRelMouse(e.clientX, e.clientY); 
    setMousePos({ x, y });
    
    if (dragMode === DragMode.PAN) { 
        setViewport({ ...viewport, offset: { x: viewport.offset.x + e.movementX, y: viewport.offset.y + e.movementY } }); 
        return; 
    }
    
    const dx = x - lastMousePos.x, dy = y - lastMousePos.y;
    
    if (dragMode === DragMode.SWAP_SLOTS && builderCanvas) { 
        const hoverIdx = getGridIndexFromPos(x, y, builderCanvas.width, builderCanvas.height, gridConfig);
        setDragHoverSlot(hoverIdx !== -1 ? hoverIdx : null);
        return; 
    }
    
    if (dragMode === DragMode.MOVE_FRAME) {
        if (currentMode === AppMode.BUILDER && selectedFrameIndex !== null) {
            const s = builderSlots?.[selectedFrameIndex!]; 
            if (s) { 
                onUpdateSlotEphemeral?.(selectedFrameIndex!, { ...s, offsetX: s.offsetX + dx, offsetY: s.offsetY + dy }); 
                setLastMousePos({ x, y }); 
            }
        } else if (selectedFrameIndex !== null) {
            const f = frames[selectedFrameIndex!]; 
            onUpdateFrameEphemeral?.(f.id, { x: f.x + dx, y: f.y + dy }); 
            setLastMousePos({ x, y });
        }
    }
  };

  const handleMouseUp = () => {
      if (dragMode === DragMode.SWAP_SLOTS && dragStartSlot !== null && dragHoverSlot !== null) {
          if (dragStartSlot !== dragHoverSlot) {
              onSwapSlots?.(dragStartSlot, dragHoverSlot);
              onSelectFrame(dragHoverSlot);
          }
      }
      else if (dragMode === DragMode.MOVE_FRAME) {
          if (currentMode === AppMode.BUILDER && selectedFrameIndex !== null) 
              onUpdateSlot?.(selectedFrameIndex!, builderSlots![selectedFrameIndex!]);
          else if (selectedFrameIndex !== null) 
              onUpdateFrame?.(frames[selectedFrameIndex!].id, frames[selectedFrameIndex!]);
      }
      setDragMode(DragMode.NONE); 
      setDragSelectionRect(null); 
      setDragStartSlot(null); 
      setDragHoverSlot(null);
  };

  const handleWheel = (e: React.WheelEvent) => { 
      if (e.ctrlKey || isSpacePressed) { 
          e.preventDefault(); 
          const r = containerRef.current!.getBoundingClientRect();
          const mx = e.clientX - r.left;
          const my = e.clientY - r.top;
          const wx = (mx - viewport.offset.x) / viewport.scale;
          const wy = (my - viewport.offset.y) / viewport.scale;
          const d = -e.deltaY;
          const ns = Math.min(Math.max(0.01, viewport.scale * Math.pow(1.1, d/150)), 100); 
          setViewport({ scale: ns, offset: { x: mx - wx * ns, y: my - wy * ns } }); 
      } 
  };
  
  const getCur = () => isEmpty ? 'default' : dragMode === DragMode.PAN ? 'grab' : dragMode === DragMode.MOVE_FRAME ? 'move' : dragMode === DragMode.SWAP_SLOTS ? 'grabbing' : isEyedropperActive ? 'crosshair' : 'default';

  return (
    <main className="h-full bg-app relative flex flex-col select-none group/canvas" onWheel={handleWheel} onDragOver={handleDragOver} onDragLeave={() => setIsDragOverCanvas(false)} onDrop={handleDrop}>
      {!isEmpty && (
        <CanvasToolbar 
          imageMeta={imageMeta} 
          builderCanvas={builderCanvas}
          currentAspectRatio={currentAspectRatio}
          onSetAspectRatio={onSetAspectRatio}
        />
      )}
      
      {isLoading && <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4"><svg className="h-10 w-10 text-accent animate-spin" viewBox="0 0 50 50"><circle cx="25" cy="25" r="20" fill="none" strokeWidth="4" stroke="currentColor"></circle></svg><span className="text-white text-[10px] font-bold uppercase tracking-widest">{loadingMessage}</span></div>}
      
      <div ref={containerRef} className="flex-1 relative overflow-hidden" style={{ cursor: getCur() }} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
        {isEmpty && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 p-8">
                <div className="max-w-3xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 animate-fade-in pointer-events-auto">
                    
                    {/* OPTION 1: Import */}
                    <div className="p-8 rounded-3xl border border-white/5 bg-panel/50 backdrop-blur-xl flex flex-col items-center text-center space-y-6 shadow-modal hover:border-accent/20 transition-all group">
                         <div className="w-20 h-20 bg-surface rounded-3xl flex items-center justify-center border border-white/5 group-hover:scale-110 transition-transform">
                             <Plus size={40} className="text-textMuted group-hover:text-accent transition-colors" />
                         </div>
                         <div className="space-y-2">
                             <h3 className="text-lg font-bold text-textMain">Import Spritesheet</h3>
                             <p className="text-xs text-textMuted leading-relaxed">Start by slicing an existing image into individual frames.</p>
                         </div>
                         <button 
                            onClick={() => localInputRef.current?.click()} 
                            className="w-full py-3.5 bg-accent hover:bg-accentHover text-white rounded-xl text-xs font-bold shadow-glow-sm transition-all active:scale-95 flex items-center justify-center gap-2"
                         >
                            <Upload size={16} /> Open Image File
                         </button>
                         <input ref={localInputRef} type="file" className="hidden" onChange={e => e.target.files && onUpload(e.target.files[0])} />
                    </div>

                    {/* OPTION 2: Create Blank */}
                    <div className="p-8 rounded-3xl border border-white/5 bg-panel/50 backdrop-blur-xl flex flex-col items-center text-center space-y-6 shadow-modal hover:border-accent/20 transition-all group">
                         <div className="w-20 h-20 bg-surface rounded-3xl flex items-center justify-center border border-white/5 group-hover:scale-110 transition-transform">
                             <Monitor size={40} className="text-textMuted group-hover:text-accent transition-colors" />
                         </div>
                         <div className="space-y-4 w-full">
                            <div className="space-y-1">
                                <h3 className="text-lg font-bold text-textMain">Create Workspace</h3>
                                <p className="text-xs text-textMuted leading-relaxed">Initialize a blank canvas for custom composition.</p>
                            </div>

                            <div className="space-y-3 pt-2">
                                <div className="space-y-1.5 text-left">
                                    <label className="text-[10px] font-bold text-textMuted uppercase tracking-widest flex items-center gap-2">
                                        <Maximize2 size={10} className="text-accent" /> Aspect Ratio
                                    </label>
                                    <select 
                                        value={initRatio} 
                                        onChange={(e) => handleRatioSelect(e.target.value)} 
                                        className="w-full bg-input border border-white/10 rounded-lg text-xs p-2.5 focus:border-accent text-textMain outline-none hover:border-white/20 transition-all"
                                    >
                                        {ASPECT_RATIOS.map(group => (
                                            <optgroup key={group.label} label={group.label}>
                                                {group.items.map(ratio => <option key={ratio} value={ratio}>{ratio}</option>)}
                                            </optgroup>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex gap-2">
                                    <NumberControl value={parseInt(initW)} onChange={(v) => setInitW(v.toString())} unit="w" className="flex-1" labelClassName="hidden" />
                                    <NumberControl value={parseInt(initH)} onChange={(v) => setInitH(v.toString())} unit="h" className="flex-1" labelClassName="hidden" />
                                </div>
                            </div>
                         </div>
                         <button 
                            onClick={() => onCreateCanvas?.(parseInt(initW)||1024, parseInt(initH)||1024)} 
                            className="w-full py-3.5 bg-surface hover:bg-white/10 text-textMain border border-white/10 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-2 shadow-inner-depth"
                         >
                            <Monitor size={16} /> New Empty Canvas
                         </button>
                    </div>

                </div>
            </div>
        )}
        <canvas ref={canvasRef} className={`block transition-opacity duration-500 ${isEmpty ? 'opacity-0' : 'opacity-100'}`} />
      </div>
      {!isEmpty && <CanvasStatusBar dragMode={dragMode} mousePos={mousePos} viewport={viewport} setViewport={setViewport} onResetView={handleResetView} modifiers={modifiers} isHoveringInteractive={selectedFrameIndex !== null} />}
    </main>
  );
});

export default CanvasArea;
