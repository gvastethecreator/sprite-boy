import { describe, expect, it, vi } from "vitest";
import { createJobRunner } from "../../core/processing/jobRunner";
import { createQueuedJob } from "../../core/processing/jobLifecycle";
import {
  createGridProcessingJobTask,
  type GridProcessingJobTaskClient,
} from "../../core/processing/gridProcessingJobTask";
import { GridProcessingClientError } from "../../features/slice/processing/gridProcessingClient";
import {
  GRID_PROCESSING_PROTOCOL_VERSION,
  type GridProcessingResultV1,
} from "../../core/processing/gridProcessingProtocol";
import { createJobStore } from "../../core/stores";

const T0 = "2026-07-16T00:00:00.000Z";

function source() {
  return {
    width: 1,
    height: 1,
    format: "rgba8" as const,
    colorSpace: "srgb" as const,
    pixels: new Uint8ClampedArray([10, 20, 30, 255]).buffer,
  };
}

function recipe() {
  return {
    kind: "grid-split" as const,
    version: 1 as const,
    sourceAssetId: "asset-job-task",
    layout: { mode: "manual" as const, rows: 1, cols: 1 },
    crop: { threshold: 0, padding: 0 },
    chroma: { enabled: false, color: "#00ff00", tolerance: 10, smoothness: 10, spill: 10 },
    pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
  };
}

function result(): GridProcessingResultV1 {
  return {
    source: { width: 1, height: 1 },
    layout: { origin: "manual", rows: 1, cols: 1 },
    outputs: [{
      index: 0,
      row: 0,
      column: 0,
      cellBounds: { x: 0, y: 0, width: 1, height: 1 },
      contentBounds: { x: 0, y: 0, width: 1, height: 1 },
      surface: {
        width: 1,
        height: 1,
        format: "rgba8",
        colorSpace: "srgb",
        pixels: new Uint8ClampedArray([10, 20, 30, 255]).buffer,
      },
      cropReductionRatio: 0,
      operations: [],
      warnings: [],
    }],
    summary: { outputCount: 1, outputPixelCount: 1, cropReductionRatio: 0, warnings: [] },
  };
}

function queuedJob(id: string) {
  return createQueuedJob({
    id,
    requestId: `${id}-request`,
    kind: "grid.process",
    label: "Process sprite grid",
    createdAt: T0,
    timeoutMs: null,
  });
}

describe("GridProcessingJobTask", () => {
  it("adapts JobRunner identity, abort signal and monotonic worker progress into a successful job", async () => {
    const process = vi.fn<GridProcessingJobTaskClient["process"]>(async (options) => {
      expect(options.request.version).toBe(GRID_PROCESSING_PROTOCOL_VERSION);
      expect(options.request.requestId).toBe("grid-job-request");
      expect(options.signal).toBeInstanceOf(AbortSignal);
      options.onProgress?.({ ratio: 1 / 7, stage: "decode", completed: 1, total: 1 });
      options.onProgress?.({ ratio: 2 / 7, stage: "detect", completed: 1, total: 1 });
      return result();
    });
    const client = Object.freeze({ process }) satisfies GridProcessingJobTaskClient;
    const task = createGridProcessingJobTask({ client, source: source(), recipe: recipe() });
    const store = createJobStore();
    const runner = createJobRunner({ store });
    const queued = queuedJob("grid-job");

    const completion = await runner.run(queued, task).result;

    expect(completion).toMatchObject({ status: "succeeded", value: { summary: { outputCount: 1 } } });
    expect(process).toHaveBeenCalledOnce();
    expect(store.getSnapshot().jobs["grid-job"]).toMatchObject({
      status: "succeeded",
      progress: { ratio: 1, phase: "completed" },
    });
  });

  it("maps closed client failures into safe JobRunner terminal diagnostics", async () => {
    const client = Object.freeze({
      process: async () => {
        throw new GridProcessingClientError(
          "memory",
          "Hostile implementation detail must not escape.",
          "resize",
          true,
        );
      },
    }) satisfies GridProcessingJobTaskClient;
    const task = createGridProcessingJobTask({ client, source: source(), recipe: recipe() });
    const store = createJobStore();
    const runner = createJobRunner({ store });

    const completion = await runner.run(queuedJob("grid-memory"), task).result;

    expect(completion.status).toBe("failed");
    expect(store.getSnapshot().jobs["grid-memory"]).toMatchObject({
      status: "failed",
      error: {
        code: "runtime-failure",
        message: "Grid processing exceeded available memory.",
        retryable: true,
      },
    });
  });

  it("lets JobRunner cancellation abort the client task without a late terminal overwrite", async () => {
    let observedAbort = false;
    const client = Object.freeze({
      process: (options: Parameters<GridProcessingJobTaskClient["process"]>[0]) =>
        new Promise<GridProcessingResultV1>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            observedAbort = true;
            reject(new GridProcessingClientError(
              "cancelled",
              "Cancelled.",
              null,
              true,
            ));
          }, { once: true });
        }),
    }) satisfies GridProcessingJobTaskClient;
    const task = createGridProcessingJobTask({ client, source: source(), recipe: recipe() });
    const store = createJobStore();
    const runner = createJobRunner({ store });
    const handle = runner.run(queuedJob("grid-cancel"), task);

    expect(handle.cancel("User cancelled processing.")).toBe(true);
    const completion = await handle.result;

    expect(observedAbort).toBe(true);
    expect(completion.status).toBe("cancelled");
    await Promise.resolve();
    expect(store.getSnapshot().jobs["grid-cancel"]?.status).toBe("cancelled");
  });
});
