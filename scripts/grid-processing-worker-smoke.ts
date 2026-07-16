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
const evidence = Object.freeze({
  outputCount: result.outputs.length,
  progressStages: Object.freeze(progressStages),
  sourceDetached: sourceBuffer.byteLength === 0,
  outputPixels: Object.freeze(result.outputs.map((output) =>
    Object.freeze([...new Uint8ClampedArray(output.surface.pixels)]))),
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
  ])
) {
  throw new Error("Real grid worker smoke assertions failed.");
}

process.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: "pass", ...evidence })}\n`);
