import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import {
  IRREGULAR_REGION_DONOR_DEFAULTS,
  IRREGULAR_REGION_DETECTION_LIMITS,
  IrregularRegionDetectionCancelledError,
  IrregularRegionDetectionLimitError,
  detectIrregularRegions,
  type IrregularRegionDetectionOptions,
} from "../../core/processing/irregularRegionDetection";

function rgba(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4);
}

function alphaAt(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  alpha = 255,
): void {
  pixels[(y * width + x) * 4 + 3] = alpha;
}

const keepEveryComponent: IrregularRegionDetectionOptions = Object.freeze({
  ...IRREGULAR_REGION_DONOR_DEFAULTS,
  minPixelCount: 1,
  minWidth: 1,
  minHeight: 1,
});

describe("irregular region detection", () => {
  it("ports donor alpha/minimum semantics and emits frozen source bounds in stable row-major order", () => {
    const pixels = rgba(9, 7);
    for (const [x, y] of [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]]) {
      alphaAt(pixels, 9, x!, y!);
    }
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 5; x <= 7; x += 1) alphaAt(pixels, 9, x, y);
    }
    alphaAt(pixels, 9, 4, 5); // donor-compatible single-pixel noise
    alphaAt(pixels, 9, 8, 6, 10); // threshold is strictly greater-than

    const result = detectIrregularRegions(
      pixels,
      9,
      7,
      IRREGULAR_REGION_DONOR_DEFAULTS,
    );

    expect(result).toEqual([
      { index: 0, pixelCount: 5, bounds: { x: 0, y: 0, width: 3, height: 3 } },
      { index: 1, pixelCount: 9, bounds: { x: 5, y: 1, width: 3, height: 3 } },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(Object.isFrozen(result[0]!.bounds)).toBe(true);
  });

  it("defines empty, transparent, edge and configurable single-pixel behavior", () => {
    expect(detectIrregularRegions(
      new Uint8ClampedArray(),
      0,
      0,
      IRREGULAR_REGION_DONOR_DEFAULTS,
    )).toEqual([]);
    expect(detectIrregularRegions(rgba(4, 3), 4, 3, keepEveryComponent)).toEqual([]);

    const pixels = rgba(4, 3);
    alphaAt(pixels, 4, 3, 2);
    expect(detectIrregularRegions(pixels, 4, 3, IRREGULAR_REGION_DONOR_DEFAULTS)).toEqual([]);
    expect(detectIrregularRegions(pixels, 4, 3, keepEveryComponent)).toEqual([
      { index: 0, pixelCount: 1, bounds: { x: 3, y: 2, width: 1, height: 1 } },
    ]);
  });

  it("applies explicit 4-way or 8-way connectivity without gap merging", () => {
    const diagonal = rgba(4, 4);
    alphaAt(diagonal, 4, 0, 0);
    alphaAt(diagonal, 4, 1, 1);
    alphaAt(diagonal, 4, 2, 2);

    expect(detectIrregularRegions(diagonal, 4, 4, {
      ...keepEveryComponent,
      connectivity: 4,
    })).toHaveLength(3);
    expect(detectIrregularRegions(diagonal, 4, 4, {
      ...keepEveryComponent,
      connectivity: 8,
    })).toEqual([
      { index: 0, pixelCount: 3, bounds: { x: 0, y: 0, width: 3, height: 3 } },
    ]);

    const separated = rgba(3, 1);
    alphaAt(separated, 3, 0, 0);
    alphaAt(separated, 3, 2, 0);
    expect(detectIrregularRegions(separated, 3, 1, keepEveryComponent)).toHaveLength(2);
  });

  it("uses deterministic inclusive byte validation and strict greater-than alpha threshold", () => {
    const pixels = rgba(4, 1);
    [0, 1, 254, 255].forEach((alpha, x) => alphaAt(pixels, 4, x, 0, alpha));

    expect(detectIrregularRegions(pixels, 4, 1, {
      ...keepEveryComponent,
      alphaThreshold: 254,
    })).toEqual([
      { index: 0, pixelCount: 1, bounds: { x: 3, y: 0, width: 1, height: 1 } },
    ]);
    expect(detectIrregularRegions(pixels, 4, 1, {
      ...keepEveryComponent,
      alphaThreshold: 255,
    })).toEqual([]);
  });

  it("rejects hostile records and typed-array impostors without invoking their accessors", () => {
    const valid = rgba(1, 1);
    let optionGetterCalls = 0;
    const hostileOptions = { ...keepEveryComponent };
    Object.defineProperty(hostileOptions, "connectivity", {
      enumerable: true,
      get() {
        optionGetterCalls += 1;
        return 4;
      },
    });
    expect(() => detectIrregularRegions(valid, 1, 1, hostileOptions)).toThrow(TypeError);
    expect(optionGetterCalls).toBe(0);

    let lengthGetterCalls = 0;
    const hostilePixels = valid.slice();
    Object.defineProperty(hostilePixels, "length", {
      get() {
        lengthGetterCalls += 1;
        return 4;
      },
    });
    expect(() => detectIrregularRegions(hostilePixels, 1, 1, keepEveryComponent)).toThrow(TypeError);
    expect(lengthGetterCalls).toBe(0);
    expect(() => detectIrregularRegions(
      new Uint8Array(4) as unknown as Uint8ClampedArray,
      1,
      1,
      keepEveryComponent,
    )).toThrow(TypeError);

    const detached = valid.slice();
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(() => detectIrregularRegions(detached, 1, 1, keepEveryComponent)).toThrow(TypeError);
    if (typeof SharedArrayBuffer !== "undefined") {
      const shared = new Uint8ClampedArray(new SharedArrayBuffer(4));
      expect(() => detectIrregularRegions(shared, 1, 1, keepEveryComponent)).toThrow(TypeError);
    }

    const crossRealm = runInNewContext("new Uint8ClampedArray([0, 0, 0, 255])") as Uint8ClampedArray;
    expect(detectIrregularRegions(crossRealm, 1, 1, keepEveryComponent)).toHaveLength(1);
  });

  it("enforces dimensions, working-set and output ceilings before returning partial results", () => {
    expect(() => detectIrregularRegions(
      rgba(1, 1),
      IRREGULAR_REGION_DETECTION_LIMITS.maxDimension + 1,
      1,
      keepEveryComponent,
    )).toThrow(TypeError);
    expect(() => detectIrregularRegions(
      new Uint8ClampedArray(),
      4_097,
      4_097,
      keepEveryComponent,
    )).toThrow(IrregularRegionDetectionLimitError);
    expect(() => detectIrregularRegions(new Uint8ClampedArray(), 0, 1, keepEveryComponent)).toThrow(TypeError);

    const pixels = rgba(5, 1);
    alphaAt(pixels, 5, 0, 0);
    alphaAt(pixels, 5, 2, 0);
    alphaAt(pixels, 5, 4, 0);
    expect(() => detectIrregularRegions(pixels, 5, 1, {
      ...keepEveryComponent,
      maxRegions: 2,
    })).toThrow(IrregularRegionDetectionLimitError);
  });

  it("cooperatively cancels at an explicit scan-row boundary", () => {
    const pixels = rgba(1, 2);
    let checks = 0;
    let cancellationError: unknown;

    try {
      detectIrregularRegions(pixels, 1, 2, keepEveryComponent, () => ++checks >= 3);
    } catch (error) {
      cancellationError = error;
    }
    expect(cancellationError).toBeInstanceOf(IrregularRegionDetectionCancelledError);
    expect(cancellationError).toMatchObject({ name: "AbortError" });
    expect(checks).toBe(3);
    expect(() => detectIrregularRegions(
      pixels,
      1,
      2,
      keepEveryComponent,
      () => 1 as unknown as boolean,
    )).toThrow(TypeError);
  });

  it("cooperatively cancels at the 4096-pixel poll inside a large component", () => {
    const width = 8_193;
    const pixels = rgba(width, 1);
    for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255;
    let checks = 0;
    let cancellationError: unknown;

    try {
      detectIrregularRegions(pixels, width, 1, keepEveryComponent, () => {
        checks += 1;
        // Polls 1-3 are pre-work, row boundary and flood head=0; poll 4 is head=4096.
        return checks === 4;
      });
    } catch (error) {
      cancellationError = error;
    }
    expect(cancellationError).toBeInstanceOf(IrregularRegionDetectionCancelledError);
    expect(cancellationError).toMatchObject({ name: "AbortError" });
    expect(checks).toBe(4);
  });

  it("preserves randomized pixel accounting, determinism and the 8-way connectivity monotonicity property", () => {
    let state = 0x5eeda11;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    for (let sample = 0; sample < 80; sample += 1) {
      const width = 1 + (random() % 23);
      const height = 1 + (random() % 19);
      const pixels = rgba(width, height);
      let visibleCount = 0;
      for (let index = 0; index < width * height; index += 1) {
        const alpha = random() % 256;
        pixels[index * 4 + 3] = alpha;
        if (alpha > 127) visibleCount += 1;
      }
      const before = pixels.slice();
      const fourWay = detectIrregularRegions(pixels, width, height, {
        ...keepEveryComponent,
        alphaThreshold: 127,
        connectivity: 4,
      });
      const eightWay = detectIrregularRegions(pixels, width, height, {
        ...keepEveryComponent,
        alphaThreshold: 127,
        connectivity: 8,
      });

      expect(fourWay.reduce((sum, region) => sum + region.pixelCount, 0)).toBe(visibleCount);
      expect(eightWay.reduce((sum, region) => sum + region.pixelCount, 0)).toBe(visibleCount);
      expect(eightWay.length).toBeLessThanOrEqual(fourWay.length);
      expect(detectIrregularRegions(pixels, width, height, {
        ...keepEveryComponent,
        alphaThreshold: 127,
        connectivity: 4,
      })).toEqual(fourWay);
      expect(pixels).toEqual(before);
      for (const region of fourWay) {
        expect(region.bounds.x + region.bounds.width).toBeLessThanOrEqual(width);
        expect(region.bounds.y + region.bounds.height).toBeLessThanOrEqual(height);
      }
    }
  });

  it("keeps a representative one-megapixel flood within a practical synchronous budget", () => {
    const width = 1_024;
    const height = 1_024;
    const pixels = rgba(width, height);
    for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255;
    const startedAt = performance.now();

    const result = detectIrregularRegions(pixels, width, height, keepEveryComponent);
    const elapsedMs = performance.now() - startedAt;

    expect(result).toEqual([
      { index: 0, pixelCount: width * height, bounds: { x: 0, y: 0, width, height } },
    ]);
    expect(elapsedMs).toBeLessThan(2_500);
  });
});
