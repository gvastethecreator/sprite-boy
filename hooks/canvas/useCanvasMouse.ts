import { useState, useCallback, useEffect } from "react";
import {
  AppMode,
  DragMode,
  DND_ASSET_TYPE,
  ViewportState,
  FrameData,
  SlotData,
  BuilderCanvasSize,
  GridConfig,
  ImageMeta,
} from "../../types";
import { rgbToHex } from "../../utils/algorithms";
import { getGridIndexFromPos } from "../../utils/canvasMath";
import { mapWandClientPointToSource } from "../../features/slice/irregular/wandCoordinates";

export interface LegacyCanvasInteraction {
  currentMode: AppMode;
  builderCanvas: BuilderCanvasSize | null | undefined;
  gridConfig: GridConfig;
  imageMeta: ImageMeta | null;
  frames: FrameData[];
  builderSlots: Record<number, SlotData> | undefined;
  selectedFrameIndex: number | null;
  isEyedropperActive: boolean;
  onPickColor: ((hex: string) => void) | undefined;
  onSelectFrame: (index: number) => void;
  onUpload: (file: File) => void;
  onUpdateSlot: ((idx: number, data: any) => void) | undefined;
  onUpdateSlotEphemeral: ((idx: number, data: any) => void) | undefined;
  onUpdateFrame: ((id: number, data: any) => void) | undefined;
  onUpdateFrameEphemeral: ((id: number, data: any) => void) | undefined;
  onSwapSlots: ((a: number, b: number) => void) | undefined;
}

export interface CanonicalEyedropperInteraction {
  readonly isActive: boolean;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly onPickColor: (hex: string) => void;
  readonly onCancel: () => void;
}

interface CanvasMouseDeps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isEmpty: boolean;
  viewport: ViewportState;
  setViewport: (vp: ViewportState) => void;
  isSpacePressed: boolean;
  canonicalEyedropper: CanonicalEyedropperInteraction | null;
  /** Null in the canonical Slice workspace. Pan/zoom stay active; legacy editing is inert. */
  legacyInteraction: LegacyCanvasInteraction | null;
}

function sampleCanonicalCanvasColor(
  canvas: HTMLCanvasElement,
  event: { readonly clientX: number; readonly clientY: number },
  viewport: ViewportState,
  sourceWidth: number,
  sourceHeight: number,
): string | null {
  const rect = canvas.getBoundingClientRect();
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const dpr = typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
    ? window.devicePixelRatio
    : 1;
  const sourcePoint = mapWandClientPointToSource(
    { clientX: event.clientX, clientY: event.clientY },
    {
      canvasClientLeft: rect.left,
      canvasClientTop: rect.top,
      devicePixelRatio: dpr,
      zoom: viewport.scale,
      sourceOriginCanvasX: viewport.offset.x * dpr,
      sourceOriginCanvasY: viewport.offset.y * dpr,
      sourceWidth,
      sourceHeight,
    },
  );
  if (!sourcePoint || canvas.width < 1 || canvas.height < 1) return null;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const backingX = Math.max(
    0,
    Math.min(canvas.width - 1, Math.floor(((event.clientX - rect.left) / rect.width) * canvas.width)),
  );
  const backingY = Math.max(
    0,
    Math.min(canvas.height - 1, Math.floor(((event.clientY - rect.top) / rect.height) * canvas.height)),
  );
  try {
    const pixel = context.getImageData(backingX, backingY, 1, 1).data;
    return rgbToHex(pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0);
  } catch {
    return null;
  }
}

/** All canvas mouse interaction: drag, pan, zoom, eyedropper, DnD, slot swap. */
export function useCanvasMouse(deps: CanvasMouseDeps) {
  const {
    containerRef,
    canvasRef,
    isEmpty,
    viewport,
    setViewport,
    isSpacePressed,
    canonicalEyedropper,
    legacyInteraction,
  } = deps;

  const [dragMode, setDragMode] = useState<DragMode>(DragMode.NONE);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [dragSelectionRect, setDragSelectionRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [dragHoverSlot, setDragHoverSlot] = useState<number | null>(null);
  const [isDragOverCanvas, setIsDragOverCanvas] = useState(false);
  const [dragStartSlot, setDragStartSlot] = useState<number | null>(null);

  useEffect(() => {
    if (legacyInteraction) return;
    setDragMode(DragMode.NONE);
    setDragSelectionRect(null);
    setDragHoverSlot(null);
    setIsDragOverCanvas(false);
    setDragStartSlot(null);
  }, [legacyInteraction]);

  useEffect(() => {
    if (!canonicalEyedropper?.isActive) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      canonicalEyedropper.onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canonicalEyedropper]);

  const getRelMouse = useCallback(
    (cx: number, cy: number) => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const r = containerRef.current.getBoundingClientRect();
      return {
        x: (cx - r.left - viewport.offset.x) / viewport.scale,
        y: (cy - r.top - viewport.offset.y) / viewport.scale,
      };
    },
    [containerRef, viewport],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!legacyInteraction) {
        setIsDragOverCanvas(false);
        setDragHoverSlot(null);
        return;
      }
      setIsDragOverCanvas(true);
      if (legacyInteraction.currentMode === AppMode.BUILDER && legacyInteraction.builderCanvas) {
        const { x, y } = getRelMouse(e.clientX, e.clientY);
        const idx = getGridIndexFromPos(
          x,
          y,
          legacyInteraction.builderCanvas.width,
          legacyInteraction.builderCanvas.height,
          legacyInteraction.gridConfig,
        );
        setDragHoverSlot(idx !== -1 ? idx : null);
      }
    },
    [legacyInteraction, getRelMouse],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOverCanvas(false);
      setDragHoverSlot(null);
      if (!legacyInteraction) return;
      if (e.dataTransfer.files.length) {
        legacyInteraction.onUpload(e.dataTransfer.files[0]);
        return;
      }
      const aid = e.dataTransfer.getData(DND_ASSET_TYPE);
      if (!aid || legacyInteraction.currentMode !== AppMode.BUILDER || !legacyInteraction.builderCanvas) return;
      const { x, y } = getRelMouse(e.clientX, e.clientY);
      const idx = getGridIndexFromPos(
        x,
        y,
        legacyInteraction.builderCanvas.width,
        legacyInteraction.builderCanvas.height,
        legacyInteraction.gridConfig,
      );
      if (idx !== -1) {
        legacyInteraction.onUpdateSlot?.(idx, {
          gridIndex: idx,
          assetId: aid,
          fitMode: "fit",
          alignment: "center",
          scaleX: 1,
          scaleY: 1,
          lockAspect: true,
          rotation: 0,
          opacity: 1,
          offsetX: 0,
          offsetY: 0,
          flipX: false,
          flipY: false,
        });
      }
    },
    [legacyInteraction, getRelMouse],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isEmpty) return;

      const { x, y } = getRelMouse(e.clientX, e.clientY);
      setLastMousePos({ x, y });

      // Canonical Slice owns selection and mutations. Only viewport panning is shared.
      if (!legacyInteraction) {
        if (canonicalEyedropper?.isActive && e.button === 0 && !isSpacePressed) {
          e.stopPropagation();
          e.preventDefault();
          if (canvasRef.current) {
            const color = sampleCanonicalCanvasColor(
              canvasRef.current,
              e,
              viewport,
              canonicalEyedropper.sourceWidth,
              canonicalEyedropper.sourceHeight,
            );
            if (color !== null) {
              canonicalEyedropper.onPickColor(color);
              canonicalEyedropper.onCancel();
            }
          }
          return;
        }
        if (e.button === 1 || (isSpacePressed && e.button === 0)) {
          setDragMode(DragMode.PAN);
        }
        return;
      }

      // Eyedropper
      if (legacyInteraction.isEyedropperActive && legacyInteraction.onPickColor && canvasRef.current) {
        e.stopPropagation();
        e.preventDefault();
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (canvas.height / rect.height);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          try {
            const ix = Math.floor(Math.max(0, Math.min(x, canvas.width - 1)));
            const iy = Math.floor(Math.max(0, Math.min(y, canvas.height - 1)));
            const pixel = ctx.getImageData(ix, iy, 1, 1).data;
            const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);
            legacyInteraction.onPickColor(hex);
          } catch (err) {
            console.warn("Could not pick color:", err);
          }
        }
        return;
      }

      if (e.button === 1 || (isSpacePressed && e.button === 0)) {
        setDragMode(DragMode.PAN);
        return;
      }

      if (legacyInteraction.currentMode === AppMode.BUILDER && legacyInteraction.builderCanvas) {
        const idx = getGridIndexFromPos(
          x,
          y,
          legacyInteraction.builderCanvas.width,
          legacyInteraction.builderCanvas.height,
          legacyInteraction.gridConfig,
        );
        if (idx !== -1) {
          legacyInteraction.onSelectFrame(idx);
          if (legacyInteraction.builderSlots?.[idx]) {
            setDragMode(DragMode.SWAP_SLOTS);
            setDragStartSlot(idx);
          }
        }
      } else if (legacyInteraction.imageMeta) {
        const idx = legacyInteraction.frames.findIndex(
          (f) => x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h,
        );
        if (idx !== -1) {
          legacyInteraction.onSelectFrame(idx);
          setDragMode(DragMode.MOVE_FRAME);
        }
      }
    },
    [
      isEmpty,
      legacyInteraction,
      canonicalEyedropper,
      isSpacePressed,
      canvasRef,
      getRelMouse,
    ],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getRelMouse(e.clientX, e.clientY);
      setMousePos({ x, y });

      if (dragMode === DragMode.PAN) {
        setViewport({
          ...viewport,
          offset: {
            x: viewport.offset.x + e.movementX,
            y: viewport.offset.y + e.movementY,
          },
        });
        return;
      }

      if (!legacyInteraction) return;

      const dx = x - lastMousePos.x;
      const dy = y - lastMousePos.y;

      if (dragMode === DragMode.SWAP_SLOTS && legacyInteraction.builderCanvas) {
        const hoverIdx = getGridIndexFromPos(
          x,
          y,
          legacyInteraction.builderCanvas.width,
          legacyInteraction.builderCanvas.height,
          legacyInteraction.gridConfig,
        );
        setDragHoverSlot(hoverIdx !== -1 ? hoverIdx : null);
        return;
      }

      if (dragMode === DragMode.MOVE_FRAME) {
        if (legacyInteraction.currentMode === AppMode.BUILDER && legacyInteraction.selectedFrameIndex !== null) {
          const s = legacyInteraction.builderSlots?.[legacyInteraction.selectedFrameIndex];
          if (s) {
            legacyInteraction.onUpdateSlotEphemeral?.(legacyInteraction.selectedFrameIndex, {
              ...s,
              offsetX: s.offsetX + dx,
              offsetY: s.offsetY + dy,
            });
            setLastMousePos({ x, y });
          }
        } else if (legacyInteraction.selectedFrameIndex !== null) {
          const f = legacyInteraction.frames[legacyInteraction.selectedFrameIndex];
          legacyInteraction.onUpdateFrameEphemeral?.(f.id, { x: f.x + dx, y: f.y + dy });
          setLastMousePos({ x, y });
        }
      }
    },
    [
      dragMode,
      getRelMouse,
      viewport,
      setViewport,
      lastMousePos,
      legacyInteraction,
    ],
  );

  const handleMouseUp = useCallback(() => {
    if (legacyInteraction && dragMode === DragMode.SWAP_SLOTS && dragStartSlot !== null && dragHoverSlot !== null) {
      if (dragStartSlot !== dragHoverSlot) {
        legacyInteraction.onSwapSlots?.(dragStartSlot, dragHoverSlot);
        legacyInteraction.onSelectFrame(dragHoverSlot);
      }
    } else if (legacyInteraction && dragMode === DragMode.MOVE_FRAME) {
      if (legacyInteraction.currentMode === AppMode.BUILDER && legacyInteraction.selectedFrameIndex !== null) {
        legacyInteraction.onUpdateSlot?.(
          legacyInteraction.selectedFrameIndex,
          legacyInteraction.builderSlots?.[legacyInteraction.selectedFrameIndex],
        );
      } else if (legacyInteraction.selectedFrameIndex !== null) {
        const frame = legacyInteraction.frames[legacyInteraction.selectedFrameIndex];
        legacyInteraction.onUpdateFrame?.(frame.id, frame);
      }
    }
    setDragMode(DragMode.NONE);
    setDragSelectionRect(null);
    setDragStartSlot(null);
    setDragHoverSlot(null);
  }, [
    dragMode,
    dragStartSlot,
    dragHoverSlot,
    legacyInteraction,
  ]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || isSpacePressed) {
        e.preventDefault();
        const r = containerRef.current!.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const wx = (mx - viewport.offset.x) / viewport.scale;
        const wy = (my - viewport.offset.y) / viewport.scale;
        const d = -e.deltaY;
        const ns = Math.min(Math.max(0.01, viewport.scale * Math.pow(1.1, d / 150)), 100);
        setViewport({ scale: ns, offset: { x: mx - wx * ns, y: my - wy * ns } });
      }
    },
    [isSpacePressed, containerRef, viewport, setViewport],
  );

  const getCursor = useCallback(() => {
    if (isEmpty) return "default";
    if (dragMode === DragMode.PAN) return "grab";
    if (canonicalEyedropper?.isActive) return "crosshair";
    if (legacyInteraction && dragMode === DragMode.MOVE_FRAME) return "move";
    if (legacyInteraction && dragMode === DragMode.SWAP_SLOTS) return "grabbing";
    if (legacyInteraction?.isEyedropperActive) return "crosshair";
    return "default";
  }, [isEmpty, dragMode, legacyInteraction, canonicalEyedropper]);

  return {
    dragMode,
    mousePos,
    dragSelectionRect,
    dragHoverSlot,
    isDragOverCanvas,
    dragStartSlot,
    setIsDragOverCanvas,
    handleDragOver,
    handleDrop,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    getCursor,
  };
}
