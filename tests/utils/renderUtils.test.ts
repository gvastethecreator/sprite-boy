import { describe, it, expect } from "vitest";
import { calculateGeometry } from "../../utils/renderUtils";
import type { GridConfig } from "../../types/config";

describe("calculateGeometry", () => {
  const baseGrid: GridConfig = {
    rows: 4,
    cols: 4,
    marginX: 0,
    marginY: 0,
    paddingX: 0,
    paddingY: 0,
  };

  it("divides canvas evenly with no margin/padding", () => {
    const g = calculateGeometry(256, 256, baseGrid);
    expect(g.cellW).toBe(64);
    expect(g.cellH).toBe(64);
    expect(g.rows).toBe(4);
    expect(g.cols).toBe(4);
  });

  it("accounts for margins", () => {
    const grid: GridConfig = { ...baseGrid, marginX: 10, marginY: 10 };
    const g = calculateGeometry(256, 256, grid);
    // available = 256 - 2*10 = 236, cell = 236/4 = 59
    expect(g.cellW).toBe(59);
    expect(g.cellH).toBe(59);
  });

  it("accounts for padding between cells", () => {
    const grid: GridConfig = { ...baseGrid, paddingX: 2, paddingY: 2 };
    const g = calculateGeometry(256, 256, grid);
    // total gap = 2 * (4-1) = 6, available = 256-6 = 250, cell = 250/4 = 62.5
    expect(g.cellW).toBe(62.5);
    expect(g.cellH).toBe(62.5);
  });

  it("returns minimum 1px cells for tiny canvas", () => {
    const g = calculateGeometry(1, 1, { ...baseGrid, rows: 100, cols: 100 });
    expect(g.cellW).toBeGreaterThanOrEqual(1);
    expect(g.cellH).toBeGreaterThanOrEqual(1);
  });

  it("handles single cell grid", () => {
    const grid: GridConfig = { ...baseGrid, rows: 1, cols: 1 };
    const g = calculateGeometry(512, 512, grid);
    expect(g.cellW).toBe(512);
    expect(g.cellH).toBe(512);
  });
});
