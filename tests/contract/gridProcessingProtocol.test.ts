import { describe, expect, it } from "vitest";
import {
  GRID_PROCESSING_ERROR_CODES,
  GRID_PROCESSING_LIMITS,
  GRID_PROCESSING_OPERATIONS,
  GRID_PROCESSING_PROTOCOL_VERSION,
  assertGridProcessingRequest,
  assertGridProcessingResponse,
  gridProcessingRequestTransferables,
  gridProcessingResponseTransferables,
  isGridProcessingErrorRetryable,
  type GridProcessingProcessRequestV1,
  type GridProcessingResponseExpectationV1,
  type GridProcessingResultResponseV1,
} from "../../core/processing/gridProcessingProtocol";

function recipe() {
  return {
    kind: "grid-split" as const,
    version: 1 as const,
    sourceAssetId: "asset-sheet",
    layout: { mode: "manual" as const, rows: 1, cols: 1 },
    crop: { threshold: 30, padding: 0 },
    chroma: {
      enabled: false,
      color: "#00ff00",
      tolerance: 25,
      smoothness: 15,
      spill: 20,
    },
    pixel: {
      enabled: false,
      size: 64,
      quantize: false,
      colors: 16,
    },
  };
}

function surface(width = 2, height = 2) {
  return {
    width,
    height,
    format: "rgba8" as const,
    colorSpace: "srgb" as const,
    pixels: new ArrayBuffer(width * height * 4),
  };
}

function processRequest(): GridProcessingProcessRequestV1 {
  return {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "process",
    requestId: "grid-request-1",
    source: surface(),
    recipe: recipe(),
  };
}

function resultResponse(): GridProcessingResultResponseV1 {
  const output = surface();
  return {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "result",
    requestId: "grid-request-1",
    result: {
      source: { width: 2, height: 2 },
      layout: { origin: "manual", rows: 1, cols: 1 },
      outputs: [{
        index: 0,
        row: 0,
        column: 0,
        cellBounds: { x: 0, y: 0, width: 2, height: 2 },
        contentBounds: { x: 0, y: 0, width: 2, height: 2 },
        surface: output,
        cropReductionRatio: 0,
        operations: [...GRID_PROCESSING_OPERATIONS],
        warnings: [],
      }],
      summary: {
        outputCount: 1,
        outputPixelCount: 4,
        cropReductionRatio: 0,
        warnings: [],
      },
    },
  };
}

function responseExpectation(
  request: GridProcessingProcessRequestV1 = processRequest(),
): GridProcessingResponseExpectationV1 {
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

interface Band {
  readonly start: number;
  readonly size: number;
}

function latticeResult(
  sourceWidth: number,
  sourceHeight: number,
  origin: "manual" | "detected" | "fallback",
  columns: readonly Band[],
  rows: readonly Band[],
): GridProcessingResultResponseV1 {
  const outputs = rows.flatMap((rowBand, row) =>
    columns.map((columnBand, column) => {
      const cellBounds = {
        x: columnBand.start,
        y: rowBand.start,
        width: columnBand.size,
        height: rowBand.size,
      };
      return {
        index: row * columns.length + column,
        row,
        column,
        cellBounds,
        contentBounds: { ...cellBounds },
        surface: surface(1, 1),
        cropReductionRatio: 0,
        operations: [] as const,
        warnings: [] as const,
      };
    })
  );
  return {
    version: GRID_PROCESSING_PROTOCOL_VERSION,
    type: "result",
    requestId: "grid-request-1",
    result: {
      source: { width: sourceWidth, height: sourceHeight },
      layout: { origin, rows: rows.length, cols: columns.length },
      outputs,
      summary: {
        outputCount: outputs.length,
        outputPixelCount: outputs.length,
        cropReductionRatio: 0,
        warnings: [],
      },
    },
  };
}

function expectedLayout(
  sourceWidth: number,
  sourceHeight: number,
  layout: GridProcessingResponseExpectationV1["layout"],
): GridProcessingResponseExpectationV1 {
  return {
    requestId: "grid-request-1",
    source: { width: sourceWidth, height: sourceHeight },
    layout,
  };
}

function resizableBuffer(byteLength: number): ArrayBuffer | null {
  if (!Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get) return null;
  try {
    const ResizableArrayBuffer = ArrayBuffer as unknown as new (
      length: number,
      options: { readonly maxByteLength: number },
    ) => ArrayBuffer;
    return new ResizableArrayBuffer(byteLength, { maxByteLength: byteLength * 2 });
  } catch {
    return null;
  }
}

describe("grid processing protocol V1", () => {
  it("accepts data-only process/cancel requests and exposes only pixel transferables", () => {
    const process = processRequest();
    const cancel = {
      version: GRID_PROCESSING_PROTOCOL_VERSION,
      type: "cancel",
      requestId: process.requestId,
    };

    expect(() => assertGridProcessingRequest(process)).not.toThrow();
    expect(() => assertGridProcessingRequest(cancel)).not.toThrow();
    expect(gridProcessingRequestTransferables(process)).toEqual([process.source.pixels]);
    expect(gridProcessingRequestTransferables(cancel)).toEqual([]);
  });

  it("accepts request-scoped progress/result/error/cancelled responses", () => {
    const result = resultResponse();
    const expected = responseExpectation();
    const responses = [
      {
        version: GRID_PROCESSING_PROTOCOL_VERSION,
        type: "progress",
        requestId: result.requestId,
        stage: "crop",
        completed: 2,
        total: 4,
      },
      result,
      {
        version: GRID_PROCESSING_PROTOCOL_VERSION,
        type: "error",
        requestId: result.requestId,
        error: { code: "memory", stage: "crop" },
      },
      {
        version: GRID_PROCESSING_PROTOCOL_VERSION,
        type: "cancelled",
        requestId: result.requestId,
      },
    ];

    for (const response of responses) {
      expect(() => assertGridProcessingResponse(response, expected)).not.toThrow();
    }
    expect(() => assertGridProcessingResponse(structuredClone(result), expected)).not.toThrow();
    expect(gridProcessingResponseTransferables(result, expected)).toEqual([
      result.result.outputs[0]?.surface.pixels,
    ]);
    expect(gridProcessingResponseTransferables(responses[0]!, expected)).toEqual([]);
  });

  it("rejects unknown protocol versions, message kinds and extra fields", () => {
    const process = processRequest();
    const result = resultResponse();
    const invalidRequests: unknown[] = [
      { ...process, version: 2 },
      { ...process, type: "PROCESS" },
      { ...process, runtimeUrl: "blob:private-runtime-url" },
      { version: 1, type: "stop", requestId: process.requestId },
    ];
    const invalidResponses: unknown[] = [
      { version: 2, type: "cancelled", requestId: process.requestId },
      { version: 1, type: "success", requestId: process.requestId, result: result.result },
      { version: 1, type: "cancelled", requestId: process.requestId, reason: "private" },
    ];

    for (const value of invalidRequests) {
      expect(() => assertGridProcessingRequest(value)).toThrow(/grid processing V1/);
    }
    for (const value of invalidResponses) {
      expect(() => assertGridProcessingResponse(value, responseExpectation(process))).toThrow(/grid processing V1/);
    }
  });

  it("rejects exotic prototypes and accessors without invoking getters", () => {
    const inherited = Object.assign(Object.create({ inherited: true }), processRequest());
    const nestedPrototype = processRequest();
    Reflect.set(nestedPrototype, "recipe", Object.assign(Object.create({}), recipe()));
    let getterCalls = 0;
    const accessor = { ...processRequest() };
    Object.defineProperty(accessor, "recipe", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return recipe();
      },
    });
    const paletteAccessor = processRequest();
    const palette = ["#000000"];
    Object.defineProperty(palette, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "#000000";
      },
    });
    Reflect.set(paletteAccessor.recipe.pixel, "palette", palette);

    for (const value of [inherited, nestedPrototype, accessor, paletteAccessor]) {
      expect(() => assertGridProcessingRequest(value)).toThrow(/grid processing V1/);
    }
    expect(getterCalls).toBe(0);
  });

  it("enforces recipe, dimension, pixel-count and packed-buffer limits", () => {
    const invalid: GridProcessingProcessRequestV1[] = [];
    for (const width of [0, -0, Number.NaN, Number.POSITIVE_INFINITY, GRID_PROCESSING_LIMITS.maxDimension + 1]) {
      const request = processRequest();
      Reflect.set(request.source, "width", width);
      invalid.push(request);
    }
    const wrongLength = processRequest();
    Reflect.set(wrongLength.source, "pixels", new ArrayBuffer(3));
    invalid.push(wrongLength);
    const pixelProductOverflow = processRequest();
    Reflect.set(pixelProductOverflow.source, "width", 8_193);
    Reflect.set(pixelProductOverflow.source, "height", 8_192);
    invalid.push(pixelProductOverflow);
    const typedArray = processRequest();
    Reflect.set(typedArray.source, "pixels", new Uint8Array(16));
    invalid.push(typedArray);
    const hugeGrid = processRequest();
    Reflect.set(hugeGrid.recipe.layout, "rows", GRID_PROCESSING_LIMITS.maxResultCount);
    Reflect.set(hugeGrid.recipe.layout, "cols", 2);
    invalid.push(hugeGrid);
    const tooManyRowsForSource = processRequest();
    Reflect.set(tooManyRowsForSource.recipe.layout, "rows", tooManyRowsForSource.source.height + 1);
    invalid.push(tooManyRowsForSource);
    const tooManyColumnsForSource = processRequest();
    Reflect.set(
      tooManyColumnsForSource.recipe.layout,
      "cols",
      tooManyColumnsForSource.source.width + 1,
    );
    invalid.push(tooManyColumnsForSource);
    const invalidThreshold = processRequest();
    Reflect.set(invalidThreshold.recipe.crop, "threshold", 101);
    invalid.push(invalidThreshold);
    const invalidPaletteSize = processRequest();
    Reflect.set(invalidPaletteSize.recipe.pixel, "colors", GRID_PROCESSING_LIMITS.maxPaletteColors + 1);
    invalid.push(invalidPaletteSize);
    const sparsePalette = processRequest();
    const sparse: string[] = [];
    sparse.length = 2;
    sparse[1] = "#ffffff";
    Reflect.set(sparsePalette.recipe.pixel, "palette", sparse);
    invalid.push(sparsePalette);

    for (const value of invalid) {
      expect(() => assertGridProcessingRequest(value)).toThrow(/grid processing V1/);
    }

    if (typeof SharedArrayBuffer !== "undefined") {
      const shared = processRequest();
      Reflect.set(shared.source, "pixels", new SharedArrayBuffer(16));
      expect(() => assertGridProcessingRequest(shared)).toThrow(/grid processing V1/);
    }

    const detached = processRequest();
    structuredClone(detached.source.pixels, { transfer: [detached.source.pixels] });
    expect(detached.source.pixels.byteLength).toBe(0);
    expect(() => assertGridProcessingRequest(detached)).toThrow(/grid processing V1/);

    const resizable = resizableBuffer(16);
    if (resizable) {
      const request = processRequest();
      Reflect.set(request.source, "pixels", resizable);
      expect(() => assertGridProcessingRequest(request)).toThrow(/grid processing V1/);
    }
  });

  it("rejects mismatched request IDs and malformed progress", () => {
    const requestId = "grid-request-1";
    const validProgress = {
      version: 1,
      type: "progress",
      requestId,
      stage: "detect",
      completed: 0,
      total: 1,
    };
    expect(() => assertGridProcessingResponse(validProgress, {
      ...responseExpectation(),
      requestId: "grid-request-2",
    })).toThrow(/requestId/);
    for (const invalidId of ["", "   ", "x".repeat(GRID_PROCESSING_LIMITS.maxIdentifierLength + 1)]) {
      expect(() => assertGridProcessingResponse(
        { ...validProgress, requestId: invalidId },
        responseExpectation(),
      ))
        .toThrow(/requestId/);
    }

    const invalidProgress = [
      { ...validProgress, stage: "private-stage" },
      { ...validProgress, completed: -0 },
      { ...validProgress, completed: Number.NaN },
      { ...validProgress, completed: 2 },
      { ...validProgress, total: 0 },
      { ...validProgress, total: Number.POSITIVE_INFINITY },
      { ...validProgress, total: GRID_PROCESSING_LIMITS.maxProgressTotal + 1 },
    ];
    for (const value of invalidProgress) {
      expect(() => assertGridProcessingResponse(value, responseExpectation())).toThrow(/grid processing V1/);
    }
  });

  it("rejects malformed result buffers, geometry, row-major IDs and summaries", () => {
    const malformed: GridProcessingResultResponseV1[] = [];
    const wrongBuffer = structuredClone(resultResponse());
    Reflect.set(wrongBuffer.result.outputs[0]!.surface, "pixels", new ArrayBuffer(15));
    malformed.push(wrongBuffer);
    const wrongIndex = structuredClone(resultResponse());
    Reflect.set(wrongIndex.result.outputs[0]!, "index", 1);
    malformed.push(wrongIndex);
    const outOfBounds = structuredClone(resultResponse());
    Reflect.set(outOfBounds.result.outputs[0]!.cellBounds, "x", 1);
    malformed.push(outOfBounds);
    const contentOutsideCell = structuredClone(resultResponse());
    Reflect.set(contentOutsideCell.result.outputs[0]!.contentBounds!, "width", 3);
    malformed.push(contentOutsideCell);
    const operationsOutOfOrder = structuredClone(resultResponse());
    Reflect.set(operationsOutOfOrder.result.outputs[0]!, "operations", ["crop", "chroma"]);
    malformed.push(operationsOutOfOrder);
    const countMismatch = structuredClone(resultResponse());
    Reflect.set(countMismatch.result.summary, "outputCount", 2);
    malformed.push(countMismatch);
    const pixelsMismatch = structuredClone(resultResponse());
    Reflect.set(pixelsMismatch.result.summary, "outputPixelCount", 3);
    malformed.push(pixelsMismatch);
    const nonFiniteReduction = structuredClone(resultResponse());
    Reflect.set(nonFiniteReduction.result.outputs[0]!, "cropReductionRatio", Number.NaN);
    malformed.push(nonFiniteReduction);
    const aggregateReductionMismatch = structuredClone(resultResponse());
    Reflect.set(aggregateReductionMismatch.result.summary, "cropReductionRatio", 0.5);
    malformed.push(aggregateReductionMismatch);

    for (const value of malformed) {
      expect(() => assertGridProcessingResponse(value, responseExpectation())).toThrow(/grid processing V1/);
    }
  });

  it("rejects hostile response/expectation graphs and unsafe result buffers", () => {
    let getterCalls = 0;
    const symbolResponse = resultResponse();
    Object.defineProperty(symbolResponse, Symbol("private"), { enumerable: true, value: "secret" });
    const accessorResponse = { ...resultResponse() };
    Object.defineProperty(accessorResponse, "result", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return resultResponse().result;
      },
    });
    const prototypeResponse = Object.assign(Object.create({ inherited: true }), resultResponse());
    const nestedPrototype = resultResponse();
    Reflect.set(
      nestedPrototype.result.outputs[0]!,
      "cellBounds",
      Object.assign(Object.create({}), nestedPrototype.result.outputs[0]!.cellBounds),
    );
    const sparseResponse = resultResponse();
    const sparseOutputs: GridProcessingResultResponseV1["result"]["outputs"][number][] = [];
    sparseOutputs.length = 1;
    Reflect.set(sparseResponse.result, "outputs", sparseOutputs);
    const expectationAccessor = responseExpectation();
    Object.defineProperty(expectationAccessor, "layout", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return { mode: "manual", rows: 1, cols: 1 };
      },
    });
    const expectationPrototype = Object.assign(Object.create({}), responseExpectation());

    for (const response of [
      symbolResponse,
      accessorResponse,
      prototypeResponse,
      nestedPrototype,
      sparseResponse,
    ]) {
      expect(() => assertGridProcessingResponse(response, responseExpectation()))
        .toThrow(/grid processing V1/);
    }
    for (const expectation of [expectationAccessor, expectationPrototype]) {
      expect(() => assertGridProcessingResponse(resultResponse(), expectation))
        .toThrow(/grid processing V1/);
    }
    expect(getterCalls).toBe(0);

    const detached = resultResponse();
    const detachedPixels = detached.result.outputs[0]!.surface.pixels;
    structuredClone(detachedPixels, { transfer: [detachedPixels] });
    expect(() => assertGridProcessingResponse(detached, responseExpectation()))
      .toThrow(/grid processing V1/);

    const resizable = resizableBuffer(16);
    if (resizable) {
      const response = resultResponse();
      Reflect.set(response.result.outputs[0]!.surface, "pixels", resizable);
      expect(() => assertGridProcessingResponse(response, responseExpectation()))
        .toThrow(/grid processing V1/);
    }
  });

  it("anchors result source/layout to the job expectation", () => {
    const sourceMismatch = resultResponse();
    Reflect.set(sourceMismatch.result.source, "width", 3);
    expect(() => assertGridProcessingResponse(sourceMismatch, responseExpectation()))
      .toThrow(/result.source/);

    expect(() => assertGridProcessingResponse(
      resultResponse(),
      expectedLayout(2, 2, { mode: "manual", rows: 1, cols: 2 }),
    )).toThrow(/result.layout/);
    expect(() => gridProcessingResponseTransferables(
      resultResponse(),
      expectedLayout(2, 2, { mode: "manual", rows: 1, cols: 2 }),
    )).toThrow(/result.layout/);
    expect(() => assertGridProcessingResponse(
      resultResponse(),
      expectedLayout(2, 2, { mode: "auto" }),
    )).toThrow(/result.layout/);
    expect(() => assertGridProcessingResponse(
      {
        version: GRID_PROCESSING_PROTOCOL_VERSION,
        type: "cancelled",
        requestId: "grid-request-1",
      },
      expectedLayout(2, 2, { mode: "manual", rows: 3, cols: 1 }),
    )).toThrow(/expectation.layout/);

    const tooManyColumns = resultResponse();
    Reflect.set(tooManyColumns.result.layout, "origin", "detected");
    Reflect.set(tooManyColumns.result.layout, "cols", 3);
    expect(() => assertGridProcessingResponse(
      tooManyColumns,
      expectedLayout(2, 2, { mode: "auto" }),
    )).toThrow(/result.layout/);
    const tooManyRows = resultResponse();
    Reflect.set(tooManyRows.result.layout, "origin", "fallback");
    Reflect.set(tooManyRows.result.layout, "rows", 3);
    expect(() => assertGridProcessingResponse(
      tooManyRows,
      expectedLayout(2, 2, { mode: "auto" }),
    )).toThrow(/result.layout/);
  });

  it("enforces manual partitioning and auto-detected lattice geometry", () => {
    const manual = latticeResult(
      4,
      3,
      "manual",
      [{ start: 0, size: 2 }, { start: 2, size: 2 }],
      [{ start: 0, size: 1 }, { start: 1, size: 2 }],
    );
    expect(() => assertGridProcessingResponse(
      manual,
      expectedLayout(4, 3, { mode: "manual", rows: 2, cols: 2 }),
    )).not.toThrow();

    const manualGap = latticeResult(
      4,
      2,
      "manual",
      [{ start: 0, size: 1 }, { start: 2, size: 2 }],
      [{ start: 0, size: 2 }],
    );
    expect(() => assertGridProcessingResponse(
      manualGap,
      expectedLayout(4, 2, { mode: "manual", rows: 1, cols: 2 }),
    )).toThrow(/outputs.columns/);

    const autoGap = latticeResult(
      3,
      3,
      "detected",
      [{ start: 0, size: 1 }, { start: 2, size: 1 }],
      [{ start: 0, size: 1 }, { start: 2, size: 1 }],
    );
    expect(() => assertGridProcessingResponse(
      autoGap,
      expectedLayout(3, 3, { mode: "auto" }),
    )).not.toThrow();
    const fallbackGap = structuredClone(autoGap);
    Reflect.set(fallbackGap.result.layout, "origin", "fallback");
    expect(() => assertGridProcessingResponse(
      fallbackGap,
      expectedLayout(3, 3, { mode: "auto" }),
    )).not.toThrow();

    const overlap = latticeResult(
      3,
      2,
      "detected",
      [{ start: 0, size: 2 }, { start: 1, size: 2 }],
      [{ start: 0, size: 2 }],
    );
    expect(() => assertGridProcessingResponse(
      overlap,
      expectedLayout(3, 2, { mode: "auto" }),
    )).toThrow(/outputs.columns/);

    const reverseOrder = latticeResult(
      3,
      2,
      "detected",
      [{ start: 2, size: 1 }, { start: 0, size: 1 }],
      [{ start: 0, size: 2 }],
    );
    expect(() => assertGridProcessingResponse(
      reverseOrder,
      expectedLayout(3, 2, { mode: "auto" }),
    )).toThrow(/outputs.columns/);

    const inconsistentLattice = latticeResult(
      4,
      4,
      "detected",
      [{ start: 0, size: 1 }, { start: 2, size: 1 }],
      [{ start: 0, size: 1 }, { start: 2, size: 1 }],
    );
    const third = inconsistentLattice.result.outputs[2]!;
    Reflect.set(third.cellBounds, "x", 1);
    Reflect.set(third.contentBounds!, "x", 1);
    expect(() => assertGridProcessingResponse(
      inconsistentLattice,
      expectedLayout(4, 4, { mode: "auto" }),
    )).toThrow(/cellBounds/);
  });

  it("rejects reused output buffers that cannot form a valid transfer list", () => {
    const response = latticeResult(
      2,
      1,
      "manual",
      [{ start: 0, size: 1 }, { start: 1, size: 1 }],
      [{ start: 0, size: 1 }],
    );
    const firstPixels = response.result.outputs[0]!.surface.pixels;
    Reflect.set(response.result.outputs[1]!.surface, "pixels", firstPixels);

    expect(() => assertGridProcessingResponse(
      response,
      expectedLayout(2, 1, { mode: "manual", rows: 1, cols: 2 }),
    )).toThrow(/grid processing V1/);
  });

  it("supports an explicit empty-output result without zero-sized surfaces", () => {
    const response = resultResponse();
    const output = response.result.outputs[0]!;
    Reflect.set(output, "contentBounds", null);
    Reflect.set(output, "cropReductionRatio", 1);
    Reflect.set(output, "warnings", ["empty-output"]);
    Reflect.set(output, "surface", surface(1, 1));
    Reflect.set(response.result.summary, "outputPixelCount", 1);
    Reflect.set(response.result.summary, "cropReductionRatio", 1);

    expect(() => assertGridProcessingResponse(response, responseExpectation())).not.toThrow();
    expect(gridProcessingResponseTransferables(response, responseExpectation())).toEqual([
      output.surface.pixels,
    ]);
  });

  it("accepts only closed safe error payloads and derives retryability locally", () => {
    const requestId = "grid-request-1";
    for (const code of GRID_PROCESSING_ERROR_CODES) {
      const response = {
        version: GRID_PROCESSING_PROTOCOL_VERSION,
        type: "error",
        requestId,
        error: { code, stage: null },
      };
      expect(() => assertGridProcessingResponse(response, responseExpectation())).not.toThrow();
    }
    const privateDetails = {
      version: GRID_PROCESSING_PROTOCOL_VERSION,
      type: "error",
      requestId,
      error: {
        code: "worker-crash",
        stage: null,
        message: "C:\\private\\project\\secret.png",
        stack: "private stack",
      },
    };
    expect(() => assertGridProcessingResponse(privateDetails, responseExpectation())).toThrow(/grid processing V1/);
    expect(() => assertGridProcessingResponse({
      ...privateDetails,
      error: { code: "private-provider-error", stage: null },
    }, responseExpectation())).toThrow(/grid processing V1/);
    expect(isGridProcessingErrorRetryable("worker-crash")).toBe(true);
    expect(isGridProcessingErrorRetryable("timeout")).toBe(true);
    expect(isGridProcessingErrorRetryable("invalid-input")).toBe(false);
  });
});
