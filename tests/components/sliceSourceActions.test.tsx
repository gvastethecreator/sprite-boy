import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useRef, useState } from "react";
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
    expect(screen.getByRole("button", { name: "Retry" })).toHaveFocus();
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
    expect(screen.getByRole("button", { name: "Replace source" })).toHaveFocus();
  });

  it("contains rejected async retry callbacks and restores retry focus without rendering the rejection", async () => {
    render(
      <SliceSourceActions
        error={{ code: "decode", message: "Replacement decode failed.", retryable: true }}
        onReplace={vi.fn()}
        onRequestReset={vi.fn()}
        onRetry={() => Promise.reject(new Error("private adapter error"))}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/Retry could not start/i);
    expect(screen.queryByText("private adapter error")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toHaveFocus();
  });

  it("contains async Replace rejection, keeps the source boundary intact and restores Replace focus", async () => {
    const onRequestReset = vi.fn();
    render(
      <SliceSourceActions
        onReplace={() => Promise.reject(new Error("private picker adapter error"))}
        onRequestReset={onRequestReset}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Replace source" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/source picker could not open/i);
    expect(screen.queryByText("private picker adapter error")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace source" })).toHaveFocus();
    expect(onRequestReset).not.toHaveBeenCalled();
  });

  it("keeps async boundary feedback armed after the StrictMode effect replay", async () => {
    render(
      <StrictMode>
        <SliceSourceActions
          onReplace={() => Promise.reject(new Error("private strict-mode rejection"))}
          onRequestReset={vi.fn()}
        />
      </StrictMode>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Replace source" }));
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/source picker could not open/i);
    expect(screen.queryByText("private strict-mode rejection")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace source" })).toHaveFocus();
  });

  it("contains sync and async Reset rejection while leaving Reset usable during busy work", async () => {
    const syncFailure = vi.fn(() => {
      throw new Error("private reset failure");
    });
    const view = render(
      <SliceSourceActions
        busy
        onReplace={vi.fn()}
        onRequestReset={syncFailure}
      />,
    );

    const reset = screen.getByRole("button", { name: "Reset source" });
    expect(reset).toBeEnabled();
    await act(async () => {
      fireEvent.click(reset);
      await Promise.resolve();
    });
    expect(syncFailure).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent(/Reset could not start/i);
    expect(screen.queryByText("private reset failure")).not.toBeInTheDocument();
    expect(reset).toHaveFocus();

    view.rerender(
      <SliceSourceActions
        onReplace={vi.fn()}
        onRequestReset={() => Promise.reject({ private: "adapter reset rejection" })}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reset source" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/Reset could not start/i);
    expect(screen.queryByText("adapter reset rejection")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset source" })).toHaveFocus();
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
