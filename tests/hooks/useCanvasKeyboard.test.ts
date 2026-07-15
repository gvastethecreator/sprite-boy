import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useCanvasKeyboard } from "../../hooks/canvas/useCanvasTools";

afterEach(() => {
  document.body.replaceChildren();
});

describe("useCanvasKeyboard", () => {
  it("owns Space only while workspace content is focused", () => {
    const workspace = document.createElement("div");
    workspace.dataset.studioWorkspaceContent = "slice";
    workspace.tabIndex = -1;
    document.body.append(workspace);
    workspace.focus();
    const { result } = renderHook(() => useCanvasKeyboard());
    const down = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Space",
      key: " ",
    });

    act(() => window.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true);
    expect(result.current.isSpacePressed).toBe(true);

    act(() => window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " " })));
    expect(result.current.isSpacePressed).toBe(false);
  });

  it("clears pan and modifiers on key release or window blur", () => {
    const workspace = document.createElement("div");
    workspace.dataset.studioWorkspaceContent = "compose";
    workspace.tabIndex = -1;
    document.body.append(workspace);
    workspace.focus();
    const { result } = renderHook(() => useCanvasKeyboard());

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", {
      code: "Space",
      key: " ",
      ctrlKey: true,
      shiftKey: true,
    })));
    expect(result.current.isSpacePressed).toBe(true);
    expect(result.current.modifiers).toEqual({ shift: true, ctrl: true, alt: false });

    act(() => window.dispatchEvent(new KeyboardEvent("keyup", {
      code: "ControlLeft",
      key: "Control",
      shiftKey: true,
    })));
    expect(result.current.modifiers).toEqual({ shift: true, ctrl: false, alt: false });

    act(() => window.dispatchEvent(new Event("blur")));
    expect(result.current.isSpacePressed).toBe(false);
    expect(result.current.modifiers).toEqual({ shift: false, ctrl: false, alt: false });
  });

  it("never captures Space from editable targets or playback ownership", () => {
    const workspace = document.createElement("div");
    workspace.dataset.studioWorkspaceContent = "animate";
    workspace.tabIndex = -1;
    const textarea = document.createElement("textarea");
    workspace.append(textarea);
    document.body.append(workspace);
    textarea.focus();
    const { result, rerender } = renderHook(
      ({ enabled }) => useCanvasKeyboard({ spacePanEnabled: enabled }),
      { initialProps: { enabled: true } },
    );
    const editableSpace = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Space",
      key: " ",
    });

    act(() => textarea.dispatchEvent(editableSpace));
    expect(editableSpace.defaultPrevented).toBe(false);
    expect(result.current.isSpacePressed).toBe(false);

    workspace.focus();
    rerender({ enabled: false });
    const playbackSpace = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Space",
      key: " ",
    });
    act(() => window.dispatchEvent(playbackSpace));
    expect(playbackSpace.defaultPrevented).toBe(false);
    expect(result.current.isSpacePressed).toBe(false);
  });
});
