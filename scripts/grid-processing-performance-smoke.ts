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
const SAMPLE_COUNT = 3;
const TARGET_SIZE = 64;
const MAX_PROCESSING_MS = 10_000;
const MAX_CANCEL_MS = 200;
const MAX_CLEANUP_HEAP_DELTA_BYTES = 64 * 1024 * 1024;
const EXPECTED_OPERATIONS = ["chroma", "crop", "resize", "quantize"] as const;
const EXPECTED_PROGRESS_STAGES = ["decode", "detect", ...EXPECTED_OPERATIONS, "finalize"] as const;

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
      pixel: { enabled: true, size: TARGET_SIZE, quantize: true, colors: 8 },
    },
  };
}

function runGc(): void {
  const bunRuntime = (globalThis as typeof globalThis & { Bun?: { gc(force?: boolean): void } }).Bun;
  bunRuntime?.gc(true);
}

async function settleCleanup(): Promise<void> {
  runGc();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
}

async function warmWorker(): Promise<void> {
  const warmPixels = new Uint8ClampedArray(4 * 4 * 4);
  warmPixels.fill(255);
  const warmup: GridProcessingProcessRequestV1 = {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "process",
    requestId: "grid-performance-warmup",
    source: {
      width: 4,
      height: 4,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: warmPixels.buffer,
    },
    recipe: {
      kind: "grid-split",
      version: 1,
      sourceAssetId: "asset-grid-performance-warmup",
      layout: { mode: "manual", rows: 1, cols: 1 },
      crop: { threshold: 0, padding: 0 },
      chroma: { enabled: false, color: "#00ff00", tolerance: 0, smoothness: 0, spill: 0 },
      pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
    },
  };
  await createGridProcessingClient().process({ request: warmup });
  await settleCleanup();
}

async function runFullSample(index: number) {
  const request = createSource(`grid-performance-full-${index}`);
  const sourceBuffer = request.source.pixels;
  const progress: string[] = [];
  const memoryBefore = process.memoryUsage();
  const startedAt = performance.now();
  let result = await createGridProcessingClient().process({
    request,
    onProgress: (event) => progress.push(event.stage),
  });
  const elapsedMs = performance.now() - startedAt;
  const memoryAfter = process.memoryUsage();
  const sample = {
    elapsedMs: Number(elapsedMs.toFixed(2)),
    outputCount: result.outputs.length,
    outputPixelCount: result.summary.outputPixelCount,
    firstDimensions: [result.outputs[0]!.surface.width, result.outputs[0]!.surface.height],
    firstOperations: result.outputs[0]!.operations,
    warnings: result.summary.warnings,
    progressStages: [...new Set(progress)],
    progressEventCount: progress.length,
    sourceDetached: sourceBuffer.byteLength === 0,
    memory: {
      rssDeltaBytes: memoryAfter.rss - memoryBefore.rss,
      heapUsedDeltaBytes: memoryAfter.heapUsed - memoryBefore.heapUsed,
      arrayBufferDeltaBytes: memoryAfter.arrayBuffers - memoryBefore.arrayBuffers,
    },
  };
  result = null as unknown as typeof result;
  await settleCleanup();
  const memoryAfterCleanup = process.memoryUsage();
  return {
    ...sample,
    memory: {
      ...sample.memory,
      cleanupRssDeltaBytes: memoryAfterCleanup.rss - memoryBefore.rss,
      cleanupHeapUsedDeltaBytes: memoryAfterCleanup.heapUsed - memoryBefore.heapUsed,
      cleanupArrayBufferDeltaBytes: memoryAfterCleanup.arrayBuffers - memoryBefore.arrayBuffers,
    },
  };
}

async function runCancellationSample(index: number) {
  const request = createSource(`grid-performance-cancel-${index}`);
  const controller = new AbortController();
  let cancelStartedAt = 0;
  let cancelStage: string | null = null;
  let cancelError: GridProcessingClientError | null = null;
  const setupStartedAt = performance.now();
  try {
    await createGridProcessingClient().process({
      request,
      signal: controller.signal,
      onProgress: (event) => {
        if (cancelStartedAt !== 0 || event.stage !== "chroma") return;
        cancelStage = event.stage;
        cancelStartedAt = performance.now();
        controller.abort();
      },
    });
  } catch (error) {
    if (error instanceof GridProcessingClientError) cancelError = error;
  }
  const elapsedMs = cancelStartedAt === 0 ? Number.POSITIVE_INFINITY : performance.now() - cancelStartedAt;
  await settleCleanup();
  return {
    stage: cancelStage,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    code: cancelError?.code ?? null,
    rejectedAsCancelled: cancelError?.code === "cancelled",
    processSetupMs: Number((performance.now() - setupStartedAt).toFixed(2)),
  };
}

await warmWorker();
const fullSamples = [];
for (let index = 0; index < SAMPLE_COUNT; index += 1) {
  fullSamples.push(await runFullSample(index));
}
const cancellationSamples = [];
for (let index = 0; index < SAMPLE_COUNT; index += 1) {
  cancellationSamples.push(await runCancellationSample(index));
}

const fullP95Ms = percentile95(fullSamples.map((sample) => sample.elapsedMs));
const cancellationP95Ms = percentile95(cancellationSamples.map((sample) => sample.elapsedMs));
const maxHeapUsedDeltaBytes = Math.max(...fullSamples.map((sample) => sample.memory.heapUsedDeltaBytes));
const maxCleanupHeapUsedDeltaBytes = Math.max(...fullSamples.map((sample) => sample.memory.cleanupHeapUsedDeltaBytes));
const maxRssDeltaBytes = Math.max(...fullSamples.map((sample) => sample.memory.rssDeltaBytes));
const maxCleanupRssDeltaBytes = Math.max(...fullSamples.map((sample) => sample.memory.cleanupRssDeltaBytes));
const everyFullSampleValid = fullSamples.every((sample) =>
  sample.outputCount === ROWS * COLS &&
  sample.outputPixelCount === ROWS * COLS * TARGET_SIZE * TARGET_SIZE &&
  sample.firstDimensions[0] === TARGET_SIZE && sample.firstDimensions[1] === TARGET_SIZE &&
  JSON.stringify(sample.firstOperations) === JSON.stringify(EXPECTED_OPERATIONS) &&
  sample.warnings.length === 0 &&
  JSON.stringify(sample.progressStages) === JSON.stringify([...EXPECTED_PROGRESS_STAGES]) &&
  sample.sourceDetached,
);
const everyCancellationSampleValid = cancellationSamples.every((sample) =>
  sample.stage === "chroma" && sample.code === "cancelled" && sample.rejectedAsCancelled &&
  sample.elapsedMs <= MAX_CANCEL_MS,
);

const evidence = {
  schemaVersion: 1,
  status: "pass",
  check: "grid-processing-large-image-performance",
  fixture: {
    source: `${WIDTH}x${HEIGHT}`,
    cells: ROWS * COLS,
    layout: `${ROWS}x${COLS}`,
    stages: [...EXPECTED_OPERATIONS],
    targetSize: TARGET_SIZE,
    quantizeColors: 8,
  },
  warmup: { completed: true, measuredSamples: SAMPLE_COUNT, p95Definition: "ceil(n*0.95) over sorted samples" },
  full: {
    p95Ms: Number(fullP95Ms.toFixed(2)),
    elapsedMs: fullSamples.map((sample) => sample.elapsedMs),
    samples: fullSamples,
    allSamplesValid: everyFullSampleValid,
  },
  cancellation: {
    p95Ms: Number(cancellationP95Ms.toFixed(2)),
    samples: cancellationSamples,
    allSamplesValid: everyCancellationSampleValid,
  },
  memory: {
    observedRuntime: "Bun main process around real Worker client; Worker-native heap is not directly exposed by this runtime",
    maxRssDeltaBytes,
    maxCleanupRssDeltaBytes,
    maxHeapUsedDeltaBytes,
    maxCleanupHeapUsedDeltaBytes,
  },
  budgets: {
    maxProcessingMs: MAX_PROCESSING_MS,
    maxCancelMs: MAX_CANCEL_MS,
    maxCleanupHeapDeltaBytes: MAX_CLEANUP_HEAP_DELTA_BYTES,
    processingPass: fullP95Ms <= MAX_PROCESSING_MS && everyFullSampleValid,
    cancellationPass: cancellationP95Ms <= MAX_CANCEL_MS && everyCancellationSampleValid,
    cleanupHeapPass: maxCleanupHeapUsedDeltaBytes <= MAX_CLEANUP_HEAP_DELTA_BYTES,
  },
};

if (!evidence.budgets.processingPass || !evidence.budgets.cancellationPass || !evidence.budgets.cleanupHeapPass) {
  evidence.status = "fail";
  throw new Error(`Grid performance budget failed: ${JSON.stringify(evidence)}`);
}

process.stdout.write(`${JSON.stringify(evidence)}\n`);
