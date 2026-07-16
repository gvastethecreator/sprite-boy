import type { GridSplitRecipeV1 } from "../../../core/project";
import { assertGridRecipeLayout } from "../../../core/processing/gridLayoutValidation";
import { GRID_PROCESSING_LIMITS } from "../../../core/processing/gridProcessingProtocol";
import type { GridLayoutDraft, GridLayoutSourceDimensions } from "./gridLayoutDraft";
import { serializeGridRecipeLayout } from "./gridLayoutDraft";
import type { SliceGridRecipeStateV1 } from "../../../types/core";

export type { SliceGridRecipeStateV1 } from "../../../types/core";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/u;

function dataRecord(value: unknown, exactKeys: readonly string[]): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== exactKeys.length || keys.some((key) => typeof key !== "string") ||
      exactKeys.some((key) => !keys.includes(key))) return null;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of exactKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    return null;
  }
}

function canonicalNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0) &&
    value >= minimum && value <= maximum;
}

function canonicalInteger(value: unknown, minimum: number, maximum: number): value is number {
  return canonicalNumber(value, minimum, maximum) && Number.isSafeInteger(value);
}

function copyRecipe(value: unknown, source: GridLayoutSourceDimensions): GridSplitRecipeV1 | null {
  const recipe = dataRecord(value, ["kind", "version", "sourceAssetId", "layout", "crop", "chroma", "pixel"]);
  if (!recipe || recipe.kind !== "grid-split" || recipe.version !== 1 ||
    typeof recipe.sourceAssetId !== "string" || recipe.sourceAssetId.trim().length === 0 ||
    recipe.sourceAssetId.length > GRID_PROCESSING_LIMITS.maxIdentifierLength) return null;

  let layout: GridSplitRecipeV1["layout"];
  try {
    layout = assertGridRecipeLayout(recipe.layout, source);
  } catch {
    return null;
  }

  const crop = dataRecord(recipe.crop, ["threshold", "padding"]);
  const chroma = dataRecord(recipe.chroma, ["enabled", "color", "tolerance", "smoothness", "spill"]);
  const pixelKeys = (() => {
    try {
      return recipe.pixel && typeof recipe.pixel === "object" &&
        Object.prototype.hasOwnProperty.call(recipe.pixel, "palette")
        ? ["enabled", "size", "quantize", "colors", "palette"] as const
        : ["enabled", "size", "quantize", "colors"] as const;
    } catch {
      return null;
    }
  })();
  const pixel = pixelKeys ? dataRecord(recipe.pixel, pixelKeys) : null;
  if (!crop || !chroma || !pixel ||
    !canonicalNumber(crop.threshold, 0, 100) ||
    !canonicalInteger(crop.padding, 0, GRID_PROCESSING_LIMITS.maxDimension) ||
    typeof chroma.enabled !== "boolean" || typeof chroma.color !== "string" ||
    !HEX_COLOR.test(chroma.color) || !canonicalNumber(chroma.tolerance, 0, 100) ||
    !canonicalNumber(chroma.smoothness, 0, 100) || !canonicalNumber(chroma.spill, 0, 100) ||
    typeof pixel.enabled !== "boolean" ||
    !canonicalInteger(pixel.size, 1, GRID_PROCESSING_LIMITS.maxPixelSize) ||
    typeof pixel.quantize !== "boolean" ||
    !canonicalInteger(pixel.colors, 2, GRID_PROCESSING_LIMITS.maxPaletteColors)) return null;

  let palette: string[] | undefined;
  if (pixelKeys && pixelKeys.length === 5) {
    try {
      if (!Array.isArray(pixel.palette) || pixel.palette.length < 1 ||
        pixel.palette.length > GRID_PROCESSING_LIMITS.maxPaletteColors ||
        Reflect.ownKeys(pixel.palette).length !== pixel.palette.length + 1) return null;
      const colors: string[] = [];
      for (let index = 0; index < pixel.palette.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(pixel.palette, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor) ||
          typeof descriptor.value !== "string" || !HEX_COLOR.test(descriptor.value)) return null;
        colors.push(descriptor.value);
      }
      Object.freeze(colors);
      palette = colors;
    } catch {
      return null;
    }
  }

  return Object.freeze({
    kind: "grid-split" as const,
    version: 1 as const,
    sourceAssetId: recipe.sourceAssetId,
    layout,
    crop: Object.freeze({ threshold: crop.threshold, padding: crop.padding }),
    chroma: Object.freeze({
      enabled: chroma.enabled,
      color: chroma.color,
      tolerance: chroma.tolerance,
      smoothness: chroma.smoothness,
      spill: chroma.spill,
    }),
    pixel: Object.freeze({
      enabled: pixel.enabled,
      size: pixel.size,
      quantize: pixel.quantize,
      colors: pixel.colors,
      ...(palette ? { palette } : {}),
    }),
  });
}

export function createDefaultSliceGridRecipeState(
  sourceAssetId: string,
  source: GridLayoutSourceDimensions,
): SliceGridRecipeStateV1 {
  const safeId = typeof sourceAssetId === "string" && sourceAssetId.trim().length > 0 &&
    sourceAssetId.length <= GRID_PROCESSING_LIMITS.maxIdentifierLength
    ? sourceAssetId
    : "slice-source";
  assertGridRecipeLayout({ mode: "auto" }, source);
  return Object.freeze({
    version: 1 as const,
    recipe: Object.freeze({
      kind: "grid-split" as const,
      version: 1 as const,
      sourceAssetId: safeId,
      layout: Object.freeze({ mode: "auto" as const }),
      crop: Object.freeze({ threshold: 0, padding: 0 }),
      chroma: Object.freeze({ enabled: false, color: "#00ff00", tolerance: 0, smoothness: 0, spill: 0 }),
      pixel: Object.freeze({ enabled: false, size: 16, quantize: false, colors: 16 }),
    }),
    manual: Object.freeze({ rows: 1, cols: 1 }),
  });
}

/** Fail-closed persisted-state hydration. Invalid data never reaches controls or workers. */
export function hydrateSliceGridRecipeState(
  value: unknown,
  source: GridLayoutSourceDimensions,
): SliceGridRecipeStateV1 | null {
  const state = dataRecord(value, ["version", "recipe", "manual"]);
  if (!state || state.version !== 1) return null;
  const recipe = copyRecipe(state.recipe, source);
  const manual = dataRecord(state.manual, ["rows", "cols"]);
  if (!recipe || !manual ||
    !canonicalInteger(manual.rows, 1, source.height) ||
    !canonicalInteger(manual.cols, 1, source.width) ||
    manual.rows * manual.cols > GRID_PROCESSING_LIMITS.maxResultCount) return null;
  if (recipe.layout.mode === "manual" &&
    (recipe.layout.rows !== manual.rows || recipe.layout.cols !== manual.cols)) return null;
  return Object.freeze({
    version: 1 as const,
    recipe,
    manual: Object.freeze({ rows: manual.rows, cols: manual.cols }),
  });
}

export function recipeStateToDraft(state: SliceGridRecipeStateV1): GridLayoutDraft {
  return Object.freeze({ mode: state.recipe.layout.mode, manual: state.manual });
}

export function updateSliceGridRecipeLayout(
  state: SliceGridRecipeStateV1,
  draft: GridLayoutDraft,
  source: GridLayoutSourceDimensions,
): SliceGridRecipeStateV1 {
  const layout = serializeGridRecipeLayout(draft, source);
  return Object.freeze({
    version: 1 as const,
    recipe: Object.freeze({ ...state.recipe, layout }),
    manual: Object.freeze({ rows: draft.manual.rows, cols: draft.manual.cols }),
  });
}

export function updateSliceGridRecipeCrop(
  state: SliceGridRecipeStateV1,
  crop: GridSplitRecipeV1["crop"],
): SliceGridRecipeStateV1 {
  if (!canonicalNumber(crop.threshold, 0, 100) ||
    !canonicalInteger(crop.padding, 0, GRID_PROCESSING_LIMITS.maxDimension)) {
    throw new TypeError("Slice grid crop settings are invalid.");
  }
  return Object.freeze({
    version: 1 as const,
    recipe: Object.freeze({
      ...state.recipe,
      crop: Object.freeze({ threshold: crop.threshold, padding: crop.padding }),
    }),
    manual: state.manual,
  });
}

export function serializeSliceGridRecipeState(state: SliceGridRecipeStateV1): string {
  const hydrated = hydrateSliceGridRecipeState(state, {
    width: Math.max(state.manual.cols, state.recipe.layout.mode === "manual" ? state.recipe.layout.cols : 1),
    height: Math.max(state.manual.rows, state.recipe.layout.mode === "manual" ? state.recipe.layout.rows : 1),
  });
  if (!hydrated) throw new TypeError("Slice grid recipe state is invalid.");
  return JSON.stringify(hydrated);
}
