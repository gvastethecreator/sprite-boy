import {
  GRID_PROCESSING_PROTOCOL_VERSION,
  type GridProcessingProcessRequestV1,
} from "../core/processing/gridProcessingProtocol";
import {
  createGridProcessingClient,
  GridProcessingClientError,
} from "../features/slice/processing/gridProcessingClient";

const WIDTH = 4_096;
const HEIGHT = 4_096;
const ROWS = 16;
const COLS = 16;
const MAX_PROCESSING_MS = 10_000;
const MAX_CANCEL_MS = 200;

function createSource(requestId: string): GridProcessingProcessRequestV1 {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let offset = 0, pixel = 0; offset < pixels.length; offset += 4, pixel += 1) {
    pixels[offset] = 40 + (pixel % 160);
    pixels[offset + 1] = 30 + ((pixel >>> 5) % 90);
    pixels[offset + 2] = 120 + ((pixel >>> 9) % 100);
    pixels[offset + 3] = 255;
  }
  return {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "process",
    requestId,
    source: {
      width: WIDTH,
      height: HEIGHT,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: pixels.buffer,
    },
    recipe: {
      kind: "grid-split",
      version: 1,
      sourceAssetId: `asset-${requestId}`,
      layout: { mode: "manual", rows: ROWS, cols: COLS },
      crop: { threshold: 1, padding: 0 },
      chroma: { enabled: true, color: "#00ff00", tolerance: 5, smoothness: 5, spill: 10 },
      pixel: { enabled: true, size: 64, quantize: true, colors: 8 },
    },
  };
}

const fullRequest = createSource("grid-performance-full");
const fullSourceBuffer = fullRequest.source.pixels;
const fullProgress: string[] = [];
const memoryBefore = process.memoryUsage();
const fullStartedAt = performance.now();
let fullResult = await createGridProcessingClient().process({
  request: fullRequest,
  onProgress: (progress) => fullProgress.push(progress.stage),
});
const fullElapsedMs = performance.now() - fullStartedAt;
const memoryAfter = process.memoryUsage();
const fullOutputCount = fullResult.outputs.length;
const fullOutputPixelCount = fullResult.summary.outputPixelCount;
const fullFirstDimensions = [fullResult.outputs[0]!.surface.width, fullResult.outputs[0]!.surface.height];
const fullFirstOperations = fullResult.outputs[0]!.operations;
const fullWarnings = fullResult.summary.warnings;
fullResult = null as unknown as typeof fullResult;
const bunRuntime = (globalThis as typeof globalThis & { Bun?: { gc(force?: boolean): void } }).Bun;
bunRuntime?.gc(true);
await new Promise((resolve) => setTimeout(resolve, 0));
const memoryAfterCleanup = process.memoryUsage();

const cancelRequest = createSource("grid-performance-cancel");
const cancelController = new AbortController();
let cancelStartedAt = 0;
let cancelStage: string | null = null;
let cancelError: GridProcessingClientError | null = null;
const cancelProcessStartedAt = performance.now();
try {
  await createGridProcessingClient().process({
    request: cancelRequest,
    signal: cancelController.signal,
    onProgress: (progress) => {
      if (cancelStartedAt !== 0 || progress.stage !== "chroma") return;
      cancelStage = progress.stage;
      cancelStartedAt = performance.now();
      cancelController.abort();
    },
  });
} catch (error) {
  if (error instanceof GridProcessingClientError) cancelError = error;
}
const cancelElapsedMs = cancelStartedAt === 0 ? Number.POSITIVE_INFINITY : performance.now() - cancelStartedAt;

const evidence = {
  schemaVersion: 1,
  status: "pass",
  check: "grid-processing-large-image-performance",
  fixture: {
    source: `${WIDTH}x${HEIGHT}`,
    cells: ROWS * COLS,
    layout: `${ROWS}x${COLS}`,
    stages: ["chroma", "crop", "resize", "quantize"],
  },
  full: {
    elapsedMs: Number(fullElapsedMs.toFixed(2)),
    outputCount: fullOutputCount,
    outputPixelCount: fullOutputPixelCount,
    firstDimensions: fullFirstDimensions,
    firstOperations: fullFirstOperations,
    warnings: fullWarnings,
    progressStages: [...new Set(fullProgress)],
    progressEventCount: fullProgress.length,
    sourceDetached: fullSourceBuffer.byteLength === 0,
  },
  cancellation: {
    stage: cancelStage,
    elapsedMs: Number(cancelElapsedMs.toFixed(2)),
    code: cancelError?.code ?? null,
    rejectedAsCancelled: cancelError?.code === "cancelled",
    processSetupMs: Number((performance.now() - cancelProcessStartedAt).toFixed(2)),
  },
  memory: {
    rssBeforeBytes: memoryBefore.rss,
    rssAfterBytes: memoryAfter.rss,
    rssDeltaBytes: memoryAfter.rss - memoryBefore.rss,
    heapUsedDeltaBytes: memoryAfter.heapUsed - memoryBefore.heapUsed,
    arrayBufferDeltaBytes: memoryAfter.arrayBuffers - memoryBefore.arrayBuffers,
    cleanupRssDeltaBytes: memoryAfterCleanup.rss - memoryBefore.rss,
    cleanupHeapUsedDeltaBytes: memoryAfterCleanup.heapUsed - memoryBefore.heapUsed,
    cleanupArrayBufferDeltaBytes: memoryAfterCleanup.arrayBuffers - memoryBefore.arrayBuffers,
  },
  budgets: {
    maxProcessingMs: MAX_PROCESSING_MS,
    maxCancelMs: MAX_CANCEL_MS,
    processingPass: fullElapsedMs <= MAX_PROCESSING_MS,
    cancellationPass: cancelError?.code === "cancelled" && cancelElapsedMs <= MAX_CANCEL_MS,
  },
};

if (
  evidence.full.outputCount !== ROWS * COLS ||
  evidence.full.outputPixelCount !== ROWS * COLS * 64 * 64 ||
  evidence.full.firstDimensions[0] !== 64 || evidence.full.firstDimensions[1] !== 64 ||
  JSON.stringify(evidence.full.firstOperations) !== JSON.stringify(["chroma", "crop", "resize", "quantize"]) ||
  !evidence.full.sourceDetached ||
  evidence.memory.cleanupHeapUsedDeltaBytes > 64 * 1024 * 1024 ||
  !evidence.budgets.processingPass || !evidence.budgets.cancellationPass
) {
  evidence.status = "fail";
  throw new Error(`Grid performance budget failed: ${JSON.stringify(evidence)}`);
}

process.stdout.write(`${JSON.stringify(evidence)}\n`);
