import React, { useRef, useLayoutEffect, useEffect, forwardRef, useImperativeHandle } from "react";
import { AppMode, CanvasHandle } from "../../types";
import { Upload, Plus, Maximize2, Monitor } from "lucide-react";
import { CanvasRenderer } from "../../utils/renderUtils";
import { ASPECT_RATIOS } from "./CanvasToolbar";
import CanvasToolbar from "./CanvasToolbar";
import CanvasStatusBar from "./CanvasStatusBar";
import NumberControl from "../common/NumberControl";
import { useProject } from "../../contexts/ProjectContext";
import {
  useImageLoader,
  useAssetCache,
  useRenderLoop,
  useAutoResetView,
} from "../../hooks/canvas/useCanvasRenderLoop";
import { useCanvasMouse } from "../../hooks/canvas/useCanvasMouse";
import { resolveCanvasContentDimensions } from "../../hooks/canvas/canvasOwnership";
import { useCanvasKeyboard, useInitCanvasForm } from "../../hooks/canvas/useCanvasTools";
import {
  SliceGridOverlay,
  type EffectiveGridLayout,
  type GridLayoutSourceDimensions,
} from "../../features/slice/grid";

export interface CanvasAreaProps {
  readonly canonicalCanvasOwnership?: boolean;
  readonly sliceGridOverlay?: Readonly<{
    sourceDimensions: GridLayoutSourceDimensions | null;
    effectiveLayout: EffectiveGridLayout | null;
  }> | null;
}

/**
 * G2-05 canonical Slice export contract: export the source bitmap only.
 * Grid-aware sheet/region export is owned by G7; legacy frames and builder grids
 * must never leak into a canonical Slice snapshot.
 */
export function renderCanonicalSliceSourceSnapshot(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
}

const CanvasArea = forwardRef<CanvasHandle, CanvasAreaProps>(({
  canonicalCanvasOwnership = false,
  sliceGridOverlay = null,
}, ref) => {
  const {
    currentMode,
    slicerImage: imageMeta,
    activeGrid: gridConfig,
    builderGrid,
    frames,
    selectedIndex: selectedFrameIndex,
    setSelectedIndex: onSelectFrame,
    handleUpload: onUpload,
    builderCanvas,
    handleCreateCanvas: onCreateCanvas,
    builderAssets,
    builderSlots,
    handleUpdateSlot: onUpdateSlot,
    handleUpdateSlotEphemeral: onUpdateSlotEphemeral,
    activeAnimationId,
    animations,
    playbackFrameIndex = 0,
    isPlaying = false,
    onionSkin,
    templateConfig,
    isLoading,
    loadingMessage,
    isEyedropperActive,
    setEyedropperColor: onPickColor,
    handleUpdateFrame: onUpdateFrame,
    handleUpdateFrameEphemeral: onUpdateFrameEphemeral,
    handleSwapSlots: onSwapSlots,
    viewport,
    setViewport,
    currentAspectRatio,
    handleSetAspectRatio: onSetAspectRatio,
    preferences,
  } = useProject();

  const activeAnimation = activeAnimationId
    ? animations.find((a) => a.id === activeAnimationId)
    : null;
  const labelConfig = preferences.frameLabel;
  const isEmpty = !imageMeta && !builderCanvas;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const localInputRef = useRef<HTMLInputElement>(null);

  // --- Extracted hooks ---
  const { isSpacePressed, modifiers } = useCanvasKeyboard({
    spacePanEnabled: !activeAnimationId,
  });
  const { initW, setInitW, initH, setInitH, initRatio, handleRatioSelect } = useInitCanvasForm();
  const slicerImgObj = useImageLoader(imageMeta);
  const assetCache = useAssetCache(builderAssets);

  const propsRef = useRef<any>({});
  const stateRef = useRef<any>({});

  const sourceIntrinsicDimensions = slicerImgObj
    ? {
        width: slicerImgObj.naturalWidth || slicerImgObj.width,
        height: slicerImgObj.naturalHeight || slicerImgObj.height,
      }
    : null;
  const contentDimensions = resolveCanvasContentDimensions({
    canonicalCanvasOwnership,
    imageMeta,
    sourceIntrinsicDimensions,
    builderCanvas,
    fallback: { width: 100, height: 100 },
  });
  const mouse = useCanvasMouse({
    containerRef,
    canvasRef,
    isEmpty,
    viewport,
    setViewport,
    isSpacePressed,
    legacyInteraction: canonicalCanvasOwnership
      ? null
      : {
          currentMode,
          builderCanvas,
          gridConfig,
          imageMeta,
          frames,
          builderSlots,
          selectedFrameIndex,
          isEyedropperActive,
          onPickColor,
          onSelectFrame,
          onUpload,
          onUpdateSlot,
          onUpdateSlotEphemeral,
          onUpdateFrame,
          onUpdateFrameEphemeral,
          onSwapSlots,
        },
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent): void => {
      mouse.handleWheel(event as unknown as React.WheelEvent);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [mouse.handleWheel]);

  // Keep refs in sync for the render loop (avoids stale closures in rAF)
  useLayoutEffect(() => {
    propsRef.current = {
      currentMode,
      imageMeta,
      gridConfig,
      builderGrid,
      frames,
      selectedFrameIndex,
      builderCanvas,
      builderSlots,
      activeAnimation,
      playbackFrameIndex,
      isPlaying,
      onionSkin,
      templateConfig,
      isLoading,
      loadingMessage,
      isEyedropperActive,
      labelConfig,
      canonicalSliceOverlayActive: canonicalCanvasOwnership,
      canvasContentDimensions: contentDimensions,
    };
    stateRef.current = {
      viewport,
      dragMode: mouse.dragMode,
      mousePos: mouse.mousePos,
      dragSelectionRect: mouse.dragSelectionRect,
      dragHoverSlot: mouse.dragHoverSlot,
      isDragOverCanvas: mouse.isDragOverCanvas,
      dragStartSlot: mouse.dragStartSlot,
    };
  });

  useRenderLoop({ canvasRef, containerRef, propsRef, stateRef, slicerImgObj, assetCache });

  const handleResetView = useAutoResetView(
    containerRef,
    contentDimensions,
    imageMeta?.src ?? null,
    currentMode,
    activeAnimation ?? null,
    setViewport,
  );

  // --- Imperative API for parent (export, reset) ---
  useImperativeHandle(ref, () => ({
    resetView: handleResetView,
    exportSnapshot: async (includeGrid: boolean) => {
      const { width: w, height: h } = contentDimensions;
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const ctx = off.getContext("2d");
      if (!ctx) return null;
      if (canonicalCanvasOwnership) {
        if (!slicerImgObj) return null;
        off.dataset.canonicalSliceExport = "source-only";
        renderCanonicalSliceSourceSnapshot(ctx, slicerImgObj, w, h);
        return new Promise<Blob | null>((resolve) => off.toBlob(resolve, "image/png"));
      }
      CanvasRenderer.render({
        ctx,
        width: w,
        height: h,
        scale: 1,
        offset: { x: 0, y: 0 },
        currentMode,
        slicerImgObj,
        assetCache,
        frames,
        builderSlots: builderSlots || {},
        activeAnimation: null,
        gridConfig,
        builderGrid: builderGrid || gridConfig,
        templateConfig,
        onionSkin,
        selectedFrameIndex: null,
        playbackFrameIndex: 0,
        isPlaying: false,
        isDraggingPivot: false,
        tempPivot: null,
        isHoveringBuilderSlot: null,
        selectedHitboxId: null,
        isExport: true,
        includeGridInExport: includeGrid,
        dragSelectionRect: null,
        guides: [],
        isDragOverCanvas: false,
      });
      return new Promise<Blob | null>((resolve) => off.toBlob(resolve, "image/png"));
    },
    exportFrame: async (frameId: number) => {
      if (canonicalCanvasOwnership) return null;
      const frame = frames.find((f) => f.id === frameId);
      if (!frame) return null;
      const off = document.createElement("canvas");
      off.width = frame.w;
      off.height = frame.h;
      const ctx = off.getContext("2d");
      if (!ctx) return null;
      if (currentMode === AppMode.BUILDER) {
        CanvasRenderer.render({
          ctx,
          width: frame.w,
          height: frame.h,
          scale: 1,
          offset: { x: -frame.x, y: -frame.y },
          currentMode,
          slicerImgObj,
          assetCache,
          frames,
          builderSlots: builderSlots || {},
          activeAnimation: null,
          gridConfig,
          builderGrid: builderGrid || gridConfig,
          templateConfig: undefined,
          onionSkin: undefined,
          selectedFrameIndex: null,
          playbackFrameIndex: 0,
          isPlaying: false,
          isDraggingPivot: false,
          tempPivot: null,
          isHoveringBuilderSlot: null,
          selectedHitboxId: null,
          isExport: true,
          includeGridInExport: false,
          dragSelectionRect: null,
          guides: [],
          isDragOverCanvas: false,
        });
      } else {
        if (slicerImgObj)
          ctx.drawImage(slicerImgObj, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
      }
      return off.toDataURL("image/png");
    },
  }));

  return (
    <section
      aria-label="Canvas workspace"
      className="h-full bg-app relative flex flex-col select-none group/canvas"
      onDragOver={mouse.handleDragOver}
      onDragLeave={() => mouse.setIsDragOverCanvas(false)}
      onDrop={mouse.handleDrop}
    >
      {!isEmpty && (
        <CanvasToolbar
          imageMeta={imageMeta}
          builderCanvas={builderCanvas}
          currentAspectRatio={currentAspectRatio}
          onSetAspectRatio={onSetAspectRatio}
        />
      )}

      {isLoading && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
          <svg className="h-10 w-10 text-accent animate-spin" viewBox="0 0 50 50">
            <circle
              cx="25"
              cy="25"
              r="20"
              fill="none"
              strokeWidth="4"
              stroke="currentColor"
            ></circle>
          </svg>
          <span className="text-white text-[10px] font-bold uppercase tracking-widest">
            {loadingMessage}
          </span>
        </div>
      )}

      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
        style={{ cursor: mouse.getCursor() }}
        onMouseDown={(event) => {
          const workspaceContent = event.currentTarget.closest("[data-studio-workspace-content]");
          if (workspaceContent instanceof HTMLElement) {
            workspaceContent.focus({ preventScroll: true });
          }
          mouse.handleMouseDown(event);
        }}
        onMouseMove={mouse.handleMouseMove}
        onMouseUp={mouse.handleMouseUp}
        onMouseLeave={mouse.handleMouseUp}
      >
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 p-8">
            <div className="max-w-3xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 animate-fade-in pointer-events-auto">
              {/* OPTION 1: Import */}
              <div className="p-8 rounded-3xl border border-white/5 bg-panel/50 backdrop-blur-xl flex flex-col items-center text-center space-y-6 shadow-modal hover:border-accent/20 transition-all group">
                <div className="w-20 h-20 bg-surface rounded-3xl flex items-center justify-center border border-white/5 group-hover:scale-110 transition-transform">
                  <Plus
                    size={40}
                    className="text-textMuted group-hover:text-accent transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-bold text-textMain">Import Spritesheet</h3>
                  <p className="text-xs text-textMuted leading-relaxed">
                    Start by slicing an existing image into individual frames.
                  </p>
                </div>
                <button
                  onClick={() => localInputRef.current?.click()}
                  className="w-full py-3.5 bg-accent hover:bg-accentHover text-white rounded-xl text-xs font-bold shadow-glow-sm transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <Upload size={16} /> Open Image File
                </button>
                <input
                  ref={localInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => e.target.files && onUpload(e.target.files[0])}
                />
              </div>

              {/* OPTION 2: Create Blank */}
              <div className="p-8 rounded-3xl border border-white/5 bg-panel/50 backdrop-blur-xl flex flex-col items-center text-center space-y-6 shadow-modal hover:border-accent/20 transition-all group">
                <div className="w-20 h-20 bg-surface rounded-3xl flex items-center justify-center border border-white/5 group-hover:scale-110 transition-transform">
                  <Monitor
                    size={40}
                    className="text-textMuted group-hover:text-accent transition-colors"
                  />
                </div>
                <div className="space-y-4 w-full">
                  <div className="space-y-1">
                    <h3 className="text-lg font-bold text-textMain">Create Workspace</h3>
                    <p className="text-xs text-textMuted leading-relaxed">
                      Initialize a blank canvas for custom composition.
                    </p>
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
                        {ASPECT_RATIOS.map((group) => (
                          <optgroup key={group.label} label={group.label}>
                            {group.items.map((ratio) => (
                              <option key={ratio} value={ratio}>
                                {ratio}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <NumberControl
                        value={parseInt(initW)}
                        onChange={(v) => setInitW(v.toString())}
                        unit="w"
                        className="flex-1"
                        labelClassName="hidden"
                      />
                      <NumberControl
                        value={parseInt(initH)}
                        onChange={(v) => setInitH(v.toString())}
                        unit="h"
                        className="flex-1"
                        labelClassName="hidden"
                      />
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => onCreateCanvas?.(parseInt(initW) || 1024, parseInt(initH) || 1024)}
                  className="w-full py-3.5 bg-surface hover:bg-white/10 text-textMain border border-white/10 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-2 shadow-inner-depth"
                >
                  <Monitor size={16} /> New Empty Canvas
                </button>
              </div>
            </div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          data-studio-source-canvas=""
          data-canonical-canvas-ownership={canonicalCanvasOwnership ? "true" : "false"}
          data-canvas-content-size={`${contentDimensions.width}x${contentDimensions.height}`}
          data-legacy-selected-index={selectedFrameIndex === null ? "none" : String(selectedFrameIndex)}
          className={`block transition-opacity duration-500 ${isEmpty ? "opacity-0" : "opacity-100"}`}
        />
        {sliceGridOverlay ? (
          <SliceGridOverlay
            sourceDimensions={sliceGridOverlay.sourceDimensions}
            effectiveLayout={sliceGridOverlay.effectiveLayout}
            transform={viewport}
          />
        ) : null}
      </div>
      {!isEmpty && (
        <CanvasStatusBar
          dragMode={mouse.dragMode}
          mousePos={mouse.mousePos}
          viewport={viewport}
          setViewport={setViewport}
          onResetView={handleResetView}
          modifiers={modifiers}
          isHoveringInteractive={selectedFrameIndex !== null}
        />
      )}
    </section>
  );
});

export default CanvasArea;
