import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ExportModal from "../../components/overlays/ExportModal";
import type { SpriteAnimation } from "../../types";

const mocks = vi.hoisted(() => ({
  context: {
    animations: [] as SpriteAnimation[],
    exportModal: { isOpen: true as boolean, type: "gif" as const },
    setExportModal: vi.fn(),
  },
}));

vi.mock("../../contexts/ProjectContext", () => ({
  useProject: () => mocks.context,
}));

describe("ExportModal animation selection", () => {
  it("selects the first animation that arrives after the modal mounted", async () => {
    const onExportGif = vi.fn().mockResolvedValue(undefined);
    const props = {
      onGenerateCode: vi.fn(() => ""),
      onExportPng: vi.fn(),
      onExportZip: vi.fn(),
      onExportGif,
      onCopyCode: vi.fn(),
    };
    mocks.context.animations = [];
    const view = render(<ExportModal {...props} />);
    expect(screen.getByRole("button", { name: "Export GIF" })).toBeDisabled();

    mocks.context.animations = [{
      id: "walk",
      name: "Walk",
      fps: 12,
      loop: true,
      keyframes: [{ uid: "frame", sourceIndex: 1, pivotX: 0.5, pivotY: 0.5 }],
    }];
    view.rerender(<ExportModal {...props} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Export GIF" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Export GIF" }));
    await waitFor(() => expect(onExportGif).toHaveBeenCalledWith("walk"));
  });
});
