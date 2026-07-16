import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  GRID_PROCESSING_ALGORITHM_LIMITS,
  applyAdvancedChromaKey,
  detectGridSegments,
  findLocalTrimBounds,
  findSegments,
  getEnergyProfile,
  quantizeColors,
} from "../../core/processing/gridProcessingAlgorithms";
import { inferAutoGridLayout } from "../../core/processing/gridProcessingDetection";

function rgba(width: number, height: number, pixel: readonly [number, number, number, number]) {
  const output = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < output.length; offset += 4) {
    output[offset] = pixel[0];
    output[offset + 1] = pixel[1];
    output[offset + 2] = pixel[2];
    output[offset + 3] = pixel[3];
  }
  return output;
}

function setPixel(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  pixel: readonly [number, number, number, number],
): void {
  pixels.set(pixel, (y * width + x) * 4);
}

function transparentTileSheet(
  rows: number,
  cols: number,
  tileWidth: number,
  tileHeight: number,
  spacing: number,
): { readonly pixels: Uint8ClampedArray; readonly width: number; readonly height: number } {
  const width = spacing + cols * (tileWidth + spacing);
  const height = spacing + rows * (tileHeight + spacing);
  const pixels = rgba(width, height, [91, 47, 203, 0]);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < cols; column += 1) {
      const red = 24 + row * 55;
      const green = 48 + column * 35;
      for (let y = spacing + row * (tileHeight + spacing); y < spacing + row * (tileHeight + spacing) + tileHeight; y += 1) {
        for (let x = spacing + column * (tileWidth + spacing); x < spacing + column * (tileWidth + spacing) + tileWidth; x += 1) {
          setPixel(pixels, width, x, y, [red, green, 220, 255]);
        }
      }
    }
  }
  return { pixels, width, height };
}

function fixedTransparentTileSheet(
  width: number,
  height: number,
  rows: number,
  cols: number,
  gutter: number,
): { readonly pixels: Uint8ClampedArray; readonly width: number; readonly height: number } {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 1;
  const tileWidth = Math.floor((width - gutter * (cols + 1)) / cols);
  const tileHeight = Math.floor((height - gutter * (rows + 1)) / rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < cols; column += 1) {
      const startX = gutter + column * (tileWidth + gutter);
      const startY = gutter + row * (tileHeight + gutter);
      const endX = column === cols - 1 ? width - gutter : startX + tileWidth;
      const endY = row === rows - 1 ? height - gutter : startY + tileHeight;
      for (let y = startY; y < endY; y += 1) {
        let offset = (y * width + startX) * 4;
        for (let x = startX; x < endX; x += 1) {
          pixels[offset] = 24 + row * 55;
          pixels[offset + 1] = 48 + column * 35;
          pixels[offset + 2] = 220;
          pixels[offset + 3] = 255;
          offset += 4;
        }
      }
    }
  }
  return { pixels, width, height };
}

function opaqueColors(pixels: Uint8ClampedArray): Set<string> {
  const colors = new Set<string>();
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3]! >= 128) {
      colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`);
    }
  }
  return colors;
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

describe("G1-02 pure RGBA algorithms", () => {
  it("applies donor chroma math in-place without touching fully transparent pixels", () => {
    const pixels = new Uint8ClampedArray([
      0, 255, 0, 255,
      255, 0, 0, 127,
      0, 255, 0, 0,
      10, 250, 10, 200,
    ]);

    applyAdvancedChromaKey(pixels, 2, 2, "#00ff00", 10, 20, 100);

    expect(Array.from(pixels)).toEqual([
      0, 0, 0, 0,
      255, 0, 0, 127,
      0, 255, 0, 0,
      10, 10, 10, 0,
    ]);

    const feathered = new Uint8ClampedArray([0, 200, 0, 255]);
    applyAdvancedChromaKey(feathered, 1, 1, "#00ff00", 10, 20, 0);
    expect(Array.from(feathered)).toEqual([0, 200, 0, 70]);
  });

  it("finds padded local trim bounds, preserves uniform opaque cells and identifies empty alpha", () => {
    const content = rgba(5, 5, [0, 0, 0, 255]);
    setPixel(content, 5, 2, 2, [255, 255, 255, 255]);
    expect(findLocalTrimBounds(content, 5, 5, 30, 1)).toEqual({
      x: 1,
      y: 1,
      width: 3,
      height: 3,
    });
    expect(findLocalTrimBounds(rgba(3, 2, [240, 30, 20, 255]), 3, 2, 100, 9)).toEqual({
      x: 0,
      y: 0,
      width: 3,
      height: 2,
    });
    expect(findLocalTrimBounds(rgba(4, 4, [255, 255, 255, 0]), 4, 4, 0, 0)).toBeNull();

    const edgeContent = rgba(5, 5, [0, 0, 0, 255]);
    setPixel(edgeContent, 5, 4, 4, [255, 255, 255, 255]);
    expect(findLocalTrimBounds(edgeContent, 5, 5, 1, 2)).toEqual({
      x: 2,
      y: 2,
      width: 3,
      height: 3,
    });
  });

  it("uses one explicit alpha policy for fixed-palette training/application and preserves every alpha byte", () => {
    const pixels = new Uint8ClampedArray([
      200, 200, 200, 127,
      200, 200, 200, 128,
      10, 10, 10, 255,
    ]);
    const beforeAlpha = [pixels[3], pixels[7], pixels[11]];

    const result = quantizeColors(pixels, 3, 1, 2, ["#000000", "#ffffff"]);

    expect(result).toEqual({ paletteSize: 2 });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Array.from(pixels)).toEqual([
      200, 200, 200, 127,
      255, 255, 255, 128,
      0, 0, 0, 255,
    ]);
    expect([pixels[3], pixels[7], pixels[11]]).toEqual(beforeAlpha);
  });

  it("resolves exact fixed-palette distance ties by earliest palette order", () => {
    const firstOrder = new Uint8ClampedArray([0, 0, 1, 255]);
    const reverseOrder = firstOrder.slice();

    quantizeColors(firstOrder, 1, 1, 2, ["#000000", "#000002"]);
    quantizeColors(reverseOrder, 1, 1, 2, ["#000002", "#000000"]);

    expect(Array.from(firstOrder)).toEqual([0, 0, 0, 255]);
    expect(Array.from(reverseOrder)).toEqual([0, 0, 2, 255]);
  });

  it("quantizes deterministically with FNV-1a/xorshift32 while Math.random throws", () => {
    const random = xorshift32(0x46314e56);
    const source = new Uint8ClampedArray(64 * 4);
    for (let offset = 0; offset < source.length; offset += 4) {
      source[offset] = random() & 0xff;
      source[offset + 1] = random() & 0xff;
      source[offset + 2] = random() & 0xff;
      source[offset + 3] = offset % 12 === 0 ? 127 : 128 + (random() & 0x7f);
    }
    const first = source.slice();
    const second = source.slice();
    const alpha = Array.from(source.filter((_, index) => index % 4 === 3));
    const randomSpy = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random is forbidden in deterministic processing");
    });
    try {
      expect(quantizeColors(first, 8, 8, 5)).toEqual({ paletteSize: 5 });
      expect(quantizeColors(second, 8, 8, 5)).toEqual({ paletteSize: 5 });
    } finally {
      randomSpy.mockRestore();
    }

    expect(first).toEqual(second);
    expect(opaqueColors(first).size).toBeLessThanOrEqual(5);
    expect(Array.from(first.filter((_, index) => index % 4 === 3))).toEqual(alpha);
  });

  it("never initializes or converges duplicate centroids when enough unique colors exist", () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 0, 255,
      255, 0, 255, 255,
      0, 255, 255, 255,
      255, 255, 255, 255,
    ]);

    expect(quantizeColors(pixels, 8, 1, 8)).toEqual({ paletteSize: 8 });
    expect(opaqueColors(pixels).size).toBe(8);
  });

  it("freezes an exact deterministic auto-quantization golden", () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 255,
      20, 30, 40, 255,
      200, 210, 220, 255,
      220, 230, 240, 255,
      120, 30, 200, 255,
      130, 40, 210, 255,
    ]);

    expect(quantizeColors(pixels, 6, 1, 3)).toEqual({ paletteSize: 3 });
    expect(Array.from(pixels)).toEqual([
      15, 25, 35, 255,
      15, 25, 35, 255,
      210, 220, 230, 255,
      210, 220, 230, 255,
      125, 35, 205, 255,
      125, 35, 205, 255,
    ]);
  });

  it("bounds high-cardinality quantization work while preserving determinism, palette membership and alpha", () => {
    expect(GRID_PROCESSING_ALGORITHM_LIMITS.maxExactTrainingColors).toBeLessThan(256 * 256);
    const random = xorshift32(0x42554447);
    const source = new Uint8ClampedArray(256 * 256 * 4);
    for (let offset = 0; offset < source.length; offset += 4) {
      source[offset] = random() & 0xff;
      source[offset + 1] = random() & 0xff;
      source[offset + 2] = random() & 0xff;
      source[offset + 3] = offset % 68 === 0 ? 127 : 128 + (random() & 0x7f);
    }
    const first = source.slice();
    const second = source.slice();
    const alpha = Array.from(source.filter((_, index) => index % 4 === 3));

    const startedAt = performance.now();
    expect(quantizeColors(first, 256, 256, 256)).toEqual({ paletteSize: 256 });
    const elapsedMs = performance.now() - startedAt;
    expect(elapsedMs).toBeLessThan(1_500);
    expect(quantizeColors(second, 256, 256, 256)).toEqual({ paletteSize: 256 });

    expect(first).toEqual(second);
    expect(opaqueColors(first).size).toBeLessThanOrEqual(256);
    expect(Array.from(first.filter((_, index) => index % 4 === 3))).toEqual(alpha);
  });

  it("does not let ignored low-alpha RGB or eligible alpha magnitude influence the auto palette", () => {
    const first = new Uint8ClampedArray([
      255, 0, 0, 128,
      0, 255, 0, 200,
      0, 0, 255, 127,
      255, 255, 0, 0,
    ]);
    const second = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 128,
      90, 40, 10, 127,
      12, 34, 56, 0,
    ]);

    expect(quantizeColors(first, 4, 1, 2)).toEqual({ paletteSize: 2 });
    expect(quantizeColors(second, 4, 1, 2)).toEqual({ paletteSize: 2 });
    expect(Array.from(first.slice(0, 8).filter((_, index) => index % 4 !== 3))).toEqual(
      Array.from(second.slice(0, 8).filter((_, index) => index % 4 !== 3)),
    );
    expect(Array.from(first.slice(8))).toEqual([0, 0, 255, 127, 255, 255, 0, 0]);
    expect(Array.from(second.slice(8))).toEqual([90, 40, 10, 127, 12, 34, 56, 0]);
  });

  it("freezes the donor energy/segment golden with exclusive segment ends", () => {
    const pixels = rgba(10, 10, [0, 0, 0, 255]);
    for (const y of [1, 2, 3, 6, 7, 8]) {
      for (const x of [1, 2, 3, 6, 7, 8]) setPixel(pixels, 10, x, y, [255, 255, 255, 255]);
    }

    expect(Array.from(getEnergyProfile(pixels, 10, 10, "y"))).toEqual([
      0, 3060, 3060, 3060, 0, 0, 3060, 3060, 3060, 0,
    ]);
    expect(Array.from(getEnergyProfile(pixels, 10, 10, "x"))).toEqual([
      0, 3060, 3060, 3060, 0, 0, 3060, 3060, 3060, 0,
    ]);
    const segments = findSegments(new Float32Array([0, 4, 4, 0, 0, 8, 8, 8, 0]));
    expect(segments).toEqual([
      { start: 1, end: 3, size: 2 },
      { start: 5, end: 8, size: 3 },
    ]);
    expect(Object.isFrozen(segments)).toBe(true);
    expect(segments?.every(Object.isFrozen)).toBe(true);
  });

  it("does not let hidden transparent RGB create energy while retaining alpha-only art edges", () => {
    const hiddenRgb = new Uint8ClampedArray([
      255, 12, 91, 0,
      0, 255, 18, 0,
      21, 4, 255, 0,
    ]);
    expect(Array.from(getEnergyProfile(hiddenRgb, 3, 1, "y"))).toEqual([0]);

    const blackAlphaArt = new Uint8ClampedArray([
      0, 0, 0, 0,
      0, 0, 0, 255,
      0, 0, 0, 0,
    ]);
    expect(getEnergyProfile(blackAlphaArt, 3, 1, "y")[0]).toBeGreaterThan(0);
  });

  it("detects source-space row and column segments without upscaling", () => {
    const pixels = rgba(10, 10, [0, 0, 0, 255]);
    for (const y of [1, 2, 3, 6, 7, 8]) {
      for (const x of [1, 2, 3, 6, 7, 8]) setPixel(pixels, 10, x, y, [255, 255, 255, 255]);
    }
    const detected = detectGridSegments(pixels, 10, 10, 600);
    expect(detected).toEqual({
      rows: [
        { start: 1, end: 4, size: 3 },
        { start: 6, end: 9, size: 3 },
      ],
      cols: [
        { start: 1, end: 4, size: 3 },
        { start: 6, end: 9, size: 3 },
      ],
    });
    expect(Object.isFrozen(detected)).toBe(true);
    expect(Object.isFrozen(detected?.rows)).toBe(true);
    expect(Object.isFrozen(detected?.cols)).toBe(true);
    expect(detectGridSegments(rgba(4, 4, [12, 12, 12, 255]), 4, 4)).toBeNull();
  });

  it("refines fractional analysis geometry without losing split source content", () => {
    const pixels = rgba(7, 5, [0, 0, 0, 255]);
    for (const x of [1, 3, 5]) setPixel(pixels, 7, x, 2, [255, 255, 255, 255]);

    expect(detectGridSegments(pixels, 7, 5, 4)).toEqual({
      rows: [{ start: 2, end: 3, size: 1 }],
      cols: [{ start: 1, end: 7, size: 6 }],
    });
  });

  it("infers transparent, spaced 2x4 and 3x3 sheets into stable row-major source cells", () => {
    const twoByFour = transparentTileSheet(2, 4, 3, 3, 2);
    const threeByThree = transparentTileSheet(3, 3, 3, 3, 2);

    expect(inferAutoGridLayout(twoByFour.pixels, twoByFour.width, twoByFour.height)).toEqual({
      origin: "detected",
      rows: 2,
      cols: 4,
      cells: [
        { x: 2, y: 2, width: 3, height: 3 },
        { x: 7, y: 2, width: 3, height: 3 },
        { x: 12, y: 2, width: 3, height: 3 },
        { x: 17, y: 2, width: 3, height: 3 },
        { x: 2, y: 7, width: 3, height: 3 },
        { x: 7, y: 7, width: 3, height: 3 },
        { x: 12, y: 7, width: 3, height: 3 },
        { x: 17, y: 7, width: 3, height: 3 },
      ],
      warnings: [],
    });
    const inferredThreeByThree = inferAutoGridLayout(threeByThree.pixels, threeByThree.width, threeByThree.height);
    expect(inferredThreeByThree).toMatchObject({ origin: "detected", rows: 3, cols: 3 });
    expect(inferredThreeByThree.cells.slice(0, 4)).toEqual([
      { x: 2, y: 2, width: 3, height: 3 },
      { x: 7, y: 2, width: 3, height: 3 },
      { x: 12, y: 2, width: 3, height: 3 },
      { x: 2, y: 7, width: 3, height: 3 },
    ]);
  });

  it("refines downsampled 4097x2049 tile bounds on source pixels without partial crops", () => {
    const sheet = fixedTransparentTileSheet(4097, 2049, 2, 4, 1);
    const inferred = inferAutoGridLayout(sheet.pixels, sheet.width, sheet.height);

    expect([sheet.width, sheet.height]).toEqual([4097, 2049]);
    expect(inferred).toEqual({
      origin: "detected",
      rows: 2,
      cols: 4,
      cells: [
        { x: 1, y: 1, width: 1023, height: 1023 },
        { x: 1025, y: 1, width: 1023, height: 1023 },
        { x: 2049, y: 1, width: 1023, height: 1023 },
        { x: 3073, y: 1, width: 1023, height: 1023 },
        { x: 1, y: 1025, width: 1023, height: 1023 },
        { x: 1025, y: 1025, width: 1023, height: 1023 },
        { x: 2049, y: 1025, width: 1023, height: 1023 },
        { x: 3073, y: 1025, width: 1023, height: 1023 },
      ],
      warnings: [],
    });
    expect(Object.isFrozen(inferred)).toBe(true);
    expect(Object.isFrozen(inferred.cells)).toBe(true);
    expect(Object.isFrozen(inferred.warnings)).toBe(true);
    expect(inferred.cells.every(Object.isFrozen)).toBe(true);
  }, 30_000);

  it("falls back for seeded opaque noise but retains clear 1xN and Nx1 sheets", () => {
    const random = xorshift32(0x47322d3032);
    const noise = new Uint8ClampedArray(32 * 32 * 4);
    for (let offset = 0; offset < noise.length; offset += 4) {
      noise[offset] = random() & 0xff;
      noise[offset + 1] = random() & 0xff;
      noise[offset + 2] = random() & 0xff;
      noise[offset + 3] = 255;
    }
    expect(inferAutoGridLayout(noise, 32, 32)).toEqual({
      origin: "fallback",
      rows: 1,
      cols: 1,
      cells: [{ x: 0, y: 0, width: 32, height: 32 }],
      warnings: ["grid-detection-fallback"],
    });

    const oneByFour = transparentTileSheet(1, 4, 8, 8, 2);
    const fourByOne = transparentTileSheet(4, 1, 8, 8, 2);
    expect(inferAutoGridLayout(oneByFour.pixels, oneByFour.width, oneByFour.height)).toMatchObject({
      origin: "detected",
      rows: 1,
      cols: 4,
    });
    expect(inferAutoGridLayout(fourByOne.pixels, fourByOne.width, fourByOne.height)).toMatchObject({
      origin: "detected",
      rows: 4,
      cols: 1,
    });
  });

  it("keeps representative landscape and max-height portrait detection within the test budget", () => {
    const landscape = fixedTransparentTileSheet(4096, 2048, 2, 4, 16);
    const portrait = fixedTransparentTileSheet(600, 16_384, 4, 1, 1);
    const startedAt = performance.now();
    const landscapeInference = inferAutoGridLayout(landscape.pixels, landscape.width, landscape.height);
    const portraitInference = inferAutoGridLayout(portrait.pixels, portrait.width, portrait.height);
    const elapsedMs = performance.now() - startedAt;

    expect(landscapeInference).toMatchObject({
      origin: "detected",
      rows: 2,
      cols: 4,
    });
    expect(portraitInference).toMatchObject({
      origin: "detected",
      rows: 4,
      cols: 1,
    });
    expect(elapsedMs).toBeLessThan(5_000);
  }, 30_000);

  it("uses one bounded fallback policy for empty, ambiguous and excessive auto-detection", () => {
    const transparent = rgba(4, 4, [203, 77, 19, 0]);
    const random = xorshift32(0x414c5048);
    for (let offset = 0; offset < transparent.length; offset += 4) {
      transparent[offset] = random() & 0xff;
      transparent[offset + 1] = random() & 0xff;
      transparent[offset + 2] = random() & 0xff;
    }
    expect(inferAutoGridLayout(transparent, 4, 4)).toEqual({
      origin: "fallback",
      rows: 1,
      cols: 1,
      cells: [{ x: 0, y: 0, width: 4, height: 4 }],
      warnings: ["grid-detection-fallback"],
    });
    expect(Object.isFrozen(inferAutoGridLayout(transparent, 4, 4))).toBe(true);
  });

  it("keeps seeded profiles and detected segments finite, canonical and in bounds", () => {
    const random = xorshift32(0x5345474d);
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const width = 2 + (random() % 31);
      const height = 2 + (random() % 31);
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let offset = 0; offset < pixels.length; offset += 1) pixels[offset] = random() & 0xff;
      for (const axis of ["x", "y"] as const) {
        const profile = getEnergyProfile(pixels, width, height, axis);
        for (const value of profile) {
          if (!Number.isFinite(value) || value < 0 || Object.is(value, -0)) {
            throw new Error(`Non-canonical energy at iteration ${iteration}.`);
          }
        }
      }
      const detected = detectGridSegments(pixels, width, height, 16);
      if (detected) {
        for (const [segments, limit] of [[detected.rows, height], [detected.cols, width]] as const) {
          for (const segment of segments) {
            if (
              !Number.isSafeInteger(segment.start) ||
              !Number.isSafeInteger(segment.end) ||
              segment.start < 0 ||
              segment.end > limit ||
              segment.start >= segment.end ||
              segment.size !== segment.end - segment.start ||
              Object.is(segment.start, -0)
            ) {
              throw new Error(`Out-of-bounds segment at iteration ${iteration}.`);
            }
          }
        }
      }
    }
  });

  it("keeps inferred cell geometry deterministic, finite and in bounds for noisy and downsampled inputs", () => {
    const random = xorshift32(0x47323032);
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const width = 2 + (random() % 95);
      const height = 2 + (random() % 95);
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let index = 0; index < pixels.length; index += 1) pixels[index] = random() & 0xff;
      const first = inferAutoGridLayout(pixels, width, height, 16);
      const second = inferAutoGridLayout(pixels.slice(), width, height, 16);
      expect(first).toEqual(second);
      expect(first.cells).toHaveLength(first.rows * first.cols);
      for (const cell of first.cells) {
        expect(Number.isSafeInteger(cell.x) && Number.isSafeInteger(cell.y)).toBe(true);
        expect(Number.isSafeInteger(cell.width) && Number.isSafeInteger(cell.height)).toBe(true);
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.width).toBeGreaterThan(0);
        expect(cell.height).toBeGreaterThan(0);
        expect(cell.x + cell.width).toBeLessThanOrEqual(width);
        expect(cell.y + cell.height).toBeLessThanOrEqual(height);
      }
    }
  });

  it("rejects malformed arrays, dimensions, numeric controls and profiles without invoking palette accessors", () => {
    const valid = rgba(2, 2, [0, 0, 0, 255]);
    for (const pixels of [new Uint8Array(16), new Uint8ClampedArray(15), []]) {
      expect(() => getEnergyProfile(pixels as Uint8ClampedArray, 2, 2, "x")).toThrow(TypeError);
    }
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0, -1]) {
      expect(() => applyAdvancedChromaKey(valid, 2, 2, "#00ff00", value, 0, 0)).toThrow(TypeError);
      expect(() => findLocalTrimBounds(valid, 2, 2, value, 0)).toThrow(TypeError);
      expect(() => quantizeColors(valid, 2, 2, value)).toThrow(TypeError);
      expect(() => detectGridSegments(valid, 2, 2, value)).toThrow(TypeError);
    }
    expect(() => quantizeColors(valid, 2, 2, 1.5)).toThrow(TypeError);
    expect(() => quantizeColors(valid, 2, 2, 1)).toThrow(TypeError);
    expect(() => quantizeColors(valid, 2, 2, 257)).toThrow(TypeError);
    expect(() => detectGridSegments(valid, 2, 2, 1.5)).toThrow(TypeError);
    expect(() => detectGridSegments(valid, 2, 2, 16_385)).toThrow(TypeError);
    expect(() => inferAutoGridLayout(valid, 2, 2, 0)).toThrow(TypeError);
    expect(() => inferAutoGridLayout(valid, 2, 2, 16_385)).toThrow(TypeError);
    expect(() => applyAdvancedChromaKey(valid, 2, 2, "green", 0, 0, 0)).toThrow(TypeError);
    expect(() => applyAdvancedChromaKey(valid, 2, 2, "#00ff00", 0, 101, 0)).toThrow(TypeError);
    expect(() => applyAdvancedChromaKey(valid, 2, 2, "#00ff00", 0, 0, 101)).toThrow(TypeError);
    expect(() => findLocalTrimBounds(valid, 2, 2, 0, 1.5)).toThrow(TypeError);
    expect(() => getEnergyProfile(valid, Number.NaN, 2, "x")).toThrow(TypeError);
    expect(() => getEnergyProfile(valid, 2, 2, "z" as "x")).toThrow(TypeError);
    for (const profile of [
      new Float32Array([0, Number.NaN]),
      new Float32Array([0, Number.POSITIVE_INFINITY]),
      new Float32Array([0, -0]),
      new Float32Array([0, -1]),
    ]) {
      expect(() => findSegments(profile)).toThrow(TypeError);
    }
    expect(() => findSegments(new Float32Array())).toThrow(TypeError);
    expect(() => findSegments(new Uint8Array([0, 1]) as unknown as Float32Array)).toThrow(TypeError);

    const crossRealmPixels = runInNewContext("new Uint8ClampedArray(16)") as Uint8ClampedArray;
    crossRealmPixels.set(valid);
    expect(Array.from(getEnergyProfile(crossRealmPixels, 2, 2, "x"))).toEqual([0, 0]);
    const crossRealmProfile = runInNewContext(
      "new Float32Array([0, 4, 4, 0])",
    ) as Float32Array;
    expect(findSegments(crossRealmProfile)).toEqual([{ start: 1, end: 3, size: 2 }]);

    const detached = valid.slice();
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(() => getEnergyProfile(detached, 2, 2, "x")).toThrow(TypeError);
    if (typeof SharedArrayBuffer !== "undefined") {
      const shared = new Uint8ClampedArray(new SharedArrayBuffer(16));
      expect(() => getEnergyProfile(shared, 2, 2, "x")).toThrow(TypeError);
    }

    let typedArrayGetterCalls = 0;
    const lengthAccessor = valid.slice();
    Object.defineProperty(lengthAccessor, "length", {
      get() {
        typedArrayGetterCalls += 1;
        return 16;
      },
    });
    expect(() => getEnergyProfile(lengthAccessor, 2, 2, "x")).toThrow(TypeError);
    expect(typedArrayGetterCalls).toBe(0);

    let getterCalls = 0;
    const palette = ["#000000"];
    Object.defineProperty(palette, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "#000000";
      },
    });
    expect(() => quantizeColors(valid, 2, 2, 2, palette)).toThrow(TypeError);
    expect(getterCalls).toBe(0);
  });
});
