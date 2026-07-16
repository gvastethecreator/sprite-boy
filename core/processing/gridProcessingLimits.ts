/** Shared resource ceilings for every Grid Split boundary. */
export const GRID_PROCESSING_LIMITS = Object.freeze({
  maxIdentifierLength: 256,
  maxDimension: 16_384,
  maxSourcePixels: 67_108_864,
  maxResultCount: 4_096,
  maxResultPixels: 67_108_864,
  maxProgressTotal: 67_108_864,
  maxPixelSize: 4_096,
  maxPaletteColors: 256,
  maxWarnings: 16,
} as const);
