import type { Rect } from "../../../core/project";

export interface RegionCropRequest {
  readonly bounds: Readonly<Rect>;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly signal?: AbortSignal;
}

export interface RegionCropPort {
  crop(source: Blob, request: RegionCropRequest): Promise<Blob>;
}

function aborted(signal: AbortSignal | undefined): never {
  throw new DOMException(
    typeof signal?.reason === "string" ? signal.reason : "Region crop was cancelled.",
    "AbortError",
  );
}

/** Browser-only, pixel-exact source-space crop. PNG keeps every source alpha byte. */
export const browserRegionCrop: RegionCropPort = Object.freeze({
  async crop(source: Blob, request: RegionCropRequest): Promise<Blob> {
    if (request.signal?.aborted) aborted(request.signal);
    const bitmap = await createImageBitmap(source);
    try {
      if (request.signal?.aborted) aborted(request.signal);
      if (bitmap.width !== request.sourceWidth || bitmap.height !== request.sourceHeight) {
        throw new TypeError("Decoded source dimensions do not match the canonical Asset.");
      }
      const { x, y, width, height } = request.bounds;
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new TypeError("A 2D crop canvas is unavailable.");
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, width, height);
      context.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
      if (request.signal?.aborted) aborted(request.signal);
      return await canvas.convertToBlob({ type: "image/png" });
    } finally {
      bitmap.close();
    }
  },
});
