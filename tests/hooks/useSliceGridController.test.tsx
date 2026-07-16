import { act, renderHook } from "@testing-library/react";
import { StrictMode, type PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

import type { GridAutoInference } from "../../core/processing/gridProcessingDetection";
import type { SourceSessionSnapshot } from "../../features/slice/source/sourceSession";
import {
  resolveSliceGridSource,
  useSliceGridController,
} from "../../features/slice/grid/useSliceGridController";
import type {
  GridPreviewInference,
  GridPreviewSource,
} from "../../features/slice/grid/gridPreviewInference";

const IDLE_SESSION: SourceSessionSnapshot = Object.freeze({
  status: "idle",
  generation: 0,
  disposed: false,
  metadata: null,
  candidateMetadata: null,
  source: null,
  error: null,
});

function legacy(width = 8, height = 4, src = "data:image/png;base64,source") {
  return { width, height, src, name: "sheet.png", fileSize: 100 };
}

function inference(
  rows: number,
  cols: number,
  origin: "detected" | "fallback" = "detected",
): GridAutoInference {
  const cells = Array.from({ length: rows * cols }, (_, index) => Object.freeze({
    x: index % cols,
    y: Math.floor(index / cols),
    width: 1,
    height: 1,
  }));
  return Object.freeze({
    origin,
    rows,
    cols,
    cells: Object.freeze(cells),
    warnings: origin === "fallback"
      ? Object.freeze(["grid-detection-fallback"] as const)
      : Object.freeze([]),
  });
}

interface PendingInference {
  readonly source: GridPreviewSource;
  readonly signal: AbortSignal;
  readonly resolve: (value: GridAutoInference) => void;
  readonly reject: (reason: unknown) => void;
}

function pendingAdapter() {
  const pending: PendingInference[] = [];
  const inferPreview: GridPreviewInference = vi.fn((source, signal) =>
    new Promise<GridAutoInference>((resolve, reject) =>
      pending.push({ source, signal, resolve, reject })));
  return { inferPreview, pending };
}

const strictWrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;

describe("useSliceGridController (G2-03)", () => {
  it("publishes detected 2x4 and deterministic fallback effective layouts", async () => {
    const detected = vi.fn<GridPreviewInference>().mockResolvedValueOnce(inference(2, 4));
    const { result, unmount } = renderHook(() => useSliceGridController({
      generation: 1,
      committedMetadata: null,
      sessionSnapshot: IDLE_SESSION,
      legacyImage: legacy(),
      inferPreview: detected,
    }));

    await act(async () => Promise.resolve());
    expect(result.current.status).toBe("detected");
    expect(result.current.detectedLayout).toMatchObject({ rows: 2, cols: 4, origin: "detected" });
    expect(result.current.effectiveLayout?.cells).toHaveLength(8);
    unmount();

    const fallback = vi.fn<GridPreviewInference>().mockResolvedValueOnce(inference(1, 1, "fallback"));
    const fallbackHook = renderHook(() => useSliceGridController({
      generation: 2,
      committedMetadata: null,
      sessionSnapshot: IDLE_SESSION,
      legacyImage: legacy(),
      inferPreview: fallback,
    }));
    await act(async () => Promise.resolve());
    expect(fallbackHook.result.current.status).toBe("fallback");
    expect(fallbackHook.result.current.effectiveLayout).toMatchObject({
      rows: 1,
      cols: 1,
      warnings: ["grid-detection-fallback"],
    });
  });

  it("commits chroma controls through the same recipe host and contains rejected commits", async () => {
    const onCommitState = vi.fn();
    const { result, unmount } = renderHook(() => useSliceGridController({
      generation: 1,
      committedMetadata: null,
      sessionSnapshot: IDLE_SESSION,
      legacyImage: legacy(),
      inferPreview: vi.fn().mockResolvedValue(inference(1, 1)),
      onCommitState,
    }));
    await act(async () => Promise.resolve());

    act(() => {
      expect(result.current.setChromaEnabled(true)).toBe(true);
      expect(result.current.setChromaColor("#12ABEF")).toBe(true);
      expect(result.current.setChromaTolerance(35)).toBe(true);
      expect(result.current.setChromaSmoothness(20)).toBe(true);
      expect(result.current.setChromaSpill(15)).toBe(true);
    });
    expect(result.current.chroma).toEqual({
      enabled: true,
      color: "#12abef",
      tolerance: 35,
      smoothness: 20,
      spill: 15,
    });
    expect(onCommitState).toHaveBeenCalledTimes(5);

    const rejected = renderHook(() => useSliceGridController({
      generation: 2,
      committedMetadata: null,
      sessionSnapshot: IDLE_SESSION,
      legacyImage: legacy(),
      inferPreview: vi.fn().mockResolvedValue(inference(1, 1)),
      onCommitState: () => { throw new Error("host rejected chroma"); },
    }));
    await act(async () => Promise.resolve());
    act(() => {
      expect(rejected.result.current.setChromaEnabled(true)).toBe(false);
    });
    expect(rejected.result.current.chroma.enabled).toBe(false);
    unmount();
    rejected.unmount();
  });

  it("commits pixel snapping and palette mode through the canonical recipe host", async () => {
    const onCommitState = vi.fn();
    const { result, unmount } = renderHook(() => useSliceGridController({
      generation: 1,
      committedMetadata: null,
      sessionSnapshot: IDLE_SESSION,
      legacyImage: legacy(),
      inferPreview: vi.fn().mockResolvedValue(inference(1, 1)),
      onCommitState,
    }));
    await act(async () => Promise.resolve());

    act(() => {
      expect(result.current.setPixelEnabled(true)).toBe(true);
      expect(result.current.setPixelSize(64)).toBe(true);
      expect(result.current.setPixelAutoPalette()).toBe(true);
      expect(result.current.setPixelColors(8)).toBe(true);
      expect(result.current.setPixelFixedPalette(["#FF0000", "#0000FF"])).toBe(true);
    });
    expect(result.current.pixel).toEqual({
      enabled: true,
      size: 64,
      quantize: false,
      colors: 8,
      palette: ["#ff0000", "#0000ff"],
    });
    expect(onCommitState).toHaveBeenCalledTimes(5);

    act(() => {
      expect(result.current.resetPixel()).toBe(true);
    });
    expect(result.current.pixel).toEqual({ enabled: false, size: 16, quantize: false, colors: 16 });
    unmount();
  });

  it("cancels StrictMode replay and source-generation races without late writes", async () => {
    const adapter = pendingAdapter();
    const { result, rerender, unmount } = renderHook(
      ({ generation }) => useSliceGridController({
        generation,
        committedMetadata: null,
        sessionSnapshot: IDLE_SESSION,
        legacyImage: legacy(8, 4, `data:image/png;base64,${generation}`),
        inferPreview: adapter.inferPreview,
      }),
      { initialProps: { generation: 1 }, wrapper: strictWrapper },
    );

    expect(adapter.pending.length).toBeGreaterThanOrEqual(1);
    const generationOne = adapter.pending.at(-1)!;
    rerender({ generation: 2 });
    expect(generationOne.signal.aborted).toBe(true);
    const generationTwo = adapter.pending.at(-1)!;

    await act(async () => {
      generationOne.resolve(inference(3, 3));
      generationTwo.resolve(inference(2, 4));
      await Promise.resolve();
    });
    expect(result.current.detectedLayout).toMatchObject({ rows: 2, cols: 4 });

    unmount();
    expect(generationTwo.signal.aborted).toBe(true);
  });

  it("keeps manual input usable while detecting, retains invalid attempts, and preserves values", () => {
    const adapter = pendingAdapter();
    const { result } = renderHook(() => useSliceGridController({
      generation: 1,
      committedMetadata: null,
      sessionSnapshot: IDLE_SESSION,
      legacyImage: legacy(8, 4),
      inferPreview: adapter.inferPreview,
    }));
    expect(result.current.status).toBe("detecting");

    act(() => result.current.setMode("manual"));
    act(() => result.current.setManualRowsInput("2"));
    act(() => result.current.setManualColsInput("4"));
    expect(result.current.effectiveLayout).toMatchObject({ rows: 2, cols: 4, origin: "manual" });

    act(() => result.current.setManualRowsInput("0"));
    expect(result.current.manualRowsInput).toBe("0");
    expect(result.current.draft.manual.rows).toBe(2);
    expect(result.current.validationIssues[0]).toMatchObject({ path: "layout.manual.rows" });

    act(() => result.current.setMode("auto"));
    act(() => result.current.setMode("manual"));
    expect(result.current.draft.manual).toEqual({ rows: 2, cols: 4 });
    expect(result.current.manualRowsInput).toBe("0");
  });

  it("contains adapter errors, retries safely, and retains state across an uncommitted candidate", async () => {
    const adapter = pendingAdapter();
    const { result, rerender } = renderHook(
      ({ candidate }) => useSliceGridController({
        generation: 7,
        committedMetadata: null,
        sessionSnapshot: IDLE_SESSION,
        legacyImage: legacy(8, 4, candidate),
        inferPreview: adapter.inferPreview,
      }),
      { initialProps: { candidate: "committed-source" } },
    );
    const first = adapter.pending[0];
    await act(async () => {
      first.reject(new Error("private canvas taint details"));
      await Promise.resolve();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).not.toContain("private canvas");

    act(() => result.current.setMode("manual"));
    act(() => result.current.setManualRowsInput("2"));
    rerender({ candidate: "invalid-replacement-candidate" });
    expect(adapter.pending).toHaveLength(1);
    expect(result.current.draft.manual.rows).toBe(2);
    expect(result.current.status).toBe("error");

    act(() => result.current.retry());
    expect(adapter.pending).toHaveLength(2);
    await act(async () => {
      adapter.pending[1].resolve(inference(2, 4));
      await Promise.resolve();
    });
    expect(result.current.status).toBe("detected");
    expect(result.current.draft.manual.rows).toBe(2);
  });

  it("resolves dimensions in committed, retained-session, then legacy order", () => {
    const session = Object.freeze({
      status: "ready" as const,
      generation: 3,
      disposed: false,
      metadata: Object.freeze({
        name: "session.png",
        declaredMimeType: "image/png",
        mimeType: "image/png",
        format: "png" as const,
        size: 10,
        lastModified: 0,
        width: 8,
        height: 4,
        pixelCount: 32,
      }),
      candidateMetadata: null,
      source: Object.freeze({ image: { owned: true }, width: 8, height: 4 }),
      error: null,
    }) satisfies SourceSessionSnapshot;
    const committed = { ...session.metadata, width: 16, height: 8, pixelCount: 128 };
    const resolved = resolveSliceGridSource({
      generation: 9,
      committedMetadata: committed,
      sessionSnapshot: session,
      legacyImage: legacy(32, 16),
    });
    expect(resolved?.dimensions).toEqual({ width: 16, height: 8 });
    expect(resolved?.preview.image).toBeNull();
    expect(resolved?.preview.legacyUrl).toBe(legacy(32, 16).src);
  });

  it("rejects source dimensions over the shared pixel ceiling before inference", () => {
    expect(resolveSliceGridSource({
      generation: 1,
      committedMetadata: null,
      sessionSnapshot: IDLE_SESSION,
      legacyImage: legacy(16_384, 16_384),
    })).toBeNull();
  });
});
