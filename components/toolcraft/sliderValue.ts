const COMPACT_UNITS = new Set(["%", "°", "px", "s", "ms"]);

function stepFractionDigits(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const raw = step.toString().toLowerCase();
  if (raw.includes("e")) {
    const [base, expPart] = raw.split("e");
    const exp = Number(expPart);
    if (!Number.isFinite(exp)) return 0;
    if (exp >= 0) return 0;
    const baseDecimals = base.includes(".") ? base.split(".")[1]!.length : 0;
    return baseDecimals + Math.abs(exp);
  }
  const dot = raw.indexOf(".");
  return dot === -1 ? 0 : raw.length - dot - 1;
}
/** Non-finite values clamp to the normalized min. Finite values clamp into [min, max]. */
export function clampSliderValue(value: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Snap to the nearest step relative to `min`, clamp into range, strip float drift.
 */
export function snapSliderValue(
  value: number,
  opts: { min: number; max: number; step: number },
): number {
  const range = normalizeSliderRange(opts.min, opts.max, opts.step);
  if (!Number.isFinite(value)) return range.min;
  const clamped = clampSliderValue(value, range.min, range.max);
  const steps = Math.round((clamped - range.min) / range.step);
  const raw = range.min + steps * range.step;
  const digits = Math.min(12, Math.max(stepFractionDigits(range.step), stepFractionDigits(range.min)) + 2);
  const snapped = Number(raw.toFixed(digits));
  return clampSliderValue(snapped, range.min, range.max);
}

/**
 * Compact units (`%`, `°`, `px`, `s`, `ms`) have no space; other non-empty units
 * use one space before the unit.
 */
export function formatSliderValueWithUnit(
  value: number,
  step: number,
  unit?: string,
): string {
  const digits = stepFractionDigits(Number.isFinite(step) && step > 0 ? step : 1);
  const n = Number.isFinite(value) ? value : 0;
  const formatted = digits > 0 ? n.toFixed(digits) : String(Math.round(n));
  const trimmedUnit = unit?.trim() ?? "";
  if (trimmedUnit === "") return formatted;
  if (COMPACT_UNITS.has(trimmedUnit)) return `${formatted}${trimmedUnit}`;
  return `${formatted} ${trimmedUnit}`;
}

/**
 * Swap reversed finite min/max; equal bounds become max = min + 1;
 * invalid/non-positive step becomes 1.
 */
export function normalizeSliderRange(
  min: number,
  max: number,
  step: number,
): { min: number; max: number; step: number } {
  let nextMin = Number.isFinite(min) ? min : 0;
  let nextMax = Number.isFinite(max) ? max : nextMin + 1;
  if (nextMin > nextMax) {
    const swap = nextMin;
    nextMin = nextMax;
    nextMax = swap;
  }
  if (nextMin === nextMax) {
    nextMax = nextMin + 1;
  }
  const nextStep = Number.isFinite(step) && step > 0 ? step : 1;
  return { min: nextMin, max: nextMax, step: nextStep };
}
