import { describe, expect, it } from "vitest";
import { trimGridCell } from "../../core/processing/gridProcessingCrop";
import { GRID_PROCESSING_LIMITS } from "../../core/processing/gridProcessingLimits";
import {
  GRID_PROCESSING_PROTOCOL_VERSION,
  assertGridProcessingRequest,
  type GridProcessingProcessRequestV1,
} from "../../core/processing/gridProcessingProtocol";

function pixels(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4);
}

function request(
  threshold: number,
  padding: number,
): GridProcessingProcessRequestV1 {
  return {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "process",
    requestId: "g3-04-hostile-gate",
    source: {
      width: 2,
      height: 2,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: new ArrayBuffer(2 * 2 * 4),
    },
    recipe: {
      kind: "grid-split",
      version: 1,
      sourceAssetId: "asset-g3-04",
      layout: { mode: "manual", rows: 1, cols: 1 },
      crop: { threshold, padding },
      chroma: {
        enabled: false,
        color: "#00ff00",
        tolerance: 0,
        smoothness: 0,
        spill: 0,
      },
      pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
    },
  };
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

describe("G3-04 hostile crop geometry gate", () => {
  it("rejects zero-sized and out-of-bounds cells before cancellation or pixel scanning", () => {
    const source = pixels(4, 3);
    const invalidBounds = [
      { x: -1, y: 0, width: 1, height: 1 },
      { x: 0, y: -1, width: 1, height: 1 },
      { x: 0, y: 0, width: 0, height: 1 },
      { x: 0, y: 0, width: 1, height: 0 },
      { x: 4, y: 0, width: 1, height: 1 },
      { x: 0, y: 3, width: 1, height: 1 },
      { x: 3, y: 0, width: 2, height: 1 },
      { x: 0, y: 2, width: 1, height: 2 },
      { x: 0.5, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: 1.5, height: 1 },
    ];
    let cancellationChecks = 0;
    for (const bounds of invalidBounds) {
      expect(() => trimGridCell(
        source,
        4,
        3,
        bounds,
        { threshold: 1, padding: 0 },
        () => {
          cancellationChecks += 1;
          return false;
        },
      )).toThrow(TypeError);
    }
    expect(cancellationChecks).toBe(0);

    for (const [width, height] of [
      [0, 3],
      [4, 0],
      [4.5, 3],
      [GRID_PROCESSING_LIMITS.maxDimension + 1, 1],
      [GRID_PROCESSING_LIMITS.maxDimension, GRID_PROCESSING_LIMITS.maxDimension],
    ] as const) {
      expect(() => trimGridCell(
        source,
        width,
        height,
        { x: 0, y: 0, width: 1, height: 1 },
        { threshold: 1, padding: 0 },
      )).toThrow(TypeError);
    }
  });

  it("clamps maximum padding to every seeded cell and never emits OOB or zero-size bounds", () => {
    const random = xorshift32(0x47332d3034);
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const sourceWidth = 2 + (random() % 63);
      const sourceHeight = 2 + (random() % 63);
      const x = random() % sourceWidth;
      const y = random() % sourceHeight;
      const width = 1 + (random() % (sourceWidth - x));
      const height = 1 + (random() % (sourceHeight - y));
      const source = pixels(sourceWidth, sourceHeight);
      const opaqueX = x + (random() % width);
      const opaqueY = y + (random() % height);
      source[(opaqueY * sourceWidth + opaqueX) * 4 + 3] = 255;

      const result = trimGridCell(
        source,
        sourceWidth,
        sourceHeight,
        { x, y, width, height },
        { threshold: 1, padding: GRID_PROCESSING_LIMITS.maxDimension },
      );

      expect(result?.localBounds).toEqual({ x: 0, y: 0, width, height });
      expect(result?.contentBounds).toEqual({ x, y, width, height });
      expect(result?.pixels).toHaveLength(width * height * 4);
      expect(result!.contentBounds.x + result!.contentBounds.width).toBeLessThanOrEqual(sourceWidth);
      expect(result!.contentBounds.y + result!.contentBounds.height).toBeLessThanOrEqual(sourceHeight);
    }
  });

  it("keeps direct and protocol crop limits exact at both sides of the boundary", () => {
    const source = pixels(2, 2);
    source[3] = 255;
    expect(() => trimGridCell(
      source,
      2,
      2,
      { x: 0, y: 0, width: 2, height: 2 },
      { threshold: 100, padding: GRID_PROCESSING_LIMITS.maxDimension },
    )).not.toThrow();
    expect(() => assertGridProcessingRequest(
      request(100, GRID_PROCESSING_LIMITS.maxDimension),
    )).not.toThrow();

    for (const threshold of [-1, -0, 100.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => trimGridCell(
        source,
        2,
        2,
        { x: 0, y: 0, width: 2, height: 2 },
        { threshold, padding: 0 },
      )).toThrow(TypeError);
      expect(() => assertGridProcessingRequest(request(threshold, 0))).toThrow(TypeError);
    }
    for (const padding of [
      -1,
      -0,
      0.5,
      GRID_PROCESSING_LIMITS.maxDimension + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(() => trimGridCell(
        source,
        2,
        2,
        { x: 0, y: 0, width: 2, height: 2 },
        { threshold: 1, padding },
      )).toThrow(TypeError);
      expect(() => assertGridProcessingRequest(request(1, padding))).toThrow(TypeError);
    }
  });
});
