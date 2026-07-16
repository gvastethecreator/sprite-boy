import {
  IRREGULAR_REGION_DETECTION_LIMITS,
  IrregularRegionDetectionCancelledError,
  type IrregularRegionBounds,
  type IrregularRegionCancellationCheck,
  type IrregularRegionConnectivity,
  type IrregularRegionDetectionOptions,
} from "../../../core/processing/irregularRegionDetection";
import { isEntityId } from "../../../core/project/primitives";
import type { EntityId } from "../../../core/project/schema";

export type WandSelectionMode = "replace" | "add" | "subtract";

export interface WandSeedPoint {
  readonly x: number;
  readonly y: number;
}

/** Row-major run relative to the owning mask bounds. */
export interface WandMaskRun {
  readonly offset: number;
  readonly length: number;
}

export interface WandPixelMask {
  readonly bounds: IrregularRegionBounds;
  readonly pixelCount: number;
  readonly runs: readonly WandMaskRun[];
}

export interface WandSelectedComponent {
  /** Stable for the same source identity and exact connected pixel membership. */
  readonly id: string;
  readonly sourceAssetId: EntityId;
  readonly firstPixelOffset: number;
  readonly pixelCount: number;
  readonly bounds: IrregularRegionBounds;
  readonly mask: WandPixelMask;
}

export interface WandSelectionSnapshot {
  readonly version: 1;
  readonly sourceAssetId: EntityId | null;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly components: readonly WandSelectedComponent[];
  readonly bounds: IrregularRegionBounds | null;
  readonly mask: WandPixelMask | null;
}

export type WandRegionMutation =
  | { readonly type: "add"; readonly component: WandSelectedComponent }
  | { readonly type: "remove"; readonly component: WandSelectedComponent };

/**
 * Feature-local handoff. S1-04 can adapt this to canonical project commands without
 * mirroring project state here. Every batch is intended to become one history entry.
 */
export interface WandRegionIntentBatch {
  readonly type: "wand-region.intent-batch";
  readonly sourceAssetId: EntityId;
  readonly history: "single-undo";
  readonly operations: readonly WandRegionMutation[];
}

export type WandSelectionTransitionStatus =
  | "selected"
  | "cleared"
  | "no-hit"
  | "unchanged"
  | "cancelled";

export interface WandSelectionTransition {
  readonly selection: WandSelectionSnapshot;
  readonly hit: WandSelectedComponent | null;
  readonly intent: WandRegionIntentBatch | null;
  readonly changed: boolean;
  readonly status: WandSelectionTransitionStatus;
}

const EMPTY_COMPONENTS: readonly WandSelectedComponent[] = Object.freeze([]);
const EMPTY_SELECTION: WandSelectionSnapshot = Object.freeze({
  version: 1,
  sourceAssetId: null,
  sourceWidth: 0,
  sourceHeight: 0,
  components: EMPTY_COMPONENTS,
  bounds: null,
  mask: null,
});
const FLOOD_CANCEL_MASK = 0xfff;
const INPUT_KEYS = Object.freeze([
  "sourceAssetId",
  "pixels",
  "width",
  "height",
  "seed",
  "mode",
  "options",
] as const);
const OPTION_KEYS = Object.freeze([
  "alphaThreshold",
  "connectivity",
  "minPixelCount",
  "minWidth",
  "minHeight",
  "maxRegions",
] as const);
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8ClampedArray.prototype) as object;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "length")?.get;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, Symbol.toStringTag)?.get;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;
const MAX_WAND_SOURCE_ID_CODE_UNITS = 4_096;

function invalid(label: string): TypeError {
  return new TypeError(`${label} is not valid wand selection input.`);
}

function isArray(value: unknown, label: string): boolean {
  try {
    return Array.isArray(value);
  } catch {
    throw invalid(label);
  }
}

function ownData(record: object, key: PropertyKey, label: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch {
    throw invalid(label);
  }
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw invalid(label);
  return descriptor.value;
}

function ownKeysExactly(record: object, keys: readonly string[], label: string): void {
  let ownKeys: readonly PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(record);
  } catch {
    throw invalid(label);
  }
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) throw invalid(label);
}

function readDenseDataArrayLength(value: unknown, label: string): number {
  if (!isArray(value, label)) throw invalid(label);
  let keys: readonly PropertyKey[];
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    keys = Reflect.ownKeys(value as object);
    lengthDescriptor = Object.getOwnPropertyDescriptor(value as object, "length");
  } catch {
    throw invalid(label);
  }
  if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value)) throw invalid(label);
  const length = lengthDescriptor.value as number;
  if (
    keys.length !== length + 1
    || !keys.includes("length")
    || keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= length))
  ) throw invalid(label);
  return length;
}

function requireInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || Object.is(value, -0)
    || value < minimum
    || value > maximum
  ) throw invalid(label);
  return value;
}

function readPixels(value: unknown): { readonly pixels: Uint8ClampedArray; readonly length: number } {
  try {
    if (
      !TYPED_ARRAY_LENGTH_GETTER
      || !TYPED_ARRAY_BUFFER_GETTER
      || !TYPED_ARRAY_TAG_GETTER
      || !ARRAY_BUFFER_BYTE_LENGTH_GETTER
      || typeof value !== "object"
      || value === null
      || Reflect.apply(TYPED_ARRAY_TAG_GETTER, value, []) !== "Uint8ClampedArray"
      || Object.getOwnPropertyDescriptor(value, "length") !== undefined
      || Object.getOwnPropertySymbols(value).length !== 0
    ) throw invalid("pixels");
    const buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBufferLike;
    Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, []);
    return Object.freeze({
      pixels: value as Uint8ClampedArray,
      length: Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as number,
    });
  } catch {
    throw invalid("pixels");
  }
}

function readOptions(value: unknown): IrregularRegionDetectionOptions {
  if (typeof value !== "object" || value === null || isArray(value, "options")) throw invalid("options");
  ownKeysExactly(value, OPTION_KEYS, "options");
  const connectivity = ownData(value, "connectivity", "options.connectivity");
  if (connectivity !== 4 && connectivity !== 8) throw invalid("options.connectivity");
  return Object.freeze({
    alphaThreshold: requireInteger(ownData(value, "alphaThreshold", "options.alphaThreshold"), 0, 255, "options.alphaThreshold"),
    connectivity,
    minPixelCount: requireInteger(
      ownData(value, "minPixelCount", "options.minPixelCount"),
      1,
      IRREGULAR_REGION_DETECTION_LIMITS.maxSourcePixels,
      "options.minPixelCount",
    ),
    minWidth: requireInteger(
      ownData(value, "minWidth", "options.minWidth"),
      1,
      IRREGULAR_REGION_DETECTION_LIMITS.maxDimension,
      "options.minWidth",
    ),
    minHeight: requireInteger(
      ownData(value, "minHeight", "options.minHeight"),
      1,
      IRREGULAR_REGION_DETECTION_LIMITS.maxDimension,
      "options.minHeight",
    ),
    // Kept in the recipe contract for S1-01 parity. A seed-local lookup never
    // enumerates unrelated components, so this ceiling does not affect a hit.
    maxRegions: requireInteger(
      ownData(value, "maxRegions", "options.maxRegions"),
      1,
      IRREGULAR_REGION_DETECTION_LIMITS.maxRegions,
      "options.maxRegions",
    ),
  });
}

function readDimensions(width: unknown, height: unknown): { readonly width: number; readonly height: number; readonly pixels: number } {
  const safeWidth = requireInteger(width, 0, IRREGULAR_REGION_DETECTION_LIMITS.maxDimension, "width");
  const safeHeight = requireInteger(height, 0, IRREGULAR_REGION_DETECTION_LIMITS.maxDimension, "height");
  if ((safeWidth === 0) !== (safeHeight === 0)) throw invalid("dimensions");
  const pixels = safeWidth * safeHeight;
  if (pixels > IRREGULAR_REGION_DETECTION_LIMITS.maxSourcePixels) {
    throw new RangeError("Wand selection source exceeds the S1-01 pixel limit.");
  }
  return Object.freeze({ width: safeWidth, height: safeHeight, pixels });
}

function readSeed(seed: unknown): WandSeedPoint {
  if (typeof seed !== "object" || seed === null || isArray(seed, "seed")) throw invalid("seed");
  ownKeysExactly(seed, ["x", "y"], "seed");
  const x = ownData(seed, "x", "seed.x");
  const y = ownData(seed, "y", "seed.y");
  if (
    typeof x !== "number" || !Number.isSafeInteger(x) || Object.is(x, -0)
    || typeof y !== "number" || !Number.isSafeInteger(y) || Object.is(y, -0)
  ) throw invalid("seed");
  return Object.freeze({ x, y });
}

interface NormalizedWandInput {
  readonly sourceAssetId: EntityId;
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly seed: WandSeedPoint;
  readonly mode: WandSelectionMode;
  readonly options: IrregularRegionDetectionOptions;
  readonly isCancelled?: IrregularRegionCancellationCheck;
}

function readInput(value: unknown): NormalizedWandInput {
  if (typeof value !== "object" || value === null || isArray(value, "input")) throw invalid("input");
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw invalid("input");
  }
  if (
    keys.some((key) => typeof key !== "string" || (!INPUT_KEYS.includes(key as typeof INPUT_KEYS[number]) && key !== "isCancelled"))
    || keys.length < INPUT_KEYS.length
    || keys.length > INPUT_KEYS.length + 1
  ) throw invalid("input");
  for (const key of INPUT_KEYS) {
    if (!keys.includes(key)) throw invalid(`input.${key}`);
  }
  const sourceAssetId = ownData(value, "sourceAssetId", "input.sourceAssetId");
  if (
    !isEntityId(sourceAssetId)
    || sourceAssetId.length > MAX_WAND_SOURCE_ID_CODE_UNITS
  ) throw invalid("sourceAssetId");
  const dimensions = readDimensions(
    ownData(value, "width", "input.width"),
    ownData(value, "height", "input.height"),
  );
  const pixels = readPixels(ownData(value, "pixels", "input.pixels"));
  if (pixels.length !== dimensions.pixels * 4) throw invalid("pixels");
  const mode = ownData(value, "mode", "input.mode");
  if (mode !== "replace" && mode !== "add" && mode !== "subtract") throw invalid("mode");
  const isCancelled = keys.includes("isCancelled")
    ? ownData(value, "isCancelled", "input.isCancelled")
    : undefined;
  if (isCancelled !== undefined && typeof isCancelled !== "function") throw invalid("isCancelled");
  return Object.freeze({
    sourceAssetId,
    pixels: pixels.pixels,
    width: dimensions.width,
    height: dimensions.height,
    seed: readSeed(ownData(value, "seed", "input.seed")),
    mode,
    options: readOptions(ownData(value, "options", "input.options")),
    ...(isCancelled ? { isCancelled: isCancelled as IrregularRegionCancellationCheck } : {}),
  });
}

function readBounds(value: unknown, label: string): IrregularRegionBounds {
  if (typeof value !== "object" || value === null || isArray(value, label)) throw invalid(label);
  ownKeysExactly(value, ["x", "y", "width", "height"], label);
  return Object.freeze({
    x: requireInteger(ownData(value, "x", `${label}.x`), 0, IRREGULAR_REGION_DETECTION_LIMITS.maxDimension, `${label}.x`),
    y: requireInteger(ownData(value, "y", `${label}.y`), 0, IRREGULAR_REGION_DETECTION_LIMITS.maxDimension, `${label}.y`),
    width: requireInteger(ownData(value, "width", `${label}.width`), 1, IRREGULAR_REGION_DETECTION_LIMITS.maxDimension, `${label}.width`),
    height: requireInteger(ownData(value, "height", `${label}.height`), 1, IRREGULAR_REGION_DETECTION_LIMITS.maxDimension, `${label}.height`),
  });
}

function readMask(value: unknown, label: string): WandPixelMask {
  if (typeof value !== "object" || value === null || isArray(value, label)) throw invalid(label);
  ownKeysExactly(value, ["bounds", "pixelCount", "runs"], label);
  const bounds = readBounds(ownData(value, "bounds", `${label}.bounds`), `${label}.bounds`);
  const pixelCount = requireInteger(
    ownData(value, "pixelCount", `${label}.pixelCount`),
    1,
    IRREGULAR_REGION_DETECTION_LIMITS.maxSourcePixels,
    `${label}.pixelCount`,
  );
  const runsValue = ownData(value, "runs", `${label}.runs`);
  const runCount = readDenseDataArrayLength(runsValue, `${label}.runs`);
  const runs: WandMaskRun[] = [];
  let counted = 0;
  let priorEnd = -1;
  for (let index = 0; index < runCount; index += 1) {
    const run = ownData(runsValue as object, String(index), `${label}.runs[${index}]`);
    if (typeof run !== "object" || run === null || isArray(run, `${label}.runs[${index}]`)) throw invalid(`${label}.runs[${index}]`);
    ownKeysExactly(run, ["offset", "length"], `${label}.runs[${index}]`);
    const offset = requireInteger(ownData(run, "offset", `${label}.runs[${index}].offset`), 0, bounds.width * bounds.height - 1, `${label}.runs[${index}].offset`);
    const length = requireInteger(ownData(run, "length", `${label}.runs[${index}].length`), 1, bounds.width, `${label}.runs[${index}].length`);
    if (offset <= priorEnd || offset % bounds.width + length > bounds.width) throw invalid(`${label}.runs[${index}]`);
    priorEnd = offset + length - 1;
    counted += length;
    runs.push(Object.freeze({ offset, length }));
  }
  if (runs.length === 0 || counted !== pixelCount) throw invalid(label);
  return Object.freeze({ bounds, pixelCount, runs: Object.freeze(runs) });
}

function sameBounds(left: IrregularRegionBounds, right: IrregularRegionBounds): boolean {
  return left.x === right.x && left.y === right.y
    && left.width === right.width && left.height === right.height;
}

function readComponent(value: unknown, label: string): WandSelectedComponent {
  if (typeof value !== "object" || value === null || isArray(value, label)) throw invalid(label);
  ownKeysExactly(value, ["id", "sourceAssetId", "firstPixelOffset", "pixelCount", "bounds", "mask"], label);
  const id = ownData(value, "id", `${label}.id`);
  const sourceAssetId = ownData(value, "sourceAssetId", `${label}.sourceAssetId`);
  if (typeof id !== "string" || !/^wand:sha256:[0-9a-f]{64}$/u.test(id)) throw invalid(`${label}.id`);
  if (!isEntityId(sourceAssetId) || sourceAssetId.length > MAX_WAND_SOURCE_ID_CODE_UNITS) throw invalid(`${label}.sourceAssetId`);
  const bounds = readBounds(ownData(value, "bounds", `${label}.bounds`), `${label}.bounds`);
  const mask = readMask(ownData(value, "mask", `${label}.mask`), `${label}.mask`);
  const pixelCount = requireInteger(ownData(value, "pixelCount", `${label}.pixelCount`), 1, IRREGULAR_REGION_DETECTION_LIMITS.maxSourcePixels, `${label}.pixelCount`);
  if (pixelCount !== mask.pixelCount || !sameBounds(bounds, mask.bounds)) throw invalid(label);
  return Object.freeze({
    id,
    sourceAssetId,
    firstPixelOffset: requireInteger(ownData(value, "firstPixelOffset", `${label}.firstPixelOffset`), 0, IRREGULAR_REGION_DETECTION_LIMITS.maxSourcePixels - 1, `${label}.firstPixelOffset`),
    pixelCount,
    bounds,
    mask,
  });
}

function readSelection(value: unknown): WandSelectionSnapshot {
  if (typeof value !== "object" || value === null || isArray(value, "selection")) throw invalid("selection");
  ownKeysExactly(value, ["version", "sourceAssetId", "sourceWidth", "sourceHeight", "components", "bounds", "mask"], "selection");
  if (ownData(value, "version", "selection.version") !== 1) throw invalid("selection.version");
  const sourceAssetId = ownData(value, "sourceAssetId", "selection.sourceAssetId");
  if (sourceAssetId !== null && (!isEntityId(sourceAssetId) || sourceAssetId.length > MAX_WAND_SOURCE_ID_CODE_UNITS)) throw invalid("selection.sourceAssetId");
  const dimensions = readDimensions(
    ownData(value, "sourceWidth", "selection.sourceWidth"),
    ownData(value, "sourceHeight", "selection.sourceHeight"),
  );
  const componentsValue = ownData(value, "components", "selection.components");
  const componentCount = readDenseDataArrayLength(componentsValue, "selection.components");
  const components: WandSelectedComponent[] = [];
  const componentKeys = new Set<string>();
  for (let index = 0; index < componentCount; index += 1) {
    const component = readComponent(
      ownData(componentsValue as object, String(index), `selection.components[${index}]`),
      `selection.components[${index}]`,
    );
    if (component.sourceAssetId !== sourceAssetId) throw invalid("selection.components");
    if (
      component.firstPixelOffset >= dimensions.pixels
      || component.bounds.x + component.bounds.width > dimensions.width
      || component.bounds.y + component.bounds.height > dimensions.height
      || componentKeys.has(`${component.sourceAssetId}\0${component.id}`)
    ) throw invalid("selection.components");
    componentKeys.add(`${component.sourceAssetId}\0${component.id}`);
    components.push(component);
  }
  const boundsValue = ownData(value, "bounds", "selection.bounds");
  const maskValue = ownData(value, "mask", "selection.mask");
  const bounds = boundsValue === null ? null : readBounds(boundsValue, "selection.bounds");
  const mask = maskValue === null ? null : readMask(maskValue, "selection.mask");
  if ((components.length === 0) !== (bounds === null) || (bounds === null) !== (mask === null)) throw invalid("selection");
  if (bounds && mask && !sameBounds(bounds, mask.bounds)) throw invalid("selection");
  if (sourceAssetId === null && (dimensions.pixels !== 0 || components.length !== 0)) throw invalid("selection");
  return Object.freeze({
    version: 1,
    sourceAssetId,
    sourceWidth: dimensions.width,
    sourceHeight: dimensions.height,
    components: Object.freeze(components),
    bounds,
    mask,
  });
}

function throwIfCancelled(check: IrregularRegionCancellationCheck | undefined): void {
  if (!check) return;
  let cancelled: unknown;
  try {
    cancelled = check();
  } catch {
    throw invalid("isCancelled callback");
  }
  if (typeof cancelled !== "boolean") throw invalid("isCancelled");
  if (cancelled) throw new IrregularRegionDetectionCancelledError();
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

class WandSha256 {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly buffer = new Uint8Array(64);
  private readonly words = new Uint32Array(64);
  private bufferLength = 0;
  private bytesHashed = 0;

  updateBytes(bytes: Uint8Array): void {
    for (const byte of bytes) this.updateByte(byte);
  }

  updateUint32(value: number): void {
    this.updateByte(value >>> 24);
    this.updateByte(value >>> 16);
    this.updateByte(value >>> 8);
    this.updateByte(value);
  }

  private updateByte(value: number): void {
    this.buffer[this.bufferLength++] = value & 0xff;
    this.bytesHashed += 1;
    if (this.bufferLength === 64) {
      this.compress();
      this.bufferLength = 0;
    }
  }

  private compress(): void {
    const words = this.words;
    for (let index = 0; index < 16; index += 1) {
      const offset = index * 4;
      words[index] = (
        (this.buffer[offset]! << 24)
        | (this.buffer[offset + 1]! << 16)
        | (this.buffer[offset + 2]! << 8)
        | this.buffer[offset + 3]!
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15]!;
      const y = words[index - 2]!;
      const sigma0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const sigma1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = ((e! >>> 6) | (e! << 26)) ^ ((e! >>> 11) | (e! << 21)) ^ ((e! >>> 25) | (e! << 7));
      const choice = (e! & f!) ^ (~e! & g!);
      const temp1 = (h! + sum1 + choice + SHA256_CONSTANTS[index]! + words[index]!) >>> 0;
      const sum0 = ((a! >>> 2) | (a! << 30)) ^ ((a! >>> 13) | (a! << 19)) ^ ((a! >>> 22) | (a! << 10));
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    this.state[0] = (this.state[0]! + a!) >>> 0;
    this.state[1] = (this.state[1]! + b!) >>> 0;
    this.state[2] = (this.state[2]! + c!) >>> 0;
    this.state[3] = (this.state[3]! + d!) >>> 0;
    this.state[4] = (this.state[4]! + e!) >>> 0;
    this.state[5] = (this.state[5]! + f!) >>> 0;
    this.state[6] = (this.state[6]! + g!) >>> 0;
    this.state[7] = (this.state[7]! + h!) >>> 0;
  }

  digestHex(): string {
    const bitHigh = Math.floor(this.bytesHashed / 0x20000000);
    const bitLow = (this.bytesHashed << 3) >>> 0;
    this.buffer[this.bufferLength++] = 0x80;
    if (this.bufferLength > 56) {
      this.buffer.fill(0, this.bufferLength);
      this.compress();
      this.bufferLength = 0;
    }
    this.buffer.fill(0, this.bufferLength, 56);
    this.buffer[56] = bitHigh >>> 24;
    this.buffer[57] = bitHigh >>> 16;
    this.buffer[58] = bitHigh >>> 8;
    this.buffer[59] = bitHigh;
    this.buffer[60] = bitLow >>> 24;
    this.buffer[61] = bitLow >>> 16;
    this.buffer[62] = bitLow >>> 8;
    this.buffer[63] = bitLow;
    this.compress();
    return [...this.state].map((word) => word.toString(16).padStart(8, "0")).join("");
  }
}

function freezeBounds(bounds: IrregularRegionBounds): IrregularRegionBounds {
  return Object.freeze({ ...bounds });
}

function maskFromMembership(
  membership: Uint8Array,
  sourceWidth: number,
  bounds: IrregularRegionBounds,
): WandPixelMask {
  const runs: WandMaskRun[] = [];
  let pixelCount = 0;
  for (let localY = 0; localY < bounds.height; localY += 1) {
    const sourceRow = (bounds.y + localY) * sourceWidth + bounds.x;
    const localRow = localY * bounds.width;
    let localX = 0;
    while (localX < bounds.width) {
      while (localX < bounds.width && membership[sourceRow + localX] === 0) localX += 1;
      if (localX >= bounds.width) break;
      const start = localX;
      while (localX < bounds.width && membership[sourceRow + localX] === 1) localX += 1;
      const length = localX - start;
      pixelCount += length;
      runs.push(Object.freeze({ offset: localRow + start, length }));
    }
  }
  return Object.freeze({
    bounds: freezeBounds(bounds),
    pixelCount,
    runs: Object.freeze(runs),
  });
}

function componentId(
  sourceAssetId: EntityId,
  sourceWidth: number,
  sourceHeight: number,
  firstPixelOffset: number,
  mask: WandPixelMask,
): string {
  const digest = new WandSha256();
  digest.updateBytes(new TextEncoder().encode("sprite-boy:wand-component:v2\0"));
  digest.updateBytes(new TextEncoder().encode(sourceAssetId));
  digest.updateBytes(new Uint8Array([0]));
  digest.updateUint32(sourceWidth);
  digest.updateUint32(sourceHeight);
  digest.updateUint32(firstPixelOffset);
  digest.updateUint32(mask.pixelCount);
  digest.updateUint32(mask.bounds.x);
  digest.updateUint32(mask.bounds.y);
  digest.updateUint32(mask.bounds.width);
  digest.updateUint32(mask.bounds.height);
  for (const run of mask.runs) {
    digest.updateUint32(run.offset);
    digest.updateUint32(run.length);
  }
  return `wand:sha256:${digest.digestHex()}`;
}

function floodSeed(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold: number,
  connectivity: IrregularRegionConnectivity,
  seed: WandSeedPoint,
  isCancelled: IrregularRegionCancellationCheck | undefined,
): { readonly membership: Uint8Array; readonly bounds: IrregularRegionBounds; readonly firstPixelOffset: number } | null {
  if (seed.x < 0 || seed.y < 0 || seed.x >= width || seed.y >= height) return null;
  const firstPixelOffset = seed.y * width + seed.x;
  if (pixels[firstPixelOffset * 4 + 3]! <= alphaThreshold) return null;

  let membership: Uint8Array;
  let frontier: Uint32Array;
  try {
    membership = new Uint8Array(width * height);
    frontier = new Uint32Array(width * height);
  } catch {
    throw new RangeError("Wand selection could not allocate its bounded component working set.");
  }
  frontier[0] = firstPixelOffset;
  membership[firstPixelOffset] = 1;
  let head = 0;
  let tail = 1;
  let minX = seed.x;
  let maxX = seed.x;
  let minY = seed.y;
  let maxY = seed.y;
  const dx = connectivity === 4 ? [0, -1, 1, 0] : [-1, 0, 1, -1, 1, -1, 0, 1];
  const dy = connectivity === 4 ? [-1, 0, 0, 1] : [-1, -1, -1, 0, 0, 1, 1, 1];

  while (head < tail) {
    if ((head & FLOOD_CANCEL_MASK) === 0) throwIfCancelled(isCancelled);
    const current = frontier[head++]!;
    const x = current % width;
    const y = Math.floor(current / width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    for (let direction = 0; direction < dx.length; direction += 1) {
      const nextX = x + dx[direction]!;
      const nextY = y + dy[direction]!;
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
      const next = nextY * width + nextX;
      if (membership[next] === 1 || pixels[next * 4 + 3]! <= alphaThreshold) continue;
      membership[next] = 1;
      frontier[tail++] = next;
    }
  }
  return Object.freeze({
    membership,
    firstPixelOffset: membership.findIndex((value) => value === 1),
    bounds: Object.freeze({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }),
  });
}

function compareComponents(left: WandSelectedComponent, right: WandSelectedComponent): number {
  return left.firstPixelOffset - right.firstPixelOffset || left.id.localeCompare(right.id);
}

function aggregateMask(components: readonly WandSelectedComponent[]): WandPixelMask | null {
  if (components.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  for (const component of components) {
    minX = Math.min(minX, component.bounds.x);
    minY = Math.min(minY, component.bounds.y);
    maxX = Math.max(maxX, component.bounds.x + component.bounds.width - 1);
    maxY = Math.max(maxY, component.bounds.y + component.bounds.height - 1);
  }
  const bounds = Object.freeze({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 });
  const membership = new Uint8Array(bounds.width * bounds.height);
  for (const component of components) {
    for (const run of component.mask.runs) {
      const componentY = Math.floor(run.offset / component.bounds.width);
      const componentX = run.offset % component.bounds.width;
      const aggregateOffset = (component.bounds.y - bounds.y + componentY) * bounds.width
        + component.bounds.x - bounds.x + componentX;
      membership.fill(1, aggregateOffset, aggregateOffset + run.length);
    }
  }
  return maskFromMembership(membership, bounds.width, { ...bounds, x: 0, y: 0 });
}

function snapshot(
  sourceAssetId: EntityId,
  sourceWidth: number,
  sourceHeight: number,
  components: readonly WandSelectedComponent[],
): WandSelectionSnapshot {
  const ordered = Object.freeze([...components].sort(compareComponents));
  const localMask = aggregateMask(ordered);
  if (!localMask) {
    return Object.freeze({
      version: 1,
      sourceAssetId,
      sourceWidth,
      sourceHeight,
      components: EMPTY_COMPONENTS,
      bounds: null,
      mask: null,
    });
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  for (const component of ordered) {
    minX = Math.min(minX, component.bounds.x);
    minY = Math.min(minY, component.bounds.y);
    maxX = Math.max(maxX, component.bounds.x + component.bounds.width - 1);
    maxY = Math.max(maxY, component.bounds.y + component.bounds.height - 1);
  }
  const bounds = freezeBounds({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 });
  const mask = Object.freeze({ ...localMask, bounds });
  return Object.freeze({ version: 1, sourceAssetId, sourceWidth, sourceHeight, components: ordered, bounds, mask });
}

function sameComponentSet(
  left: readonly WandSelectedComponent[],
  right: readonly WandSelectedComponent[],
): boolean {
  return left.length === right.length && left.every((component, index) =>
    component.id === right[index]!.id
    && component.sourceAssetId === right[index]!.sourceAssetId);
}

function intentForDiff(
  sourceAssetId: EntityId,
  previous: readonly WandSelectedComponent[],
  next: readonly WandSelectedComponent[],
): WandRegionIntentBatch | null {
  const key = ({ id, sourceAssetId }: WandSelectedComponent) => `${sourceAssetId}\0${id}`;
  const previousIds = new Set(previous.map(key));
  const nextIds = new Set(next.map(key));
  const operations: WandRegionMutation[] = [];
  for (const component of previous) {
    if (!nextIds.has(key(component))) operations.push(Object.freeze({ type: "remove", component }));
  }
  for (const component of next) {
    if (!previousIds.has(key(component))) operations.push(Object.freeze({ type: "add", component }));
  }
  if (operations.length === 0) return null;
  return Object.freeze({
    type: "wand-region.intent-batch",
    sourceAssetId,
    history: "single-undo",
    operations: Object.freeze(operations),
  });
}

function transition(
  selection: WandSelectionSnapshot,
  hit: WandSelectedComponent | null,
  intent: WandRegionIntentBatch | null,
  status: WandSelectionTransitionStatus,
): WandSelectionTransition {
  return Object.freeze({ selection, hit, intent, changed: intent !== null, status });
}

export function createEmptyWandSelection(): WandSelectionSnapshot {
  return EMPTY_SELECTION;
}

/** Escape/cancel is deliberately side-effect free: caller retains the exact prior snapshot identity. */
export function cancelWandSelection(selection: WandSelectionSnapshot): WandSelectionTransition {
  readSelection(selection);
  return transition(selection, null, null, "cancelled");
}

/**
 * Pure controller seam: detect exact alpha component at seed, then reduce replace/add/subtract.
 * No project/store writes happen here; cancellation throws before any next snapshot is returned.
 */
export function selectWandComponent(
  selection: WandSelectionSnapshot,
  input: {
    readonly sourceAssetId: EntityId;
    readonly pixels: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly seed: WandSeedPoint;
    readonly mode: WandSelectionMode;
    readonly options: IrregularRegionDetectionOptions;
    readonly isCancelled?: IrregularRegionCancellationCheck;
  },
): WandSelectionTransition {
  const previous = readSelection(selection);
  const safe = readInput(input);
  const sourceMismatch = previous.sourceAssetId !== null && previous.sourceAssetId !== safe.sourceAssetId;
  if (sourceMismatch && previous.components.length > 0 && safe.mode !== "replace") {
    throw invalid("selection.sourceAssetId");
  }
  throwIfCancelled(safe.isCancelled);

  const flood = floodSeed(
    safe.pixels,
    safe.width,
    safe.height,
    safe.options.alphaThreshold,
    safe.options.connectivity,
    safe.seed,
    safe.isCancelled,
  );
  let hit: WandSelectedComponent | null = null;
  if (flood) {
    const mask = maskFromMembership(flood.membership, safe.width, flood.bounds);
    if (
      mask.pixelCount >= safe.options.minPixelCount
      && flood.bounds.width >= safe.options.minWidth
      && flood.bounds.height >= safe.options.minHeight
    ) {
      hit = Object.freeze({
        id: componentId(safe.sourceAssetId, safe.width, safe.height, flood.firstPixelOffset, mask),
        sourceAssetId: safe.sourceAssetId,
        firstPixelOffset: flood.firstPixelOffset,
        pixelCount: mask.pixelCount,
        bounds: mask.bounds,
        mask,
      });
    }
  }

  let nextComponents: readonly WandSelectedComponent[];
  if (safe.mode === "replace") nextComponents = hit ? [hit] : EMPTY_COMPONENTS;
  else if (safe.mode === "add") {
    nextComponents = !hit || previous.components.some(({ id, sourceAssetId }) =>
      id === hit!.id && sourceAssetId === hit!.sourceAssetId)
      ? previous.components
      : [...previous.components, hit];
  } else {
    nextComponents = !hit
      ? previous.components
      : previous.components.filter(({ id, sourceAssetId }) =>
        id !== hit!.id || sourceAssetId !== hit!.sourceAssetId);
  }

  const orderedNext = [...nextComponents].sort(compareComponents);
  if (sameComponentSet(previous.components, orderedNext)) {
    return transition(selection, hit, null, hit ? "unchanged" : "no-hit");
  }
  const next = snapshot(safe.sourceAssetId, safe.width, safe.height, orderedNext);
  const intent = intentForDiff(safe.sourceAssetId, previous.components, next.components);
  return transition(next, hit, intent, next.components.length === 0 ? "cleared" : "selected");
}
