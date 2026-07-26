import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ColorControl, normalizeHexColor } from "../../components/toolcraft/ColorControl";
import { hexToHsv, hsvToHex } from "../../components/toolcraft/colorValue";
import { FileDropControl, normalizeFileAccept } from "../../components/toolcraft/FileDropControl";
import { SegmentedControl } from "../../components/toolcraft/SegmentedControl";
import { SelectControl } from "../../components/toolcraft/SelectControl";

const OPTIONS = [
  { label: "All frames", value: "all" },
  { label: "Sample FPS", value: "fps" },
  { label: "Unavailable", value: "off", disabled: true },
] as const;

describe("SegmentedControl", () => {
  it("exposes a named radio group and changes enabled options", () => {
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        name="Frame mode"
        options={OPTIONS}
        value="all"
        onValueChange={onValueChange}
      />,
    );

    expect(screen.getByRole("radiogroup", { name: "Frame mode" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All frames" })).toBeChecked();
    const fps = screen.getByRole("radio", { name: "Sample FPS" });
    fps.focus();
    expect(fps).toHaveFocus();
    fireEvent.click(fps);
    expect(onValueChange).toHaveBeenCalledWith("fps");
    expect(screen.getByRole("radio", { name: "Unavailable" })).toBeDisabled();
  });

  it("syncs controlled changes and falls back when the current option disappears", () => {
    const { rerender } = render(
      <SegmentedControl name="Mode" options={OPTIONS} value="all" />,
    );
    rerender(<SegmentedControl name="Mode" options={OPTIONS} value="fps" />);
    expect(screen.getByRole("radio", { name: "Sample FPS" })).toBeChecked();

    rerender(
      <SegmentedControl
        name="Mode"
        options={[{ label: "Only", value: "only" }]}
        value="missing"
      />,
    );
    expect(screen.getByRole("radio", { name: "Only" })).toBeChecked();
  });

  it("blocks the whole group when disabled", () => {
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        name="Mode"
        options={OPTIONS}
        disabled
        onValueChange={onValueChange}
      />,
    );
    const fps = screen.getByRole("radio", { name: "Sample FPS" });
    expect(fps).toBeDisabled();
    fireEvent.click(fps);
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe("SelectControl", () => {
  it("supports visible and aria-only labels and emits a selection", () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <SelectControl
        name="Codec"
        options={OPTIONS}
        value="all"
        onValueChange={onValueChange}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Codec" });
    fireEvent.change(select, { target: { value: "fps" } });
    expect(onValueChange).toHaveBeenCalledWith("fps");

    rerender(
      <SelectControl name="Codec compact" options={OPTIONS} value="fps" showLabel={false} />,
    );
    expect(screen.getByRole("combobox", { name: "Codec compact" })).toHaveValue("fps");
  });

  it("falls back to the first enabled option and preserves disabled states", () => {
    render(<SelectControl name="Codec" options={OPTIONS} value="missing" />);
    expect(screen.getByRole("combobox", { name: "Codec" })).toHaveValue("all");
    expect(screen.getByRole("option", { name: "Unavailable" })).toBeDisabled();
  });

  it("blocks changes when disabled", () => {
    const onValueChange = vi.fn();
    render(
      <SelectControl
        name="Codec"
        options={OPTIONS}
        value="all"
        disabled
        onValueChange={onValueChange}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Codec" });
    expect(select).toBeDisabled();
    fireEvent.change(select, { target: { value: "fps" } });
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe("ColorControl", () => {
  it("normalizes supported hex forms and rejects invalid values", () => {
    expect(normalizeHexColor("#abc")).toBe("#AABBCC");
    expect(normalizeHexColor("abc")).toBe("#AABBCC");
    expect(normalizeHexColor("#12abEF")).toBe("#12ABEF");
    expect(normalizeHexColor("12abEF")).toBe("#12ABEF");
    expect(normalizeHexColor("#abcd")).toBeNull();
    expect(normalizeHexColor("red")).toBeNull();
  });

  it("keeps swatch and text in sync, merges live history, and commits once", () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    render(
      <ColorControl
        name="Mask"
        hex="#000000"
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );
    const text = screen.getByRole("textbox", { name: "Mask hex" });
    const swatch = screen.getByLabelText("Mask swatch");
    fireEvent.change(text, { target: { value: "#123456" } });
    expect(swatch.querySelector("[data-color]")).toHaveAttribute("data-color", "#123456");
    expect(onValueChange).toHaveBeenCalledWith(
      { hex: "#123456" },
      expect.objectContaining({ history: "merge", historyGroup: expect.any(String) }),
    );
    fireEvent.blur(text);
    fireEvent.blur(text);
    expect(onValueCommit).toHaveBeenCalledTimes(1);
    expect(onValueCommit).toHaveBeenCalledWith({ hex: "#123456" });
  });

  it("keeps one live group when the host controls the value", () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    function ControlledColor() {
      const [hex, setHex] = useState("#000000");
      return (
        <ColorControl
          name="Controlled"
          hex={hex}
          onValueChange={(next, meta) => {
            onValueChange(next, meta);
            setHex(next.hex);
          }}
          onValueCommit={onValueCommit}
        />
      );
    }
    render(<ControlledColor />);
    const text = screen.getByRole("textbox", { name: "Controlled hex" });
    fireEvent.change(text, { target: { value: "#123456" } });
    fireEvent.blur(text);

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueCommit).toHaveBeenCalledTimes(1);
    expect(onValueCommit).toHaveBeenCalledWith({ hex: "#123456" });
  });

  it("opens the Toolcraft surface, hue and channel picker without a native color input", () => {
    render(<ColorControl name="Mask" hex="#336699" />);
    fireEvent.click(screen.getByRole("button", { name: "Mask swatch" }));
    expect(screen.getByLabelText("Mask color picker")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Mask saturation and brightness" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Mask hue" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Mask color format" })).toBeInTheDocument();
    expect(document.querySelector('input[type="color"]')).toBeNull();
  });

  it("round-trips Toolcraft HSV conversion", () => {
    expect(hsvToHex(hexToHsv("#336699"))).toBe("#336699");
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe("#FF0000");
  });

  it("commits short hex, restores invalid drafts, and cancels with Escape", () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    render(
      <ColorControl
        name="Guide"
        hex="#112233"
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );
    const text = screen.getByRole("textbox", { name: "Guide hex" });
    fireEvent.change(text, { target: { value: "#abc" } });
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.blur(text);
    expect(onValueChange).toHaveBeenCalledWith(
      { hex: "#AABBCC" },
      expect.objectContaining({ history: "merge" }),
    );
    expect(onValueCommit).toHaveBeenCalledWith({ hex: "#AABBCC" });

    onValueChange.mockClear();
    onValueCommit.mockClear();
    fireEvent.change(text, { target: { value: "bad value" } });
    fireEvent.blur(text);
    expect(text).toHaveValue("#112233");
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onValueCommit).not.toHaveBeenCalled();

    fireEvent.change(text, { target: { value: "#445566" } });
    onValueChange.mockClear();
    fireEvent.keyDown(text, { key: "Escape" });
    expect(text).toHaveValue("#112233");
    expect(onValueChange).toHaveBeenCalledWith(
      { hex: "#112233" },
      expect.objectContaining({ history: "merge", historyGroup: expect.any(String) }),
    );
    expect(onValueCommit).not.toHaveBeenCalled();
  });

  it("syncs controlled changes and blocks disabled callbacks", () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    const { rerender } = render(
      <ColorControl
        name="Tint"
        hex="#000000"
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );
    rerender(
      <ColorControl
        name="Tint"
        hex="#FFFFFF"
        disabled
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );
    const text = screen.getByRole("textbox", { name: "Tint hex" });
    expect(text).toHaveValue("#FFFFFF");
    expect(text).toBeDisabled();
    fireEvent.change(text, { target: { value: "#123456" } });
    fireEvent.blur(text);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onValueCommit).not.toHaveBeenCalled();
  });
});

describe("FileDropControl", () => {
  it("normalizes aliases, preserves valid patterns, and removes duplicates", () => {
    expect(normalizeFileAccept("png, JPG, image/*, .mov, nope, png")).toBe(
      ".png,image/png,.jpg,.jpeg,image/jpeg,image/*,.mov",
    );
    expect(normalizeFileAccept("mp4, webm")).toBe(
      ".mp4,video/mp4,.webm,video/webm",
    );
  });

  it("selects one file from input or drop", () => {
    const onFileSelect = vi.fn();
    const first = new File(["a"], "first.png", { type: "image/png" });
    const second = new File(["b"], "second.png", { type: "image/png" });
    const { container } = render(
      <FileDropControl accept="png" name="Artwork" onFileSelect={onFileSelect} />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("Missing file input");
    fireEvent.change(input, { target: { files: [first, second] } });
    expect(onFileSelect).toHaveBeenCalledWith(first);

    fireEvent.drop(screen.getByRole("button", { name: "Artwork" }), {
      dataTransfer: { files: [second] },
    });
    expect(onFileSelect).toHaveBeenLastCalledWith(second);
  });

  it("handles multiple files once or falls back per file", () => {
    const files = [
      new File(["a"], "a.webm", { type: "video/webm" }),
      new File(["b"], "b.webm", { type: "video/webm" }),
    ];
    const onFilesSelect = vi.fn();
    const { rerender } = render(
      <FileDropControl accept="webm" multiple name="Videos" onFilesSelect={onFilesSelect} />,
    );
    fireEvent.drop(screen.getByRole("button", { name: "Videos" }), {
      dataTransfer: { files },
    });
    expect(onFilesSelect).toHaveBeenCalledTimes(1);
    expect(onFilesSelect).toHaveBeenCalledWith(files);

    const onFileSelect = vi.fn();
    rerender(
      <FileDropControl accept="webm" multiple name="Videos" onFileSelect={onFileSelect} />,
    );
    fireEvent.drop(screen.getByRole("button", { name: "Videos" }), {
      dataTransfer: { files },
    });
    expect(onFileSelect.mock.calls.map(([file]) => file)).toEqual(files);
  });

  it("opens with click, Enter and Space and blocks all disabled actions", () => {
    const onFileSelect = vi.fn();
    const file = new File(["x"], "x.mp4", { type: "video/mp4" });
    const { container, rerender } = render(
      <FileDropControl accept="mp4" name="Video" onFileSelect={onFileSelect} />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("Missing file input");
    const click = vi.spyOn(input, "click").mockImplementation(() => undefined);
    const target = screen.getByRole("button", { name: "Video" });
    target.focus();
    expect(target).toHaveFocus();
    fireEvent.click(target);
    fireEvent.keyDown(target, { key: "Enter" });
    fireEvent.keyDown(target, { key: " " });
    expect(click).toHaveBeenCalledTimes(3);

    rerender(
      <FileDropControl accept="mp4" name="Video" disabled onFileSelect={onFileSelect} />,
    );
    const disabledTarget = screen.getByRole("button", { name: "Video" });
    expect(disabledTarget).toHaveAttribute("aria-disabled", "true");
    expect(disabledTarget).toHaveAttribute("tabindex", "-1");
    fireEvent.click(disabledTarget);
    fireEvent.keyDown(disabledTarget, { key: "Enter" });
    fireEvent.drop(disabledTarget, { dataTransfer: { files: [file] } });
    expect(click).toHaveBeenCalledTimes(3);
    expect(onFileSelect).not.toHaveBeenCalled();
  });
});
