import type { WandSeedPoint } from "./wandSelection";

export interface WandClientPoint {
  readonly clientX: number;
  readonly clientY: number;
}

/** Physical-canvas transform supplied by the eventual S1-04 canvas integration. */
export interface WandSourceCoordinateTransform {
  readonly canvasClientLeft: number;
  readonly canvasClientTop: number;
  readonly devicePixelRatio: number;
  readonly zoom: number;
  readonly sourceOriginCanvasX: number;
  readonly sourceOriginCanvasY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

function invalid(label: string): TypeError {
  return new TypeError(`${label} is not valid wand coordinate input.`);
}

function isArray(value: unknown, label: string): boolean {
  try {
    return Array.isArray(value);
  } catch {
    throw invalid(label);
  }
}

function readExactRecord(value: unknown, keys: readonly string[], label: string): Record<string, number> {
  if (typeof value !== "object" || value === null || isArray(value, label)) throw invalid(label);
  let ownKeys: readonly PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch {
    throw invalid(label);
  }
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) {
    throw invalid(label);
  }
  const result: Record<string, number> = {};
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw invalid(`${label}.${key}`);
    }
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value !== "number") {
      throw invalid(`${label}.${key}`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

/** Maps CSS client coordinates through DPR + zoom into an integer source seed. */
export function mapWandClientPointToSource(
  point: WandClientPoint,
  transform: WandSourceCoordinateTransform,
): WandSeedPoint | null {
  const safePoint = readExactRecord(point, ["clientX", "clientY"], "point");
  const safe = readExactRecord(transform, [
    "canvasClientLeft",
    "canvasClientTop",
    "devicePixelRatio",
    "zoom",
    "sourceOriginCanvasX",
    "sourceOriginCanvasY",
    "sourceWidth",
    "sourceHeight",
  ], "transform");
  for (const [key, value] of Object.entries({ ...safePoint, ...safe })) {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw invalid(key);
  }
  if (safe.devicePixelRatio! <= 0 || safe.zoom! <= 0) throw invalid("transform.scale");
  if (
    !Number.isSafeInteger(safe.sourceWidth) || safe.sourceWidth! < 0
    || !Number.isSafeInteger(safe.sourceHeight) || safe.sourceHeight! < 0
    || (safe.sourceWidth === 0) !== (safe.sourceHeight === 0)
  ) throw invalid("transform.sourceDimensions");

  const canvasX = (safePoint.clientX! - safe.canvasClientLeft!) * safe.devicePixelRatio!;
  const canvasY = (safePoint.clientY! - safe.canvasClientTop!) * safe.devicePixelRatio!;
  const scale = safe.zoom! * safe.devicePixelRatio!;
  const x = Math.floor((canvasX - safe.sourceOriginCanvasX!) / scale);
  const y = Math.floor((canvasY - safe.sourceOriginCanvasY!) / scale);
  if (x < 0 || y < 0 || x >= safe.sourceWidth! || y >= safe.sourceHeight!) return null;
  return Object.freeze({ x, y });
}
