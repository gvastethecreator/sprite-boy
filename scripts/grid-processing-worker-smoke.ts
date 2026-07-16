import {
  GRID_PROCESSING_PROTOCOL_VERSION,
  type GridProcessingProcessRequestV1,
} from "../core/processing/gridProcessingProtocol";
import { createGridProcessingClient } from "../features/slice/processing/gridProcessingClient";

const request: GridProcessingProcessRequestV1 = {
  version: GRID_PROCESSING_PROTOCOL_VERSION,
  type: "process",
  requestId: "grid-real-worker-smoke",
  source: {
    width: 4,
    height: 2,
    format: "rgba8",
    colorSpace: "srgb",
    pixels: new Uint8ClampedArray([
      255, 0, 0, 255,
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 255, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 255, 0, 255,
    ]).buffer,
  },
  recipe: {
    kind: "grid-split",
    version: 1,
    sourceAssetId: "asset-real-worker-smoke",
    layout: { mode: "manual", rows: 1, cols: 2 },
    crop: { threshold: 1, padding: 0 },
    chroma: { enabled: true, color: "#00ff00", tolerance: 10, smoothness: 10, spill: 10 },
    pixel: { enabled: true, size: 2, quantize: true, colors: 2 },
  },
};
const sourceBuffer = request.source.pixels;
const progressStages: string[] = [];
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort("Real grid worker smoke timed out."), 20_000);
const result = await createGridProcessingClient().process({
  request,
  signal: controller.signal,
  onProgress: (progress) => progressStages.push(progress.stage),
}).finally(() => clearTimeout(timeout));
const alphaCropResult = await createGridProcessingClient().process({
  request: {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "process",
    requestId: "grid-real-worker-alpha-crop",
    source: {
      width: 4,
      height: 1,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: new Uint8ClampedArray([
        7, 8, 9, 1,
        7, 8, 9, 127,
        7, 8, 9, 128,
        7, 8, 9, 255,
      ]).buffer,
    },
    recipe: {
      kind: "grid-split",
      version: 1,
      sourceAssetId: "asset-real-worker-alpha-crop",
      layout: { mode: "manual", rows: 1, cols: 1 },
      crop: { threshold: 50, padding: 0 },
      chroma: { enabled: false, color: "#00ff00", tolerance: 0, smoothness: 0, spill: 0 },
      pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
    },
  },
});
const alphaOutput = alphaCropResult.outputs[0]!;
const edgePixels = new Uint8ClampedArray(7 * 5 * 4);
const setEdgePixel = (x: number, y: number, rgba: readonly number[]): void => {
  edgePixels.set(rgba, (y * 7 + x) * 4);
};
setEdgePixel(2, 0, [10, 20, 30, 127]);
setEdgePixel(3, 1, [40, 50, 60, 128]);
setEdgePixel(6, 0, [70, 80, 90, 255]);
for (let y = 2; y < 5; y += 1) {
  for (let x = 0; x < 2; x += 1) setEdgePixel(x, y, [100, 110, 120, 255]);
}
setEdgePixel(5, 3, [130, 140, 150, 255]);
const edgeRecipe = {
  kind: "grid-split",
  version: 1,
  sourceAssetId: "asset-real-worker-reduction-edge",
  layout: { mode: "manual", rows: 2, cols: 3 },
  crop: { threshold: 50, padding: 1 },
  chroma: { enabled: false, color: "#00ff00", tolerance: 0, smoothness: 0, spill: 0 },
  pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
} as const;
const edgeRecipeBefore = structuredClone(edgeRecipe);
const edgeResult = await createGridProcessingClient().process({
  request: {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "process",
    requestId: "grid-real-worker-reduction-edge",
    source: {
      width: 7,
      height: 5,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: edgePixels.buffer,
    },
    recipe: edgeRecipe,
  },
});
const allEmptyResult = await createGridProcessingClient().process({
  request: {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "process",
    requestId: "grid-real-worker-all-empty",
    source: {
      width: 3,
      height: 2,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: new Uint8ClampedArray(3 * 2 * 4).buffer,
    },
    recipe: {
      ...edgeRecipe,
      sourceAssetId: "asset-real-worker-all-empty",
      layout: { mode: "manual", rows: 2, cols: 3 },
      crop: { threshold: 1, padding: 16_384 },
    },
  },
});
const cropDisabledTransparentResult = await createGridProcessingClient().process({
  request: {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "process",
    requestId: "grid-real-worker-transparent-crop-disabled",
    source: {
      width: 2,
      height: 2,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: new Uint8ClampedArray(2 * 2 * 4).buffer,
    },
    recipe: {
      ...edgeRecipe,
      sourceAssetId: "asset-real-worker-transparent-crop-disabled",
      layout: { mode: "manual", rows: 1, cols: 1 },
      crop: { threshold: 0, padding: 16_384 },
    },
  },
});
const maxEmptyResult = await createGridProcessingClient().process({
  request: {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "process",
    requestId: "grid-real-worker-max-empty",
    source: {
      width: 4_096,
      height: 1,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: new Uint8ClampedArray(4_096 * 4).buffer,
    },
    recipe: {
      ...edgeRecipe,
      sourceAssetId: "asset-real-worker-max-empty",
      layout: { mode: "manual", rows: 1, cols: 4_096 },
      crop: { threshold: 1, padding: 0 },
    },
  },
});
const evidence = Object.freeze({
  outputCount: result.outputs.length,
  progressStages: Object.freeze(progressStages),
  sourceDetached: sourceBuffer.byteLength === 0,
  outputPixels: Object.freeze(result.outputs.map((output) =>
    Object.freeze([...new Uint8ClampedArray(output.surface.pixels)]))),
  alphaCrop: Object.freeze({
    contentBounds: alphaOutput.contentBounds,
    dimensions: Object.freeze({ width: alphaOutput.surface.width, height: alphaOutput.surface.height }),
    operations: alphaOutput.operations,
    pixels: Object.freeze([...new Uint8ClampedArray(alphaOutput.surface.pixels)]),
  }),
  reductionEdge: Object.freeze({
    recipeUnchanged: JSON.stringify(edgeRecipe) === JSON.stringify(edgeRecipeBefore),
    outputCount: edgeResult.outputs.length,
    indexes: Object.freeze(edgeResult.outputs.map(({ index, row, column }) => `${index}:${row}:${column}`)),
    contentBounds: Object.freeze(edgeResult.outputs.map((output) => output.contentBounds)),
    dimensions: Object.freeze(edgeResult.outputs.map((output) => [output.surface.width, output.surface.height])),
    reductions: Object.freeze(edgeResult.outputs.map((output) => output.cropReductionRatio)),
    warnings: Object.freeze(edgeResult.outputs.map((output) => output.warnings)),
    outputPixelCount: edgeResult.summary.outputPixelCount,
    summaryReduction: edgeResult.summary.cropReductionRatio,
  }),
  allEmpty: Object.freeze({
    outputCount: allEmptyResult.outputs.length,
    indexes: Object.freeze(allEmptyResult.outputs.map(({ index, row, column }) => `${index}:${row}:${column}`)),
    dimensions: Object.freeze(allEmptyResult.outputs.map((output) => [output.surface.width, output.surface.height])),
    reductions: Object.freeze(allEmptyResult.outputs.map((output) => output.cropReductionRatio)),
    warnings: Object.freeze(allEmptyResult.outputs.map((output) => output.warnings)),
    summary: allEmptyResult.summary,
  }),
  cropDisabledTransparent: Object.freeze({
    contentBounds: cropDisabledTransparentResult.outputs[0]?.contentBounds,
    dimensions: [
      cropDisabledTransparentResult.outputs[0]?.surface.width,
      cropDisabledTransparentResult.outputs[0]?.surface.height,
    ],
    reduction: cropDisabledTransparentResult.outputs[0]?.cropReductionRatio,
    operations: cropDisabledTransparentResult.outputs[0]?.operations,
    warnings: cropDisabledTransparentResult.outputs[0]?.warnings,
    summary: cropDisabledTransparentResult.summary,
  }),
  maxEmpty: Object.freeze({
    outputCount: maxEmptyResult.outputs.length,
    first: maxEmptyResult.outputs[0] && {
      index: maxEmptyResult.outputs[0].index,
      row: maxEmptyResult.outputs[0].row,
      column: maxEmptyResult.outputs[0].column,
    },
    last: maxEmptyResult.outputs.at(-1) && {
      index: maxEmptyResult.outputs.at(-1)!.index,
      row: maxEmptyResult.outputs.at(-1)!.row,
      column: maxEmptyResult.outputs.at(-1)!.column,
    },
    exactPolicy: maxEmptyResult.outputs.every((output) =>
      output.contentBounds === null &&
      output.surface.width === 1 &&
      output.surface.height === 1 &&
      output.cropReductionRatio === 1 &&
      output.warnings.join(",") === "empty-output"),
    summary: maxEmptyResult.summary,
  }),
});
if (
  evidence.outputCount !== 2 ||
  !evidence.sourceDetached ||
  evidence.progressStages.join(",") !==
    "decode,detect,chroma,chroma,crop,crop,resize,resize,quantize,quantize,finalize" ||
  JSON.stringify(evidence.outputPixels) !== JSON.stringify([
    [
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
    ],
    [0, 0, 0, 0],
  ]) ||
  JSON.stringify(evidence.alphaCrop) !== JSON.stringify({
    contentBounds: { x: 2, y: 0, width: 2, height: 1 },
    dimensions: { width: 2, height: 1 },
    operations: ["crop"],
    pixels: [7, 8, 9, 128, 7, 8, 9, 255],
  }) ||
  JSON.stringify(evidence.reductionEdge) !== JSON.stringify({
    recipeUnchanged: true,
    outputCount: 6,
    indexes: ["0:0:0", "1:0:1", "2:0:2", "3:1:0", "4:1:1", "5:1:2"],
    contentBounds: [
      null,
      { x: 2, y: 0, width: 2, height: 2 },
      { x: 5, y: 0, width: 2, height: 2 },
      { x: 0, y: 2, width: 2, height: 3 },
      null,
      { x: 4, y: 2, width: 3, height: 3 },
    ],
    dimensions: [[1, 1], [2, 2], [2, 2], [2, 3], [1, 1], [3, 3]],
    reductions: [1, 0, 1 / 3, 0, 1, 0],
    warnings: [["empty-output"], [], [], [], ["empty-output"], []],
    outputPixelCount: 25,
    summaryReduction: 12 / 35,
  }) ||
  JSON.stringify(evidence.allEmpty) !== JSON.stringify({
    outputCount: 6,
    indexes: ["0:0:0", "1:0:1", "2:0:2", "3:1:0", "4:1:1", "5:1:2"],
    dimensions: [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1]],
    reductions: [1, 1, 1, 1, 1, 1],
    warnings: [
      ["empty-output"], ["empty-output"], ["empty-output"],
      ["empty-output"], ["empty-output"], ["empty-output"],
    ],
    summary: {
      outputCount: 6,
      outputPixelCount: 6,
      cropReductionRatio: 1,
      warnings: ["empty-output"],
    },
  }) ||
  JSON.stringify(evidence.cropDisabledTransparent) !== JSON.stringify({
    contentBounds: { x: 0, y: 0, width: 2, height: 2 },
    dimensions: [2, 2],
    reduction: 0,
    operations: [],
    warnings: [],
    summary: {
      outputCount: 1,
      outputPixelCount: 4,
      cropReductionRatio: 0,
      warnings: [],
    },
  }) ||
  JSON.stringify(evidence.maxEmpty) !== JSON.stringify({
    outputCount: 4_096,
    first: { index: 0, row: 0, column: 0 },
    last: { index: 4_095, row: 0, column: 4_095 },
    exactPolicy: true,
    summary: {
      outputCount: 4_096,
      outputPixelCount: 4_096,
      cropReductionRatio: 1,
      warnings: ["empty-output"],
    },
  })
) {
  throw new Error("Real grid worker smoke assertions failed.");
}

process.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: "pass", ...evidence })}\n`);
