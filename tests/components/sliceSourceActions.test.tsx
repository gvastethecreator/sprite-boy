import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SliceSourceActions } from "../../features/slice/source/SliceSourceActions";
import { SliceSourceResetDialog } from "../../features/slice/source/SliceSourceResetDialog";

function ResetHarness({ onConfirm }: { readonly onConfirm: () => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>Open reset</button>
      <SliceSourceResetDialog
        isOpen={open}
        sourceName="hero.png"
        restoreFocusRef={triggerRef}
        onCancel={() => setOpen(false)}
        onConfirm={onConfirm}
      />
    </>
  );
}

describe("Slice source replace/reset controls (G0-04)", () => {
  it("keeps reset available to abort a busy replacement", () => {
    const onReplace = vi.fn();
    const onReset = vi.fn();
    render(
      <SliceSourceActions
        busy
        onReplace={onReplace}
        onRequestReset={onReset}
      />,
    );

    expect(screen.getByRole("button", { name: "Replacing…" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/current source stays active/i);
    fireEvent.click(screen.getByRole("button", { name: "Reset source" }));
    expect(onReplace).not.toHaveBeenCalled();
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("contains replacement errors and exposes retry only when valid", () => {
    const onRetry = vi.fn();
    const view = render(
      <SliceSourceActions
        error={{ code: "decode", message: "Replacement decode failed.", retryable: true }}
        onReplace={vi.fn()}
        onRequestReset={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/current source was kept/i);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();

    view.rerender(
      <SliceSourceActions
        error={{ code: "memory", message: "Replacement is too large.", retryable: false }}
        onReplace={vi.fn()}
        onRequestReset={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("requires an accessible confirmation and cancel restores the trigger", () => {
    const onConfirm = vi.fn();
    render(<ResetHarness onConfirm={onConfirm} />);
    const trigger = screen.getByRole("button", { name: "Open reset" });
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "Reset the Slice source?" })).toBeInTheDocument();
    expect(screen.getByText(/preferences and the asset library stay intact/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep source" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Keep source" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it("invokes destructive reset only from the explicit confirmation", () => {
    const onConfirm = vi.fn();
    render(<ResetHarness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Open reset" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset source" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
