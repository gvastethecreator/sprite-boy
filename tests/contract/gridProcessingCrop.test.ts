import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  GridCropCancelledError,
  trimGridCell,
  type GridCropStageResult,
} from "../../core/processing/gridProcessingCrop";
import type { GridSplitRecipeV1 } from "../../core/project";

const TRANSPARENT = [9, 8, 7, 0] as const;

function rgba(
  width: number,
  height: number,
  fill: readonly [number, number, number, number] = TRANSPARENT,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(fill, offset);
  return pixels;
}

function setPixel(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  value: readonly [number, number, number, number],
): void {
  pixels.set(value, (y * width + x) * 4);
}

function crop(
  threshold: number,
  padding: number,
): GridSplitRecipeV1["crop"] {
  return Object.freeze({ threshold, padding });
}

function expectPixels(result: GridCropStageResult, expected: readonly number[]): void {
  expect(Array.from(result.pixels)).toEqual(expected);
}

function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

describe("grid alpha crop stage", () => {
  it("matches the exact source-space pixel golden without mutating source or recipe", () => {
    const pixels = rgba(5, 4);
    setPixel(pixels, 5, 2, 1, [10, 20, 30, 1]);
    setPixel(pixels, 5, 3, 2, [40, 50, 60, 255]);
    const original = pixels.slice();
    const recipeCrop = crop(0, 0);

    const result = trimGridCell(
      pixels,
      5,
      4,
      { x: 1, y: 0, width: 4, height: 4 },
      recipeCrop,
    );

    expect(result).toEqual({
      localBounds: { x: 1, y: 1, width: 2, height: 2 },
      contentBounds: { x: 2, y: 1, width: 2, height: 2 },
      pixels: expect.any(Uint8ClampedArray),
    });
    expectPixels(result!, [
      10, 20, 30, 1, 9, 8, 7, 0,
      9, 8, 7, 0, 40, 50, 60, 255,
    ]);
    expect(pixels).toEqual(original);
    expect(recipeCrop).toEqual({ threshold: 0, padding: 0 });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.localBounds)).toBe(true);
    expect(Object.isFrozen(result?.contentBounds)).toBe(true);
  });

  it("uses a strict monotonic alpha threshold at 0, midpoint, near-max and max", () => {
    const pixels = new Uint8ClampedArray([
      1, 1, 1, 1,
      2, 2, 2, 127,
      3, 3, 3, 128,
      4, 4, 4, 255,
    ]);
    const bounds = { x: 0, y: 0, width: 4, height: 1 };

    expect(trimGridCell(pixels, 4, 1, bounds, crop(0, 0))?.localBounds).toEqual({
      x: 0, y: 0, width: 4, height: 1,
    });
    expect(trimGridCell(pixels, 4, 1, bounds, crop(50, 0))?.localBounds).toEqual({
      x: 2, y: 0, width: 2, height: 1,
    });
    expect(trimGridCell(pixels, 4, 1, bounds, crop(99, 0))?.localBounds).toEqual({
      x: 3, y: 0, width: 1, height: 1,
    });
    expect(trimGridCell(pixels, 4, 1, bounds, crop(100, 0))).toBeNull();
  });

  it("clamps configurable padding to the cell rather than leaking into adjacent source pixels", () => {
    const pixels = rgba(5, 5);
    setPixel(pixels, 5, 2, 2, [100, 110, 120, 255]);
    const result = trimGridCell(
      pixels,
      5,
      5,
      { x: 1, y: 1, width: 3, height: 3 },
      crop(0, 16_384),
    );

    expect(result?.localBounds).toEqual({ x: 0, y: 0, width: 3, height: 3 });
    expect(result?.contentBounds).toEqual({ x: 1, y: 1, width: 3, height: 3 });
    expect(result?.pixels).toHaveLength(3 * 3 * 4);
  });

  it("returns null for transparent/threshold-empty cells and preserves a solid tile", () => {
    expect(trimGridCell(rgba(3, 2), 3, 2, { x: 0, y: 0, width: 3, height: 2 }, crop(0, 0)))
      .toBeNull();
    const solid = rgba(3, 2, [10, 20, 30, 255]);
    const result = trimGridCell(solid, 3, 2, { x: 0, y: 0, width: 3, height: 2 }, crop(99, 0));
    expect(result?.localBounds).toEqual({ x: 0, y: 0, width: 3, height: 2 });
    expect(result?.pixels).toEqual(solid);
    expect(result?.pixels).not.toBe(solid);
  });

  it("rejects zero-sized, out-of-bounds and over-budget source geometry", () => {
    const pixels = rgba(2, 2);
    const invalidBounds = [
      { x: -1, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: 0, height: 1 },
      { x: 1, y: 0, width: 2, height: 1 },
      { x: 0, y: 1, width: 1, height: 2 },
      { x: 0, y: 0, width: 1, height: 1, extra: true },
    ];
    for (const bounds of invalidBounds) {
      expect(() => trimGridCell(pixels, 2, 2, bounds, crop(0, 0))).toThrow(TypeError);
    }
    expect(() => trimGridCell(pixels, 0, 0, { x: 0, y: 0, width: 1, height: 1 }, crop(0, 0)))
      .toThrow(TypeError);
    expect(() => trimGridCell(
      new Uint8ClampedArray(4),
      16_384,
      16_384,
      { x: 0, y: 0, width: 1, height: 1 },
      crop(0, 0),
    )).toThrow(TypeError);
  });

  it("contains hostile typed arrays and crop/bounds accessors without invoking them", () => {
    const valid = rgba(2, 2, [1, 2, 3, 255]);
    for (const value of [new Uint8Array(16), new Uint8ClampedArray(15), []]) {
      expect(() => trimGridCell(
        value as Uint8ClampedArray,
        2,
        2,
        { x: 0, y: 0, width: 2, height: 2 },
        crop(0, 0),
      )).toThrow(TypeError);
    }

    const detached = valid.slice();
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(() => trimGridCell(
      detached,
      2,
      2,
      { x: 0, y: 0, width: 2, height: 2 },
      crop(0, 0),
    )).toThrow(TypeError);

    if (typeof SharedArrayBuffer !== "undefined") {
      const shared = new Uint8ClampedArray(new SharedArrayBuffer(16));
      expect(() => trimGridCell(
        shared,
        2,
        2,
        { x: 0, y: 0, width: 2, height: 2 },
        crop(0, 0),
      )).toThrow(TypeError);
    }

    let shadowCalls = 0;
    const shadowedSubarray = valid.slice();
    Object.defineProperty(shadowedSubarray, "subarray", {
      get() {
        shadowCalls += 1;
        throw new Error("must not run");
      },
    });
    expect(trimGridCell(
      shadowedSubarray,
      2,
      2,
      { x: 0, y: 0, width: 2, height: 2 },
      crop(0, 0),
    )?.pixels).toEqual(valid);
    expect(shadowCalls).toBe(0);

    let getterCalls = 0;
    const hostileBounds = { x: 0, y: 0, width: 2 };
    Object.defineProperty(hostileBounds, "height", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 2;
      },
    });
    expect(() => trimGridCell(valid, 2, 2, hostileBounds as never, crop(0, 0))).toThrow(TypeError);
    const hostileCrop = { padding: 0 };
    Object.defineProperty(hostileCrop, "threshold", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 0;
      },
    });
    expect(() => trimGridCell(
      valid,
      2,
      2,
      { x: 0, y: 0, width: 2, height: 2 },
      hostileCrop as never,
    )).toThrow(TypeError);
    expect(getterCalls).toBe(0);
  });

  it("accepts a genuine cross-realm Uint8ClampedArray", () => {
    const pixels = runInNewContext("new Uint8ClampedArray([1,2,3,0,4,5,6,255])") as Uint8ClampedArray;
    const result = trimGridCell(pixels, 2, 1, { x: 0, y: 0, width: 2, height: 1 }, crop(0, 0));
    expect(result?.localBounds).toEqual({ x: 1, y: 0, width: 1, height: 1 });
    expectPixels(result!, [4, 5, 6, 255]);
  });

  it("supports cooperative cancellation before work and during a large scan", () => {
    const tiny = rgba(1, 1, [1, 2, 3, 255]);
    expect(() => trimGridCell(
      tiny,
      1,
      1,
      { x: 0, y: 0, width: 1, height: 1 },
      crop(0, 0),
      () => true,
    )).toThrow(GridCropCancelledError);

    const pixels = rgba(8_193, 1, [1, 2, 3, 255]);
    let checks = 0;
    expect(() => trimGridCell(
      pixels,
      8_193,
      1,
      { x: 0, y: 0, width: 8_193, height: 1 },
      crop(0, 0),
      () => ++checks === 4,
    )).toThrow(GridCropCancelledError);
    expect(checks).toBe(4);
  });

  it("keeps seeded bounds deterministic, monotonic, padded and pixel-exact", () => {
    const random = xorshift32(0x47332d3031);
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const width = 3 + (random() % 29);
      const height = 3 + (random() % 29);
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let offset = 0; offset < pixels.length; offset += 1) pixels[offset] = random() & 0xff;
      const cell = { x: 1, y: 1, width: width - 2, height: height - 2 };
      const low = trimGridCell(pixels, width, height, cell, crop(0, 0));
      const high = trimGridCell(pixels, width, height, cell, crop(75, 0));
      const padded = trimGridCell(pixels, width, height, cell, crop(75, 3));
      const repeat = trimGridCell(pixels.slice(), width, height, cell, crop(75, 3));
      expect(repeat).toEqual(padded);

      if (high && low) {
        expect(high.contentBounds.x).toBeGreaterThanOrEqual(low.contentBounds.x);
        expect(high.contentBounds.y).toBeGreaterThanOrEqual(low.contentBounds.y);
        expect(high.contentBounds.x + high.contentBounds.width)
          .toBeLessThanOrEqual(low.contentBounds.x + low.contentBounds.width);
        expect(high.contentBounds.y + high.contentBounds.height)
          .toBeLessThanOrEqual(low.contentBounds.y + low.contentBounds.height);
      }
      if (high && padded) {
        expect(padded.contentBounds.x).toBeLessThanOrEqual(high.contentBounds.x);
        expect(padded.contentBounds.y).toBeLessThanOrEqual(high.contentBounds.y);
        expect(padded.contentBounds.x + padded.contentBounds.width)
          .toBeGreaterThanOrEqual(high.contentBounds.x + high.contentBounds.width);
        expect(padded.contentBounds.y + padded.contentBounds.height)
          .toBeGreaterThanOrEqual(high.contentBounds.y + high.contentBounds.height);
      }
      if (padded) {
        const { x, y, width: cropWidth, height: cropHeight } = padded.contentBounds;
        expect(x).toBeGreaterThanOrEqual(cell.x);
        expect(y).toBeGreaterThanOrEqual(cell.y);
        expect(x + cropWidth).toBeLessThanOrEqual(cell.x + cell.width);
        expect(y + cropHeight).toBeLessThanOrEqual(cell.y + cell.height);
        const expected: number[] = [];
        for (let row = y; row < y + cropHeight; row += 1) {
          for (let column = x; column < x + cropWidth; column += 1) {
            const offset = (row * width + column) * 4;
            expected.push(...pixels.slice(offset, offset + 4));
          }
        }
        expectPixels(padded, expected);
      }
    }
  });

  it("stays within the bounded representative scan/copy budget", () => {
    const width = 2_048;
    const height = 1_024;
    const pixels = rgba(width, height, [1, 2, 3, 255]);
    const startedAt = performance.now();
    const result = trimGridCell(
      pixels,
      width,
      height,
      { x: 0, y: 0, width, height },
      crop(0, 0),
    );
    const elapsedMs = performance.now() - startedAt;
    expect(result?.pixels).toHaveLength(width * height * 4);
    expect(elapsedMs).toBeLessThan(2_500);
  }, 10_000);
});
