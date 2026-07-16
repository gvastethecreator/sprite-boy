import { GRID_PROCESSING_LIMITS, type GridProcessingRectV1 } from "./gridProcessingProtocol";
import { getDetectionGeometry } from "./gridProcessingGeometry";

type RgbTuple = [number, number, number];

export interface GridSegment {
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
  readonly size: number;
}

export interface DetectedGridSegments {
  readonly rows: readonly GridSegment[];
  readonly cols: readonly GridSegment[];
}

export interface QuantizeColorsResult {
  readonly paletteSize: number;
}

/**
 * Hard work limits for deterministic browser-safe quantization.
 *
 * Low-cardinality inputs retain the exact donor-compatible weighted population. Once the
 * exact-color budget is exceeded, training falls back to a fixed 6-bit/channel histogram.
 * A 6-bit bin contains at most 64 exact RGB colors, so crossing the 16,384-color exact budget
 * still guarantees enough occupied bins for the protocol maximum of 256 palette colors.
 * Palette application performs only a bounded number of exact searches before using a
 * deterministic 5-bit/channel lookup table, so work no longer grows as pixels * palette size.
 */
export const GRID_PROCESSING_ALGORITHM_LIMITS = Object.freeze({
  maxExactTrainingColors: 16_384,
  maxWeightedTrainingColors: 2_048,
  maxExactApplicationColors: 16_384,
  trainingHistogramChannelBits: 6,
  applicationLookupChannelBits: 5,
  maxKMeansIterations: 12,
});

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const QUANTIZATION_ALPHA_THRESHOLD = 128;
const MAX_CENTROID_SAMPLES = 1_000;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8ClampedArray.prototype) as object;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "length",
)?.get;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)?.get;
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  Symbol.toStringTag,
)?.get;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;

interface WeightedColor {
  readonly color: RgbTuple;
  weight: number;
}

interface QuantizationTrainingData {
  readonly colors: readonly WeightedColor[];
  readonly seed: number;
}

function algorithmTypeError(label: string): TypeError {
  return new TypeError(`${label} is not valid grid processing RGBA data.`);
}

function requireInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    !Number.isFinite(value) ||
    Object.is(value, -0) ||
    value < minimum ||
    value > maximum
  ) {
    throw algorithmTypeError(label);
  }
  return value;
}

function requireNumber(value: number, minimum: number, maximum: number, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Object.is(value, -0) ||
    value < minimum ||
    value > maximum
  ) {
    throw algorithmTypeError(label);
  }
  return value;
}

function requireDimensions(width: number, height: number): { width: number; height: number } {
  const safeWidth = requireInteger(width, 1, GRID_PROCESSING_LIMITS.maxDimension, "width");
  const safeHeight = requireInteger(height, 1, GRID_PROCESSING_LIMITS.maxDimension, "height");
  if (safeWidth * safeHeight > GRID_PROCESSING_LIMITS.maxSourcePixels) {
    throw algorithmTypeError("dimensions");
  }
  return { width: safeWidth, height: safeHeight };
}

function typedArrayLength(value: unknown, expectedTag: string, label: string): number {
  try {
    if (
      !TYPED_ARRAY_LENGTH_GETTER ||
      !TYPED_ARRAY_BUFFER_GETTER ||
      !TYPED_ARRAY_TAG_GETTER ||
      !ARRAY_BUFFER_BYTE_LENGTH_GETTER ||
      typeof value !== "object" ||
      value === null
    ) {
      throw algorithmTypeError(label);
    }
    const tag = Reflect.apply(TYPED_ARRAY_TAG_GETTER, value, []) as string | undefined;
    if (tag !== expectedTag) throw algorithmTypeError(label);
    const buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBufferLike;
    const byteLength = Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, []) as number;
    const length = Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as number;
    if (
      byteLength === 0 ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      Object.getOwnPropertyDescriptor(value, "length") !== undefined ||
      Object.getOwnPropertySymbols(value).length !== 0
    ) {
      throw algorithmTypeError(label);
    }
    return length;
  } catch {
    throw algorithmTypeError(label);
  }
}

function requirePixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): { width: number; height: number } {
  const dimensions = requireDimensions(width, height);
  if (
    typedArrayLength(pixels, "Uint8ClampedArray", "pixels") !==
    dimensions.width * dimensions.height * 4
  ) {
    throw algorithmTypeError("pixels");
  }
  return dimensions;
}

function parseHexColor(value: string, label: string): RgbTuple {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) throw algorithmTypeError(label);
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function colorKey(color: RgbTuple): number {
  return colorKeyChannels(color[0], color[1], color[2]);
}

function colorKeyChannels(red: number, green: number, blue: number): number {
  return (red << 16) | (green << 8) | blue;
}

function colorDistance(left: RgbTuple, right: RgbTuple): number {
  const redMean = (left[0] + right[0]) / 2;
  const deltaRed = left[0] - right[0];
  const deltaGreen = left[1] - right[1];
  const deltaBlue = left[2] - right[2];
  return (
    (2 + redMean / 256) * deltaRed * deltaRed +
    4 * deltaGreen * deltaGreen +
    (2 + (255 - redMean) / 256) * deltaBlue * deltaBlue
  );
}

function closestColorIndex(pixel: RgbTuple, palette: readonly RgbTuple[]): number {
  let closest = 0;
  let minimumDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < palette.length; index += 1) {
    const distance = colorDistance(pixel, palette[index]!);
    if (distance < minimumDistance) {
      minimumDistance = distance;
      closest = index;
    }
  }
  return closest;
}

/** Mutates an owned packed RGBA buffer using the pinned donor chroma/feather/spill math. */
export function applyAdvancedChromaKey(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  colorHex: string,
  tolerancePercent: number,
  smoothnessPercent: number,
  spillPercent: number,
): void {
  requirePixels(pixels, width, height);
  const target = parseHexColor(colorHex, "colorHex");
  const tolerance = (requireNumber(tolerancePercent, 0, 100, "tolerancePercent") / 100) * Math.sqrt(3);
  const smoothness = (requireNumber(smoothnessPercent, 0, 100, "smoothnessPercent") / 100) * 0.5;
  const spillIntensity = requireNumber(spillPercent, 0, 100, "spillPercent") / 100;
  const targetRed = target[0] / 255;
  const targetGreen = target[1] / 255;
  const targetBlue = target[2] / 255;
  const pixelLength = width * height * 4;

  for (let offset = 0; offset < pixelLength; offset += 4) {
    let red = pixels[offset]! / 255;
    let green = pixels[offset + 1]! / 255;
    let blue = pixels[offset + 2]! / 255;
    const alpha = pixels[offset + 3]! / 255;
    if (alpha === 0) continue;

    const deltaRed = red - targetRed;
    const deltaGreen = green - targetGreen;
    const deltaBlue = blue - targetBlue;
    const distance = Math.sqrt(
      deltaRed * deltaRed + deltaGreen * deltaGreen + deltaBlue * deltaBlue,
    );
    let mask = 1;
    if (distance < tolerance) {
      mask = 0;
    } else if (smoothness > 0 && distance < tolerance + smoothness) {
      mask = Math.pow((distance - tolerance) / smoothness, 1.5);
    }

    if (spillIntensity > 0 && mask < 0.95) {
      const influence = (1 - mask) * spillIntensity;
      if (target[1] >= target[0] && target[1] >= target[2]) {
        const replacement = (red + blue) / 2;
        if (green > replacement) green = green * (1 - influence) + replacement * influence;
      } else if (target[2] >= target[0] && target[2] >= target[1]) {
        const replacement = (red + green) / 2;
        if (blue > replacement) blue = blue * (1 - influence) + replacement * influence;
      } else {
        const replacement = (green + blue) / 2;
        if (red > replacement) red = red * (1 - influence) + replacement * influence;
      }
    }

    pixels[offset] = Math.floor(red * 255);
    pixels[offset + 1] = Math.floor(green * 255);
    pixels[offset + 2] = Math.floor(blue * 255);
    pixels[offset + 3] = Math.floor(alpha * mask * 255);
  }
}

/** Returns source-local retained bounds. Null is reserved for a fully transparent cell. */
export function findLocalTrimBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  thresholdPercent: number,
  padding: number,
): GridProcessingRectV1 | null {
  const dimensions = requirePixels(pixels, width, height);
  const threshold = (requireNumber(thresholdPercent, 0, 100, "thresholdPercent") / 100) * 765;
  const safePadding = requireInteger(padding, 0, GRID_PROCESSING_LIMITS.maxDimension, "padding");
  const backgroundRed = pixels[0]!;
  const backgroundGreen = pixels[1]!;
  const backgroundBlue = pixels[2]!;
  let top = dimensions.height;
  let bottom = -1;
  let left = dimensions.width;
  let right = -1;
  let hasVisiblePixel = false;

  for (let y = 0; y < dimensions.height; y += 1) {
    for (let x = 0; x < dimensions.width; x += 1) {
      const offset = (y * dimensions.width + x) * 4;
      if (pixels[offset + 3]! <= 20) continue;
      hasVisiblePixel = true;
      const difference =
        Math.abs(pixels[offset]! - backgroundRed) +
        Math.abs(pixels[offset + 1]! - backgroundGreen) +
        Math.abs(pixels[offset + 2]! - backgroundBlue);
      if (difference <= threshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (!hasVisiblePixel) return null;
  if (right < left || bottom < top) {
    return Object.freeze({ x: 0, y: 0, width: dimensions.width, height: dimensions.height });
  }
  const paddedLeft = Math.max(0, left - safePadding);
  const paddedTop = Math.max(0, top - safePadding);
  const paddedRight = Math.min(dimensions.width - 1, right + safePadding);
  const paddedBottom = Math.min(dimensions.height - 1, bottom + safePadding);
  return Object.freeze({
    x: paddedLeft,
    y: paddedTop,
    width: paddedRight - paddedLeft + 1,
    height: paddedBottom - paddedTop + 1,
  });
}

function readFixedPalette(value: readonly string[] | undefined): RgbTuple[] | null {
  if (value === undefined) return null;
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      throw algorithmTypeError("fixedPaletteHex");
    }
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !length ||
      !("value" in length) ||
      !Number.isSafeInteger(length.value) ||
      length.value < 1 ||
      length.value > GRID_PROCESSING_LIMITS.maxPaletteColors ||
      Reflect.ownKeys(value).length !== length.value + 1
    ) {
      throw algorithmTypeError("fixedPaletteHex");
    }
    const output: RgbTuple[] = [];
    const seen = new Set<number>();
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw algorithmTypeError("fixedPaletteHex");
      }
      const color = parseHexColor(descriptor.value as string, "fixedPaletteHex");
      const key = colorKey(color);
      if (!seen.has(key)) {
        seen.add(key);
        output.push(color);
      }
    }
    return output;
  } catch {
    throw algorithmTypeError("fixedPaletteHex");
  }
}

function appendFnv1aByte(hash: number, value: number): number {
  return Math.imul(hash ^ value, 0x01000193);
}

function finishFnv1aSeed(hash: number, width: number, height: number, colorCount: number): number {
  let output = hash;
  for (const value of [width, height, colorCount]) {
    for (let shift = 0; shift < 32; shift += 8) {
      output = appendFnv1aByte(output, (value >>> shift) & 0xff);
    }
  }
  return (output >>> 0) || 0x9e3779b9;
}

function trainingHistogramIndex(red: number, green: number, blue: number): number {
  const bits = GRID_PROCESSING_ALGORITHM_LIMITS.trainingHistogramChannelBits;
  const shift = 8 - bits;
  return ((red >>> shift) << (bits * 2)) | ((green >>> shift) << bits) | (blue >>> shift);
}

function buildQuantizationTrainingData(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  colorCount: number,
): QuantizationTrainingData | null {
  const bits = GRID_PROCESSING_ALGORITHM_LIMITS.trainingHistogramChannelBits;
  const binCount = 1 << (bits * 3);
  const counts = new Uint32Array(binCount);
  const redSums = new Float64Array(binCount);
  const greenSums = new Float64Array(binCount);
  const blueSums = new Float64Array(binCount);
  let exactColors: Map<number, WeightedColor> | null = new Map();
  let hash = 0x811c9dc5;
  let eligibleCount = 0;
  const pixelLength = width * height * 4;

  for (let offset = 0; offset < pixelLength; offset += 4) {
    if (pixels[offset + 3]! < QUANTIZATION_ALPHA_THRESHOLD) continue;
    const red = pixels[offset]!;
    const green = pixels[offset + 1]!;
    const blue = pixels[offset + 2]!;
    eligibleCount += 1;
    hash = appendFnv1aByte(hash, red);
    hash = appendFnv1aByte(hash, green);
    hash = appendFnv1aByte(hash, blue);

    const bin = trainingHistogramIndex(red, green, blue);
    counts[bin] = counts[bin]! + 1;
    redSums[bin] += red;
    greenSums[bin] += green;
    blueSums[bin] += blue;

    if (exactColors) {
      const key = colorKeyChannels(red, green, blue);
      const existing = exactColors.get(key);
      if (existing) {
        existing.weight += 1;
      } else if (exactColors.size < GRID_PROCESSING_ALGORITHM_LIMITS.maxExactTrainingColors) {
        exactColors.set(key, { color: [red, green, blue], weight: 1 });
      } else {
        exactColors = null;
      }
    }
  }

  if (eligibleCount === 0) return null;
  const seed = finishFnv1aSeed(hash, width, height, colorCount);
  if (exactColors) return { colors: [...exactColors.values()], seed };

  const occupiedBins: number[] = [];
  for (let index = 0; index < counts.length; index += 1) {
    if (counts[index]! > 0) occupiedBins.push(index);
  }
  occupiedBins.sort((left, right) => counts[right]! - counts[left]! || left - right);
  const selectedBins = occupiedBins
    .slice(0, GRID_PROCESSING_ALGORITHM_LIMITS.maxWeightedTrainingColors)
    .sort((left, right) => left - right);
  const colors = selectedBins.map((index): WeightedColor => {
    const weight = counts[index]!;
    return {
      color: [
        Math.round(redSums[index]! / weight),
        Math.round(greenSums[index]! / weight),
        Math.round(blueSums[index]! / weight),
      ],
      weight,
    };
  });
  return { colors, seed };
}

function createXorshift32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function pickFarthestUnrepresented(
  uniquePixels: readonly RgbTuple[],
  palette: readonly RgbTuple[],
  usedKeys: ReadonlySet<number>,
): RgbTuple {
  let best: RgbTuple | null = null;
  let greatestDistance = -1;
  for (const candidate of uniquePixels) {
    if (usedKeys.has(colorKey(candidate))) continue;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const centroid of palette) {
      nearestDistance = Math.min(nearestDistance, colorDistance(candidate, centroid));
    }
    if (nearestDistance > greatestDistance) {
      greatestDistance = nearestDistance;
      best = candidate;
    }
  }
  if (!best) throw algorithmTypeError("centroids");
  return [...best];
}

function initializeCentroids(
  uniquePixels: readonly RgbTuple[],
  targetCount: number,
  nextRandom: () => number,
): RgbTuple[] {
  const first = uniquePixels[nextRandom() % uniquePixels.length]!;
  const centroids: RgbTuple[] = [[...first]];
  const selectedKeys = new Set<number>([colorKey(first)]);
  while (centroids.length < targetCount) {
    let best: RgbTuple | null = null;
    let greatestDistance = -1;
    const sampleCount = Math.min(uniquePixels.length, MAX_CENTROID_SAMPLES);
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const candidate = uniquePixels[nextRandom() % uniquePixels.length]!;
      if (selectedKeys.has(colorKey(candidate))) continue;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const centroid of centroids) {
        nearestDistance = Math.min(nearestDistance, colorDistance(candidate, centroid));
      }
      if (nearestDistance > greatestDistance) {
        greatestDistance = nearestDistance;
        best = candidate;
      }
    }
    const selected = best ?? pickFarthestUnrepresented(uniquePixels, centroids, selectedKeys);
    selectedKeys.add(colorKey(selected));
    centroids.push([...selected]);
  }
  return centroids;
}

function trainCentroids(
  trainingColors: readonly WeightedColor[],
  uniquePixels: readonly RgbTuple[],
  initial: RgbTuple[],
): RgbTuple[] {
  let centroids = initial;
  for (
    let iteration = 0;
    iteration < GRID_PROCESSING_ALGORITHM_LIMITS.maxKMeansIterations;
    iteration += 1
  ) {
    const sums = Array.from({ length: centroids.length }, () => [0, 0, 0] as RgbTuple);
    const counts = new Float64Array(centroids.length);
    for (const trainingColor of trainingColors) {
      const pixel = trainingColor.color;
      const weight = trainingColor.weight;
      const closest = closestColorIndex(pixel, centroids);
      const sum = sums[closest]!;
      sum[0] += pixel[0] * weight;
      sum[1] += pixel[1] * weight;
      sum[2] += pixel[2] * weight;
      counts[closest] = counts[closest]! + weight;
    }

    const next: RgbTuple[] = [];
    const usedKeys = new Set<number>();
    let changed = false;
    for (let index = 0; index < centroids.length; index += 1) {
      const count = counts[index]!;
      const sum = sums[index]!;
      let candidate: RgbTuple = count === 0
        ? centroids[index]!
        : [Math.round(sum[0] / count), Math.round(sum[1] / count), Math.round(sum[2] / count)];
      if (usedKeys.has(colorKey(candidate))) {
        candidate = pickFarthestUnrepresented(uniquePixels, next, usedKeys);
      }
      usedKeys.add(colorKey(candidate));
      next.push(candidate);
      const previous = centroids[index]!;
      if (
        candidate[0] !== previous[0] ||
        candidate[1] !== previous[1] ||
        candidate[2] !== previous[2]
      ) {
        changed = true;
      }
    }
    centroids = next;
    if (!changed) break;
  }
  return centroids;
}

function applicationLookupIndex(red: number, green: number, blue: number): number {
  const bits = GRID_PROCESSING_ALGORITHM_LIMITS.applicationLookupChannelBits;
  const shift = 8 - bits;
  return (
    ((red >>> shift) << (bits * 2)) |
    ((green >>> shift) << bits) |
    (blue >>> shift)
  );
}

function buildPaletteLookup(palette: readonly RgbTuple[]): Uint8Array {
  const bits = GRID_PROCESSING_ALGORITHM_LIMITS.applicationLookupChannelBits;
  const shift = 8 - bits;
  const mask = (1 << bits) - 1;
  const midpoint = 1 << (shift - 1);
  const lookup = new Uint8Array(1 << (bits * 3));
  for (let index = 0; index < lookup.length; index += 1) {
    const blueBucket = index & mask;
    const greenBucket = (index >>> bits) & mask;
    const redBucket = (index >>> (bits * 2)) & mask;
    lookup[index] = closestColorIndex([
      (redBucket << shift) + midpoint,
      (greenBucket << shift) + midpoint,
      (blueBucket << shift) + midpoint,
    ], palette);
  }
  return lookup;
}

function applyPaletteBounded(
  pixels: Uint8ClampedArray,
  pixelLength: number,
  palette: readonly RgbTuple[],
): void {
  const exactCache = new Map<number, number>();
  let lookup: Uint8Array | null = null;
  for (let offset = 0; offset < pixelLength; offset += 4) {
    if (pixels[offset + 3]! < QUANTIZATION_ALPHA_THRESHOLD) continue;
    const red = pixels[offset]!;
    const green = pixels[offset + 1]!;
    const blue = pixels[offset + 2]!;
    const key = colorKeyChannels(red, green, blue);
    let paletteIndex = exactCache.get(key);
    if (paletteIndex === undefined) {
      if (exactCache.size < GRID_PROCESSING_ALGORITHM_LIMITS.maxExactApplicationColors) {
        paletteIndex = closestColorIndex([red, green, blue], palette);
        exactCache.set(key, paletteIndex);
      } else {
        lookup ??= buildPaletteLookup(palette);
        paletteIndex = lookup[applicationLookupIndex(red, green, blue)]!;
      }
    }
    const color = palette[paletteIndex]!;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
  }
}

/**
 * Mutates an owned RGBA buffer. Alpha compatibility policy is deliberately symmetric:
 * pixels with alpha >= 128 train and receive quantization; lower-alpha RGB and every alpha byte stay intact.
 */
export function quantizeColors(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  colorCount: number,
  fixedPaletteHex?: readonly string[],
): QuantizeColorsResult {
  requirePixels(pixels, width, height);
  const safeColorCount = requireInteger(
    colorCount,
    2,
    GRID_PROCESSING_LIMITS.maxPaletteColors,
    "colorCount",
  );
  let palette = readFixedPalette(fixedPaletteHex);
  const pixelLength = width * height * 4;
  if (palette === null) {
    const training = buildQuantizationTrainingData(pixels, width, height, safeColorCount);
    if (!training) return Object.freeze({ paletteSize: 0 });
    const uniquePixels = training.colors.map((entry) => entry.color);
    const targetCount = Math.min(safeColorCount, uniquePixels.length);
    const random = createXorshift32(training.seed);
    palette = trainCentroids(
      training.colors,
      uniquePixels,
      initializeCentroids(uniquePixels, targetCount, random),
    );
  }

  applyPaletteBounded(pixels, pixelLength, palette);
  return Object.freeze({ paletteSize: palette.length });
}

/**
 * Alpha-aware premultiplied change profile. Axis y yields rows; axis x yields columns.
 * Hidden RGB must not invent a grid inside a transparent gutter, while alpha-only edges
 * (for example black art over transparency) remain detectable.
 */
export function getEnergyProfile(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  axis: "x" | "y",
): Float32Array {
  const dimensions = requirePixels(pixels, width, height);
  if (axis !== "x" && axis !== "y") throw algorithmTypeError("axis");
  const profile = new Float32Array(axis === "x" ? dimensions.width : dimensions.height);
  if (axis === "y") {
    for (let y = 0; y < dimensions.height; y += 1) {
      let sum = 0;
      for (let x = 1; x < dimensions.width; x += 1) {
        const current = (y * dimensions.width + x) * 4;
        const previous = current - 4;
        const currentAlpha = pixels[current + 3]!;
        const previousAlpha = pixels[previous + 3]!;
        sum +=
          Math.abs(pixels[current]! * currentAlpha - pixels[previous]! * previousAlpha) / 255 +
          Math.abs(pixels[current + 1]! * currentAlpha - pixels[previous + 1]! * previousAlpha) / 255 +
          Math.abs(pixels[current + 2]! * currentAlpha - pixels[previous + 2]! * previousAlpha) / 255 +
          Math.abs(currentAlpha - previousAlpha) * 3;
      }
      profile[y] = sum;
    }
  } else {
    for (let x = 0; x < dimensions.width; x += 1) {
      let sum = 0;
      for (let y = 1; y < dimensions.height; y += 1) {
        const current = (y * dimensions.width + x) * 4;
        const previous = ((y - 1) * dimensions.width + x) * 4;
        const currentAlpha = pixels[current + 3]!;
        const previousAlpha = pixels[previous + 3]!;
        sum +=
          Math.abs(pixels[current]! * currentAlpha - pixels[previous]! * previousAlpha) / 255 +
          Math.abs(pixels[current + 1]! * currentAlpha - pixels[previous + 1]! * previousAlpha) / 255 +
          Math.abs(pixels[current + 2]! * currentAlpha - pixels[previous + 2]! * previousAlpha) / 255 +
          Math.abs(currentAlpha - previousAlpha) * 3;
      }
      profile[x] = sum;
    }
  }
  return profile;
}

function requireProfile(profile: Float32Array): number {
  const length = typedArrayLength(profile, "Float32Array", "profile");
  if (length < 1 || length > GRID_PROCESSING_LIMITS.maxDimension) {
    throw algorithmTypeError("profile");
  }
  for (let index = 0; index < length; index += 1) {
    const value = profile[index]!;
    if (!Number.isFinite(value) || value < 0 || Object.is(value, -0)) {
      throw algorithmTypeError("profile");
    }
  }
  return length;
}

/** Finds donor energy runs above 5% of peak; end is exclusive and tiny runs are discarded. */
export function findSegments(profile: Float32Array): readonly GridSegment[] | null {
  const length = requireProfile(profile);
  let maximum = 0;
  for (let index = 0; index < length; index += 1) {
    maximum = Math.max(maximum, profile[index]!);
  }
  const threshold = maximum * 0.05;
  const segments: GridSegment[] = [];
  let start = 0;
  let inSegment = false;
  for (let index = 0; index < length; index += 1) {
    if (profile[index]! > threshold) {
      if (!inSegment) {
        start = index;
        inSegment = true;
      }
    } else if (inSegment) {
      segments.push({ start, end: index, size: index - start });
      inSegment = false;
    }
  }
  if (inSegment) segments.push({ start, end: length, size: length - start });
  const minimumSize = length * 0.05;
  const retained = segments
    .filter((segment) => segment.size > minimumSize)
    .map((segment) => Object.freeze(segment));
  return retained.length === 0 ? null : Object.freeze(retained);
}

function downsampleNearest(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  if (width === sourceWidth && height === sourceHeight) return source;
  const output = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / width));
      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
      const outputOffset = (y * width + x) * 4;
      output[outputOffset] = source[sourceOffset]!;
      output[outputOffset + 1] = source[sourceOffset + 1]!;
      output[outputOffset + 2] = source[sourceOffset + 2]!;
      output[outputOffset + 3] = source[sourceOffset + 3]!;
    }
  }
  return output;
}

function mapSegmentsToSource(
  segments: readonly GridSegment[],
  analysisLength: number,
  sourceLength: number,
): readonly GridSegment[] {
  return Object.freeze(segments.map((segment) => {
    const start = Math.min(
      sourceLength - 1,
      Math.floor((segment.start * sourceLength) / analysisLength),
    );
    const end = Math.min(
      sourceLength,
      Math.max(start + 1, Math.ceil((segment.end * sourceLength) / analysisLength)),
    );
    return Object.freeze({ start, end, size: end - start });
  }));
}

function refineSegmentsOnSource(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  coarseRows: readonly GridSegment[],
  coarseCols: readonly GridSegment[],
): DetectedGridSegments | null {
  const rows = findSegments(getEnergyProfile(pixels, width, height, "y"));
  const cols = findSegments(getEnergyProfile(pixels, width, height, "x"));
  if (!rows || !cols) return null;

  const refineAxis = (
    refined: readonly GridSegment[],
    coarse: readonly GridSegment[],
  ): readonly GridSegment[] | null => {
    if (refined.length === coarse.length) {
      const corresponds = refined.every((segment, index) => {
        const candidate = coarse[index]!;
        return segment.start < candidate.end && candidate.start < segment.end;
      });
      return corresponds ? refined : null;
    }

    const owners = refined.map((segment) => coarse
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => segment.start < candidate.end && candidate.start < segment.end));
    if (owners.some((matches) => matches.length !== 1)) return null;
    const grouped = coarse.map((_, index) => refined.filter((__, segmentIndex) => owners[segmentIndex]![0]!.index === index));
    if (grouped.some((segments) => segments.length === 0)) return null;
    return Object.freeze(grouped.map((segments, index) => {
      const start = segments[0]!.start;
      const end = segments[segments.length - 1]!.end;
      const candidate = coarse[index]!;
      if (candidate.start <= start && candidate.end >= end) return candidate;
      const expandedStart = Math.min(candidate.start, start);
      const expandedEnd = Math.max(candidate.end, end);
      return Object.freeze({ start: expandedStart, end: expandedEnd, size: expandedEnd - expandedStart });
    }));
  };

  const refinedRows = refineAxis(rows, coarseRows);
  const refinedCols = refineAxis(cols, coarseCols);
  return refinedRows && refinedCols ? Object.freeze({ rows: refinedRows, cols: refinedCols }) : null;
}

/** Detects source-space grid runs through a bounded, never-upscaled pure RGBA analysis surface. */
export function detectGridSegments(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  maxWidth = 600,
): DetectedGridSegments | null {
  const dimensions = requirePixels(pixels, width, height);
  const geometry = getDetectionGeometry(dimensions.width, dimensions.height, maxWidth);
  const analysis = downsampleNearest(
    pixels,
    dimensions.width,
    dimensions.height,
    geometry.width,
    geometry.height,
  );
  const rows = findSegments(getEnergyProfile(analysis, geometry.width, geometry.height, "y"));
  const cols = findSegments(getEnergyProfile(analysis, geometry.width, geometry.height, "x"));
  if (!rows || !cols) return null;
  const coarse = Object.freeze({
    rows: mapSegmentsToSource(rows, geometry.height, dimensions.height),
    cols: mapSegmentsToSource(cols, geometry.width, dimensions.width),
  });
  if (geometry.width === dimensions.width && geometry.height === dimensions.height) return coarse;

  // Coarse detection keeps allocation/work tied to maxWidth. Only a credible coarse grid earns
  // one source-pixel refinement pass; disagreement becomes fallback rather than a partial crop.
  return refineSegmentsOnSource(
    pixels,
    dimensions.width,
    dimensions.height,
    coarse.rows,
    coarse.cols,
  );
}
