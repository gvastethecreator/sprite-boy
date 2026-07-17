import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyStudioProject } from "../../core/project";
import { createEmptyWandSelection } from "../../features/slice/irregular";
import IrregularSliceTools from "../../features/slice/irregular/IrregularSliceTools";

const NOW = "2026-07-16T12:00:00.000Z";

function props() {
  return {
    project: createEmptyStudioProject({ id: "project-irregular-tools", now: NOW }),
    sourceAssetId: "asset-source",
    selection: createEmptyWandSelection(),
    toolMode: "wand" as const,
    wandMode: "replace" as const,
    wandAlphaThreshold: 10,
    wandConnectivity: 4 as const,
    manualDraft: { x: 0, y: 0, width: 1, height: 1 },
    selectedRegionId: null,
    onToolModeChange: vi.fn(),
    onWandModeChange: vi.fn(),
    onWandAlphaThresholdChange: vi.fn(),
    onWandConnectivityChange: vi.fn(),
    onCancelSelection: vi.fn(),
    onManualDraftChange: vi.fn(),
    onCreateManual: vi.fn(),
    onApplyManual: vi.fn(),
    onDeleteRegion: vi.fn(),
    onDuplicateRegion: vi.fn(),
    onToggleHidden: vi.fn(),
    onConvertToAsset: vi.fn(),
    onSelectRegion: vi.fn(),
  };
}

describe("IrregularSliceTools (S1-04)", () => {
  it("exposes labeled wand controls and switches to bounded manual actions", () => {
    const value = props();
    const { rerender } = render(<IrregularSliceTools {...value} />);
    expect(screen.getByRole("heading", { name: "Irregular regions" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Wand alpha threshold" })).toHaveValue("10");
    fireEvent.click(screen.getByRole("tab", { name: /Manual/i }));
    expect(value.onToolModeChange).toHaveBeenCalledWith("manual");
    // The tools panel is intentionally controlled by the workspace. Mirror the
    // parent state transition before asserting the manual panel contents.
    rerender(<IrregularSliceTools {...value} toolMode="manual" />);
    expect(screen.getByRole("spinbutton", { name: "Region width" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Region width" }), { target: { value: "12" } });
    expect(value.onManualDraftChange).toHaveBeenCalledWith({ width: 12 });
    fireEvent.click(screen.getByRole("button", { name: /Create from bounds/i }));
    expect(value.onCreateManual).toHaveBeenCalledOnce();
  });
});
