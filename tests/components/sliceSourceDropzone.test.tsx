import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SliceSourceDropzone } from "../../features/slice/source/SliceSourceDropzone";
import type { SourceSessionSnapshot } from "../../features/slice/source/sourceSession";

const idle: SourceSessionSnapshot = Object.freeze({
  status: "idle",
  generation: 0,
  disposed: false,
  metadata: null,
  source: null,
  error: null,
});

function fileList(file: File): FileList {
  return {
    0: file,
    length: 1,
    item: (index: number) => index === 0 ? file : null,
    [Symbol.iterator]: function* () { yield file; },
  } as unknown as FileList;
}

describe("SliceSourceDropzone", () => {
  it("offers a keyboard file-picker alternative and documents the source policy", () => {
    const onBrowse = vi.fn();
    render(
      <SliceSourceDropzone snapshot={idle} onBrowse={onBrowse} onSelect={vi.fn()} />,
    );

    expect(screen.getByRole("heading", { name: "Bring in a spritesheet" })).toBeInTheDocument();
    expect(screen.getByText(/PNG, JPEG or WebP · maximum 10 MiB/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose source image" }));
    expect(onBrowse).toHaveBeenCalledOnce();
  });

  it("routes a dropped FileList once and exposes visual drag state", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <SliceSourceDropzone snapshot={idle} onBrowse={vi.fn()} onSelect={onSelect} />,
    );
    const dropzone = container.querySelector("[data-slice-source-dropzone]") as HTMLElement;
    const files = fileList(new File(["pixels"], "sheet.png", { type: "image/png" }));

    fireEvent.dragEnter(dropzone, { dataTransfer: { files, dropEffect: "none" } });
    expect(dropzone).toHaveAttribute("data-drop-active", "true");
    expect(screen.getByRole("heading", { name: "Drop the spritesheet here" })).toBeInTheDocument();
    fireEvent.drop(dropzone, { dataTransfer: { files, dropEffect: "copy" } });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(files);
    expect(dropzone).not.toHaveAttribute("data-drop-active");
  });

  it("announces progress and blocks browse/drop while the session owns an operation", () => {
    const onBrowse = vi.fn();
    const onSelect = vi.fn();
    const validating: SourceSessionSnapshot = Object.freeze({
      status: "validating",
      generation: 1,
      disposed: false,
      metadata: null,
      source: null,
      error: null,
    });
    const { container } = render(
      <SliceSourceDropzone snapshot={validating} onBrowse={onBrowse} onSelect={onSelect} />,
    );
    const dropzone = container.querySelector("[data-slice-source-dropzone]") as HTMLElement;
    const files = fileList(new File(["pixels"], "sheet.png", { type: "image/png" }));

    expect(dropzone).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(/Checking file type/i);
    expect(screen.getByRole("button", { name: "Choose source image" })).toBeDisabled();
    fireEvent.drop(dropzone, { dataTransfer: { files, dropEffect: "none" } });
    expect(onBrowse).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("announces the commit bridge as busy after validation", () => {
    render(
      <SliceSourceDropzone
        snapshot={idle}
        committing
        onBrowse={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/Opening the validated source/i);
    expect(screen.getByRole("button", { name: "Choose source image" })).toBeDisabled();
  });

  it("announces a retryable error and invokes retry without reopening the picker", () => {
    const onRetry = vi.fn();
    const failed: SourceSessionSnapshot = Object.freeze({
      status: "error",
      generation: 2,
      disposed: false,
      metadata: null,
      source: null,
      error: Object.freeze({
        code: "read-failed",
        message: "Image source bytes could not be read.",
        retryable: true,
      }),
    });
    render(
      <SliceSourceDropzone
        snapshot={failed}
        onBrowse={vi.fn()}
        onSelect={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Image source bytes could not be read.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("contains hostile drop boundaries and reports a recoverable selection error", () => {
    const { container } = render(
      <SliceSourceDropzone snapshot={idle} onBrowse={vi.fn()} onSelect={vi.fn()} />,
    );
    const dropzone = container.querySelector("[data-slice-source-dropzone]") as HTMLElement;
    const dataTransfer = {
      get files(): FileList {
        throw new Error("revoked host object");
      },
      dropEffect: "none",
    };

    expect(() => fireEvent.drop(dropzone, { dataTransfer })).not.toThrow();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be read/i);
  });

  it("contains rejected async selection callbacks without leaking an unhandled rejection", async () => {
    const { container } = render(
      <SliceSourceDropzone
        snapshot={idle}
        onBrowse={vi.fn()}
        onSelect={() => Promise.reject(new Error("adapter failed"))}
      />,
    );
    const dropzone = container.querySelector("[data-slice-source-dropzone]") as HTMLElement;
    const files = fileList(new File(["pixels"], "sheet.png", { type: "image/png" }));

    await act(async () => {
      fireEvent.drop(dropzone, { dataTransfer: { files, dropEffect: "copy" } });
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/Choose the file again/i);
  });
});
