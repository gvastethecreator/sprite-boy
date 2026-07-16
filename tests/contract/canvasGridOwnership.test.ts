import { describe, expect, it, vi } from "vitest";

import { AppMode, type GridConfig } from "../../types";
import { renderCanonicalSliceSourceSnapshot } from "../../components/canvas/CanvasArea";
import { resolveCanvasContentDimensions } from "../../hooks/canvas/canvasOwnership";
import { CanvasRenderer, type RenderContext } from "../../utils/renderUtils";

function fakeContext() {
  const counts = { stroke: 0, strokeRect: 0, drawImage: 0 };
  const context = {
    canvas: { width: 400, height: 200 },
    imageSmoothingEnabled: true,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), clearRect: vi.fn(),
    fillRect: vi.fn(), translate: vi.fn(), scale: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), rect: vi.fn(), clip: vi.fn(), rotate: vi.fn(),
    closePath: vi.fn(), fill: vi.fn(), arcTo: vi.fn(), roundRect: vi.fn(), fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    createPattern: vi.fn(() => ({})),
    stroke: vi.fn(() => { counts.stroke += 1; }),
    strokeRect: vi.fn(() => { counts.strokeRect += 1; }),
    drawImage: vi.fn(() => { counts.drawImage += 1; }),
  };
  return { context: context as unknown as CanvasRenderingContext2D, counts };
}

const GRID_2X2: GridConfig = Object.freeze({
  rows: 2,
  cols: 2,
  marginX: 0,
  marginY: 0,
  paddingX: 0,
  paddingY: 0,
});

function renderState(ctx: CanvasRenderingContext2D): RenderContext {
  return {
    ctx,
    width: 400,
    height: 200,
    scale: 1,
    offset: { x: 0, y: 0 },
    currentMode: AppMode.BUILDER,
    slicerImgObj: { width: 400, height: 200 } as HTMLImageElement,
    assetCache: {},
    frames: [],
    builderSlots: {},
    activeAnimation: null,
    gridConfig: GRID_2X2,
    builderGrid: GRID_2X2,
    templateConfig: { viewType: "full", showIndices: true, gridColor: "#fff", gridWidth: 1, backgroundColor: "#000" },
    selectedFrameIndex: null,
    playbackFrameIndex: 0,
    isPlaying: false,
    isDraggingPivot: false,
    tempPivot: null,
    isHoveringBuilderSlot: null,
    selectedHitboxId: null,
    isExport: false,
    includeGridInExport: false,
    dragSelectionRect: null,
    guides: [],
  };
}

describe("Canvas grid ownership (G2-05)", () => {
  it("uses source dimensions under canonical ownership and builder dimensions otherwise", () => {
    const input = {
      imageMeta: { width: 400, height: 200 },
      sourceIntrinsicDimensions: { width: 400, height: 200 },
      builderCanvas: { width: 1024, height: 1024 },
      fallback: { width: 100, height: 100 },
    };

    expect(resolveCanvasContentDimensions({
      ...input,
      canonicalCanvasOwnership: true,
    })).toEqual({ width: 400, height: 200 });
    expect(resolveCanvasContentDimensions({
      ...input,
      canonicalCanvasOwnership: false,
    })).toEqual({ width: 1024, height: 1024 });
  });

  it("exports canonical Slice as source-only without legacy grid strokes", () => {
    const { context, counts } = fakeContext();
    const source = { width: 400, height: 200 } as HTMLImageElement;

    renderCanonicalSliceSourceSnapshot(context, source, 400, 200);

    expect(context.imageSmoothingEnabled).toBe(false);
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 400, 200);
    expect(context.drawImage).toHaveBeenCalledWith(source, 0, 0, 400, 200);
    expect(counts.drawImage).toBe(1);
    expect(counts.stroke + counts.strokeRect).toBe(0);
  });

  it("renders the source once without executing legacy 2x2 grid/frame consumers under canonical 3x2 overlay", () => {
    const { context, counts } = fakeContext();
    const state = renderState(context);
    let legacyReads = 0;
    const hostileGrid = Object.create(null) as GridConfig;
    for (const key of ["rows", "cols", "marginX", "marginY", "paddingX", "paddingY"] as const) {
      Object.defineProperty(hostileGrid, key, {
        enumerable: true,
        get() {
          legacyReads += 1;
          throw new Error("legacy grid executed");
        },
      });
    }
    const frames = new Proxy([], {
      get() {
        legacyReads += 1;
        throw new Error("legacy frames executed");
      },
    });

    expect(() => CanvasRenderer.render({
      ...state,
      canonicalSliceOverlayActive: true,
      gridConfig: hostileGrid,
      builderGrid: hostileGrid,
      frames,
    })).not.toThrow();
    expect(legacyReads).toBe(0);
    expect(counts.drawImage).toBe(1);
    expect(counts.stroke + counts.strokeRect).toBe(0);
  });

  it("preserves legacy renderer behavior outside the canonical Slice workspace", () => {
    const { context, counts } = fakeContext();
    CanvasRenderer.render(renderState(context));
    expect(counts.drawImage).toBe(1);
    expect(counts.stroke).toBeGreaterThanOrEqual(2);
  });
});
