export const SCENE_RASTER_MIME_TYPES = Object.freeze([
  "image/png",
  "image/webp",
] as const);

export type SceneRasterMimeType = (typeof SCENE_RASTER_MIME_TYPES)[number];

export interface SceneRasterEncodeOptions {
  readonly mimeType: SceneRasterMimeType;
  readonly quality?: number;
}

/** Cross-realm Blob brand check using the platform internal slot. */
export function isPlatformBlob(value: unknown): value is Blob {
  if (value === null || typeof value !== "object") return false;
  try {
    Reflect.apply(Blob.prototype.slice, value, [0, 0]);
    return typeof (value as Blob).size === "number" &&
      typeof (value as Blob).type === "string";
  } catch {
    return false;
  }
}
