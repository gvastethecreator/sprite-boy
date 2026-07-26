import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AssetRepository } from "../../core/assets";
import type { ProjectStore } from "../../core/stores";
import { SlicePropertiesPanel } from "../../features/slice/SlicePropertiesPanel";
import { createDefaultSliceGridRecipeState } from "../../features/slice/grid/gridRecipeState";
import type { SliceGridController } from "../../features/slice/grid/useSliceGridController";

function controller(): SliceGridController {
  const recipeState = createDefaultSliceGridRecipeState("asset-grid", { width: 80, height: 40 });
  return {
    sourceDimensions: { width: 80, height: 40 },
    draft: { mode: "auto", manual: { rows: 2, cols: 4 } },
    manualRowsInput: "2",
    manualColsInput: "4",
    validationIssues: [],
    status: "detected",
    detectedLayout: { origin: "detected", rows: 2, cols: 4, cells: [], warnings: [], recipeLayout: { mode: "auto" } },
    effectiveLayout: { origin: "detected", rows: 2, cols: 4, cells: [], warnings: [], recipeLayout: { mode: "auto" } },
    recipeState,
    recipe: recipeState.recipe,
    errorMessage: null,
    cropPreview: { enabled: false, threshold: 0, padding: 0, cellCount: 8 },
    chroma: recipeState.recipe.chroma,
    pixel: recipeState.recipe.pixel,
    setMode: vi.fn(),
    setManualRowsInput: vi.fn(),
    setManualColsInput: vi.fn(),
    setCropThreshold: vi.fn(() => true),
    setCropPadding: vi.fn(() => true),
    resetCrop: vi.fn(() => true),
    setChromaEnabled: vi.fn(() => true),
    setChromaColor: vi.fn(() => true),
    setChromaTolerance: vi.fn(() => true),
    setChromaSmoothness: vi.fn(() => true),
    setChromaSpill: vi.fn(() => true),
    resetChroma: vi.fn(() => true),
    setPixelEnabled: vi.fn(() => true),
    setPixelSize: vi.fn(() => true),
    setPixelQuantize: vi.fn(() => true),
    setPixelColors: vi.fn(() => true),
    setPixelPalette: vi.fn(() => true),
    setPixelAutoPalette: vi.fn(() => true),
    setPixelFixedPalette: vi.fn(() => true),
    resetPixel: vi.fn(() => true),
    retry: vi.fn(),
  };
}

describe("SlicePropertiesPanel background ownership", () => {
  it("keeps color key and AI models under one Background tab", () => {
    const onEyedropperActiveChange = vi.fn();
    const view = render(
      <SlicePropertiesPanel
        assets={{} as AssetRepository}
        controller={controller()}
        store={{} as ProjectStore}
        eyedropperActive={false}
        onEyedropperActiveChange={onEyedropperActiveChange}
      />,
    );

    expect(screen.getByRole("complementary", { name: "Slice grid inspector" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Enable chroma removal" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Background" }));
    expect(screen.getByRole("radiogroup", { name: "Background removal method" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Color key" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "AI model" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Enable chroma removal" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pick color from canvas" }));
    expect(onEyedropperActiveChange).toHaveBeenCalledWith(true);
    onEyedropperActiveChange.mockClear();
    fireEvent.click(screen.getByRole("radio", { name: "Grid" }));
    expect(onEyedropperActiveChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText("BG Removal")).not.toBeInTheDocument();
    onEyedropperActiveChange.mockClear();
    view.unmount();
    expect(onEyedropperActiveChange).toHaveBeenCalledWith(false);
  });
});
