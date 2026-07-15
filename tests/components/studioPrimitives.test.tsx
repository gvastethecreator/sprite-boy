import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { StudioDialog } from "../../components/studio/StudioDialog";
import { StudioPanel } from "../../components/studio/StudioPanel";

function DialogHarness({ conditional = false }: { conditional?: boolean }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const initialFocusRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const dialog = (
    <StudioDialog
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      labelledBy="dialog-title"
      initialFocusRef={initialFocusRef}
      restoreFocusRef={triggerRef}
      data-testid="studio-dialog"
    >
      <h2 id="dialog-title">Rename sprite</h2>
      <input ref={initialFocusRef} aria-label="Name" />
      <button type="button">Save</button>
    </StudioDialog>
  );

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setIsOpen(true)}>
        Open dialog
      </button>
      {conditional ? (isOpen ? dialog : null) : dialog}
    </>
  );
}

describe("StudioDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes dialog semantics and focuses the deterministic initial target", () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Rename sprite" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "dialog-title");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
  });

  it("wraps Tab and Shift+Tab within the dialog", () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    fireEvent.click(trigger);

    const input = screen.getByRole("textbox", { name: "Name" });
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    fireEvent.keyDown(save, { key: "Tab" });
    expect(input).toHaveFocus();

    input.focus();
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(save).toHaveFocus();
  });

  it("closes from Escape/backdrop and restores the exact trigger focus", () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    fireEvent.click(trigger);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId("studio-dialog").parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("supports disabling Escape and backdrop close", () => {
    const onClose = vi.fn();
    render(
      <StudioDialog
        isOpen
        onClose={onClose}
        ariaLabel="Persistent dialog"
        closeOnEscape={false}
        closeOnBackdrop={false}
      >
        <button type="button">Keep open</button>
      </StudioDialog>,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Keep open" }), { key: "Escape" });
    fireEvent.click(document.querySelector("[data-studio-dialog-backdrop]") as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Persistent dialog" })).toBeInTheDocument();
  });

  it("honors reduced motion and removes the media-query listener on close", async () => {
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as MediaQueryList;
    const previousMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => mediaQuery),
    });

    const { rerender } = render(
      <StudioDialog isOpen onClose={vi.fn()} ariaLabel="Reduced motion dialog">
        <button type="button">Action</button>
      </StudioDialog>,
    );

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveAttribute("data-reduced-motion", "true");
      expect(mediaQuery.addEventListener).toHaveBeenCalledTimes(1);
    });

    rerender(
      <StudioDialog isOpen={false} onClose={vi.fn()} ariaLabel="Reduced motion dialog">
        <button type="button">Action</button>
      </StudioDialog>,
    );
    expect(mediaQuery.removeEventListener).toHaveBeenCalledTimes(1);

    if (previousMatchMedia) {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: previousMatchMedia,
      });
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
  });

  it("restores focus when a parent conditionally unmounts the open dialog", () => {
    render(<DialogHarness conditional />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "Escape" });
    expect(trigger).toHaveFocus();
  });
});

describe("StudioPanel", () => {
  it("is a labelled complementary panel with an optional close affordance", () => {
    const onClose = vi.fn();
    render(
      <StudioPanel label="Layers" variant="drawer" onClose={onClose} data-testid="layers-panel">
        <div>Layer list</div>
      </StudioPanel>,
    );

    const panel = screen.getByRole("complementary", { name: "Layers" });
    expect(panel).toHaveAttribute("data-studio-panel-variant", "drawer");
    expect(screen.getByRole("heading", { name: "Layers" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close Layers" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render a close button when no close handler is supplied", () => {
    render(<StudioPanel label="Tools">Tool controls</StudioPanel>);
    expect(screen.getByRole("complementary", { name: "Tools" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close tools/i })).not.toBeInTheDocument();
  });
});
