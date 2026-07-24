import { useRef, useEffect, useState, useCallback } from "react";
import {
  AppMode,
  ImageMeta,
  BuilderAsset,
  ViewportState,
  SpriteAnimation,
} from "../../types";
import { CanvasRenderer } from "../../utils/renderUtils";
import type { CanvasContentDimensions } from "./canvasOwnership";
import {
  missingAssetIdsForCache,
  pruneAssetCacheEntries,
} from "../../utils/hostAssetCache";
import { hostCanvasNeedsContinuousPaint } from "../../utils/hostProjectPolicy";

interface RenderLoopDeps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  propsRef: React.MutableRefObject<any>;
  stateRef: React.MutableRefObject<any>;
  slicerImgObj: HTMLImageElement | null;
  assetCache: Record<string, HTMLImageElement>;
  /** Filled by the loop so layout/ref updates can request a single paint. */
  invalidateRef?: React.MutableRefObject<(() => void) | null>;
}

/** Loads the slicer image into an HTMLImageElement when imageMeta changes. */
/** Loads an HTMLImageElement from ImageMeta (data URI). */
export function useImageLoader(imageMeta: ImageMeta | null) {
  const [slicerImgObj, setSlicerImgObj] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (imageMeta) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = imageMeta.src;
      img.onload = () => setSlicerImgObj(img);
    } else {
      setSlicerImgObj(null);
    }
  }, [imageMeta]);

  return slicerImgObj;
}

/** Maintains an HTMLImageElement cache keyed by asset ID; prunes deleted ids. */
export function useAssetCache(builderAssets: BuilderAsset[] | undefined) {
  const [assetCache, setAssetCache] = useState<Record<string, HTMLImageElement>>({});

  useEffect(() => {
    setAssetCache((prev) => pruneAssetCacheEntries(prev, builderAssets));
  }, [builderAssets]);

  useEffect(() => {
    const missing = missingAssetIdsForCache(assetCache, builderAssets);
    for (const a of missing) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = a.src;
      img.onload = () => setAssetCache((prev) => ({ ...prev, [a.id]: img }));
    }
  }, [builderAssets, assetCache]);

  return assetCache;
}

/** Observes the container size and keeps canvasDims in sync. */
/** Auto-sizes the canvas element to fill its container. */
export function useCanvasResize(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const [canvasDims, setCanvasDims] = useState({ w: 0, h: 0 });

  // Sync canvas resolution with CSS size
  useEffect(() => {
    const c = canvasRef.current;
    if (c && canvasDims.w > 0 && canvasDims.h > 0) {
      const dpr = window.devicePixelRatio || 1;
      c.width = canvasDims.w * dpr;
      c.height = canvasDims.h * dpr;
      c.style.width = `${canvasDims.w}px`;
      c.style.height = `${canvasDims.h}px`;
    }
  }, [canvasDims, canvasRef]);

  // Observe container resize
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      if (entries[0]) {
        setCanvasDims({
          w: entries[0].contentRect.width,
          h: entries[0].contentRect.height,
        });
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [containerRef]);

  return canvasDims;
}

/**
 * Dirty/invalidation canvas paint via CanvasRenderer.
 * Idle: no perpetual rAF. Continuous only while playback/drag needs frames.
 * Call invalidateRef.current() after updating propsRef/stateRef.
 */
export function useRenderLoop(deps: RenderLoopDeps) {
  const { canvasRef, propsRef, stateRef, slicerImgObj, assetCache, invalidateRef } = deps;
  const canvasDims = useCanvasResize(canvasRef, deps.containerRef);

  useEffect(() => {
    let rid = 0;
    let cancelled = false;
    let dirty = true;

    const paintOnce = (): void => {
      const c = canvasRef.current;
      const p = propsRef.current;
      const s = stateRef.current;
      if (!c || canvasDims.w <= 0 || !p || !s) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      CanvasRenderer.render({
        ctx,
        width: p.canvasContentDimensions?.width ?? canvasDims.w,
        height: p.canvasContentDimensions?.height ?? canvasDims.h,
        scale: s.viewport?.scale ?? 1,
        offset: s.viewport?.offset ?? { x: 0, y: 0 },
        currentMode: p.currentMode,
        slicerImgObj,
        assetCache,
        frames: p.frames,
        builderSlots: p.builderSlots || {},
        activeAnimation: p.activeAnimation || null,
        gridConfig: p.gridConfig,
        builderGrid: p.builderGrid || p.gridConfig,
        templateConfig: p.templateConfig,
        onionSkin: p.onionSkin,
        selectedFrameIndex: p.selectedFrameIndex,
        playbackFrameIndex: p.playbackFrameIndex || 0,
        isPlaying: p.isPlaying || false,
        isDraggingPivot: false,
        tempPivot: null,
        isHoveringBuilderSlot: s.dragHoverSlot,
        draggingSlotIndex: s.dragStartSlot,
        mousePos: s.mousePos,
        selectedHitboxId: null,
        isExport: false,
        includeGridInExport: false,
        dragSelectionRect: s.dragSelectionRect,
        guides: [],
        labelConfig: p.labelConfig,
        isDragOverCanvas: s.isDragOverCanvas,
        canonicalSliceOverlayActive: p.canonicalSliceOverlayActive === true,
      });
    };

    const tick = (): void => {
      if (cancelled) return;
      rid = 0;
      dirty = false;
      paintOnce();
      const p = propsRef.current;
      const s = stateRef.current;
      const continuous = hostCanvasNeedsContinuousPaint({
        isPlaying: p?.isPlaying,
        dragMode: s?.dragMode,
        dragSelectionRect: s?.dragSelectionRect,
        isDragOverCanvas: s?.isDragOverCanvas,
        dragStartSlot: s?.dragStartSlot,
      });
      if (continuous || dirty) {
        rid = requestAnimationFrame(tick);
      }
    };

    const invalidate = (): void => {
      dirty = true;
      if (!rid && !cancelled) {
        rid = requestAnimationFrame(tick);
      }
    };

    if (invalidateRef) invalidateRef.current = invalidate;
    invalidate();

    return () => {
      cancelled = true;
      if (invalidateRef) invalidateRef.current = null;
      if (rid) cancelAnimationFrame(rid);
    };
  }, [canvasDims, slicerImgObj, assetCache, canvasRef, propsRef, stateRef, invalidateRef]);

  return canvasDims;
}

/** Auto-resets viewport when image source, mode, or active animation changes. */
/** Resets viewport (fit-to-view) when image/canvas/mode changes. */
export function useAutoResetView(
  containerRef: React.RefObject<HTMLDivElement | null>,
  contentDimensions: CanvasContentDimensions,
  sourceIdentity: string | null,
  currentMode: AppMode,
  activeAnimation: SpriteAnimation | null,
  setViewport: (vp: ViewportState) => void,
) {
  const lastSourceRef = useRef<string | null>(null);

  const handleResetView = useCallback(() => {
    const { width: w, height: h } = contentDimensions;

    if (containerRef.current) {
      const { clientWidth: cw, clientHeight: ch } = containerRef.current;
      if (cw === 0 || ch === 0) return;
      const pad = 80;
      const isDualView = currentMode === AppMode.ANIMATION && !!activeAnimation;
      const availableWidth = isDualView ? cw * 0.6 : cw;
      const avW = availableWidth - pad;
      const avH = ch - pad;
      const s = Math.min(avW / w, avH / h, 1);
      setViewport({
        scale: s,
        offset: {
          x: (availableWidth - w * s) / 2,
          y: (ch - h * s) / 2,
        },
      });
    }
  }, [contentDimensions, currentMode, activeAnimation, setViewport, containerRef]);

  useEffect(() => {
    const currentSource = sourceIdentity ??
      `canvas-${contentDimensions.width}-${contentDimensions.height}`;
    const modeKey = `${currentMode}-${activeAnimation?.id || "none"}`;
    const changeKey = `${currentSource}-${modeKey}`;
    if (currentSource && changeKey !== lastSourceRef.current) {
      lastSourceRef.current = changeKey;
      setTimeout(handleResetView, 50);
    }
  }, [sourceIdentity, contentDimensions, currentMode, activeAnimation, handleResetView]);

  return handleResetView;
}
