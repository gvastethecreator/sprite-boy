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
  })
) {
  throw new Error("Real grid worker smoke assertions failed.");
}

process.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: "pass", ...evidence })}\n`);
