import React, { useRef, useLayoutEffect, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from "react";
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
import { mapWandClientPointToSource, type WandSeedPoint } from "../../features/slice/irregular";

export interface CanonicalRegionToolInteraction {
  readonly mode: "wand" | "manual" | null;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly onWandSeed?: (seed: WandSeedPoint, pixels: Uint8ClampedArray) => void;
  readonly onManualCommit?: (bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }) => void;
  readonly onCancel?: () => void;
}

export interface CanvasAreaProps {
  readonly canonicalCanvasOwnership?: boolean;
  readonly onCanonicalPickColor?: (hex: string) => void;
  readonly sliceGridOverlay?: Readonly<{
    sourceDimensions: GridLayoutSourceDimensions | null;
    effectiveLayout: EffectiveGridLayout | null;
  }> | null;
  readonly canonicalRegionTool?: CanonicalRegionToolInteraction | null;
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
  onCanonicalPickColor,
  sliceGridOverlay = null,
  canonicalRegionTool = null,
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
    setIsEyedropperActive,
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
  const [manualDragStart, setManualDragStart] = useState<WandSeedPoint | null>(null);
  const [manualDragBounds, setManualDragBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

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
  const sourcePointFromClient = useCallback((clientX: number, clientY: number): WandSeedPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas || !canonicalRegionTool || canonicalRegionTool.sourceWidth < 1 || canonicalRegionTool.sourceHeight < 1) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
      ? window.devicePixelRatio : 1;
    return mapWandClientPointToSource(
      { clientX, clientY },
      {
        canvasClientLeft: rect.left,
        canvasClientTop: rect.top,
        devicePixelRatio: dpr,
        zoom: viewport.scale,
        sourceOriginCanvasX: viewport.offset.x * dpr,
        sourceOriginCanvasY: viewport.offset.y * dpr,
        sourceWidth: canonicalRegionTool.sourceWidth,
        sourceHeight: canonicalRegionTool.sourceHeight,
      },
    );
  }, [canonicalRegionTool, viewport]);
  const readSourcePixels = useCallback((): Uint8ClampedArray | null => {
    if (!slicerImgObj || !canonicalRegionTool) return null;
    const width = canonicalRegionTool.sourceWidth;
    const height = canonicalRegionTool.sourceHeight;
    const surface = typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(width, height)
      : (() => {
          if (typeof document === "undefined") return null;
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          return canvas;
        })();
    if (!surface) return null;
    const context = surface.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context) return null;
    context.clearRect(0, 0, width, height);
    context.drawImage(slicerImgObj, 0, 0, width, height);
    try {
      return new Uint8ClampedArray(context.getImageData(0, 0, width, height).data);
    } catch {
      return null;
    }
  }, [canonicalRegionTool, slicerImgObj]);
  const clampBounds = useCallback((start: WandSeedPoint, end: WandSeedPoint) => {
    const x = Math.max(0, Math.min(start.x, end.x));
    const y = Math.max(0, Math.min(start.y, end.y));
    const right = Math.min(canonicalRegionTool?.sourceWidth ?? contentDimensions.width, Math.max(start.x, end.x) + 1);
    const bottom = Math.min(canonicalRegionTool?.sourceHeight ?? contentDimensions.height, Math.max(start.y, end.y) + 1);
    return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
  }, [canonicalRegionTool, contentDimensions.height, contentDimensions.width]);
  useEffect(() => {
    if (canonicalRegionTool?.mode === "wand" || canonicalRegionTool?.mode === "manual") {
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        setManualDragStart(null);
        setManualDragBounds(null);
        canonicalRegionTool.onCancel?.();
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }
    setManualDragStart(null);
    setManualDragBounds(null);
    return undefined;
  }, [canonicalRegionTool]);
  const handleCanonicalPickColor = React.useCallback((hex: string) => {
    onCanonicalPickColor?.(hex);
    // Keep the shared legacy swatch in sync while Slice owns the recipe commit.
    onPickColor(hex);
  }, [onCanonicalPickColor, onPickColor]);
  const canonicalEyedropper = React.useMemo(() => canonicalCanvasOwnership ? {
    isActive: isEyedropperActive,
    sourceWidth: contentDimensions.width,
    sourceHeight: contentDimensions.height,
    onPickColor: handleCanonicalPickColor,
    onCancel: () => setIsEyedropperActive(false),
  } : null, [
    canonicalCanvasOwnership,
    contentDimensions.height,
    contentDimensions.width,
    isEyedropperActive,
    onPickColor,
    handleCanonicalPickColor,
    setIsEyedropperActive,
  ]);
  const mouse = useCanvasMouse({
    containerRef,
    canvasRef,
    isEmpty,
    viewport,
    setViewport,
    isSpacePressed,
    canonicalEyedropper,
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
        style={{ cursor: canonicalRegionTool?.mode ? "crosshair" : mouse.getCursor() }}
        onMouseDown={(event) => {
          const workspaceContent = event.currentTarget.closest("[data-studio-workspace-content]");
          if (workspaceContent instanceof HTMLElement) {
            workspaceContent.focus({ preventScroll: true });
          }
          if (canonicalRegionTool?.mode && !canonicalEyedropper?.isActive && event.button === 0 && !isSpacePressed && !isEmpty) {
            const seed = sourcePointFromClient(event.clientX, event.clientY);
            if (!seed) return;
            event.preventDefault();
            event.stopPropagation();
            if (canonicalRegionTool.mode === "wand") {
              const pixels = readSourcePixels();
              if (pixels) canonicalRegionTool.onWandSeed?.(seed, pixels);
            } else {
              setManualDragStart(seed);
              setManualDragBounds(clampBounds(seed, seed));
            }
            return;
          }
          mouse.handleMouseDown(event);
        }}
        onMouseMove={(event) => {
          if (manualDragStart && canonicalRegionTool?.mode === "manual") {
            const point = sourcePointFromClient(event.clientX, event.clientY);
            if (point) setManualDragBounds(clampBounds(manualDragStart, point));
            return;
          }
          mouse.handleMouseMove(event);
        }}
        onMouseUp={() => {
          if (manualDragStart && canonicalRegionTool?.mode === "manual") {
            if (manualDragBounds) canonicalRegionTool.onManualCommit?.(manualDragBounds);
            setManualDragStart(null);
            setManualDragBounds(null);
            return;
          }
          mouse.handleMouseUp();
        }}
        onMouseLeave={() => {
          if (manualDragStart) {
            setManualDragStart(null);
            setManualDragBounds(null);
          }
          mouse.handleMouseUp();
        }}
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
        {manualDragBounds ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute border border-accent bg-accent/15"
            style={{
              left: viewport.offset.x + manualDragBounds.x * viewport.scale,
              top: viewport.offset.y + manualDragBounds.y * viewport.scale,
              width: manualDragBounds.width * viewport.scale,
              height: manualDragBounds.height * viewport.scale,
            }}
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
