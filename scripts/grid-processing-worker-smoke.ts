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
const resizeSource = [
  255, 0, 0, 255,
  0, 255, 0, 192,
  0, 0, 255, 64,
  255, 255, 0, 0,
] as const;
const processResizeFixture = (enabled: boolean, requestId: string) => createGridProcessingClient().process({
  request: {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "process",
    requestId,
    source: {
      width: 2,
      height: 2,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: new Uint8ClampedArray(resizeSource).buffer,
    },
    recipe: {
      kind: "grid-split",
      version: 1,
      sourceAssetId: `asset-${requestId}`,
      layout: { mode: "manual", rows: 1, cols: 1 },
      crop: { threshold: 0, padding: 0 },
      chroma: { enabled: false, color: "#00ff00", tolerance: 0, smoothness: 0, spill: 0 },
      pixel: { enabled, size: 4, quantize: false, colors: 16 },
    },
  },
});
const resizeEnabledResult = await processResizeFixture(true, "grid-real-worker-resize-enabled");
const resizeDisabledResult = await processResizeFixture(false, "grid-real-worker-resize-disabled");
const quantizeAutoSource = [
  250, 20, 20, 255,
  240, 30, 30, 255,
  20, 30, 240, 255,
  30, 20, 230, 255,
  10, 200, 10, 127,
  9, 9, 9, 0,
] as const;
const quantizeFixedSource = [
  240, 20, 20, 255,
  10, 20, 240, 255,
  250, 10, 10, 127,
  0, 255, 0, 0,
] as const;
const processQuantizeFixture = (
  source: readonly number[],
  requestId: string,
  options: { readonly size: number; readonly quantize: boolean; readonly colors: number; readonly palette?: readonly string[] },
) => createGridProcessingClient().process({
  request: {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "process",
    requestId,
    source: {
      width: source.length / 4,
      height: 1,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: new Uint8ClampedArray(source).buffer,
    },
    recipe: {
      kind: "grid-split",
      version: 1,
      sourceAssetId: `asset-${requestId}`,
      layout: { mode: "manual", rows: 1, cols: 1 },
      crop: { threshold: 0, padding: 0 },
      chroma: { enabled: false, color: "#00ff00", tolerance: 0, smoothness: 0, spill: 0 },
      pixel: {
        enabled: true,
        size: options.size,
        quantize: options.quantize,
        colors: options.colors,
        ...(options.palette ? { palette: [...options.palette] } : {}),
      },
    },
  },
});
const quantizeAutoResult = await processQuantizeFixture(
  quantizeAutoSource,
  "grid-real-worker-quantize-auto",
  { size: 6, quantize: true, colors: 2 },
);
const quantizeAutoRepeat = await processQuantizeFixture(
  quantizeAutoSource,
  "grid-real-worker-quantize-auto-repeat",
  { size: 6, quantize: true, colors: 2 },
);
const quantizeFixedResult = await processQuantizeFixture(
  quantizeFixedSource,
  "grid-real-worker-quantize-fixed",
  { size: 4, quantize: false, colors: 2, palette: ["#ff0000", "#0000ff"] },
);
const quantizeFixedRepeat = await processQuantizeFixture(
  quantizeFixedSource,
  "grid-real-worker-quantize-fixed-repeat",
  { size: 4, quantize: false, colors: 2, palette: ["#ff0000", "#0000ff"] },
);
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
const chromaSource = [
  0, 255, 0, 255,
  10, 250, 10, 200,
  0, 200, 0, 255,
  255, 0, 0, 127,
  210, 150, 120, 255,
  0, 255, 0, 0,
] as const;
const processChromaFixture = (enabled: boolean, requestId: string) =>
  createGridProcessingClient().process({
    request: {
      version: GRID_PROCESSING_PROTOCOL_VERSION,
      type: "process",
      requestId,
      source: {
        width: 6,
        height: 1,
        format: "rgba8",
        colorSpace: "srgb",
        pixels: new Uint8ClampedArray(chromaSource).buffer,
      },
      recipe: {
        kind: "grid-split",
        version: 1,
        sourceAssetId: `asset-${requestId}`,
        layout: { mode: "manual", rows: 1, cols: 1 },
        crop: { threshold: 0, padding: 0 },
        chroma: { enabled, color: "#00ff00", tolerance: 10, smoothness: 20, spill: 100 },
        pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
      },
    },
  });
const chromaEnabledResult = await processChromaFixture(true, "grid-real-worker-chroma-enabled");
const chromaDisabledResult = await processChromaFixture(false, "grid-real-worker-chroma-disabled");
const chromaOrderSource = [
  0, 255, 0, 255,
  220, 20, 30, 255,
  0, 255, 0, 255,
  30, 80, 220, 255,
] as const;
const processChromaCropFixture = (requestId: string) => createGridProcessingClient().process({
  request: {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "process",
    requestId,
    source: {
      width: 4,
      height: 1,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: new Uint8ClampedArray(chromaOrderSource).buffer,
    },
    recipe: {
      kind: "grid-split",
      version: 1,
      sourceAssetId: `asset-${requestId}`,
      layout: { mode: "manual", rows: 1, cols: 1 },
      crop: { threshold: 1, padding: 0 },
      chroma: { enabled: true, color: "#00ff00", tolerance: 1, smoothness: 0, spill: 0 },
      pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
    },
  },
});
const chromaOrderResult = await processChromaCropFixture("grid-real-worker-chroma-order");
const chromaOrderRepeat = await processChromaCropFixture("grid-real-worker-chroma-order-repeat");
const processChromaHostileFixture = (pixels: readonly number[], requestId: string, tolerance: number) =>
  createGridProcessingClient().process({
    request: {
      version: GRID_PROCESSING_PROTOCOL_VERSION,
      type: "process",
      requestId,
      source: {
        width: pixels.length / 4,
        height: 1,
        format: "rgba8",
        colorSpace: "srgb",
        pixels: new Uint8ClampedArray(pixels).buffer,
      },
      recipe: {
        kind: "grid-split",
        version: 1,
        sourceAssetId: `asset-${requestId}`,
        layout: { mode: "manual", rows: 1, cols: 1 },
        crop: { threshold: 1, padding: 0 },
        chroma: { enabled: true, color: "#00ff00", tolerance, smoothness: 100, spill: 100 },
        pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
      },
    },
  });
const chromaNoMatchResult = await processChromaHostileFixture([
  220, 20, 30, 255,
  0, 255, 0, 0,
  30, 80, 220, 255,
], "grid-real-worker-chroma-no-match", 0);
const chromaExtremeResult = await processChromaHostileFixture([
  0, 255, 0, 255,
  220, 20, 30, 128,
  0, 255, 0, 0,
], "grid-real-worker-chroma-extreme", 100);
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
  resizeGolden: Object.freeze({
    enabledDimensions: [resizeEnabledResult.outputs[0]!.surface.width, resizeEnabledResult.outputs[0]!.surface.height],
    enabledOperations: resizeEnabledResult.outputs[0]!.operations,
    enabledPixels: Object.freeze([...new Uint8ClampedArray(resizeEnabledResult.outputs[0]!.surface.pixels)]),
    disabledDimensions: [resizeDisabledResult.outputs[0]!.surface.width, resizeDisabledResult.outputs[0]!.surface.height],
    disabledOperations: resizeDisabledResult.outputs[0]!.operations,
    disabledPixels: Object.freeze([...new Uint8ClampedArray(resizeDisabledResult.outputs[0]!.surface.pixels)]),
  }),
  quantizeGolden: Object.freeze({
    autoDimensions: [quantizeAutoResult.outputs[0]!.surface.width, quantizeAutoResult.outputs[0]!.surface.height],
    autoOperations: quantizeAutoResult.outputs[0]!.operations,
    autoWarnings: quantizeAutoResult.outputs[0]!.warnings,
    autoPixels: Object.freeze([...new Uint8ClampedArray(quantizeAutoResult.outputs[0]!.surface.pixels)]),
    autoRepeatPixels: Object.freeze([...new Uint8ClampedArray(quantizeAutoRepeat.outputs[0]!.surface.pixels)]),
    autoRepeatOperations: quantizeAutoRepeat.outputs[0]!.operations,
    fixedOperations: quantizeFixedResult.outputs[0]!.operations,
    fixedWarnings: quantizeFixedResult.outputs[0]!.warnings,
    fixedPixels: Object.freeze([...new Uint8ClampedArray(quantizeFixedResult.outputs[0]!.surface.pixels)]),
    fixedRepeatPixels: Object.freeze([...new Uint8ClampedArray(quantizeFixedRepeat.outputs[0]!.surface.pixels)]),
    fixedRepeatOperations: quantizeFixedRepeat.outputs[0]!.operations,
  }),
  alphaCrop: Object.freeze({
    contentBounds: alphaOutput.contentBounds,
    dimensions: Object.freeze({ width: alphaOutput.surface.width, height: alphaOutput.surface.height }),
    operations: alphaOutput.operations,
    pixels: Object.freeze([...new Uint8ClampedArray(alphaOutput.surface.pixels)]),
  }),
  chromaGolden: Object.freeze({
    enabledPixels: Object.freeze([
      ...new Uint8ClampedArray(chromaEnabledResult.outputs[0]!.surface.pixels),
    ]),
    enabledOperations: chromaEnabledResult.outputs[0]!.operations,
    disabledPixels: Object.freeze([
      ...new Uint8ClampedArray(chromaDisabledResult.outputs[0]!.surface.pixels),
    ]),
    disabledOperations: chromaDisabledResult.outputs[0]!.operations,
  }),
  chromaOrder: Object.freeze({
    operations: chromaOrderResult.outputs[0]!.operations,
    contentBounds: chromaOrderResult.outputs[0]!.contentBounds,
    dimensions: [chromaOrderResult.outputs[0]!.surface.width, chromaOrderResult.outputs[0]!.surface.height],
    pixels: Object.freeze([...new Uint8ClampedArray(chromaOrderResult.outputs[0]!.surface.pixels)]),
    repeatContentBounds: chromaOrderRepeat.outputs[0]!.contentBounds,
    repeatDimensions: [chromaOrderRepeat.outputs[0]!.surface.width, chromaOrderRepeat.outputs[0]!.surface.height],
    repeatPixels: Object.freeze([...new Uint8ClampedArray(chromaOrderRepeat.outputs[0]!.surface.pixels)]),
    repeatOperations: chromaOrderRepeat.outputs[0]!.operations,
  }),
  chromaHostile: Object.freeze({
    noMatch: Object.freeze({
      pixels: Object.freeze([...new Uint8ClampedArray(chromaNoMatchResult.outputs[0]!.surface.pixels)]),
      contentBounds: chromaNoMatchResult.outputs[0]!.contentBounds,
      operations: chromaNoMatchResult.outputs[0]!.operations,
      warnings: chromaNoMatchResult.outputs[0]!.warnings,
    }),
    extreme: Object.freeze({
      pixels: Object.freeze([...new Uint8ClampedArray(chromaExtremeResult.outputs[0]!.surface.pixels)]),
      contentBounds: chromaExtremeResult.outputs[0]!.contentBounds,
      dimensions: [chromaExtremeResult.outputs[0]!.surface.width, chromaExtremeResult.outputs[0]!.surface.height],
      operations: chromaExtremeResult.outputs[0]!.operations,
      warnings: chromaExtremeResult.outputs[0]!.warnings,
    }),
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
  JSON.stringify(evidence.resizeGolden) !== JSON.stringify({
    enabledDimensions: [4, 4],
    enabledOperations: ["resize"],
    enabledPixels: [
      255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 192, 0, 255, 0, 192,
      255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 192, 0, 255, 0, 192,
      0, 0, 255, 64, 0, 0, 255, 64, 255, 255, 0, 0, 255, 255, 0, 0,
      0, 0, 255, 64, 0, 0, 255, 64, 255, 255, 0, 0, 255, 255, 0, 0,
    ],
    disabledDimensions: [2, 2],
    disabledOperations: [],
    disabledPixels: resizeSource,
  }) ||
  JSON.stringify(evidence.quantizeGolden) !== JSON.stringify({
    autoDimensions: [6, 1],
    autoOperations: ["resize", "quantize"],
    autoWarnings: [],
    autoPixels: [
      245, 25, 25, 255,
      245, 25, 25, 255,
      25, 25, 235, 255,
      25, 25, 235, 255,
      10, 200, 10, 127,
      9, 9, 9, 0,
    ],
    autoRepeatPixels: [
      245, 25, 25, 255,
      245, 25, 25, 255,
      25, 25, 235, 255,
      25, 25, 235, 255,
      10, 200, 10, 127,
      9, 9, 9, 0,
    ],
    autoRepeatOperations: ["resize", "quantize"],
    fixedOperations: ["resize", "quantize"],
    fixedWarnings: [],
    fixedPixels: [
      255, 0, 0, 255,
      0, 0, 255, 255,
      250, 10, 10, 127,
      0, 255, 0, 0,
    ],
    fixedRepeatPixels: [
      255, 0, 0, 255,
      0, 0, 255, 255,
      250, 10, 10, 127,
      0, 255, 0, 0,
    ],
    fixedRepeatOperations: ["resize", "quantize"],
  }) ||
  JSON.stringify(evidence.alphaCrop) !== JSON.stringify({
    contentBounds: { x: 2, y: 0, width: 2, height: 1 },
    dimensions: { width: 2, height: 1 },
    operations: ["crop"],
    pixels: [7, 8, 9, 128, 7, 8, 9, 255],
  }) ||
  JSON.stringify(evidence.chromaGolden) !== JSON.stringify({
    enabledPixels: [
      0, 0, 0, 0,
      10, 10, 10, 0,
      0, 55, 0, 70,
      255, 0, 0, 127,
      210, 150, 120, 255,
      0, 255, 0, 0,
    ],
    enabledOperations: ["chroma"],
    disabledPixels: chromaSource,
    disabledOperations: [],
  }) ||
  JSON.stringify(evidence.chromaOrder) !== JSON.stringify({
    operations: ["chroma", "crop"],
    contentBounds: { x: 1, y: 0, width: 3, height: 1 },
    dimensions: [3, 1],
    pixels: [
      220, 20, 30, 255,
      0, 255, 0, 0,
      30, 80, 220, 255,
    ],
    repeatContentBounds: { x: 1, y: 0, width: 3, height: 1 },
    repeatDimensions: [3, 1],
    repeatPixels: [
      220, 20, 30, 255,
      0, 255, 0, 0,
      30, 80, 220, 255,
    ],
    repeatOperations: ["chroma", "crop"],
  }) ||
  JSON.stringify(evidence.chromaHostile) !== JSON.stringify({
    noMatch: {
      pixels: [220, 20, 30, 255, 0, 255, 0, 0, 30, 80, 220, 255],
      contentBounds: { x: 0, y: 0, width: 3, height: 1 },
      operations: ["chroma", "crop"],
      warnings: [],
    },
    extreme: {
      pixels: [0, 0, 0, 0],
      contentBounds: null,
      dimensions: [1, 1],
      operations: ["chroma", "crop"],
      warnings: ["empty-output"],
    },
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
