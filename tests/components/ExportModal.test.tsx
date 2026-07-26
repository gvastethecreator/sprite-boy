import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ExportModal from "../../components/overlays/ExportModal";
import type { ExportModalState, SpriteAnimation } from "../../types";

const mocks = vi.hoisted(() => ({
  context: {
    animations: [] as SpriteAnimation[],
    exportModal: { isOpen: true, type: "gif" } as ExportModalState,
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
    mocks.context.exportModal = { isOpen: true, type: "gif" };
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

  it("explains the empty code export and labels every control", () => {
    mocks.context.animations = [];
    mocks.context.exportModal = { isOpen: true, type: "code" };
    render(
      <ExportModal
        onGenerateCode={vi.fn(() => "")}
        onExportPng={vi.fn()}
        onExportZip={vi.fn()}
        onExportGif={vi.fn().mockResolvedValue(undefined)}
        onCopyCode={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Animation" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Scale" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Format" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Generated animation data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy generated animation data" })).toBeDisabled();
    expect(screen.getByText("Create a sequence before exporting animation data."))
      .toBeInTheDocument();
  });

  it("keeps the GIF dialog open and reports an export failure", async () => {
    mocks.context.animations = [{
      id: "idle",
      name: "Idle",
      fps: 8,
      loop: true,
      keyframes: [{ uid: "idle-frame", sourceIndex: 0, pivotX: 0.5, pivotY: 0.5 }],
    }];
    mocks.context.exportModal = { isOpen: true, type: "gif" };
    mocks.context.setExportModal.mockClear();
    render(
      <ExportModal
        onGenerateCode={vi.fn(() => "")}
        onExportPng={vi.fn()}
        onExportZip={vi.fn()}
        onExportGif={vi.fn().mockRejectedValue(new Error("encoder stopped"))}
        onCopyCode={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Export GIF" }));
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("GIF export failed. Check the sequence and try again.");
    expect(mocks.context.setExportModal).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Export Animated GIF" })).toBeInTheDocument();
  });
});
