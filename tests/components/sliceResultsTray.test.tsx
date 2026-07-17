import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  beginStagedGridProcessing,
  completeStagedGridProcessing,
  createIdleStagedGridResults,
  failStagedGridProcessing,
  type StagedGridResultsSnapshot,
} from "../../features/slice/results";
import { SliceResultsTray, STAGED_OUTPUT_PAGE_SIZE } from "../../features/slice/results/SliceResultsTray";
import type { StagedGridResultsController } from "../../features/slice/results/useStagedGridResults";

function snapshot(): StagedGridResultsSnapshot {
  return completeStagedGridProcessing(
    beginStagedGridProcessing(createIdleStagedGridResults(), {
      requestId: "request-tray",
      source: {
        width: 4,
        height: 2,
        format: "rgba8",
        colorSpace: "srgb",
        pixels: new ArrayBuffer(32),
      },
      recipe: {
        kind: "grid-split",
        version: 1,
        sourceAssetId: "asset-tray",
        layout: { mode: "manual", rows: 1, cols: 2 },
        crop: { threshold: 0, padding: 0 },
        chroma: { enabled: false, color: "#00ff00", tolerance: 0, smoothness: 0, spill: 0 },
        pixel: { enabled: false, size: 16, quantize: false, colors: 16 },
      },
    }),
    {
      source: { width: 4, height: 2 },
      layout: { origin: "manual", rows: 1, cols: 2 },
      outputs: [0, 1].map((index) => ({
        index,
        row: 0,
        column: index,
        cellBounds: { x: index * 2, y: 0, width: 2, height: 2 },
        contentBounds: { x: index * 2, y: 0, width: 2, height: 2 },
        surface: {
          width: 1,
          height: 1,
          format: "rgba8" as const,
          colorSpace: "srgb" as const,
          pixels: new Uint8Array([index ? 20 : 10, 0, 0, 255]).buffer,
        },
        cropReductionRatio: 0,
        operations: ["crop" as const],
        warnings: [],
      })),
      summary: { outputCount: 2, outputPixelCount: 2, cropReductionRatio: 0, warnings: [] },
    },
  );
}

function controller(state = snapshot()): StagedGridResultsController {
  return {
    state,
    canProcess: true,
    process: vi.fn(async () => true),
    retry: vi.fn(async () => true),
    cancel: vi.fn(),
    clear: vi.fn(),
    select: vi.fn(),
  };
}

function largeSnapshot(): StagedGridResultsSnapshot {
  const count = STAGED_OUTPUT_PAGE_SIZE + 2;
  const processing = beginStagedGridProcessing(createIdleStagedGridResults(), {
    requestId: "request-large-tray",
    source: {
      width: count,
      height: 1,
      format: "rgba8",
      colorSpace: "srgb",
      pixels: new ArrayBuffer(count * 4),
    },
    recipe: {
      ...snapshot().recipe!,
      sourceAssetId: "asset-large-tray",
      layout: { mode: "manual", rows: 1, cols: count },
    },
  });
  const outputs = Array.from({ length: count }, (_, index) => ({
    index,
    row: 0,
    column: index,
    cellBounds: { x: index, y: 0, width: 1, height: 1 },
    contentBounds: { x: index, y: 0, width: 1, height: 1 },
    surface: {
      width: 1,
      height: 1,
      format: "rgba8" as const,
      colorSpace: "srgb" as const,
      pixels: new Uint8Array([index % 255, 0, 0, 255]).buffer,
    },
    cropReductionRatio: 0,
    operations: ["crop" as const],
    warnings: [],
  }));
  return completeStagedGridProcessing(processing, {
    source: { width: count, height: 1 },
    layout: { origin: "manual", rows: 1, cols: count },
    outputs,
    summary: { outputCount: count, outputPixelCount: count, cropReductionRatio: 0, warnings: [] },
  });
}

describe("SliceResultsTray (G6-02)", () => {
  it("exposes process, clear, bounded output selection and summary metadata", () => {
    const value = controller();
    render(<SliceResultsTray controller={value} />);

    expect(screen.getByRole("region", { name: "Staged slice results" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/2 staged slices ready/i);
    expect(screen.getByRole("button", { name: "Process again" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Clear" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Slice 2/ }));
    expect(value.select).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Process again" }));
    expect(value.process).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(value.clear).toHaveBeenCalledOnce();
  });

  it("shows recoverable failure feedback and a retry action", () => {
    const processing = beginStagedGridProcessing(createIdleStagedGridResults(), {
      requestId: "request-failed",
      source: { width: 1, height: 1, format: "rgba8", colorSpace: "srgb", pixels: new ArrayBuffer(4) },
      recipe: snapshot().recipe!,
    });
    const failed = failStagedGridProcessing(processing, {
      code: "worker-crash",
      message: "Grid processing worker stopped unexpectedly.",
      stage: null,
      retryable: true,
    });
    const value = controller(failed);
    render(<SliceResultsTray controller={value} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/worker stopped unexpectedly/i);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(value.retry).toHaveBeenCalledOnce();
  });

  it("caps mounted output previews and pages the remaining results", () => {
    render(<SliceResultsTray controller={controller(largeSnapshot())} />);
    const outputStrip = screen.getByLabelText("Staged slice outputs");
    expect(outputStrip).toHaveAttribute("data-visible-output-count", String(STAGED_OUTPUT_PAGE_SIZE));
    expect(within(outputStrip).getAllByRole("button")).toHaveLength(STAGED_OUTPUT_PAGE_SIZE);
    expect(screen.getByText(`Showing 1–${STAGED_OUTPUT_PAGE_SIZE} of ${STAGED_OUTPUT_PAGE_SIZE + 2}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next output page" }));
    expect(screen.getByText(`Showing ${STAGED_OUTPUT_PAGE_SIZE + 1}–${STAGED_OUTPUT_PAGE_SIZE + 2} of ${STAGED_OUTPUT_PAGE_SIZE + 2}`)).toBeInTheDocument();
    expect(within(outputStrip).getAllByRole("button")).toHaveLength(2);
  });
});
