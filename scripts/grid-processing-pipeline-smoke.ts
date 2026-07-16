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
    pixels[offset] = 255;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 0;
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
    tolerance: 0,
    smoothness: 0,
    spill: 0,
  });
  return updateSliceGridRecipePixel(keyed, {
    enabled: true,
    size: 2,
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

const fullRequest = requestFor("grid-pipeline-full", hydrated.recipe);
const fullSourceBuffer = fullRequest.source.pixels;
const fullResult = await createGridProcessingClient().process({ request: fullRequest });
const repeatResult = await createGridProcessingClient().process({
  request: requestFor("grid-pipeline-repeat", hydrated.recipe),
});
const resetRequest = requestFor("grid-pipeline-reset", resetHydrated.recipe);
const resetResult = await createGridProcessingClient().process({ request: resetRequest });

const first = fullResult.outputs[0]!;
const repeated = repeatResult.outputs[0]!;
const reset = resetResult.outputs[0]!;
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
    operations: first.operations,
    expectedOperations: FULL_OPERATIONS,
    pixels: firstPixels,
    sourceDetached: fullSourceBuffer.byteLength === 0,
  },
  repeat: {
    operations: repeated.operations,
    pixelsIdentical: JSON.stringify(repeatedPixels) === JSON.stringify(firstPixels),
    operationsIdentical: JSON.stringify(repeated.operations) === JSON.stringify(first.operations),
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
  },
};

if (
  evidence.full.outputCount !== 1 ||
  JSON.stringify(evidence.full.operations) !== JSON.stringify(FULL_OPERATIONS) ||
  JSON.stringify(evidence.repeat.operations) !== JSON.stringify(FULL_OPERATIONS) ||
  !evidence.repeat.pixelsIdentical || !evidence.repeat.operationsIdentical ||
  !evidence.full.sourceDetached ||
  JSON.stringify(evidence.reset.operations) !== JSON.stringify(RESET_OPERATIONS) ||
  evidence.reset.enabled || evidence.reset.size !== 16 || evidence.reset.quantize ||
  evidence.reset.colors !== 16 || evidence.reset.hasPalette
) {
  evidence.status = "fail";
  throw new Error(`Grid pipeline round-trip gate failed: ${JSON.stringify(evidence)}`);
}

process.stdout.write(`${JSON.stringify(evidence)}\n`);
