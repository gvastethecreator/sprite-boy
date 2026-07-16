import { describe, expect, it, vi } from "vitest";

import { buildManualGrid } from "../../core/processing/gridProcessingGeometry";
import {
  paintGridOverlay,
  projectGridOverlay,
} from "../../features/slice/grid/gridOverlayGeometry";

describe("G2-04 grid overlay geometry", () => {
  it("projects non-divisible source cells through fractional zoom, pan and DPR without drift", () => {
    const cells = buildManualGrid(7, 5, 2, 3);
    const projection = projectGridOverlay(
      cells,
      7,
      5,
      { scale: 1.25, offset: { x: -2.375, y: 4.125 } },
      { width: 311.5, height: 177.25, devicePixelRatio: 2.5 },
    );

    expect(projection.backingWidth).toBe(779);
    expect(projection.backingHeight).toBe(443);
    expect(projection.sourceBoundsCss).toEqual({
      x: -2.375,
      y: 4.125,
      width: 8.75,
      height: 6.25,
    });
    expect(projection.sourceBoundsDevice).toEqual({
      x: -5.9375,
      y: 10.3125,
      width: 21.875,
      height: 15.625,
    });

    for (const cell of projection.cells) {
      expect(cell.css.x).toBe(projection.transform.offset.x + cell.source.x * 1.25);
      expect(cell.css.y).toBe(projection.transform.offset.y + cell.source.y * 1.25);
      expect(cell.css.width).toBe(cell.source.width * 1.25);
      expect(cell.css.height).toBe(cell.source.height * 1.25);
      expect(cell.device.x).toBe(cell.css.x * 2.5);
      expect(cell.device.y).toBe(cell.css.y * 2.5);
      expect(cell.device.width).toBe(cell.css.width * 2.5);
      expect(cell.device.height).toBe(cell.css.height * 2.5);
      expect(cell.source.x + cell.source.width).toBeLessThanOrEqual(7);
      expect(cell.source.y + cell.source.height).toBeLessThanOrEqual(5);
      expect(cell.css.x + cell.css.width).toBeLessThanOrEqual(
        projection.sourceBoundsCss.x + projection.sourceBoundsCss.width,
      );
      expect(cell.css.y + cell.css.height).toBeLessThanOrEqual(
        projection.sourceBoundsCss.y + projection.sourceBoundsCss.height,
      );
    }

    for (let row = 0; row < 2; row += 1) {
      const rowCells = projection.cells.slice(row * 3, row * 3 + 3);
      expect(rowCells[0]!.css.x + rowCells[0]!.css.width).toBe(rowCells[1]!.css.x);
      expect(rowCells[1]!.css.x + rowCells[1]!.css.width).toBe(rowCells[2]!.css.x);
      expect(rowCells[2]!.css.x + rowCells[2]!.css.width).toBe(
        projection.sourceBoundsCss.x + projection.sourceBoundsCss.width,
      );
    }
    expect(projection.cells[2]!.source.width).toBe(3);
    expect(projection.cells[5]!.source.height).toBe(3);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.cells)).toBe(true);
  });

  it("preserves detected gaps and recomputes only the explicit viewport transform", () => {
    const cells = Object.freeze([
      Object.freeze({ x: 2, y: 3, width: 4, height: 5 }),
      Object.freeze({ x: 9, y: 3, width: 3, height: 5 }),
    ]);
    const first = projectGridOverlay(
      cells,
      16,
      12,
      { scale: 2, offset: { x: 10, y: 20 } },
      { width: 200, height: 100, devicePixelRatio: 1 },
    );
    const zoomed = projectGridOverlay(
      cells,
      16,
      12,
      { scale: 0.5, offset: { x: -7, y: -11 } },
      { width: 200, height: 100, devicePixelRatio: 3 },
    );

    expect(first.cells.map(({ css }) => css)).toEqual([
      { x: 14, y: 26, width: 8, height: 10 },
      { x: 28, y: 26, width: 6, height: 10 },
    ]);
    expect(zoomed.cells.map(({ css }) => css)).toEqual([
      { x: -6, y: -9.5, width: 2, height: 2.5 },
      { x: -2.5, y: -9.5, width: 1.5, height: 2.5 },
    ]);
    expect(zoomed.cells[0]!.source).toEqual(cells[0]);
    expect(zoomed.cells[1]!.source).toEqual(cells[1]);
    expect(zoomed.cells.every(({ source }) => Object.isFrozen(source))).toBe(true);
  });

  it("rejects getters, sparse arrays, OOB cells and hostile numeric transforms", () => {
    const getter = vi.fn(() => 0);
    const accessorCell = Object.defineProperties({}, {
      x: { enumerable: true, get: getter },
      y: { enumerable: true, value: 0 },
      width: { enumerable: true, value: 1 },
      height: { enumerable: true, value: 1 },
    });
    const validTransform = { scale: 1, offset: { x: 0, y: 0 } };
    const validSurface = { width: 20, height: 20, devicePixelRatio: 1 };
    expect(() => projectGridOverlay([accessorCell], 2, 2, validTransform, validSurface)).toThrow(TypeError);
    expect(getter).not.toHaveBeenCalled();

    const sparse = Array.from({ length: 2 });
    delete sparse[1];
    sparse[0] = { x: 0, y: 0, width: 1, height: 1 };
    expect(() => projectGridOverlay(sparse, 2, 2, validTransform, validSurface)).toThrow(TypeError);
    expect(() => projectGridOverlay(
      [{ x: 1, y: 0, width: 2, height: 1 }],
      2,
      2,
      validTransform,
      validSurface,
    )).toThrow(TypeError);

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0, -1]) {
      expect(() => projectGridOverlay(
        [{ x: 0, y: 0, width: 1, height: 1 }],
        2,
        2,
        { scale: value, offset: { x: 0, y: 0 } },
        validSurface,
      )).toThrow(TypeError);
    }
  });

  it("paints exactly one DPR-scaled frame and clears in backing coordinates", () => {
    const calls: Array<readonly unknown[]> = [];
    const context = {
      setTransform: (...args: unknown[]) => calls.push(["setTransform", ...args]),
      clearRect: (...args: unknown[]) => calls.push(["clearRect", ...args]),
      beginPath: () => calls.push(["beginPath"]),
      rect: (...args: unknown[]) => calls.push(["rect", ...args]),
      fill: () => calls.push(["fill"]),
      stroke: () => calls.push(["stroke"]),
      strokeRect: (...args: unknown[]) => calls.push(["strokeRect", ...args]),
      lineWidth: 0,
      fillStyle: "",
      strokeStyle: "",
    } as unknown as CanvasRenderingContext2D;
    const projection = projectGridOverlay(
      buildManualGrid(5, 3, 1, 2),
      5,
      3,
      { scale: 4, offset: { x: 2, y: 6 } },
      { width: 80, height: 60, devicePixelRatio: 2 },
    );

    paintGridOverlay(context, projection);
    expect(calls).toEqual([
      ["setTransform", 1, 0, 0, 1, 0, 0],
      ["clearRect", 0, 0, 160, 120],
      ["setTransform", 2, 0, 0, 2, 0, 0],
      ["beginPath"],
      ["rect", 2, 6, 8, 12],
      ["rect", 10, 6, 12, 12],
      ["fill"],
      ["stroke"],
      ["strokeRect", 2, 6, 20, 12],
      ["setTransform", 1, 0, 0, 1, 0, 0],
    ]);
  });
});
