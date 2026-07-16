import { createGridProcessingClient } from "./gridProcessingClient";
import type { GridProcessingProcessRequestV1 } from "../../../core/processing/gridProcessingProtocol";

export interface GridProcessingBrowserProbeEvidence {
  readonly workerConstructed: boolean;
  readonly workerType: string | null;
  readonly outputCount: number;
  readonly sourceDetached: boolean;
  readonly progressMonotonic: boolean;
  readonly progressStages: readonly string[];
  readonly outputDimensions: readonly (readonly [number, number])[];
  readonly outputPixels: readonly (readonly number[])[];
}

function fixedRequest(): GridProcessingProcessRequestV1 {
  const pixels = new Uint8ClampedArray([
    255, 0, 0, 255,
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 255, 0, 255,
    255, 0, 0, 255,
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 255, 0, 255,
  ]);
  return {
    version: 1,
    type: "process",
    requestId: "browser-grid-worker-probe",
    source: {
      width: 4,
      height: 2,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: pixels.buffer as ArrayBuffer,
    },
    recipe: {
      kind: "grid-split",
      version: 1,
      sourceAssetId: "asset-browser-grid-worker-probe",
      layout: { mode: "manual", rows: 1, cols: 2 },
      crop: { threshold: 1, padding: 0 },
      chroma: { enabled: true, color: "#00ff00", tolerance: 10, smoothness: 10, spill: 10 },
      pixel: { enabled: true, size: 2, quantize: true, colors: 2 },
    },
  };
}

/** Fixed-input production probe. It accepts no page-controlled payload or Worker factory. */
export async function runGridProcessingBrowserProbe(): Promise<GridProcessingBrowserProbeEvidence> {
  const nativeWorker = globalThis.Worker;
  const nativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  let workerConstructed = false;
  let workerType: string | null = null;

  class ObservedNativeWorker extends nativeWorker {
    constructor(scriptURL: string | URL, options?: WorkerOptions) {
      super(scriptURL, options);
      workerConstructed = true;
      workerType = options?.type ?? "classic";
    }
  }

  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: ObservedNativeWorker,
  });
  try {
    const request = fixedRequest();
    const sourceBuffer = request.source.pixels;
    const progressStages: string[] = [];
    const progressRatios: number[] = [];
    const result = await createGridProcessingClient().process({
      request,
      onProgress: (progress) => {
        progressStages.push(progress.stage);
        progressRatios.push(progress.ratio);
      },
    });
    return Object.freeze({
      workerConstructed,
      workerType,
      outputCount: result.outputs.length,
      sourceDetached: sourceBuffer.byteLength === 0,
      progressMonotonic: progressRatios.every((ratio, index) =>
        index === 0 || ratio >= progressRatios[index - 1]!),
      progressStages: Object.freeze(progressStages),
      outputDimensions: Object.freeze(result.outputs.map((output) =>
        Object.freeze([output.surface.width, output.surface.height] as const))),
      outputPixels: Object.freeze(result.outputs.map((output) =>
        Object.freeze([...new Uint8ClampedArray(output.surface.pixels)]))),
    });
  } finally {
    if (nativeDescriptor) Object.defineProperty(globalThis, "Worker", nativeDescriptor);
    else Object.defineProperty(globalThis, "Worker", { value: nativeWorker, configurable: true, writable: true });
  }
}
