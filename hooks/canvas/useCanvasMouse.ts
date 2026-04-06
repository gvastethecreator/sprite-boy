import { useState, useCallback } from "react";
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

interface CanvasMouseDeps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isEmpty: boolean;
  viewport: ViewportState;
  setViewport: (vp: ViewportState) => void;
  currentMode: AppMode;
  builderCanvas: BuilderCanvasSize | null | undefined;
  gridConfig: GridConfig;
  imageMeta: ImageMeta | null;
  frames: FrameData[];
  builderSlots: Record<number, SlotData> | undefined;
  selectedFrameIndex: number | null;
  isEyedropperActive: boolean;
  isSpacePressed: boolean;
  onPickColor: ((hex: string) => void) | undefined;
  onSelectFrame: (index: number) => void;
  onUpload: (file: File) => void;
  onUpdateSlot: ((idx: number, data: any) => void) | undefined;
  onUpdateSlotEphemeral: ((idx: number, data: any) => void) | undefined;
  onUpdateFrame: ((id: number, data: any) => void) | undefined;
  onUpdateFrameEphemeral: ((id: number, data: any) => void) | undefined;
  onSwapSlots: ((a: number, b: number) => void) | undefined;
}

/** All canvas mouse interaction: drag, pan, zoom, eyedropper, DnD, slot swap. */
export function useCanvasMouse(deps: CanvasMouseDeps) {
  const {
    containerRef,
    canvasRef,
    isEmpty,
    viewport,
    setViewport,
    currentMode,
    builderCanvas,
    gridConfig,
    imageMeta,
    frames,
    builderSlots,
    selectedFrameIndex,
    isEyedropperActive,
    isSpacePressed,
    onPickColor,
    onSelectFrame,
    onUpload,
    onUpdateSlot,
    onUpdateSlotEphemeral,
    onUpdateFrame,
    onUpdateFrameEphemeral,
    onSwapSlots,
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
      setIsDragOverCanvas(true);
      if (currentMode === AppMode.BUILDER && builderCanvas) {
        const { x, y } = getRelMouse(e.clientX, e.clientY);
        const idx = getGridIndexFromPos(
          x,
          y,
          builderCanvas.width,
          builderCanvas.height,
          gridConfig,
        );
        setDragHoverSlot(idx !== -1 ? idx : null);
      }
    },
    [currentMode, builderCanvas, gridConfig, getRelMouse],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
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
    [currentMode, builderCanvas, gridConfig, getRelMouse, onUpload, onUpdateSlot],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isEmpty) return;

      // Eyedropper
      if (isEyedropperActive && onPickColor && canvasRef.current) {
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
            onPickColor(hex);
          } catch (err) {
            console.warn("Could not pick color:", err);
          }
        }
        return;
      }

      const { x, y } = getRelMouse(e.clientX, e.clientY);
      setLastMousePos({ x, y });

      if (e.button === 1 || (isSpacePressed && e.button === 0)) {
        setDragMode(DragMode.PAN);
        return;
      }

      if (currentMode === AppMode.BUILDER && builderCanvas) {
        const idx = getGridIndexFromPos(
          x,
          y,
          builderCanvas.width,
          builderCanvas.height,
          gridConfig,
        );
        if (idx !== -1) {
          onSelectFrame(idx);
          if (builderSlots?.[idx]) {
            setDragMode(DragMode.SWAP_SLOTS);
            setDragStartSlot(idx);
          }
        }
      } else if (imageMeta) {
        const idx = frames.findIndex(
          (f) => x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h,
        );
        if (idx !== -1) {
          onSelectFrame(idx);
          setDragMode(DragMode.MOVE_FRAME);
        }
      }
    },
    [
      isEmpty,
      isEyedropperActive,
      isSpacePressed,
      onPickColor,
      canvasRef,
      getRelMouse,
      currentMode,
      builderCanvas,
      gridConfig,
      imageMeta,
      frames,
      builderSlots,
      onSelectFrame,
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

      const dx = x - lastMousePos.x;
      const dy = y - lastMousePos.y;

      if (dragMode === DragMode.SWAP_SLOTS && builderCanvas) {
        const hoverIdx = getGridIndexFromPos(
          x,
          y,
          builderCanvas.width,
          builderCanvas.height,
          gridConfig,
        );
        setDragHoverSlot(hoverIdx !== -1 ? hoverIdx : null);
        return;
      }

      if (dragMode === DragMode.MOVE_FRAME) {
        if (currentMode === AppMode.BUILDER && selectedFrameIndex !== null) {
          const s = builderSlots?.[selectedFrameIndex];
          if (s) {
            onUpdateSlotEphemeral?.(selectedFrameIndex, {
              ...s,
              offsetX: s.offsetX + dx,
              offsetY: s.offsetY + dy,
            });
            setLastMousePos({ x, y });
          }
        } else if (selectedFrameIndex !== null) {
          const f = frames[selectedFrameIndex];
          onUpdateFrameEphemeral?.(f.id, { x: f.x + dx, y: f.y + dy });
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
      builderCanvas,
      gridConfig,
      currentMode,
      selectedFrameIndex,
      builderSlots,
      frames,
      onUpdateSlotEphemeral,
      onUpdateFrameEphemeral,
    ],
  );

  const handleMouseUp = useCallback(() => {
    if (dragMode === DragMode.SWAP_SLOTS && dragStartSlot !== null && dragHoverSlot !== null) {
      if (dragStartSlot !== dragHoverSlot) {
        onSwapSlots?.(dragStartSlot, dragHoverSlot);
        onSelectFrame(dragHoverSlot);
      }
    } else if (dragMode === DragMode.MOVE_FRAME) {
      if (currentMode === AppMode.BUILDER && selectedFrameIndex !== null) {
        onUpdateSlot?.(selectedFrameIndex, builderSlots?.[selectedFrameIndex]);
      } else if (selectedFrameIndex !== null) {
        onUpdateFrame?.(frames[selectedFrameIndex].id, frames[selectedFrameIndex]);
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
    currentMode,
    selectedFrameIndex,
    builderSlots,
    frames,
    onSwapSlots,
    onSelectFrame,
    onUpdateSlot,
    onUpdateFrame,
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
    if (dragMode === DragMode.MOVE_FRAME) return "move";
    if (dragMode === DragMode.SWAP_SLOTS) return "grabbing";
    if (isEyedropperActive) return "crosshair";
    return "default";
  }, [isEmpty, dragMode, isEyedropperActive]);

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
