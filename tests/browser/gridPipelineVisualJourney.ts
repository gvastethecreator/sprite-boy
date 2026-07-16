import { GRID_PROCESSING_PROTOCOL_VERSION, type GridProcessingProcessRequestV1 } from "../../core/processing/gridProcessingProtocol";
import { createGridProcessingClient } from "../../features/slice/processing/gridProcessingClient";
import {
  createDefaultSliceGridRecipeState,
  hydrateSliceGridRecipeState,
  serializeSliceGridRecipeState,
  updateSliceGridRecipeChroma,
  updateSliceGridRecipeCrop,
  updateSliceGridRecipeLayout,
  updateSliceGridRecipePixel,
} from "../../features/slice/grid/gridRecipeState";

declare global {
  var __spriteBoyG505: Promise<unknown> | undefined;
}

const SOURCE = { width: 4, height: 4 } as const;
const FULL_OPERATIONS = ["chroma", "crop", "resize", "quantize"] as const;

function sourcePixels(): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(SOURCE.width * SOURCE.height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = 0;
    pixels[offset + 1] = 255;
    pixels[offset + 2] = 0;
    pixels[offset + 3] = 255;
  }
  for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]] as const) {
    const offset = (y * SOURCE.width + x) * 4;
    pixels[offset] = 220;
    pixels[offset + 1] = 20;
    pixels[offset + 2] = 30;
  }
  return pixels;
}

function createRecipe() {
  const initial = createDefaultSliceGridRecipeState("asset-pipeline-browser", SOURCE);
  const layout = updateSliceGridRecipeLayout(initial, { mode: "manual", manual: { rows: 1, cols: 1 } }, SOURCE);
  const crop = updateSliceGridRecipeCrop(layout, { threshold: 1, padding: 0 });
  const chroma = updateSliceGridRecipeChroma(crop, {
    enabled: true, color: "#00ff00", tolerance: 5, smoothness: 0, spill: 0,
  });
  return updateSliceGridRecipePixel(chroma, {
    enabled: true, size: 4, quantize: false, colors: 2, palette: ["#ff0000", "#000000"],
  });
}

function resetRecipe(state: ReturnType<typeof createRecipe>) {
  return updateSliceGridRecipePixel(state, { enabled: false, size: 16, quantize: false, colors: 16 });
}

function request(requestId: string, recipe: ReturnType<typeof createRecipe>["recipe"]): GridProcessingProcessRequestV1 {
  return {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "process",
    requestId,
    source: { ...SOURCE, format: "rgba8", colorSpace: "srgb", pixels: sourcePixels().buffer as ArrayBuffer },
    recipe,
  };
}

function draw(id: string, pixels: ArrayBuffer, width: number, height: number): void {
  const canvas = document.querySelector<HTMLCanvasElement>(`#${id}`);
  if (!canvas) throw new Error(`Missing ${id} canvas.`);
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error(`Missing ${id} context.`);
  context.imageSmoothingEnabled = false;
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
}

async function run() {
  const recipeState = createRecipe();
  const serialized = serializeSliceGridRecipeState(recipeState);
  const hydrated = hydrateSliceGridRecipeState(JSON.parse(serialized), SOURCE);
  if (!hydrated || serializeSliceGridRecipeState(hydrated) !== serialized) throw new Error("Recipe round-trip failed.");
  const reset = resetRecipe(hydrated);
  const baseline = await createGridProcessingClient().process({ request: request("g505-browser-baseline", {
    ...hydrated.recipe, crop: { threshold: 0, padding: 0 }, chroma: { ...hydrated.recipe.chroma, enabled: false }, pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
  }) });
  const chroma = await createGridProcessingClient().process({ request: request("g505-browser-chroma", {
    ...hydrated.recipe, crop: { threshold: 0, padding: 0 }, pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
  }) });
  const crop = await createGridProcessingClient().process({ request: request("g505-browser-crop", reset.recipe) });
  const full = await createGridProcessingClient().process({ request: request("g505-browser-full", hydrated.recipe) });
  const repeat = await createGridProcessingClient().process({ request: request("g505-browser-repeat", hydrated.recipe) });
  const source = sourcePixels().buffer as ArrayBuffer;
  const fullOutput = full.outputs[0]!;
  const cropOutput = crop.outputs[0]!;
  const baselinePixels = [...new Uint8ClampedArray(baseline.outputs[0]!.surface.pixels)];
  const chromaPixels = [...new Uint8ClampedArray(chroma.outputs[0]!.surface.pixels)];
  const cropPixels = [...new Uint8ClampedArray(cropOutput.surface.pixels)];
  const fullPixels = [...new Uint8ClampedArray(fullOutput.surface.pixels)];
  draw("source", source, SOURCE.width, SOURCE.height);
  draw("chroma", chroma.outputs[0]!.surface.pixels, chroma.outputs[0]!.surface.width, chroma.outputs[0]!.surface.height);
  draw("crop", cropOutput.surface.pixels, cropOutput.surface.width, cropOutput.surface.height);
  draw("full", fullOutput.surface.pixels, fullOutput.surface.width, fullOutput.surface.height);
  const stageEffects = {
    chromaChangedPixels: JSON.stringify(chromaPixels) !== JSON.stringify(baselinePixels),
    cropChangedBounds: JSON.stringify(chroma.outputs[0]!.contentBounds) !== JSON.stringify(cropOutput.contentBounds),
    quantizeChangedPixels: JSON.stringify(fullPixels) !== JSON.stringify(cropPixels),
  };
  const repeatPixels = [...new Uint8ClampedArray(repeat.outputs[0]!.surface.pixels)];
  if (!Object.values(stageEffects).every(Boolean) || JSON.stringify(fullOutput.operations) !== JSON.stringify(FULL_OPERATIONS) ||
    JSON.stringify(repeatPixels) !== JSON.stringify(fullPixels)) throw new Error("Browser pipeline visual gate failed.");
  document.querySelector("#recipe")!.textContent = "stable";
  document.querySelector("#repeat")!.textContent = "identical";
  document.querySelector("#reset")!.textContent = `${reset.recipe.pixel.size}px / off`;
  return { status: "pass", stageEffects, operations: fullOutput.operations, fullDimensions: [fullOutput.surface.width, fullOutput.surface.height], cropDimensions: [cropOutput.surface.width, cropOutput.surface.height], resetEnabled: reset.recipe.pixel.enabled };
}

globalThis.__spriteBoyG505 = run();
