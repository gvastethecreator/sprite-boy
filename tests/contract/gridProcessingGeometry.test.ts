import { describe, expect, it } from "vitest";
import {
  buildManualGrid,
  calculateReductionRatio,
  getDetectionGeometry,
  getScaledDimensions,
} from "../../core/processing/gridProcessingGeometry";

function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

describe("G1-02 grid processing geometry", () => {
  it("builds the donor golden in strict row-major order and gives remainder to the last row/column", () => {
    const cells = buildManualGrid(100, 80, 3, 3);
    expect(cells).toEqual([
      { x: 0, y: 0, width: 33, height: 26 },
      { x: 33, y: 0, width: 33, height: 26 },
      { x: 66, y: 0, width: 34, height: 26 },
      { x: 0, y: 26, width: 33, height: 26 },
      { x: 33, y: 26, width: 33, height: 26 },
      { x: 66, y: 26, width: 34, height: 26 },
      { x: 0, y: 52, width: 33, height: 28 },
      { x: 33, y: 52, width: 33, height: 28 },
      { x: 66, y: 52, width: 34, height: 28 },
    ]);
    expect(Object.isFrozen(cells)).toBe(true);
    expect(cells.every(Object.isFrozen)).toBe(true);
  });

  it("covers seeded valid sources exactly without zero cells, gaps, overlap or out-of-bounds geometry", () => {
    const random = xorshift32(0x47524944);
    for (let iteration = 0; iteration < 500; iteration += 1) {
      const width = 1 + (random() % 257);
      const height = 1 + (random() % 257);
      const cols = 1 + (random() % Math.min(width, 32));
      const rows = 1 + (random() % Math.min(height, 32));
      const cells = buildManualGrid(width, height, rows, cols);

      expect(cells).toHaveLength(rows * cols);
      let coveredArea = 0;
      for (let index = 0; index < cells.length; index += 1) {
        const cell = cells[index]!;
        const row = Math.floor(index / cols);
        const column = index % cols;
        const expectedX = column === 0 ? 0 : cells[index - 1]!.x + cells[index - 1]!.width;
        const expectedY = row === 0 ? 0 : cells[(row - 1) * cols]!.y + cells[(row - 1) * cols]!.height;
        if (
          cell.width <= 0 ||
          cell.height <= 0 ||
          cell.x !== expectedX ||
          cell.y !== expectedY ||
          cell.x + cell.width > width ||
          cell.y + cell.height > height
        ) {
          throw new Error(`Invalid seeded cell geometry at iteration ${iteration}, index ${index}.`);
        }
        coveredArea += cell.width * cell.height;
      }
      expect(coveredArea).toBe(width * height);
      expect(cells.at(-1)).toMatchObject({
        width: width - Math.floor(width / cols) * (cols - 1),
        height: height - Math.floor(height / rows) * (rows - 1),
      });
    }
  });

  it("scales a longest side exactly while keeping every output dimension positive", () => {
    expect(getScaledDimensions(300, 150, 60)).toEqual({ width: 60, height: 30 });
    expect(getScaledDimensions(150, 300, 60)).toEqual({ width: 30, height: 60 });
    expect(getScaledDimensions(1, 16_384, 1)).toEqual({ width: 1, height: 1 });
    expect(getScaledDimensions(20, 10, 40)).toEqual({ width: 40, height: 20 });
    expect(Object.isFrozen(getScaledDimensions(20, 10, 40))).toBe(true);
  });

  it("keeps donor-width detection at source size below budget and never upscales", () => {
    expect(getDetectionGeometry(320, 200, 600)).toEqual({
      width: 320,
      height: 200,
      scale: 1,
    });
    const landscape = getDetectionGeometry(1_200, 600, 600);
    expect(landscape).toEqual({
      width: 600,
      height: 300,
      scale: 0.5,
    });
    expect(Object.isFrozen(landscape)).toBe(true);
    expect(getDetectionGeometry(1, 16_384, 600)).toEqual({
      width: 1,
      height: 16_384,
      scale: 1,
    });
    expect(getDetectionGeometry(300, 900)).toEqual({ width: 300, height: 900, scale: 1 });
  });

  it("reports an exact canonical crop reduction ratio including empty content", () => {
    expect(calculateReductionRatio(100, 100, 75, 75)).toBe(0.4375);
    expect(calculateReductionRatio(4, 4, 4, 4)).toBe(0);
    expect(calculateReductionRatio(4, 4, 0, 0)).toBe(1);
    for (const ratio of [
      calculateReductionRatio(3, 7, 1, 1),
      calculateReductionRatio(9, 5, 0, 3),
      calculateReductionRatio(257, 251, 128, 127),
    ]) {
      expect(Number.isFinite(ratio)).toBe(true);
      expect(Object.is(ratio, -0)).toBe(false);
      expect(ratio).toBeGreaterThanOrEqual(0);
      expect(ratio).toBeLessThanOrEqual(1);
    }
  });

  it("rejects hostile dimensions, grid counts and impossible crop geometry", () => {
    const hostile = [Number.NaN, Number.POSITIVE_INFINITY, -0, -1, 1.5, 16_385];
    for (const value of hostile) {
      expect(() => buildManualGrid(value, 10, 1, 1)).toThrow(TypeError);
      expect(() => getScaledDimensions(10, value, 8)).toThrow(TypeError);
      expect(() => getDetectionGeometry(10, 10, value)).toThrow(TypeError);
      expect(() => calculateReductionRatio(10, 10, value, 1)).toThrow(TypeError);
    }
    expect(() => buildManualGrid(2, 2, 3, 1)).toThrow(TypeError);
    expect(() => buildManualGrid(2, 2, 1, 3)).toThrow(TypeError);
    expect(() => buildManualGrid(100, 100, 65, 65)).toThrow(TypeError);
    expect(() => calculateReductionRatio(10, 10, 11, 1)).toThrow(TypeError);
    expect(() => calculateReductionRatio(10, 10, 1, 11)).toThrow(TypeError);
    expect(() => getScaledDimensions(10, 10, 4_097)).toThrow(TypeError);
  });
});
