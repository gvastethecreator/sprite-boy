import React from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SliceGridOverlay } from "../../features/slice/grid/SliceGridOverlay";
import type { EffectiveGridLayout } from "../../features/slice/grid/useSliceGridController";

const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  rect: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  strokeRect: vi.fn(),
  lineWidth: 0,
  fillStyle: "",
  strokeStyle: "",
} as unknown as CanvasRenderingContext2D;

let size = { width: 300, height: 180 };
let resizeCallback: ResizeObserverCallback | null = null;
const disconnect = vi.fn();
const observe = vi.fn();

const layout: EffectiveGridLayout = Object.freeze({
  origin: "manual",
  rows: 1,
  cols: 2,
  cells: Object.freeze([
    Object.freeze({ x: 0, y: 0, width: 3, height: 3 }),
    Object.freeze({ x: 3, y: 0, width: 4, height: 3 }),
  ]),
  warnings: Object.freeze([]),
  recipeLayout: Object.freeze({ mode: "manual", rows: 1, cols: 2 }),
});

describe("G2-04 SliceGridOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    size = { width: 300, height: 180 };
    resizeCallback = null;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
      x: 0,
      y: 0,
      top: 0,
      right: size.width,
      bottom: size.height,
      left: 0,
      width: size.width,
      height: size.height,
      toJSON: () => ({}),
    }));
    class ResizeObserverProbe {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverProbe);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("consumes the controller layout directly, stays non-interactive and redraws on resize", () => {
    const { container, rerender, unmount } = render(
      <div style={{ position: "relative", width: 300, height: 180 }}>
        <SliceGridOverlay
          sourceDimensions={Object.freeze({ width: 7, height: 3 })}
          effectiveLayout={layout}
          transform={Object.freeze({ scale: 10, offset: Object.freeze({ x: 5, y: 7 }) })}
          devicePixelRatio={2}
        />
      </div>,
    );
    const host = container.querySelector<HTMLElement>("[data-slice-grid-overlay]")!;
    const canvas = container.querySelector<HTMLCanvasElement>("[data-slice-grid-overlay-canvas]")!;
    expect(host).toHaveAttribute("aria-hidden", "true");
    expect(host.style.pointerEvents).toBe("none");
    expect(canvas.style.pointerEvents).toBe("none");
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(360);
    expect(canvas.dataset.gridOverlayCells).toBe("2");
    expect(canvas.dataset.gridOverlayScale).toBe("10");
    expect(canvas.dataset.gridOverlayOffset).toBe("5,7");
    expect(Number(canvas.dataset.gridOverlayDrawCount)).toBeGreaterThan(0);
    expect(observe).toHaveBeenCalledWith(host);

    size = { width: 240.5, height: 120.5 };
    act(() => resizeCallback?.([], {} as ResizeObserver));
    expect(canvas.width).toBe(481);
    expect(canvas.height).toBe(241);
    expect(canvas.dataset.gridOverlayBacking).toBe("481x241");

    rerender(
      <div style={{ position: "relative", width: 300, height: 180 }}>
        <SliceGridOverlay
          sourceDimensions={Object.freeze({ width: 7, height: 3 })}
          effectiveLayout={layout}
          transform={Object.freeze({ scale: 4, offset: Object.freeze({ x: -3, y: 11 }) })}
          devicePixelRatio={2}
        />
      </div>,
    );
    expect(canvas.dataset.gridOverlayScale).toBe("4");
    expect(canvas.dataset.gridOverlayOffset).toBe("-3,11");

    const lateCallback = resizeCallback;
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(() => lateCallback?.([], {} as ResizeObserver)).not.toThrow();
    expect(canvas.width).toBe(0);
  });

  it("renders nothing until both canonical controller outputs exist", () => {
    const { container, rerender } = render(
      <SliceGridOverlay
        sourceDimensions={null}
        effectiveLayout={null}
        transform={{ scale: 1, offset: { x: 0, y: 0 } }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <SliceGridOverlay
        sourceDimensions={{ width: 7, height: 3 }}
        effectiveLayout={null}
        transform={{ scale: 1, offset: { x: 0, y: 0 } }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
