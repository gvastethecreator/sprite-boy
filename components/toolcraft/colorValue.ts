export interface HsvColor {
  readonly h: number;
  readonly s: number;
  readonly v: number;
}

export function clampColorChannel(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeHue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((value % 360) + 360) % 360;
}

export function hexToRgb(hex: string): readonly [number, number, number] {
  const value = hex.replace(/^#/u, "").padEnd(6, "0").slice(0, 6);
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

export function rgbToHex(red: number, green: number, blue: number): string {
  const channel = (value: number) => Math.round(clampColorChannel(value, 0, 255))
    .toString(16)
    .padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`.toUpperCase();
}

export function hexToHsv(hex: string): HsvColor {
  const [red, green, blue] = hexToRgb(hex).map((channel) => channel / 255);
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta !== 0) {
    if (maximum === red) hue = ((green - blue) / delta) % 6;
    else if (maximum === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
  }
  return {
    h: normalizeHue(hue * 60),
    s: maximum === 0 ? 0 : delta / maximum,
    v: maximum,
  };
}

export function hsvToHex(color: HsvColor): string {
  const hue = normalizeHue(color.h);
  const saturation = clampColorChannel(color.s, 0, 1);
  const value = clampColorChannel(color.v, 0, 1);
  const chroma = value * saturation;
  const segment = hue / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const match = value - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;
  if (segment < 1) [red, green] = [chroma, x];
  else if (segment < 2) [red, green] = [x, chroma];
  else if (segment < 3) [green, blue] = [chroma, x];
  else if (segment < 4) [green, blue] = [x, chroma];
  else if (segment < 5) [red, blue] = [x, chroma];
  else [red, blue] = [chroma, x];
  return rgbToHex((red + match) * 255, (green + match) * 255, (blue + match) * 255);
}
