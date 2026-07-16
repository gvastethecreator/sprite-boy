import {
  GRID_PROCESSING_PROTOCOL_VERSION,
  type GridProcessingProcessRequestV1,
} from "../core/processing/gridProcessingProtocol";
import {
  createGridProcessingClient,
} from "../features/slice/processing/gridProcessingClient";
import {
  createDefaultSliceGridRecipeState,
  hydrateSliceGridRecipeState,
  serializeSliceGridRecipeState,
  updateSliceGridRecipeChroma,
  updateSliceGridRecipeCrop,
  updateSliceGridRecipeLayout,
  updateSliceGridRecipePixel,
} from "../features/slice/grid/gridRecipeState";

const SOURCE = Object.freeze({ width: 4, height: 4 });
const FULL_OPERATIONS = ["chroma", "crop", "resize", "quantize"] as const;
const RESET_OPERATIONS = ["chroma", "crop"] as const;

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
    pixels[offset + 3] = 255;
  }
  return pixels;
}

function createRecipeState() {
  const initial = createDefaultSliceGridRecipeState("asset-pipeline-smoke", SOURCE);
  const manual = updateSliceGridRecipeLayout(initial, {
    mode: "manual",
    manual: { rows: 1, cols: 1 },
  }, SOURCE);
  const cropped = updateSliceGridRecipeCrop(manual, { threshold: 1, padding: 0 });
  const keyed = updateSliceGridRecipeChroma(cropped, {
    enabled: true,
    color: "#00FF00",
    tolerance: 5,
    smoothness: 0,
    spill: 0,
  });
  return updateSliceGridRecipePixel(keyed, {
    enabled: true,
    size: 4,
    quantize: false,
    colors: 2,
    palette: ["#FF0000", "#000000"],
  });
}

function resetPixelState(state: ReturnType<typeof createRecipeState>) {
  return updateSliceGridRecipePixel(state, {
    enabled: false,
    size: 16,
    quantize: false,
    colors: 16,
  });
}

function requestFor(requestId: string, recipe: ReturnType<typeof createRecipeState>["recipe"]): GridProcessingProcessRequestV1 {
  const pixels = sourcePixels();
  return {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "process",
    requestId,
    source: {
      width: SOURCE.width,
      height: SOURCE.height,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: pixels.buffer as ArrayBuffer,
    },
    recipe,
  };
}

const fullState = createRecipeState();
const serialized = serializeSliceGridRecipeState(fullState);
const hydrated = hydrateSliceGridRecipeState(JSON.parse(serialized), SOURCE);
if (!hydrated || serializeSliceGridRecipeState(hydrated) !== serialized) {
  throw new Error("Canonical recipe did not round-trip byte-for-byte.");
}

const resetState = resetPixelState(hydrated);
const resetSerialized = serializeSliceGridRecipeState(resetState);
const resetHydrated = hydrateSliceGridRecipeState(JSON.parse(resetSerialized), SOURCE);
if (!resetHydrated || resetHydrated.recipe.pixel.enabled ||
  resetHydrated.recipe.pixel.size !== 16 || resetHydrated.recipe.pixel.quantize ||
  resetHydrated.recipe.pixel.colors !== 16 || "palette" in resetHydrated.recipe.pixel) {
  throw new Error("Pixel reset retained stale canonical state.");
}

const baselineRecipe = {
  ...hydrated.recipe,
  crop: { threshold: 0, padding: 0 },
  chroma: { ...hydrated.recipe.chroma, enabled: false },
  pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
};
const chromaRecipe = {
  ...baselineRecipe,
  chroma: hydrated.recipe.chroma,
};
const resizeOnlyRecipe = {
  ...hydrated.recipe,
  pixel: { enabled: true, size: 4, quantize: false, colors: 2 },
};

const baselineRequest = requestFor("grid-pipeline-baseline", baselineRecipe);
const baselineResult = await createGridProcessingClient().process({ request: baselineRequest });
const chromaRequest = requestFor("grid-pipeline-chroma", chromaRecipe);
const chromaResult = await createGridProcessingClient().process({ request: chromaRequest });
const fullRequest = requestFor("grid-pipeline-full", hydrated.recipe);
const fullSourceBuffer = fullRequest.source.pixels;
const fullResult = await createGridProcessingClient().process({ request: fullRequest });
const repeatResult = await createGridProcessingClient().process({
  request: requestFor("grid-pipeline-repeat", hydrated.recipe),
});
const cropResult = await createGridProcessingClient().process({
  request: requestFor("grid-pipeline-crop", resetHydrated.recipe),
});
const resizeOnlyResult = await createGridProcessingClient().process({
  request: requestFor("grid-pipeline-resize-only", resizeOnlyRecipe),
});
const resetRequest = requestFor("grid-pipeline-reset", resetHydrated.recipe);
const resetResult = await createGridProcessingClient().process({ request: resetRequest });

const first = fullResult.outputs[0]!;
const repeated = repeatResult.outputs[0]!;
const crop = cropResult.outputs[0]!;
const reset = resetResult.outputs[0]!;
const baseline = baselineResult.outputs[0]!;
const chroma = chromaResult.outputs[0]!;
const baselinePixels = [...new Uint8ClampedArray(baseline.surface.pixels)];
const chromaPixels = [...new Uint8ClampedArray(chroma.surface.pixels)];
const cropPixels = [...new Uint8ClampedArray(crop.surface.pixels)];
const resetPixels = [...new Uint8ClampedArray(reset.surface.pixels)];
const resizeOnly = resizeOnlyResult.outputs[0]!;
const resizeOnlyPixels = [...new Uint8ClampedArray(resizeOnly.surface.pixels)];
const firstPixels = [...new Uint8ClampedArray(first.surface.pixels)];
const repeatedPixels = [...new Uint8ClampedArray(repeated.surface.pixels)];
const evidence = {
  schemaVersion: 1,
  status: "pass",
  check: "grid-processing-pipeline-roundtrip",
  recipe: {
    serializedStable: true,
    sourceAssetId: hydrated.recipe.sourceAssetId,
    layout: hydrated.recipe.layout,
    crop: hydrated.recipe.crop,
    chroma: hydrated.recipe.chroma,
    pixel: hydrated.recipe.pixel,
  },
  full: {
    outputCount: fullResult.outputs.length,
    dimensions: [first.surface.width, first.surface.height],
    contentBounds: first.contentBounds,
    operations: first.operations,
    expectedOperations: FULL_OPERATIONS,
    pixels: firstPixels,
    sourceDetached: fullSourceBuffer.byteLength === 0,
  },
  stageEffects: {
    chromaChangedPixels: JSON.stringify(chromaPixels) !== JSON.stringify(baselinePixels),
    cropChangedBounds: JSON.stringify(chroma.contentBounds) !== JSON.stringify(crop.contentBounds),
    quantizeChangedPixels: JSON.stringify(firstPixels) !== JSON.stringify(resizeOnlyPixels),
  },
  repeat: {
    operations: repeated.operations,
    pixelsIdentical: JSON.stringify(repeatedPixels) === JSON.stringify(firstPixels),
    operationsIdentical: JSON.stringify(repeated.operations) === JSON.stringify(first.operations),
  },
  resizeOnly: {
    dimensions: [resizeOnly.surface.width, resizeOnly.surface.height],
    operations: resizeOnly.operations,
    pixels: resizeOnlyPixels,
  },
  reset: {
    enabled: resetHydrated.recipe.pixel.enabled,
    size: resetHydrated.recipe.pixel.size,
    quantize: resetHydrated.recipe.pixel.quantize,
    colors: resetHydrated.recipe.pixel.colors,
    hasPalette: "palette" in resetHydrated.recipe.pixel,
    operations: reset.operations,
    expectedOperations: RESET_OPERATIONS,
    dimensions: [reset.surface.width, reset.surface.height],
    contentBounds: reset.contentBounds,
    pixels: resetPixels,
    pixelsIdenticalToCrop: JSON.stringify(resetPixels) === JSON.stringify(cropPixels),
  },
};

if (
  evidence.full.outputCount !== 1 ||
  JSON.stringify(evidence.full.operations) !== JSON.stringify(FULL_OPERATIONS) ||
  JSON.stringify(evidence.repeat.operations) !== JSON.stringify(FULL_OPERATIONS) ||
  !evidence.repeat.pixelsIdentical || !evidence.repeat.operationsIdentical ||
  !evidence.full.sourceDetached ||
  !evidence.stageEffects.chromaChangedPixels ||
  !evidence.stageEffects.cropChangedBounds ||
  !evidence.stageEffects.quantizeChangedPixels ||
  JSON.stringify(evidence.reset.operations) !== JSON.stringify(RESET_OPERATIONS) ||
  evidence.reset.enabled || evidence.reset.size !== 16 || evidence.reset.quantize ||
  evidence.reset.colors !== 16 || evidence.reset.hasPalette || !evidence.reset.pixelsIdenticalToCrop
) {
  evidence.status = "fail";
  throw new Error(`Grid pipeline round-trip gate failed: ${JSON.stringify(evidence)}`);
}

process.stdout.write(`${JSON.stringify(evidence)}\n`);
