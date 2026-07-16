import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useCanvasMouse, type LegacyCanvasInteraction } from "../../hooks/canvas/useCanvasMouse";
import { AppMode, DragMode, type GridConfig } from "../../types";

const grid: GridConfig = {
  rows: 2,
  cols: 2,
  marginX: 0,
  marginY: 0,
  paddingX: 0,
  paddingY: 0,
};

function refs() {
  const container = document.createElement("div");
  Object.defineProperty(container, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, width: 400, height: 200 }),
  });
  return {
    containerRef: { current: container },
    canvasRef: { current: document.createElement("canvas") },
  };
}

function mouseEvent(overrides: Record<string, unknown> = {}) {
  return {
    button: 0,
    clientX: 20,
    clientY: 20,
    movementX: 0,
    movementY: 0,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  };
}

describe("useCanvasMouse canonical isolation (G2-05)", () => {
  it("keeps click, drag/drop and legacy selection inert while retaining pan", () => {
    const setViewport = vi.fn();
    const { result, rerender } = renderHook(
      ({ space }) => useCanvasMouse({
        ...refs(),
        isEmpty: false,
        viewport: { scale: 1, offset: { x: 0, y: 0 } },
        setViewport,
        isSpacePressed: space,
        canonicalEyedropper: null,
        legacyInteraction: null,
      }),
      { initialProps: { space: false } },
    );

    act(() => result.current.handleMouseDown(mouseEvent() as never));
    expect(result.current.dragMode).toBe(DragMode.NONE);

    const dragOver = mouseEvent();
    act(() => result.current.handleDragOver(dragOver as never));
    expect(dragOver.preventDefault).toHaveBeenCalledOnce();
    expect(result.current.isDragOverCanvas).toBe(false);
    expect(result.current.dragHoverSlot).toBeNull();

    const drop = mouseEvent({
      dataTransfer: { files: [new File(["x"], "replacement.png")], getData: vi.fn() },
    });
    act(() => result.current.handleDrop(drop as never));
    expect(drop.preventDefault).toHaveBeenCalledOnce();

    rerender({ space: true });
    act(() => result.current.handleMouseDown(mouseEvent() as never));
    expect(result.current.dragMode).toBe(DragMode.PAN);
    act(() => result.current.handleMouseMove(mouseEvent({ movementX: 8, movementY: -3 }) as never));
    expect(setViewport).toHaveBeenCalledWith({ scale: 1, offset: { x: 8, y: -3 } });
  });

  it("preserves legacy selection outside canonical Slice", () => {
    const onSelectFrame = vi.fn();
    const legacyInteraction: LegacyCanvasInteraction = {
      currentMode: AppMode.ANIMATION,
      builderCanvas: null,
      gridConfig: grid,
      imageMeta: { name: "sheet.png", width: 400, height: 200 } as never,
      frames: [{ id: 1, x: 0, y: 0, w: 100, h: 100 }] as never,
      builderSlots: undefined,
      selectedFrameIndex: null,
      isEyedropperActive: false,
      onPickColor: undefined,
      onSelectFrame,
      onUpload: vi.fn(),
      onUpdateSlot: undefined,
      onUpdateSlotEphemeral: undefined,
      onUpdateFrame: undefined,
      onUpdateFrameEphemeral: undefined,
      onSwapSlots: undefined,
    };
    const { result } = renderHook(() => useCanvasMouse({
      ...refs(),
      isEmpty: false,
      viewport: { scale: 1, offset: { x: 0, y: 0 } },
      setViewport: vi.fn(),
      isSpacePressed: false,
      canonicalEyedropper: null,
      legacyInteraction,
    }));

    act(() => result.current.handleMouseDown(mouseEvent() as never));
    expect(onSelectFrame).toHaveBeenCalledWith(0);
    expect(result.current.dragMode).toBe(DragMode.MOVE_FRAME);
  });

  it("quarantines an in-flight legacy drag when canonical ownership takes over", () => {
    const legacyInteraction: LegacyCanvasInteraction = {
      currentMode: AppMode.ANIMATION,
      builderCanvas: null,
      gridConfig: grid,
      imageMeta: { name: "sheet.png", width: 400, height: 200 } as never,
      frames: [{ id: 1, x: 0, y: 0, w: 100, h: 100 }] as never,
      builderSlots: undefined,
      selectedFrameIndex: 0,
      isEyedropperActive: false,
      onPickColor: vi.fn(),
      onSelectFrame: vi.fn(),
      onUpload: vi.fn(),
      onUpdateSlot: undefined,
      onUpdateSlotEphemeral: undefined,
      onUpdateFrame: vi.fn(),
      onUpdateFrameEphemeral: vi.fn(),
      onSwapSlots: undefined,
    };
    const { result, rerender } = renderHook(
      ({ canonical }) => useCanvasMouse({
        ...refs(),
        isEmpty: false,
        viewport: { scale: 1, offset: { x: 0, y: 0 } },
        setViewport: vi.fn(),
        isSpacePressed: false,
        canonicalEyedropper: null,
        legacyInteraction: canonical ? null : legacyInteraction,
      }),
      { initialProps: { canonical: false } },
    );
    act(() => result.current.handleMouseDown(mouseEvent() as never));
    expect(result.current.dragMode).toBe(DragMode.MOVE_FRAME);

    rerender({ canonical: true });

    expect(result.current.dragMode).toBe(DragMode.NONE);
    expect(result.current.dragStartSlot).toBeNull();
    expect(result.current.dragHoverSlot).toBeNull();
  });

  it("samples the canonical source through zoom and DPR, then cancels on pick or Escape", () => {
    const originalDpr = window.devicePixelRatio;
    const { containerRef, canvasRef } = refs();
    const canvas = canvasRef.current!;
    canvas.width = 800;
    canvas.height = 400;
    Object.defineProperty(canvas, "getBoundingClientRect", {
      value: () => ({ left: 100, top: 50, width: 400, height: 200 }),
    });
    const getImageData = vi.fn(() => ({
      data: new Uint8ClampedArray([12, 34, 56, 255]),
    }));
    vi.spyOn(canvas, "getContext").mockReturnValue({ getImageData } as never);
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });

    try {
      const onPickColor = vi.fn();
      const onCancel = vi.fn();
      const { result } = renderHook(() => useCanvasMouse({
        containerRef,
        canvasRef,
        isEmpty: false,
        viewport: { scale: 3, offset: { x: 10, y: 5 } },
        setViewport: vi.fn(),
        isSpacePressed: false,
        canonicalEyedropper: {
          isActive: true,
          sourceWidth: 20,
          sourceHeight: 10,
          onPickColor,
          onCancel,
        },
        legacyInteraction: null,
      }));

      const pick = mouseEvent({ clientX: 110, clientY: 55 });
      act(() => result.current.handleMouseDown(pick as never));

      expect(pick.preventDefault).toHaveBeenCalledOnce();
      expect(pick.stopPropagation).toHaveBeenCalledOnce();
      expect(getImageData).toHaveBeenCalledWith(20, 10, 1, 1);
      expect(onPickColor).toHaveBeenCalledWith("#0c2238");
      expect(onCancel).toHaveBeenCalledOnce();

      const middlePan = mouseEvent({ button: 1 });
      act(() => result.current.handleMouseDown(middlePan as never));
      expect(result.current.dragMode).toBe(DragMode.PAN);
      expect(result.current.getCursor()).toBe("grab");
      expect(getImageData).toHaveBeenCalledOnce();
      expect(onPickColor).toHaveBeenCalledOnce();
      act(() => result.current.handleMouseUp());

      const outside = mouseEvent({ clientX: 99, clientY: 55 });
      act(() => result.current.handleMouseDown(outside as never));
      expect(onPickColor).toHaveBeenCalledOnce();

      act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
      expect(onCancel).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(window, "devicePixelRatio", {
        configurable: true,
        value: originalDpr,
      });
    }
  });
});
