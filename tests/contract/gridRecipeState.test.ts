import { describe, expect, it } from "vitest";

import {
  createDefaultSliceGridRecipeState,
  hydrateSliceGridRecipeState,
  recipeStateToDraft,
  serializeSliceGridRecipeState,
  updateSliceGridRecipeLayout,
  updateSliceGridRecipeCrop,
  updateSliceGridRecipeChroma,
  updateSliceGridRecipePixel,
} from "../../features/slice/grid/gridRecipeState";

const SOURCE = Object.freeze({ width: 12, height: 8 });

describe("Slice grid recipe state (G2-05)", () => {
  it("emits an exact deterministic GridSplitRecipeV1 and preserves manual memory in auto", () => {
    const initial = createDefaultSliceGridRecipeState("asset-sheet", SOURCE);
    const manual = updateSliceGridRecipeLayout(initial, {
      mode: "manual",
      manual: { rows: 3, cols: 4 },
    }, SOURCE);
    const automatic = updateSliceGridRecipeLayout(manual, {
      mode: "auto",
      manual: { rows: 3, cols: 4 },
    }, SOURCE);

    expect(Object.keys(automatic)).toEqual(["version", "recipe", "manual"]);
    expect(Object.keys(automatic.recipe)).toEqual([
      "kind", "version", "sourceAssetId", "layout", "crop", "chroma", "pixel",
    ]);
    expect(automatic.recipe).toEqual({
      kind: "grid-split",
      version: 1,
      sourceAssetId: "asset-sheet",
      layout: { mode: "auto" },
      crop: { threshold: 0, padding: 0 },
      chroma: { enabled: false, color: "#00ff00", tolerance: 0, smoothness: 0, spill: 0 },
      pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
    });
    expect(automatic.manual).toEqual({ rows: 3, cols: 4 });
    expect(recipeStateToDraft(automatic)).toEqual({ mode: "auto", manual: { rows: 3, cols: 4 } });
    expect(Object.isFrozen(automatic.recipe.layout)).toBe(true);
  });

  it("round-trips JSON exactly and rejects contradictory or accessor-backed state", () => {
    const manual = updateSliceGridRecipeLayout(
      createDefaultSliceGridRecipeState("asset-sheet", SOURCE),
      { mode: "manual", manual: { rows: 3, cols: 4 } },
      SOURCE,
    );
    const serialized = serializeSliceGridRecipeState(manual);
    expect(hydrateSliceGridRecipeState(JSON.parse(serialized), SOURCE)).toEqual(manual);
    expect(serializeSliceGridRecipeState(hydrateSliceGridRecipeState(JSON.parse(serialized), SOURCE)!))
      .toBe(serialized);

    expect(hydrateSliceGridRecipeState({
      ...manual,
      manual: { rows: 2, cols: 4 },
    }, SOURCE)).toBeNull();

    let getterCalls = 0;
    const hostile = { version: 1, recipe: manual.recipe } as Record<string, unknown>;
    Object.defineProperty(hostile, "manual", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return { rows: 3, cols: 4 };
      },
    });
    expect(hydrateSliceGridRecipeState(hostile, SOURCE)).toBeNull();
    expect(getterCalls).toBe(0);
  });

  it("rejects invalid bounds, extra keys, malformed palettes and oversized identifiers", () => {
    const state = createDefaultSliceGridRecipeState("asset-sheet", SOURCE);
    expect(hydrateSliceGridRecipeState({ ...state, extra: true }, SOURCE)).toBeNull();
    expect(hydrateSliceGridRecipeState({ ...state, manual: { rows: 9, cols: 1 } }, SOURCE)).toBeNull();
    expect(hydrateSliceGridRecipeState({
      ...state,
      recipe: { ...state.recipe, sourceAssetId: "x".repeat(257) },
    }, SOURCE)).toBeNull();
    expect(hydrateSliceGridRecipeState({
      ...state,
      recipe: { ...state.recipe, pixel: { ...state.recipe.pixel, palette: ["#bad"] } },
    }, SOURCE)).toBeNull();
  });

  it("updates only canonical crop settings and keeps the recipe round-trippable", () => {
    const initial = createDefaultSliceGridRecipeState("asset-sheet", SOURCE);
    const cropped = updateSliceGridRecipeCrop(initial, { threshold: 37, padding: 9 });

    expect(cropped.recipe.crop).toEqual({ threshold: 37, padding: 9 });
    expect(cropped.recipe.layout).toBe(initial.recipe.layout);
    expect(cropped.recipe.chroma).toBe(initial.recipe.chroma);
    expect(cropped.recipe.pixel).toBe(initial.recipe.pixel);
    expect(cropped.manual).toBe(initial.manual);
    expect(Object.isFrozen(cropped.recipe.crop)).toBe(true);
    expect(hydrateSliceGridRecipeState(JSON.parse(serializeSliceGridRecipeState(cropped)), SOURCE))
      .toEqual(cropped);
    expect(() => updateSliceGridRecipeCrop(initial, { threshold: Number.NaN, padding: 0 }))
      .toThrow(TypeError);
    expect(() => updateSliceGridRecipeCrop(initial, { threshold: 1, padding: 1.5 }))
      .toThrow(TypeError);
  });

  it("updates chroma settings canonically, normalizes hex and rejects invalid values", () => {
    const initial = createDefaultSliceGridRecipeState("asset-sheet", SOURCE);
    const chroma = updateSliceGridRecipeChroma(initial, {
      enabled: true,
      color: "#12AbEf",
      tolerance: 35,
      smoothness: 20,
      spill: 15,
    });

    expect(chroma.recipe.chroma).toEqual({
      enabled: true,
      color: "#12abef",
      tolerance: 35,
      smoothness: 20,
      spill: 15,
    });
    expect(chroma.recipe.layout).toBe(initial.recipe.layout);
    expect(chroma.recipe.crop).toBe(initial.recipe.crop);
    expect(Object.isFrozen(chroma.recipe.chroma)).toBe(true);
    expect(() => updateSliceGridRecipeChroma(initial, {
      ...initial.recipe.chroma,
      color: "#bad",
    })).toThrow(TypeError);
    expect(() => updateSliceGridRecipeChroma(initial, {
      ...initial.recipe.chroma,
      tolerance: Number.NaN,
    })).toThrow(TypeError);
  });

  it("updates pixel stage and fixed palette canonically with strict boundaries", () => {
    const initial = createDefaultSliceGridRecipeState("asset-sheet", SOURCE);
    const pixel = updateSliceGridRecipePixel(initial, {
      enabled: true,
      size: 64,
      quantize: false,
      colors: 8,
      palette: ["#FF0000", "#0000FF"],
    });

    expect(pixel.recipe.pixel).toEqual({
      enabled: true,
      size: 64,
      quantize: false,
      colors: 8,
      palette: ["#ff0000", "#0000ff"],
    });
    expect(Object.isFrozen(pixel.recipe.pixel)).toBe(true);
    expect(Object.isFrozen(pixel.recipe.pixel.palette)).toBe(true);
    expect(pixel.recipe.crop).toBe(initial.recipe.crop);
    expect(pixel.recipe.chroma).toBe(initial.recipe.chroma);
    expect(hydrateSliceGridRecipeState(JSON.parse(serializeSliceGridRecipeState(pixel)), SOURCE))
      .toEqual(pixel);
    expect(() => updateSliceGridRecipePixel(initial, {
      ...initial.recipe.pixel,
      size: 4097,
    })).toThrow(TypeError);
    expect(() => updateSliceGridRecipePixel(initial, {
      ...initial.recipe.pixel,
      palette: ["#bad"],
    })).toThrow(TypeError);
  });
});
