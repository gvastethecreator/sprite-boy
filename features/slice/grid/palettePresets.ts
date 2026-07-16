export interface GridPalettePreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly colors: readonly string[];
}
const preset = (
  id: string,
  label: string,
  description: string,
  colors: readonly string[],
): GridPalettePreset => Object.freeze({
  id,
  label,
  description,
  colors: Object.freeze(colors.map((color) => color.toLowerCase())),
});

/** Stable fixed palettes exposed by the Slice inspector. */
export const GRID_PALETTE_PRESETS = Object.freeze([
  preset("game-boy", "Game Boy", "Four-tone handheld green", ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"]),
  preset("pico-8", "PICO-8", "Eight-bit fantasy console", ["#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8"]),
  preset("arcade", "Arcade", "High-contrast arcade primary", ["#0b1020", "#ff3864", "#ffdd57", "#23d5ab", "#3273dc", "#f5f5f5"]),
  preset("mono", "Monochrome", "Neutral four-tone ramp", ["#111827", "#4b5563", "#9ca3af", "#f9fafb"]),
],);

export const GRID_PALETTE_PRESET_MAP = new Map(
  GRID_PALETTE_PRESETS.map((entry) => [entry.id, entry] as const),
);

export function palettePresetForColors(colors: readonly string[] | undefined): GridPalettePreset | null {
  if (!colors) return null;
  const normalized = colors.map((color) => color.toLowerCase());
  return GRID_PALETTE_PRESETS.find((entry) =>
    entry.colors.length === normalized.length && entry.colors.every((color, index) => color === normalized[index]),
  ) ?? null;
}
