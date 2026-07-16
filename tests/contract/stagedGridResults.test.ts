import { describe, expect, it } from "vitest";

import type {
  GridProcessingProcessRequestV1,
  GridProcessingResultV1,
} from "../../core/processing/gridProcessingProtocol";
import {
  beginStagedGridProcessing,
  completeStagedGridProcessing,
  copyStagedGridPixels,
  createIdleStagedGridResults,
  disposeStagedGridResults,
  failStagedGridProcessing,
  selectStagedGridOutput,
  updateStagedGridProgress,
} from "../../features/slice/results";

function recipe() {
  return {
    kind: "grid-split" as const,
    version: 1 as const,
    sourceAssetId: "asset-source",
    layout: { mode: "manual" as const, rows: 1, cols: 2 },
    crop: { threshold: 0, padding: 0 },
    chroma: { enabled: false, color: "#00ff00", tolerance: 0, smoothness: 0, spill: 0 },
    pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
  };
}

function request(): GridProcessingProcessRequestV1 {
  return {
    version: 1,
    type: "process",
    requestId: "request-1",
    source: {
      width: 4,
      height: 2,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: new Uint8Array(32).buffer,
    },
    recipe: recipe(),
  };
}

function result(): GridProcessingResultV1 {
  const pixels = (red: number) => new Uint8Array([red, 0, 0, 255]).buffer;
  const outputs = [0, 1].map((index) => ({
    index,
    row: 0,
    column: index,
    cellBounds: { x: index * 2, y: 0, width: 2, height: 2 },
    contentBounds: index === 0 ? { x: index * 2, y: 0, width: 2, height: 2 } : null,
    surface: { width: 1, height: 1, format: "rgba8" as const, colorSpace: "srgb" as const, pixels: pixels(index ? 20 : 10) },
    cropReductionRatio: index === 0 ? 0 : 1,
    operations: ["crop" as const],
    warnings: index === 0 ? [] : ["empty-output" as const],
  }));
  return {
    source: { width: 4, height: 2 },
    layout: { origin: "manual", rows: 1, cols: 2 },
    outputs,
    summary: {
      outputCount: 2,
      outputPixelCount: 2,
      cropReductionRatio: 0.5,
      warnings: ["empty-output"],
    },
  };
}

describe("staged Grid results contract (G6-01)", () => {
  it("clones Worker buffers, freezes recipe metadata and builds a summary", () => {
    const input = request();
    const processing = beginStagedGridProcessing(createIdleStagedGridResults(), input);
    const progressed = updateStagedGridProgress(processing, {
      ratio: 0.25,
      stage: "decode",
      completed: 1,
      total: 1,
    });
    const snapshot = completeStagedGridProcessing(progressed, result());
    expect(snapshot.status).toBe("succeeded");
    expect(snapshot.summary).toEqual({
      outputCount: 2,
      outputPixelCount: 2,
      cropReductionRatio: 0.5,
      warnings: ["empty-output"],
      emptyOutputCount: 1,
    });
    expect(snapshot.selectedIndex).toBe(0);
    expect(snapshot.recipe).not.toBe(input.recipe);
    expect(Object.isFrozen(snapshot.recipe)).toBe(true);
    expect(Object.isFrozen(snapshot.recipe?.pixel)).toBe(true);
    const sourcePixels = new Uint8Array(result().outputs[0]!.surface.pixels);
    const stagedPixels = new Uint8Array(snapshot.outputs[0]!.surface.pixels);
    expect(stagedPixels).toEqual(sourcePixels);
    expect(snapshot.outputs[0]!.surface.pixels).not.toBe(result().outputs[0]!.surface.pixels);
  });

  it("keeps output selection bounded and returns detached copies", () => {
    const snapshot = completeStagedGridProcessing(
      beginStagedGridProcessing(createIdleStagedGridResults(), request()),
      result(),
    );
    expect(selectStagedGridOutput(snapshot, 1).selectedIndex).toBe(1);
    expect(() => selectStagedGridOutput(snapshot, 2)).toThrow(/outside/);
    const copied = copyStagedGridPixels(snapshot.outputs[0]!);
    expect(copied).not.toBe(snapshot.outputs[0]!.surface.pixels);
    new Uint8Array(copied)[0] = 99;
    expect(new Uint8Array(snapshot.outputs[0]!.surface.pixels)[0]).toBe(10);
  });

  it("fails closed on summary drift and preserves retryable terminal errors", () => {
    const processing = beginStagedGridProcessing(createIdleStagedGridResults(), request());
    const valid = result();
    const invalid = {
      ...valid,
      summary: { ...valid.summary, outputPixelCount: 99 },
    };
    expect(() => completeStagedGridProcessing(processing, invalid)).toThrow(/summary counts/);
    const failed = failStagedGridProcessing(processing, {
      code: "worker-crash",
      message: "Worker stopped unexpectedly.",
      stage: null,
      retryable: true,
    });
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatchObject({ code: "worker-crash", retryable: true });
    const cancelled = failStagedGridProcessing(processing, {
      code: "cancelled",
      message: "Grid processing was cancelled.",
      stage: "crop",
      retryable: true,
    });
    expect(cancelled.status).toBe("cancelled");
  });

  it("zeroes owned buffers and returns an idle release boundary", () => {
    const snapshot = completeStagedGridProcessing(
      beginStagedGridProcessing(createIdleStagedGridResults(), request()),
      result(),
    );
    const buffer = snapshot.outputs[0]!.surface.pixels;
    const released = disposeStagedGridResults(snapshot);
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([0, 0, 0, 0]));
    expect(released).toEqual(createIdleStagedGridResults());
  });
});
