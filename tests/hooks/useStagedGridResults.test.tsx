import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  GridProcessingClient,
  GridProcessingClientProgress,
} from "../../features/slice/processing/gridProcessingClient";
import type { GridProcessingResultV1 } from "../../core/processing/gridProcessingProtocol";
import {
  scheduleGridRasterization,
  useStagedGridResults,
  type SliceSourceRasterizer,
} from "../../features/slice/results/useStagedGridResults";
import type { SourceSessionSnapshot } from "../../features/slice/source/sourceSession";

const recipe = {
  kind: "grid-split" as const,
  version: 1 as const,
  sourceAssetId: "asset-hook",
  layout: { mode: "manual" as const, rows: 1, cols: 1 },
  crop: { threshold: 0, padding: 0 },
  chroma: { enabled: false, color: "#00ff00", tolerance: 0, smoothness: 0, spill: 0 },
  pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
};

function readySnapshot(): SourceSessionSnapshot {
  return {
    generation: 1,
    disposed: false,
    status: "ready",
    metadata: {
      name: "hook.png",
      declaredMimeType: "image/png",
      mimeType: "image/png",
      format: "png",
      size: 80,
      lastModified: 0,
      width: 2,
      height: 2,
      pixelCount: 4,
    },
    candidateMetadata: null,
    source: { image: {}, width: 2, height: 2 },
    error: null,
  };
}

function result(): GridProcessingResultV1 {
  return {
    source: { width: 2, height: 2 },
    layout: { origin: "manual", rows: 1, cols: 1 },
    outputs: [{
      index: 0,
      row: 0,
      column: 0,
      cellBounds: { x: 0, y: 0, width: 2, height: 2 },
      contentBounds: { x: 0, y: 0, width: 2, height: 2 },
      surface: { width: 1, height: 1, format: "rgba8", colorSpace: "srgb", pixels: new Uint8Array([10, 20, 30, 255]).buffer },
      cropReductionRatio: 0,
      operations: [],
      warnings: [],
    }],
    summary: { outputCount: 1, outputPixelCount: 1, cropReductionRatio: 0, warnings: [] },
  };
}

describe("useStagedGridResults (G6-02)", () => {
  it("waits for a paint before scheduling synchronous default raster work", () => {
    const frames: Array<FrameRequestCallback> = [];
    const timers: Array<() => void> = [];
    const run = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return 1;
    });
    vi.stubGlobal("setTimeout", (callback: TimerHandler) => {
      if (typeof callback === "function") timers.push(callback as () => void);
      return 1;
    });
    try {
      scheduleGridRasterization(run);
      expect(run).not.toHaveBeenCalled();
      frames.shift()?.(0);
      expect(run).not.toHaveBeenCalled();
      timers.shift()?.();
      expect(run).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rasterizes, reports Worker progress and publishes owned staged outputs", async () => {
    const progress: GridProcessingClientProgress = { ratio: 0.3, stage: "crop", completed: 1, total: 1 };
    const process = vi.fn(async ({ onProgress }: { onProgress?: (value: GridProcessingClientProgress) => void }) => {
      onProgress?.(progress);
      return result();
    });
    const client = { process } as unknown as GridProcessingClient;
    const rasterize: SliceSourceRasterizer = vi.fn(async () => ({
      width: 2,
      height: 2,
      format: "rgba8" as const,
      colorSpace: "srgb" as const,
      pixels: new ArrayBuffer(16),
    }));
    const { result: hook } = renderHook(() => useStagedGridResults({
      sourceSnapshot: readySnapshot(),
      recipe,
      client,
      rasterize,
    }));

    await act(async () => {
      await hook.current.process();
    });

    expect(rasterize).toHaveBeenCalledOnce();
    expect(process).toHaveBeenCalledOnce();
    expect(hook.current.state.status).toBe("succeeded");
    expect(hook.current.state.progress).toEqual(progress);
    expect(hook.current.state.summary?.outputCount).toBe(1);
    expect(hook.current.state.outputs[0]?.surface.pixels).not.toBe(result().outputs[0]!.surface.pixels);
  });

  it("cancels the active processing request and clears stale staged outputs", async () => {
    let rejectProcess: ((error: unknown) => void) | null = null;
    const process = vi.fn(({ signal }: { signal?: AbortSignal }) => new Promise<GridProcessingResultV1>((_resolve, reject) => {
      rejectProcess = reject;
      signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    }));
    const client = { process } as unknown as GridProcessingClient;
    const { result: hook } = renderHook(() => useStagedGridResults({
      sourceSnapshot: readySnapshot(),
      recipe,
      client,
      rasterize: async () => ({ width: 2, height: 2, format: "rgba8", colorSpace: "srgb", pixels: new ArrayBuffer(16) }),
    }));

    let pending: Promise<boolean> | undefined;
    await act(async () => {
      pending = hook.current.process();
      await Promise.resolve();
    });
    expect(hook.current.state.status).toBe("processing");
    act(() => hook.current.cancel());
    await act(async () => {
      await pending;
    });
    expect(rejectProcess).not.toBeNull();
    expect(hook.current.state.status).toBe("cancelled");
  });

  it("publishes preparation before rasterization resolves", async () => {
    let resolveRasterize: ((surface: Awaited<ReturnType<SliceSourceRasterizer>>) => void) | null = null;
    const rasterize: SliceSourceRasterizer = vi.fn(() => new Promise((resolve) => {
      resolveRasterize = resolve;
    }));
    const process = vi.fn(async () => result());
    const client = { process } as unknown as GridProcessingClient;
    const { result: hook } = renderHook(() => useStagedGridResults({
      sourceSnapshot: readySnapshot(),
      recipe,
      client,
      rasterize,
    }));

    let pending: Promise<boolean> | undefined;
    await act(async () => {
      pending = hook.current.process();
      await Promise.resolve();
    });
    expect(hook.current.state.status).toBe("processing");
    expect(hook.current.state.progress).toBeNull();
    expect(process).not.toHaveBeenCalled();
    resolveRasterize?.({
      width: 2,
      height: 2,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: new ArrayBuffer(16),
    });
    await act(async () => {
      await pending;
    });
    expect(process).toHaveBeenCalledOnce();
    expect(hook.current.state.status).toBe("succeeded");
  });
});
