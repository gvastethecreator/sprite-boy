import type { AssetMedia, AssetRecord, VideoTrackMetadata } from "../project/schema";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(
  record: UnknownRecord,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(record).sort();
  const allowed = [...expected].sort();
  if (
    actual.length !== allowed.length
    || actual.some((key, index) => key !== allowed[index])
  ) {
    throw new TypeError(`${label} fields are invalid.`);
  }
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return value as number;
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function positiveFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be positive and finite.`);
  }
  return value;
}

function sanitizeVideoTrack(
  value: unknown,
  width: number,
  height: number,
): VideoTrackMetadata {
  if (!isRecord(value)) throw new TypeError("Video track metadata must be an object.");
  const optionalKeys = [
    ...(value.frameRate === undefined ? [] : ["frameRate"]),
    ...(value.sampleCount === undefined ? [] : ["sampleCount"]),
  ];
  assertExactKeys(
    value,
    [
      "index",
      "codec",
      "codedWidth",
      "codedHeight",
      "displayWidth",
      "displayHeight",
      "rotationDegrees",
      ...optionalKeys,
    ],
    "Video track metadata",
  );
  const codec = value.codec;
  if (typeof codec !== "string" || codec.trim().length === 0) {
    throw new TypeError("Video track codec must be a non-empty string.");
  }
  const displayWidth = positiveSafeInteger(value.displayWidth, "Video display width");
  const displayHeight = positiveSafeInteger(value.displayHeight, "Video display height");
  if (displayWidth !== width || displayHeight !== height) {
    throw new TypeError("Video display dimensions must equal the asset dimensions.");
  }
  if (![0, 90, 180, 270].includes(value.rotationDegrees as number)) {
    throw new TypeError("Video rotation must be 0, 90, 180 or 270 degrees.");
  }
  return Object.freeze({
    index: nonNegativeSafeInteger(value.index, "Video track index"),
    codec: codec.trim(),
    codedWidth: positiveSafeInteger(value.codedWidth, "Video coded width"),
    codedHeight: positiveSafeInteger(value.codedHeight, "Video coded height"),
    displayWidth,
    displayHeight,
    rotationDegrees: value.rotationDegrees as 0 | 90 | 180 | 270,
    ...(value.frameRate === undefined
      ? {}
      : { frameRate: positiveFinite(value.frameRate, "Video frame rate") }),
    ...(value.sampleCount === undefined
      ? {}
      : { sampleCount: nonNegativeSafeInteger(value.sampleCount, "Video sample count") }),
  });
}

/** Validate and freeze media metadata before it crosses the repository boundary. */
export function sanitizeAssetMedia(
  value: unknown,
  mimeType: string,
  width: number,
  height: number,
): AssetMedia {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new TypeError("Asset media metadata must be a discriminated object.");
  }
  const mime = mimeType.trim().toLowerCase();
  if (value.type === "binary") {
    assertExactKeys(value, ["type"], "Binary media metadata");
    if (mime.startsWith("image/") || mime.startsWith("video/")) {
      throw new TypeError("Visual MIME types require image or video media metadata.");
    }
    return Object.freeze({ type: "binary" });
  }
  if (value.type === "image") {
    assertExactKeys(value, ["type"], "Image media metadata");
    if (!mime.startsWith("image/")) throw new TypeError("Image media requires an image MIME type.");
    return Object.freeze({ type: "image" });
  }
  if (value.type === "video") {
    assertExactKeys(value, ["type", "durationUs", "track"], "Video media metadata");
    if (!mime.startsWith("video/")) throw new TypeError("Video media requires a video MIME type.");
    return Object.freeze({
      type: "video",
      durationUs: positiveSafeInteger(value.durationUs, "Video duration"),
      track: sanitizeVideoTrack(value.track, width, height),
    });
  }
  throw new TypeError("Asset media type is unsupported.");
}

/** Infer safe legacy metadata. Video always needs an explicit inspected track. */
export function resolveAssetMedia(
  value: unknown,
  mimeType: string,
  width: number,
  height: number,
): AssetMedia {
  if (value !== undefined) return sanitizeAssetMedia(value, mimeType, width, height);
  const mime = mimeType.trim().toLowerCase();
  if (mime.startsWith("video/")) {
    throw new TypeError("Video assets require inspected track metadata.");
  }
  return Object.freeze(mime.startsWith("image/")
    ? { type: "image" as const }
    : { type: "binary" as const });
}

/** Upgrade legacy IndexedDB image/binary records and validate current records on read. */
export function hydrateAssetRecordMedia(record: Readonly<AssetRecord>): AssetRecord {
  const legacy = record as Readonly<AssetRecord> & { media?: unknown };
  return {
    ...record,
    media: resolveAssetMedia(legacy.media, record.mimeType, record.width, record.height),
  };
}
