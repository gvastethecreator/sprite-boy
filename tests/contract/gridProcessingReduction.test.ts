import { describe, expect, it } from "vitest";
import {
  GRID_EMPTY_CELL_POLICY,
  calculateAggregateCropReductionRatio,
  resolveGridCellReductionPolicy,
} from "../../core/processing/gridProcessingReduction";

describe("G3-02 grid crop reduction and empty-cell policy", () => {
  it("retains empty cells as one transparent placeholder slot without skipping", () => {
    expect(GRID_EMPTY_CELL_POLICY).toBe("retain-transparent-1x1");
    const policy = resolveGridCellReductionPolicy(7, 5, null, null);
    expect(policy).toEqual({
      skip: false,
      empty: true,
      surfaceWidth: 1,
      surfaceHeight: 1,
      cropReductionRatio: 1,
      warning: "empty-output",
    });
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it("reports exact canonical min, intermediate and max per-cell reduction", () => {
    expect(resolveGridCellReductionPolicy(4, 3, 4, 3)).toMatchObject({
      skip: false,
      empty: false,
      surfaceWidth: 4,
      surfaceHeight: 3,
      cropReductionRatio: 0,
      warning: null,
    });
    expect(resolveGridCellReductionPolicy(4, 3, 2, 2).cropReductionRatio).toBe(2 / 3);
    expect(resolveGridCellReductionPolicy(16_384, 1, 1, 1).cropReductionRatio)
      .toBe(16_383 / 16_384);
  });

  it("uses cell-area weighting for mixed and all-empty result summaries", () => {
    expect(calculateAggregateCropReductionRatio(10, 7)).toBe(0.3);
    expect(calculateAggregateCropReductionRatio(67_108_864, 1)).toBe(
      67_108_863 / 67_108_864,
    );
    expect(calculateAggregateCropReductionRatio(12, 12)).toBe(0);
    expect(Object.is(calculateAggregateCropReductionRatio(12, 12), -0)).toBe(false);
    expect(calculateAggregateCropReductionRatio(12, 0)).toBe(1);
  });

  it("rejects partial-null, impossible, non-canonical and over-budget dimensions", () => {
    expect(() => resolveGridCellReductionPolicy(2, 2, null, 1)).toThrow(TypeError);
    expect(() => resolveGridCellReductionPolicy(2, 2, 1, null)).toThrow(TypeError);
    expect(() => resolveGridCellReductionPolicy(2, 2, 0, 1)).toThrow(TypeError);
    expect(() => resolveGridCellReductionPolicy(2, 2, 1, 0)).toThrow(TypeError);
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0, -1, 1.5, 16_385]) {
      expect(() => resolveGridCellReductionPolicy(value, 2, 1, 1)).toThrow(TypeError);
    }
    for (const [cellPixels, retainedPixels] of [
      [0, 0],
      [10, 11],
      [10, -1],
      [10, -0],
      [10, Number.NaN],
      [67_108_865, 1],
    ] as const) {
      expect(() => calculateAggregateCropReductionRatio(cellPixels, retainedPixels)).toThrow(TypeError);
    }
  });
});
