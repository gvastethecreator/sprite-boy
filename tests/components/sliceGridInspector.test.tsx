import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import SlicerTools from "../../components/panels/left/SlicerTools";
import { SliceGridInspector } from "../../features/slice/grid/SliceGridInspector";
import type {
  EffectiveGridLayout,
  SliceGridController,
} from "../../features/slice/grid/useSliceGridController";
import { createDefaultSliceGridRecipeState } from "../../features/slice/grid/gridRecipeState";
import { AppMode } from "../../types";

const DETECTED: EffectiveGridLayout = Object.freeze({
  origin: "detected",
  rows: 2,
  cols: 4,
  cells: Object.freeze([]),
  warnings: Object.freeze([]),
  recipeLayout: Object.freeze({ mode: "auto" as const }),
});

function controller(overrides: Partial<SliceGridController> = {}): SliceGridController {
  const recipeState = createDefaultSliceGridRecipeState("asset-grid", { width: 80, height: 40 });
  return {
    sourceDimensions: { width: 80, height: 40 },
    draft: { mode: "auto", manual: { rows: 3, cols: 5 } },
    manualRowsInput: "3",
    manualColsInput: "5",
    validationIssues: [],
    status: "detected",
    detectedLayout: DETECTED,
    effectiveLayout: DETECTED,
    recipeState,
    recipe: recipeState.recipe,
    errorMessage: null,
    setMode: vi.fn(),
    setManualRowsInput: vi.fn(),
    setManualColsInput: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}

function RetryHarness({ outcome }: { readonly outcome: "detected" | "fallback" }) {
  const [status, setStatus] = useState<"error" | "detecting" | "detected" | "fallback">("error");
  const outcomeLayout = outcome === "fallback"
    ? { ...DETECTED, origin: "fallback" as const, rows: 1, cols: 1 }
    : DETECTED;
  return (
    <>
      <SliceGridInspector controller={controller({
        status,
        detectedLayout: status === "detected" || status === "fallback" ? outcomeLayout : null,
        effectiveLayout: status === "detected" || status === "fallback" ? outcomeLayout : null,
        errorMessage: status === "error" ? "Grid detection could not analyze this source." : null,
        retry: () => setStatus("detecting"),
      })} />
      {status === "detecting" && (
        <button type="button" onClick={() => setStatus(outcome)}>Resolve inference</button>
      )}
    </>
  );
}

describe("SliceGridInspector (G2-03)", () => {
  it("announces detected layout and exposes an accessible auto/manual radiogroup", () => {
    const value = controller();
    render(<SliceGridInspector controller={value} />);

    expect(screen.getByRole("complementary", { name: "Slice grid inspector" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Grid layout mode" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Auto" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Manual" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(/Detected 2 rows × 4 columns \(8 cells\)/i);

    fireEvent.click(screen.getByRole("radio", { name: "Manual" }));
    expect(value.setMode).toHaveBeenCalledWith("manual");
  });

  it("keeps Manual available during detection and reports the safe 1x1 fallback", () => {
    const view = render(<SliceGridInspector controller={controller({
      status: "detecting",
      detectedLayout: null,
      effectiveLayout: null,
    })} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Detecting grid/i);
    expect(screen.getByRole("radio", { name: "Manual" })).toBeEnabled();

    view.rerender(<SliceGridInspector controller={controller({
      status: "fallback",
      detectedLayout: { ...DETECTED, origin: "fallback", rows: 1, cols: 1 },
      effectiveLayout: { ...DETECTED, origin: "fallback", rows: 1, cols: 1 },
    })} />);
    expect(screen.getByRole("status")).toHaveTextContent(/safe 1 × 1 fallback/i);
    expect(screen.getByRole("status")).toHaveAttribute("data-grid-inference-origin", "fallback");
  });

  it("keeps an invalid manual attempt visible with field-specific a11y feedback", () => {
    const setRows = vi.fn();
    render(<SliceGridInspector controller={controller({
      draft: { mode: "manual", manual: { rows: 3, cols: 5 } },
      manualRowsInput: "0",
      setManualRowsInput: setRows,
      validationIssues: [{
        code: "invalid-integer",
        path: "layout.manual.rows",
        message: "Rows must be an integer from 1 to 1024.",
      }],
    })} />);

    const rows = screen.getByRole("spinbutton", { name: /Rows/i });
    expect(rows).toHaveValue(0);
    expect(rows).toHaveAttribute("aria-invalid", "true");
    expect(rows).toHaveAccessibleDescription(/Rows must be an integer/i);
    fireEvent.change(rows, { target: { value: "-2" } });
    expect(setRows).toHaveBeenCalledWith("-2");
  });

  it("focuses a safe alert and keeps Retry actionable", () => {
    const retry = vi.fn();
    render(<SliceGridInspector controller={controller({
      status: "error",
      detectedLayout: null,
      effectiveLayout: null,
      errorMessage: "Grid detection could not analyze this source. Your manual values are still available.",
      retry,
    })} />);

    const alert = screen.getByRole("alert");
    expect(screen.getByRole("button", { name: "Retry detection" })).toHaveFocus();
    expect(alert).not.toHaveTextContent(/stack|private|exception/i);
    fireEvent.click(screen.getByRole("button", { name: "Retry detection" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it.each(["detected", "fallback"] as const)(
    "keeps focus reachable through error -> detecting -> %s retry",
    (outcome) => {
      render(<RetryHarness outcome={outcome} />);
      fireEvent.click(screen.getByRole("button", { name: "Retry detection" }));
      const detectingStatus = screen.getByRole("status");
      expect(detectingStatus).toHaveTextContent(/Detecting grid/i);
      expect(detectingStatus).toHaveFocus();

      fireEvent.click(screen.getByRole("button", { name: "Resolve inference" }));
      const resolvedStatus = screen.getByRole("status");
      expect(resolvedStatus).toHaveFocus();
      expect(resolvedStatus).toHaveAttribute("data-grid-inference-origin", outcome);
    },
  );

  it("quarantines legacy Grid/Sync controls when Slice owns grid state", () => {
    const common = {
      currentMode: AppMode.BUILDER,
      imageMeta: { width: 80, height: 40 },
      gridConfig: { rows: 2, cols: 2, marginX: 0, marginY: 0, paddingX: 0, paddingY: 0 },
      setGridConfig: vi.fn(),
      onSyncGridConfig: vi.fn(),
    };
    const view = render(<SlicerTools {...common} showLegacyGridControls={false} />);
    expect(screen.queryByText("Grid Layout")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync Grids" })).not.toBeInTheDocument();

    view.rerender(<SlicerTools {...common} showLegacyGridControls />);
    expect(screen.getByText("Grid Layout")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync Grids" })).toBeInTheDocument();
  });
});
