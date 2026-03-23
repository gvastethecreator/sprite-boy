import { describe, it, expect } from "vitest";
import { generateFramesFromGrid } from "../../utils/algorithms";
import type { GridConfig } from "../../types/config";

describe("generateFramesFromGrid", () => {
  const baseGrid: GridConfig = {
    rows: 4,
    cols: 4,
    marginX: 0,
    marginY: 0,
    paddingX: 0,
    paddingY: 0,
  };

  it("generates 16 frames for a 4x4 grid on 256x256", () => {
    const frames = generateFramesFromGrid(256, 256, baseGrid);
    expect(frames).toHaveLength(16);
  });

  it("generates frames with correct positions", () => {
    const frames = generateFramesFromGrid(256, 256, baseGrid);
    // First frame at (0,0), second at (64,0), etc.
    expect(frames[0]).toEqual({ id: 0, x: 0, y: 0, w: 64, h: 64 });
    expect(frames[1]).toEqual({ id: 1, x: 64, y: 0, w: 64, h: 64 });
    expect(frames[4]).toEqual({ id: 4, x: 0, y: 64, w: 64, h: 64 });
  });

  it("respects margins", () => {
    const grid: GridConfig = { ...baseGrid, rows: 1, cols: 1, marginX: 10, marginY: 10 };
    const frames = generateFramesFromGrid(256, 256, grid);
    expect(frames).toHaveLength(1);
    expect(frames[0].x).toBe(10);
    expect(frames[0].y).toBe(10);
  });

  it("generates single row correctly", () => {
    const grid: GridConfig = { ...baseGrid, rows: 1, cols: 4 };
    const frames = generateFramesFromGrid(256, 64, grid);
    expect(frames).toHaveLength(4);
    frames.forEach((f) => {
      expect(f.y).toBe(0);
      expect(f.h).toBe(64);
    });
  });

  it("handles non-divisible sizes with floor rounding", () => {
    const grid: GridConfig = { ...baseGrid, rows: 3, cols: 3 };
    const frames = generateFramesFromGrid(100, 100, grid);
    // 100/3 ≈ 33.33, floored to 33
    expect(frames[0].w).toBe(33);
    expect(frames[0].h).toBe(33);
  });
});
