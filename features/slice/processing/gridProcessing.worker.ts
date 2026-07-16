/// <reference lib="webworker" />

import {
  applyAdvancedChromaKey,
  detectGridSegments,
  findLocalTrimBounds,
  quantizeColors,
} from "../../../core/processing/gridProcessingAlgorithms";
import {
  buildManualGrid,
  calculateReductionRatio,
  getScaledDimensions,
} from "../../../core/processing/gridProcessingGeometry";
import {
  GRID_PROCESSING_LIMITS,
  GRID_PROCESSING_PROTOCOL_VERSION,
  assertGridProcessingRequest,
  gridProcessingResponseTransferables,
  type GridProcessingOperation,
  type GridProcessingOutputV1,
  type GridProcessingProcessRequestV1,
  type GridProcessingRectV1,
  type GridProcessingResponseExpectationV1,
  type GridProcessingResponseV1,
  type GridProcessingResultV1,
  type GridProcessingStage,
  type GridProcessingWarningCode,
} from "../../../core/processing/gridProcessingProtocol";
import {
  GridProcessingStageBoundary,
  GridProcessingWorkerFailure,
  diagnoseGridProcessingWorkerFailure,
} from "./gridProcessingWorkerDiagnostics";

const workerScope = self as DedicatedWorkerGlobalScope;
const YIELD_INTERVAL = 16;

interface ActiveProcess {
  readonly requestId: string;
  readonly expectation: GridProcessingResponseExpectationV1;
  cancelled: boolean;
  terminalSent: boolean;
}

interface WorkingOutput {
  readonly index: number;
  readonly row: number;
  readonly column: number;
  readonly cellBounds: GridProcessingRectV1;
  contentBounds: GridProcessingRectV1 | null;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  cropReductionRatio: number;
  readonly operations: GridProcessingOperation[];
  readonly warnings: GridProcessingWarningCode[];
}

interface WorkerLayout {
  readonly origin: "manual" | "detected" | "fallback";
  readonly rows: number;
  readonly cols: number;
  readonly cells: readonly GridProcessingRectV1[];
  readonly warnings: readonly GridProcessingWarningCode[];
}

let active: ActiveProcess | null = null;

function expectationFor(request: GridProcessingProcessRequestV1): GridProcessingResponseExpectationV1 {
  return {
    requestId: request.requestId,
    source: { width: request.source.width, height: request.source.height },
    layout: request.recipe.layout.mode === "auto"
      ? { mode: "auto" }
      : {
          mode: "manual",
          rows: request.recipe.layout.rows,
          cols: request.recipe.layout.cols,
        },
  };
}

function postResponse(process: ActiveProcess, response: GridProcessingResponseV1): void {
  if (process.terminalSent) return;
  const transfer = [...gridProcessingResponseTransferables(response, process.expectation)];
  workerScope.postMessage(response, transfer);
  if (response.type === "result" || response.type === "error" || response.type === "cancelled") {
    process.terminalSent = true;
  }
}

function yieldToWorker(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function reportProgress(
  process: ActiveProcess,
  stage: GridProcessingStage,
  completed: number,
  total: number,
): Promise<boolean> {
  if (process.cancelled || process.terminalSent) return false;
  postResponse(process, {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "progress",
    requestId: process.requestId,
    stage,
    completed,
    total,
  });
  if (completed === total || completed % YIELD_INTERVAL === 0) await yieldToWorker();
  return !process.cancelled && !process.terminalSent;
}

function copyRect(
  source: Uint8ClampedArray,
  sourceWidth: number,
  rect: GridProcessingRectV1,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(rect.width * rect.height * 4);
  const rowBytes = rect.width * 4;
  for (let row = 0; row < rect.height; row += 1) {
    const sourceStart = ((rect.y + row) * sourceWidth + rect.x) * 4;
    output.set(source.subarray(sourceStart, sourceStart + rowBytes), row * rowBytes);
  }
  return output;
}

function resizeNearest(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  if (width === sourceWidth && height === sourceHeight) return source;
  const output = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / width));
      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
      const outputOffset = (y * width + x) * 4;
      output[outputOffset] = source[sourceOffset]!;
      output[outputOffset + 1] = source[sourceOffset + 1]!;
      output[outputOffset + 2] = source[sourceOffset + 2]!;
      output[outputOffset + 3] = source[sourceOffset + 3]!;
    }
  }
  return output;
}

function addWarning(output: WorkingOutput, warning: GridProcessingWarningCode): void {
  if (!output.warnings.includes(warning)) output.warnings.push(warning);
}

function createLayout(
  request: GridProcessingProcessRequestV1,
  sourcePixels: Uint8ClampedArray,
): WorkerLayout {
  const { width, height } = request.source;
  if (request.recipe.layout.mode === "manual") {
    return {
      origin: "manual",
      rows: request.recipe.layout.rows,
      cols: request.recipe.layout.cols,
      cells: buildManualGrid(width, height, request.recipe.layout.rows, request.recipe.layout.cols),
      warnings: [],
    };
  }
  const detected = detectGridSegments(sourcePixels, width, height);
  if (!detected || detected.rows.length * detected.cols.length > GRID_PROCESSING_LIMITS.maxResultCount) {
    return {
      origin: "fallback",
      rows: 1,
      cols: 1,
      cells: buildManualGrid(width, height, 1, 1),
      warnings: ["grid-detection-fallback"],
    };
  }
  return {
    origin: "detected",
    rows: detected.rows.length,
    cols: detected.cols.length,
    cells: detected.rows.flatMap((row) => detected.cols.map((column) => ({
      x: column.start,
      y: row.start,
      width: column.size,
      height: row.size,
    }))),
    warnings: [],
  };
}

function createWorkingOutputs(
  layout: WorkerLayout,
  sourcePixels: Uint8ClampedArray,
  sourceWidth: number,
): WorkingOutput[] {
  return layout.cells.map((cellBounds, index) => ({
    index,
    row: Math.floor(index / layout.cols),
    column: index % layout.cols,
    cellBounds,
    contentBounds: { ...cellBounds },
    width: cellBounds.width,
    height: cellBounds.height,
    pixels: copyRect(sourcePixels, sourceWidth, cellBounds),
    cropReductionRatio: 0,
    operations: [],
    warnings: [],
  }));
}

async function applyChromaStage(
  process: ActiveProcess,
  request: GridProcessingProcessRequestV1,
  outputs: WorkingOutput[],
): Promise<boolean> {
  if (!request.recipe.chroma.enabled) return true;
  for (let index = 0; index < outputs.length; index += 1) {
    const output = outputs[index]!;
    applyAdvancedChromaKey(
      output.pixels,
      output.width,
      output.height,
      request.recipe.chroma.color,
      request.recipe.chroma.tolerance,
      request.recipe.chroma.smoothness,
      request.recipe.chroma.spill,
    );
    output.operations.push("chroma");
    if (!await reportProgress(process, "chroma", index + 1, outputs.length)) return false;
  }
  return true;
}

async function applyCropStage(
  process: ActiveProcess,
  request: GridProcessingProcessRequestV1,
  outputs: WorkingOutput[],
): Promise<boolean> {
  if (request.recipe.crop.threshold === 0) return true;
  for (let index = 0; index < outputs.length; index += 1) {
    const output = outputs[index]!;
    const bounds = findLocalTrimBounds(
      output.pixels,
      output.width,
      output.height,
      request.recipe.crop.threshold,
      request.recipe.crop.padding,
    );
    output.operations.push("crop");
    if (bounds === null) {
      output.contentBounds = null;
      output.width = 1;
      output.height = 1;
      output.pixels = new Uint8ClampedArray(4);
      output.cropReductionRatio = 1;
      addWarning(output, "empty-output");
    } else {
      output.cropReductionRatio = calculateReductionRatio(
        output.cellBounds.width,
        output.cellBounds.height,
        bounds.width,
        bounds.height,
      );
      output.contentBounds = {
        x: output.cellBounds.x + bounds.x,
        y: output.cellBounds.y + bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
      if (bounds.x !== 0 || bounds.y !== 0 || bounds.width !== output.width || bounds.height !== output.height) {
        output.pixels = copyRect(output.pixels, output.width, bounds);
        output.width = bounds.width;
        output.height = bounds.height;
      }
    }
    if (!await reportProgress(process, "crop", index + 1, outputs.length)) return false;
  }
  return true;
}

async function applyResizeStage(
  process: ActiveProcess,
  request: GridProcessingProcessRequestV1,
  outputs: WorkingOutput[],
): Promise<boolean> {
  if (!request.recipe.pixel.enabled) return true;
  let outputPixels = 0;
  for (let index = 0; index < outputs.length; index += 1) {
    const output = outputs[index]!;
    if (output.contentBounds !== null) {
      const dimensions = getScaledDimensions(output.width, output.height, request.recipe.pixel.size);
      outputPixels += dimensions.width * dimensions.height;
      if (outputPixels > GRID_PROCESSING_LIMITS.maxResultPixels) {
        throw new GridProcessingWorkerFailure("memory", "resize");
      }
      output.pixels = resizeNearest(
        output.pixels,
        output.width,
        output.height,
        dimensions.width,
        dimensions.height,
      );
      output.width = dimensions.width;
      output.height = dimensions.height;
      output.operations.push("resize");
    } else {
      outputPixels += 1;
    }
    if (!await reportProgress(process, "resize", index + 1, outputs.length)) return false;
  }
  return true;
}

async function applyQuantizeStage(
  process: ActiveProcess,
  request: GridProcessingProcessRequestV1,
  outputs: WorkingOutput[],
): Promise<boolean> {
  const palette = request.recipe.pixel.palette;
  if (!request.recipe.pixel.enabled || (!request.recipe.pixel.quantize && !palette)) return true;
  for (let index = 0; index < outputs.length; index += 1) {
    const output = outputs[index]!;
    if (output.contentBounds !== null) {
      const quantized = quantizeColors(
        output.pixels,
        output.width,
        output.height,
        request.recipe.pixel.colors,
        palette,
      );
      output.operations.push("quantize");
      if (!palette && quantized.paletteSize < request.recipe.pixel.colors) {
        addWarning(output, "palette-reduced");
      }
    }
    if (!await reportProgress(process, "quantize", index + 1, outputs.length)) return false;
  }
  return true;
}

function finalizeResult(
  request: GridProcessingProcessRequestV1,
  layout: WorkerLayout,
  working: WorkingOutput[],
): GridProcessingResultV1 {
  let outputPixelCount = 0;
  let cellPixelCount = 0;
  let retainedPixelCount = 0;
  const warningSet = new Set<GridProcessingWarningCode>(layout.warnings);
  const outputs: GridProcessingOutputV1[] = working.map((output) => {
    outputPixelCount += output.width * output.height;
    cellPixelCount += output.cellBounds.width * output.cellBounds.height;
    retainedPixelCount += output.contentBounds === null
      ? 0
      : output.contentBounds.width * output.contentBounds.height;
    for (const warning of output.warnings) warningSet.add(warning);
    return {
      index: output.index,
      row: output.row,
      column: output.column,
      cellBounds: output.cellBounds,
      contentBounds: output.contentBounds,
      surface: {
        width: output.width,
        height: output.height,
        format: "rgba8",
        colorSpace: "srgb",
        pixels: output.pixels.buffer as ArrayBuffer,
      },
      cropReductionRatio: output.cropReductionRatio,
      operations: output.operations,
      warnings: output.warnings,
    };
  });
  if (outputPixelCount > GRID_PROCESSING_LIMITS.maxResultPixels) {
    throw new GridProcessingWorkerFailure("memory", "finalize");
  }
  return {
    source: { width: request.source.width, height: request.source.height },
    layout: { origin: layout.origin, rows: layout.rows, cols: layout.cols },
    outputs,
    summary: {
      outputCount: outputs.length,
      outputPixelCount,
      cropReductionRatio: 1 - retainedPixelCount / cellPixelCount,
      warnings: [...warningSet],
    },
  };
}

async function processRequest(
  process: ActiveProcess,
  request: GridProcessingProcessRequestV1,
  boundary: GridProcessingStageBoundary,
): Promise<GridProcessingResultV1 | null> {
  const sourcePixels = await boundary.run("decode", async () => {
    const pixels = new Uint8ClampedArray(request.source.pixels);
    return await reportProgress(process, "decode", 1, 1) ? pixels : null;
  });
  if (sourcePixels === null) return null;
  const layout = await boundary.run("detect", async () => {
    const detected = createLayout(request, sourcePixels);
    return await reportProgress(process, "detect", 1, 1) ? detected : null;
  });
  if (layout === null) return null;
  const outputs = createWorkingOutputs(layout, sourcePixels, request.source.width);
  if (!await boundary.run("chroma", () => applyChromaStage(process, request, outputs))) return null;
  if (!await boundary.run("crop", () => applyCropStage(process, request, outputs))) return null;
  if (!await boundary.run("resize", () => applyResizeStage(process, request, outputs))) return null;
  if (!await boundary.run("quantize", () => applyQuantizeStage(process, request, outputs))) return null;
  return boundary.run("finalize", async () => {
    const result = finalizeResult(request, layout, outputs);
    return await reportProgress(process, "finalize", 1, 1) ? result : null;
  });
}

async function runProcess(request: GridProcessingProcessRequestV1, process: ActiveProcess): Promise<void> {
  const boundary = new GridProcessingStageBoundary();
  try {
    const result = await processRequest(process, request, boundary);
    if (result && !process.cancelled && !process.terminalSent) {
      postResponse(process, {
        version: GRID_PROCESSING_PROTOCOL_VERSION,
        type: "result",
        requestId: request.requestId,
        result,
      });
    }
  } catch (error) {
    if (!process.cancelled && !process.terminalSent) {
      const diagnostic = diagnoseGridProcessingWorkerFailure(error, boundary.stage);
      postResponse(process, {
        version: GRID_PROCESSING_PROTOCOL_VERSION,
        type: "error",
        requestId: request.requestId,
        error: diagnostic,
      });
    }
  } finally {
    if (active === process) active = null;
  }
}

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  let request: GridProcessingProcessRequestV1 | { readonly type: "cancel"; readonly requestId: string };
  try {
    assertGridProcessingRequest(event.data);
    request = event.data;
  } catch {
    return;
  }
  if (request.type === "cancel") {
    if (active?.requestId !== request.requestId || active.terminalSent) return;
    active.cancelled = true;
    postResponse(active, {
      version: GRID_PROCESSING_PROTOCOL_VERSION,
      type: "cancelled",
      requestId: request.requestId,
    });
    return;
  }
  if (active) {
    const expectation = expectationFor(request);
    const rejected: ActiveProcess = {
      requestId: request.requestId,
      expectation,
      cancelled: false,
      terminalSent: false,
    };
    postResponse(rejected, {
      version: GRID_PROCESSING_PROTOCOL_VERSION,
      type: "error",
      requestId: request.requestId,
      error: { code: "worker-crash", stage: null },
    });
    return;
  }
  const process: ActiveProcess = {
    requestId: request.requestId,
    expectation: expectationFor(request),
    cancelled: false,
    terminalSent: false,
  };
  active = process;
  void runProcess(request, process);
});

export {};
