import type { BuilderCanvasSize, ImageMeta } from "../../types";

export interface CanvasContentDimensions {
  readonly width: number;
  readonly height: number;
}

interface ResolveCanvasContentDimensionsOptions {
  readonly canonicalCanvasOwnership: boolean;
  readonly imageMeta: Pick<ImageMeta, "width" | "height"> | null;
  readonly sourceIntrinsicDimensions?: CanvasContentDimensions | null;
  readonly builderCanvas: BuilderCanvasSize | null | undefined;
  readonly fallback: CanvasContentDimensions;
}

function validDimensions(value: CanvasContentDimensions | null | undefined): value is CanvasContentDimensions {
  return value !== null && value !== undefined &&
    Number.isFinite(value.width) && Number.isFinite(value.height) &&
    value.width > 0 && value.height > 0;
}

/** One dimension policy for visible render, viewport fitting and snapshot export. */
export function resolveCanvasContentDimensions(
  options: ResolveCanvasContentDimensionsOptions,
): CanvasContentDimensions {
  const source = validDimensions(options.sourceIntrinsicDimensions)
    ? options.sourceIntrinsicDimensions
    : validDimensions(options.imageMeta)
      ? options.imageMeta
      : null;
  const builder = validDimensions(options.builderCanvas) ? options.builderCanvas : null;
  const selected = options.canonicalCanvasOwnership
    ? source ?? builder
    : builder ?? source;
  return selected ?? options.fallback;
}
