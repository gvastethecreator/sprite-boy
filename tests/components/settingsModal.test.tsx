import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import SettingsModal from "../../components/overlays/SettingsModal";
import { DEFAULT_PREFERENCES, type UserPreferences } from "../../types";

vi.mock("../../features/control/ControlBridgeSettings", () => ({
  ControlBridgeSettings: () => <section aria-label="Local control settings" />,
}));

function SettingsHarness() {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  return (
    <SettingsModal
      isOpen
      onClose={() => undefined}
      preferences={preferences}
      onUpdatePreferences={setPreferences}
    />
  );
}

describe("SettingsModal", () => {
  it("uses labelled Toolcraft choices and sliders for the main visual controls", () => {
    render(<SettingsHarness />);

    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();

    expect(screen.getByRole("radiogroup", { name: "Accent color" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Blue" }));
    expect(screen.getByRole("radio", { name: "Blue" })).toBeChecked();

    for (const name of ["Font size", "Opacity", "Snap threshold"]) {
      expect(screen.getByRole("slider", { name }).closest("[data-toolcraft-control=slider]"))
        .toHaveAttribute("data-toolcraft-control", "slider");
    }
    expect(screen.getByRole("button", { name: "Blue frame label color" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("removes every frame-label option from keyboard use when indices are hidden", () => {
    render(<SettingsHarness />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Show Frame Indices" }));
    const options = screen.getByRole("group", { name: "Frame label options" });
    expect(options).toBeDisabled();
    expect(within(options).getByRole("combobox", { name: "Position" })).toBeDisabled();
    expect(within(options).getByRole("slider", { name: "Font size" })).toBeDisabled();
    expect(within(options).getByRole("slider", { name: "Opacity" })).toBeDisabled();
    expect(within(options).getByRole("button", { name: "Blue frame label color" }))
      .toBeDisabled();
    expect(within(options).getByRole("textbox", { name: "Frame label color hex" }))
      .toBeDisabled();
    expect(screen.getByText("Turn on frame indices to edit these options."))
      .toBeInTheDocument();
  });
});
