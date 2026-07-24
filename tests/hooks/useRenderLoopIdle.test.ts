import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { useRenderLoop } from "../../hooks/canvas/useCanvasRenderLoop";
import { hostCanvasNeedsContinuousPaint } from "../../utils/hostProjectPolicy";

describe("useRenderLoop idle policy", () => {
  let rafQueue: FrameRequestCallback[];
  let rafId: number;

  beforeEach(() => {
    rafQueue = [];
    rafId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafId++;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      void id;
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not reschedule continuous rAF when idle after first paint", () => {
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "getContext", {
      value: () => ({
        setTransform: vi.fn(),
        scale: vi.fn(),
      }),
    });

    const { result } = renderHook(() => {
      const canvasRef = useRef<HTMLCanvasElement | null>(canvas);
      const containerRef = useRef<HTMLDivElement | null>(document.createElement("div"));
      const propsRef = useRef({
        isPlaying: false,
        frames: [],
        gridConfig: { rows: 1, cols: 1, marginX: 0, marginY: 0, paddingX: 0, paddingY: 0 },
        canvasContentDimensions: { width: 10, height: 10 },
        currentMode: "BUILDER",
      });
      const stateRef = useRef({
        viewport: { scale: 1, offset: { x: 0, y: 0 } },
        dragMode: "NONE",
        mousePos: { x: 0, y: 0 },
        dragSelectionRect: null,
        dragHoverSlot: null,
        isDragOverCanvas: false,
        dragStartSlot: null,
      });
      const invalidateRef = useRef<(() => void) | null>(null);
      useRenderLoop({
        canvasRef,
        containerRef,
        propsRef,
        stateRef,
        slicerImgObj: null,
        assetCache: {},
        invalidateRef,
      });
      return { invalidateRef, propsRef, stateRef };
    });

    // Force non-zero dims by invoking scheduled frames after mock resize path.
    // The hook still schedules an initial invalidate paint via rAF.
    const initialQueued = rafQueue.length;
    expect(initialQueued).toBeGreaterThanOrEqual(1);

    // Drain all scheduled frames; idle must not grow unbounded queues.
    let safety = 0;
    while (rafQueue.length > 0 && safety < 20) {
      safety += 1;
      const batch = rafQueue.splice(0, rafQueue.length);
      for (const cb of batch) {
        act(() => {
          cb(performance.now());
        });
      }
    }
    expect(safety).toBeLessThan(10);
    expect(rafQueue.length).toBe(0);

    // Continuous policy helper stays false for idle state.
    expect(
      hostCanvasNeedsContinuousPaint({
        isPlaying: result.current.propsRef.current.isPlaying,
        dragMode: result.current.stateRef.current.dragMode,
      }),
    ).toBe(false);

    // One invalidate schedules exactly one more paint generation.
    const before = rafQueue.length;
    act(() => {
      result.current.invalidateRef.current?.();
    });
    expect(rafQueue.length).toBe(before + 1);
    const again = rafQueue.splice(0, rafQueue.length);
    for (const cb of again) act(() => cb(performance.now()));
    expect(rafQueue.length).toBe(0);
  });
});
