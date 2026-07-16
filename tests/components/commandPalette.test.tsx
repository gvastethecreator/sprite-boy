import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createStudioCommandRegistry,
  type StudioCommandContext,
  type StudioCommandHandlers,
} from "../../core/studio";
import CommandPalette from "../../components/overlays/CommandPalette";

function handlers(): StudioCommandHandlers {
  return {
    newProject: vi.fn(),
    openProject: vi.fn(),
    saveProject: vi.fn(),
    importAsset: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    openWorkspace: vi.fn(),
    resetCanvas: vi.fn(),
    openCommandPalette: vi.fn(),
    openPreferences: vi.fn(),
    openHelp: vi.fn(),
  };
}

const ready: StudioCommandContext = {
  projectAvailable: true,
  projectOpenAvailable: true,
  busy: false,
  canUndo: true,
  canRedo: true,
  canvasAvailable: true,
};

describe("CommandPalette registry adapter", () => {
  it("searches metadata and routes enabled commands by canonical ID", () => {
    const onExecute = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        isOpen
        onClose={onClose}
        registry={createStudioCommandRegistry(handlers())}
        context={ready}
        onExecute={onExecute}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Search commands" }), {
      target: { value: "collision" },
    });
    const command = screen.getByRole("button", { name: /Open Collision/i });
    expect(command).toHaveTextContent("workspace");
    fireEvent.click(command);

    expect(onExecute).toHaveBeenCalledWith("workspace.open.collision");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("explains disabled commands and never routes them", () => {
    const onExecute = vi.fn();
    render(
      <CommandPalette
        isOpen
        onClose={vi.fn()}
        registry={createStudioCommandRegistry(handlers())}
        context={{ ...ready, projectAvailable: false }}
        onExecute={onExecute}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Search commands" }), {
      target: { value: "save project" },
    });
    const command = screen.getByRole("button", { name: /Save project/i });
    expect(command).toBeDisabled();
    expect(command).toHaveTextContent("Open or create a project first.");
    fireEvent.click(command);
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("handles empty keyboard results without modulo or execution errors", () => {
    const onExecute = vi.fn();
    render(
      <CommandPalette
        isOpen
        onClose={vi.fn()}
        registry={createStudioCommandRegistry(handlers())}
        context={ready}
        onExecute={onExecute}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Search commands" });
    fireEvent.change(input, { target: { value: "no-such-command" } });
    expect(screen.getByText("No matching commands.")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onExecute).not.toHaveBeenCalled();
  });
});
