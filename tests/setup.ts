import "@testing-library/jest-dom/vitest";

// Stub for canvas context in jsdom
HTMLCanvasElement.prototype.getContext = function () {
  return null;
} as any;

// Stub for Web Worker
class WorkerStub {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage() {}
  terminate() {}
}

Object.defineProperty(globalThis, "Worker", { value: WorkerStub });

// Stub for URL.createObjectURL
URL.createObjectURL = () => "blob:stub";
URL.revokeObjectURL = () => {};
