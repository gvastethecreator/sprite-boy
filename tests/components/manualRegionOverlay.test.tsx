import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ManualRegionOverlay } from "../../features/slice/irregular/ManualRegionOverlay";

const regions = [
  { id: "region-a", name: "Small sprite", bounds: { x: 10, y: 12, width: 24, height: 18 } },
  { id: "region-b", name: "Wide sprite", bounds: { x: 48, y: 20, width: 60, height: 30 } },
] as const;

describe("ManualRegionOverlay", () => {
  it("renders independent rectangles and moves the selected slice with the keyboard", () => {
    const onSelectRegion = vi.fn();
    const onCommitBounds = vi.fn();
    render(
      <ManualRegionOverlay
        sourceDimensions={{ width: 128, height: 96 }}
        regions={regions}
        selectedRegionId="region-a"
        transform={{ scale: 2, offset: { x: 5, y: 7 } }}
        onSelectRegion={onSelectRegion}
        onCommitBounds={onCommitBounds}
      />,
    );

    expect(document.querySelectorAll("[data-manual-region-id]")).toHaveLength(2);
    const selected = screen.getByRole("button", { name: /Small sprite, x 10, y 12/i });
    fireEvent.keyDown(selected, { key: "ArrowRight", shiftKey: true });
    expect(onSelectRegion).toHaveBeenCalledWith("region-a");
    expect(onCommitBounds).toHaveBeenCalledWith("region-a", { x: 20, y: 12, width: 24, height: 18 });
  });

  it("exposes eight handles and resizes from source-space keyboard input", () => {
    const onCommitBounds = vi.fn();
    render(
      <ManualRegionOverlay
        sourceDimensions={{ width: 128, height: 96 }}
        regions={regions}
        selectedRegionId="region-b"
        transform={{ scale: 1, offset: { x: 0, y: 0 } }}
        onSelectRegion={vi.fn()}
        onCommitBounds={onCommitBounds}
      />,
    );

    expect(document.querySelectorAll("[data-manual-region-resize]")).toHaveLength(8);
    fireEvent.keyDown(screen.getByRole("button", { name: "Resize Wide sprite from se" }), { key: "ArrowRight" });
    expect(onCommitBounds).toHaveBeenCalledWith("region-b", { x: 48, y: 20, width: 61, height: 30 });
  });
});
