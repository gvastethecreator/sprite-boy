import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HelpModal from "../../components/overlays/HelpModal";

describe("HelpModal shortcut reference", () => {
  it("renders canonical Studio shortcuts and omits unavailable hitbox clipboard claims", () => {
    render(<HelpModal isOpen onClose={() => undefined} />);

    expect(screen.getByText("Open Collision")).toBeInTheDocument();
    expect(screen.getAllByText("Ctrl/Cmd").length).toBeGreaterThan(5);
    expect(screen.getByText("Preferences")).toBeInTheDocument();
    expect(screen.queryByText(/Copy Hitboxes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Paste Hitboxes/i)).not.toBeInTheDocument();
  });
});
