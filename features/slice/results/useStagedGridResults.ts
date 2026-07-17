import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  GridProcessingProcessRequestV1,
  GridProcessingSurfaceV1,
} from "../../../core/processing/gridProcessingProtocol";
import type { GridSplitRecipeV1 } from "../../../core/project";
import {
  createGridProcessingClient,
  GridProcessingClientError,
  type GridProcessingClient,
} from "../processing/gridProcessingClient";
import type { SourceSessionResource, SourceSessionSnapshot } from "../source/sourceSession";
import {
  beginStagedGridPreparation,
  completeStagedGridProcessing,
  createIdleStagedGridResults,
  disposeStagedGridResults,
  failStagedGridProcessing,
  selectStagedGridOutput,
  type StagedGridResultError,
  type StagedGridResultsSnapshot,
  updateStagedGridProgress,
} from "./stagedGridResults";

export interface SliceSourceRasterizerOptions {
  readonly source: SourceSessionResource;
  readonly signal: AbortSignal;
}

export type SliceSourceRasterizer = (
  options: SliceSourceRasterizerOptions,
) => Promise<GridProcessingSurfaceV1>;

export interface UseStagedGridResultsOptions {
  readonly sourceSnapshot: SourceSessionSnapshot;
  readonly recipe: GridSplitRecipeV1 | null;
  readonly client?: GridProcessingClient;
  readonly rasterize?: SliceSourceRasterizer;
}

export interface StagedGridResultsController {
  readonly state: StagedGridResultsSnapshot;
  readonly canProcess: boolean;
  readonly process: () => Promise<boolean>;
  readonly retry: () => Promise<boolean>;
  readonly cancel: () => void;
  readonly clear: () => void;
  readonly select: (index: number | null) => void;
}

let requestSequence = 0;

function nextRequestId(): string {
  try {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID === "function") return `grid-process-${randomUUID.call(globalThis.crypto)}`;
  } catch {
    // Keep the monotonic fallback deterministic when crypto is unavailable.
  }
  requestSequence += 1;
  return `grid-process-${Date.now().toString(36)}-${requestSequence.toString(36)}`;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new DOMException("Grid processing was cancelled.", "AbortError");
    throw error;
  }
}

function createRasterSurface(source: SourceSessionResource, signal: AbortSignal): GridProcessingSurfaceV1 {
  throwIfAborted(signal);
  if (source.image === null || source.image === undefined) {
    throw new TypeError("Decoded source pixels are unavailable.");
  }
  const width = source.width;
  const height = source.height;
  let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  let canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  if (typeof OffscreenCanvas === "function") {
    canvas = new OffscreenCanvas(width, height);
    context = canvas.getContext("2d", { willReadFrequently: true });
  } else if (typeof document !== "undefined") {
    const element = document.createElement("canvas");
    element.width = width;
    element.height = height;
    canvas = element;
    context = element.getContext("2d", { willReadFrequently: true });
  }
  if (!context || !canvas) throw new TypeError("Canvas pixels are unavailable in this runtime.");
  try {
    context.clearRect(0, 0, width, height);
    context.drawImage(source.image as CanvasImageSource, 0, 0, width, height);
    throwIfAborted(signal);
    const pixels = context.getImageData(0, 0, width, height).data;
    return {
      width,
      height,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: pixels.slice().buffer,
    };
  } finally {
    if (typeof HTMLCanvasElement !== "undefined" && canvas instanceof HTMLCanvasElement) canvas.width = 1;
  }
}

/** Schedule synchronous pixel extraction after a browser paint opportunity. */
export function scheduleGridRasterization(run: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      setTimeout(run, 0);
    });
    return;
  }
  setTimeout(run, 0);
}

function defaultRasterizer(options: SliceSourceRasterizerOptions): Promise<GridProcessingSurfaceV1> {
  return new Promise((resolve, reject) => {
    const run = (): void => {
      try {
        throwIfAborted(options.signal);
        resolve(createRasterSurface(options.source, options.signal));
      } catch (error) {
        reject(error);
      }
    };
    scheduleGridRasterization(run);
  });
}

function fixedError(error: unknown, signal: AbortSignal): StagedGridResultError {
  if (signal.aborted || (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError")) {
    return Object.freeze({
      code: "cancelled",
      message: "Grid processing was cancelled.",
      stage: null,
      retryable: true,
    });
  }
  if (error instanceof GridProcessingClientError) {
    return Object.freeze({
      code: error.code === "invalid-response" ? "invalid-result" : error.code,
      message: error.code === "invalid-response"
        ? "Grid processing returned an invalid result."
        : error.code === "worker-crash"
          ? "Grid processing worker stopped unexpectedly."
          : error.code === "memory"
            ? "This source exceeds the safe processing memory budget."
            : error.code === "timeout"
              ? "Grid processing took too long and was stopped."
              : error.code === "decode"
                ? "Grid processing could not decode this source."
                : "Grid processing could not complete.",
      stage: error.stage,
      retryable: error.retryable,
    });
  }
  return Object.freeze({
    code: "invalid-input",
    message: "Source pixels are unavailable. Re-select the image and try again.",
    stage: null,
    retryable: true,
  });
}

function sourceKey(snapshot: SourceSessionSnapshot): string {
  return `${snapshot.generation}:${snapshot.status}:${snapshot.metadata?.width ?? 0}x${snapshot.metadata?.height ?? 0}`;
}

function releaseWorkerResult(result: { readonly outputs: readonly { readonly surface: { readonly pixels: ArrayBuffer } }[] }): void {
  for (const output of result.outputs) {
    try {
      new Uint8Array(output.surface.pixels).fill(0);
    } catch {
      // A detached response buffer is already released by the transfer boundary.
    }
  }
}

export function useStagedGridResults(options: UseStagedGridResultsOptions): StagedGridResultsController {
  const client = useMemo(() => options.client ?? createGridProcessingClient(), [options.client]);
  const rasterize = useMemo<SliceSourceRasterizer>(() => options.rasterize ?? defaultRasterizer, [options.rasterize]);
  const [state, setState] = useState<StagedGridResultsSnapshot>(createIdleStagedGridResults);
  const stateRef = useRef(state);
  const operationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const sourceSnapshotRef = useRef(options.sourceSnapshot);
  const recipeRef = useRef(options.recipe);
  sourceSnapshotRef.current = options.sourceSnapshot;
  recipeRef.current = options.recipe;
  stateRef.current = state;

  const publish = useCallback((next: StagedGridResultsSnapshot): void => {
    stateRef.current = next;
    setState(next);
  }, []);

  const cancel = useCallback((): void => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback((): void => {
    operationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    publish(disposeStagedGridResults(stateRef.current));
  }, [publish]);

  const select = useCallback((index: number | null): void => {
    publish(selectStagedGridOutput(stateRef.current, index));
  }, [publish]);

  useEffect(() => {
    clear();
    return () => {
      operationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      disposeStagedGridResults(stateRef.current);
    };
  }, [clear, options.recipe ? JSON.stringify(options.recipe) : "", sourceKey(options.sourceSnapshot)]);

  const process = useCallback(async (): Promise<boolean> => {
    const snapshot = sourceSnapshotRef.current;
    const recipe = recipeRef.current;
    if (snapshot.status !== "ready" || snapshot.source === null || recipe === null) {
      publish(failStagedGridProcessing(stateRef.current, {
        code: "invalid-input",
        message: "Load an image and finish its validation before processing.",
        stage: null,
        retryable: false,
      }));
      return false;
    }
    operationRef.current += 1;
    const operation = operationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = nextRequestId();
    publish(beginStagedGridPreparation(stateRef.current, {
      requestId,
      source: {
        assetId: recipe.sourceAssetId,
        width: snapshot.source.width,
        height: snapshot.source.height,
      },
      recipe,
    }));
    try {
      const surface = await rasterize({ source: snapshot.source, signal: controller.signal });
      throwIfAborted(controller.signal);
      const request: GridProcessingProcessRequestV1 = {
        version: 1,
        type: "process",
        requestId,
        source: surface,
        recipe,
      };
      if (operation !== operationRef.current) return false;
      const result = await client.process({
        request,
        signal: controller.signal,
        onProgress: (progress) => {
          if (operation !== operationRef.current) return;
          publish(updateStagedGridProgress(stateRef.current, progress));
        },
      });
      if (operation !== operationRef.current) {
        releaseWorkerResult(result);
        return false;
      }
      let completed: StagedGridResultsSnapshot;
      try {
        completed = completeStagedGridProcessing(stateRef.current, result);
      } finally {
        releaseWorkerResult(result);
      }
      publish(completed);
      return true;
    } catch (error) {
      if (operation !== operationRef.current) return false;
      const nextError = fixedError(error, controller.signal);
      publish(failStagedGridProcessing(stateRef.current, nextError));
      return false;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [client, publish, rasterize]);

  const retry = useCallback(() => process(), [process]);

  return useMemo(() => Object.freeze({
    state,
    canProcess: options.sourceSnapshot.status === "ready" && options.sourceSnapshot.source !== null && options.recipe !== null,
    process,
    retry,
    cancel,
    clear,
    select,
  }), [cancel, clear, options.recipe, options.sourceSnapshot, process, retry, select, state]);
}
