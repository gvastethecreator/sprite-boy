import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStudioCommandRegistry,
  type StudioCommandHandlers,
  type StudioCommandId,
} from "../../core/studio";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";

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

function keyDown(
  target: EventTarget,
  code: string,
  options: KeyboardEventInit = {},
) {
  target.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code,
    ...options,
  }));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("useKeyboardShortcuts", () => {
  it("dispatches locale-independent global commands through the registry", () => {
    const executeStudioCommand = vi.fn<(commandId: StudioCommandId) => void>();
    renderHook(() => useKeyboardShortcuts({
      registry: createStudioCommandRegistry(handlers()),
      executeStudioCommand,
      deleteSelection: vi.fn(),
      nudge: vi.fn(),
      togglePlay: vi.fn(),
      stepFrame: vi.fn(),
      closeModals: vi.fn(),
      isModalOpen: false,
      activeAnimationId: null,
    }));

    act(() => keyDown(window, "Digit4", { key: "ç", ctrlKey: true }));
    act(() => keyDown(window, "Comma", { key: ";", metaKey: true }));

    expect(executeStudioCommand.mock.calls.map(([commandId]) => commandId)).toEqual([
      "workspace.open.collision",
      "app.openPreferences",
    ]);
  });

  it("honors editable and modal ownership before global or domain keys", () => {
    const executeStudioCommand = vi.fn<(commandId: StudioCommandId) => void>();
    const closeModals = vi.fn();
    const nudge = vi.fn();
    const input = document.createElement("textarea");
    document.body.append(input);
    input.focus();

    const { rerender } = renderHook(
      ({ isModalOpen }) => useKeyboardShortcuts({
        registry: createStudioCommandRegistry(handlers()),
        executeStudioCommand,
        deleteSelection: vi.fn(),
        nudge,
        togglePlay: vi.fn(),
        stepFrame: vi.fn(),
        closeModals,
        isModalOpen,
        activeAnimationId: null,
      }),
      { initialProps: { isModalOpen: false } },
    );

    act(() => keyDown(input, "KeyS", { key: "s", ctrlKey: true }));
    act(() => keyDown(input, "KeyK", { key: "k", ctrlKey: true }));
    expect(executeStudioCommand).toHaveBeenCalledOnce();
    expect(executeStudioCommand).toHaveBeenCalledWith("app.openCommandPalette");
    expect(nudge).not.toHaveBeenCalled();

    rerender({ isModalOpen: true });
    act(() => keyDown(window, "Digit1", { key: "1", ctrlKey: true }));
    act(() => keyDown(window, "Escape", { key: "Escape" }));
    expect(executeStudioCommand).toHaveBeenCalledOnce();
    expect(closeModals).toHaveBeenCalledOnce();
  });

  it("keeps repeatable editor keys local and de-bounces playback", () => {
    const nudge = vi.fn();
    const togglePlay = vi.fn();
    const stepFrame = vi.fn();
    const { rerender } = renderHook(
      ({ activeAnimationId }) => useKeyboardShortcuts({
        registry: createStudioCommandRegistry(handlers()),
        executeStudioCommand: vi.fn(),
        deleteSelection: vi.fn(),
        nudge,
        togglePlay,
        stepFrame,
        closeModals: vi.fn(),
        isModalOpen: false,
        activeAnimationId,
      }),
      { initialProps: { activeAnimationId: null as string | null } },
    );

    act(() => keyDown(window, "ArrowRight", { key: "ArrowRight", shiftKey: true, repeat: true }));
    expect(nudge).toHaveBeenCalledWith(10, 0);

    rerender({ activeAnimationId: "walk" });
    act(() => keyDown(window, "ArrowLeft", { key: "ArrowLeft" }));
    act(() => keyDown(window, "Space", { key: " ", repeat: true }));
    act(() => keyDown(window, "Space", { key: " " }));
    expect(stepFrame).toHaveBeenCalledWith(-1);
    expect(togglePlay).toHaveBeenCalledOnce();
  });
});
