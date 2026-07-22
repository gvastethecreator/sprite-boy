import { describe, expect, it } from "vitest";

import {
  moveManualRegionBounds,
  resizeManualRegionBounds,
} from "../../features/slice/irregular/manualRegionGeometry";

describe("manual Region canvas geometry", () => {
  const source = { width: 128, height: 96 };

  it("moves mixed-size rectangles in source pixels and clamps them to the source", () => {
    expect(moveManualRegionBounds({ x: 10, y: 20, width: 30, height: 15 }, 7, -4, source)).toEqual({
      x: 17, y: 16, width: 30, height: 15,
    });
    expect(moveManualRegionBounds({ x: 100, y: 80, width: 30, height: 20 }, 50, 50, source)).toEqual({
      x: 98, y: 76, width: 30, height: 20,
    });
  });

  it("resizes every edge while preserving a one-pixel minimum and source bounds", () => {
    const bounds = { x: 20, y: 15, width: 40, height: 30 };
    expect(resizeManualRegionBounds(bounds, "nw", -10, -5, source)).toEqual({
      x: 10, y: 10, width: 50, height: 35,
    });
    expect(resizeManualRegionBounds(bounds, "se", 100, 100, source)).toEqual({
      x: 20, y: 15, width: 108, height: 81,
    });
    expect(resizeManualRegionBounds(bounds, "nw", 100, 100, source)).toEqual({
      x: 59, y: 44, width: 1, height: 1,
    });
  });
});
