import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BgRemovalTool from "../../components/panels/left/BgRemovalTool";

describe("BgRemovalTool canonical eyedropper controls (G4-02/G4-03)", () => {
  it("exposes a toggleable canvas picker with status and Escape-oriented copy", () => {
    const setIsEyedropperActive = vi.fn();
    const view = render(
      <BgRemovalTool
        hasImage
        isEyedropperActive={false}
        setIsEyedropperActive={setIsEyedropperActive}
      />,
    );

    const picker = screen.getByRole("button", { name: "Pick color from canvas" });
    expect(picker).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(picker);
    expect(setIsEyedropperActive).toHaveBeenCalledWith(true);

    view.rerender(
      <BgRemovalTool
        hasImage
        isEyedropperActive
        setIsEyedropperActive={setIsEyedropperActive}
      />,
    );
    expect(screen.getByRole("button", { name: "Cancel canvas color picker" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent(/press Escape to cancel/i);
  });

  it("keeps the picker unavailable without a source image", () => {
    render(
      <BgRemovalTool
        hasImage={false}
        isEyedropperActive={false}
        setIsEyedropperActive={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Pick color from canvas" })).toBeDisabled();
    expect(screen.getByText(/No source image to process/i)).toBeInTheDocument();
  });
});
