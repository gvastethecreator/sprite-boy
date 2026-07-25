import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createControlHistoryGroupId } from "../../components/toolcraft/controlTypes";
import {
  clampSliderValue,
  formatSliderValueWithUnit,
  normalizeSliderRange,
  snapSliderValue,
} from "../../components/toolcraft/sliderValue";
import { SliderControl } from "../../components/toolcraft/SliderControl";
import { RangeSliderControl } from "../../components/toolcraft/RangeSliderControl";

describe("sliderValue pure helpers", () => {
  it("normalizes reversed and equal bounds and invalid step", () => {
    expect(normalizeSliderRange(10, 0, 1)).toEqual({ min: 0, max: 10, step: 1 });
    expect(normalizeSliderRange(5, 5, 1)).toEqual({ min: 5, max: 6, step: 1 });
    expect(normalizeSliderRange(0, 10, 0)).toEqual({ min: 0, max: 10, step: 1 });
    expect(normalizeSliderRange(0, 10, -2)).toEqual({ min: 0, max: 10, step: 1 });
    expect(normalizeSliderRange(0, 10, Number.NaN)).toEqual({
      min: 0,
      max: 10,
      step: 1,
    });
  });

  it("clamps non-finite values to min and snaps decimals to step", () => {
    expect(clampSliderValue(Number.NaN, 2, 8)).toBe(2);
    expect(clampSliderValue(Number.POSITIVE_INFINITY, 2, 8)).toBe(2);
    expect(clampSliderValue(Number.NaN, 10, 0)).toBe(0);
    expect(clampSliderValue(3, 0, 10)).toBe(3);
    expect(clampSliderValue(-1, 0, 10)).toBe(0);
    expect(clampSliderValue(99, 0, 10)).toBe(10);

    expect(snapSliderValue(0.24, { min: 0, max: 1, step: 0.1 })).toBe(0.2);
    expect(snapSliderValue(0.26, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
    expect(snapSliderValue(Number.NaN, { min: 1, max: 5, step: 0.5 })).toBe(1);
    expect(snapSliderValue(1.15, { min: 0, max: 2, step: 0.25 })).toBe(1.25);
  });

  it("formats compact and spaced units", () => {
    expect(formatSliderValueWithUnit(50, 1, "%")).toBe("50%");
    expect(formatSliderValueWithUnit(90, 1, "°")).toBe("90°");
    expect(formatSliderValueWithUnit(12, 1, "px")).toBe("12px");
    expect(formatSliderValueWithUnit(1, 1, "s")).toBe("1s");
    expect(formatSliderValueWithUnit(16, 1, "ms")).toBe("16ms");
    expect(formatSliderValueWithUnit(2.5, 0.1, "em")).toBe("2.5 em");
    expect(formatSliderValueWithUnit(3, 1, "frames")).toBe("3 frames");
    expect(formatSliderValueWithUnit(4, 1)).toBe("4");
    expect(formatSliderValueWithUnit(4, 1, "")).toBe("4");
    expect(formatSliderValueWithUnit(50, 1, "  %  ")).toBe("50%");
    expect(formatSliderValueWithUnit(2.5, 0.1, "  em  ")).toBe("2.5 em");
    expect(formatSliderValueWithUnit(4, 1, "   ")).toBe("4");
  });
});

describe("createControlHistoryGroupId", () => {
  it("returns a new non-empty id per call without randomness", () => {
    const a = createControlHistoryGroupId("opacity");
    const b = createControlHistoryGroupId("opacity");
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
    expect(a.startsWith("opacity:")).toBe(true);
  });
});

describe("SliderControl", () => {
  it("exposes accessible name and value text", () => {
    render(
      <SliderControl name="Opacity" value={40} min={0} max={100} unit="%" />,
    );
    const slider = screen.getByRole("slider", { name: "Opacity" });
    expect(slider).toHaveAttribute("aria-valuetext", "40%");
    expect(screen.getByText("Opacity")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("syncs controlled prop changes and blocks callbacks when disabled", () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    const { rerender } = render(
      <SliderControl
        name="Size"
        value={10}
        min={0}
        max={100}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );
    expect(screen.getByRole("slider", { name: "Size" })).toHaveValue("10");

    rerender(
      <SliderControl
        name="Size"
        value={55}
        min={0}
        max={100}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );
    expect(screen.getByRole("slider", { name: "Size" })).toHaveValue("55");

    rerender(
      <SliderControl
        name="Size"
        value={55}
        min={0}
        max={100}
        disabled
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );
    const disabledSlider = screen.getByRole("slider", { name: "Size" });
    fireEvent.change(disabledSlider, { target: { value: "70" } });
    fireEvent.pointerUp(disabledSlider);
    fireEvent.doubleClick(disabledSlider);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onValueCommit).not.toHaveBeenCalled();
  });

  it("resets to baseValue on double-click", () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    render(
      <SliderControl
        name="Zoom"
        value={80}
        baseValue={50}
        min={0}
        max={100}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );
    fireEvent.doubleClick(screen.getByRole("slider", { name: "Zoom" }));
    expect(onValueChange).toHaveBeenCalledWith(50, expect.objectContaining({ history: "record" }));
    expect(onValueCommit).toHaveBeenCalledWith(50);
  });

  it("reuses one history group across live changes and starts a new group after commit", () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    render(
      <SliderControl
        name="Amount"
        value={0}
        min={0}
        max={100}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );
    const slider = screen.getByRole("slider", { name: "Amount" });

    fireEvent.change(slider, { target: { value: "10" } });
    fireEvent.change(slider, { target: { value: "20" } });
    fireEvent.change(slider, { target: { value: "30" } });

    expect(onValueChange).toHaveBeenCalledTimes(3);
    const groupA = onValueChange.mock.calls[0]![1]?.historyGroup as string;
    expect(groupA.length).toBeGreaterThan(0);
    for (const call of onValueChange.mock.calls) {
      expect(call[1]).toEqual({ history: "merge", historyGroup: groupA });
    }

    fireEvent.pointerUp(slider);
    expect(onValueCommit).toHaveBeenCalledTimes(1);
    expect(onValueCommit).toHaveBeenCalledWith(30);

    fireEvent.change(slider, { target: { value: "40" } });
    const groupB = onValueChange.mock.calls[3]![1]?.historyGroup as string;
    expect(groupB.length).toBeGreaterThan(0);
    expect(groupB).not.toBe(groupA);
    expect(onValueChange.mock.calls[3]![1]).toEqual({
      history: "merge",
      historyGroup: groupB,
    });
  });

  it("drops valueLabel while a live local change differs from the controlled prop", () => {
    render(
      <SliderControl
        name="Labeled"
        value={10}
        min={0}
        max={100}
        unit="%"
        valueLabel="Original"
      />,
    );
    expect(screen.getByText("Original")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "Labeled" }), {
      target: { value: "25" },
    });
    expect(screen.queryByText("Original")).not.toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
  });
});

describe("RangeSliderControl", () => {
  it("names start/end inputs, keeps values sorted when crossing, and commits", () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    render(
      <RangeSliderControl
        name="Trim"
        value={[20, 60]}
        min={0}
        max={100}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );

    expect(screen.getByRole("group", { name: "Trim" })).toBeInTheDocument();

    const start = screen.getByRole("slider", { name: "Trim start" });
    const end = screen.getByRole("slider", { name: "Trim end" });
    expect(start).toHaveAttribute("name", "Trim start");
    expect(end).toHaveAttribute("name", "Trim end");

    fireEvent.change(start, { target: { value: "80" } });
    expect(onValueChange).toHaveBeenLastCalledWith(
      [60, 60],
      expect.objectContaining({ history: "merge" }),
    );

    fireEvent.change(end, { target: { value: "10" } });
    expect(onValueChange).toHaveBeenLastCalledWith(
      [60, 60],
      expect.objectContaining({ history: "merge" }),
    );

    fireEvent.pointerUp(end);
    expect(onValueCommit).toHaveBeenCalledWith([60, 60]);
  });

  it("drops a stale valueLabel after a live range change", () => {
    render(
      <RangeSliderControl
        name="Trim"
        value={[20, 60]}
        min={0}
        max={100}
        valueLabel="Original range"
      />,
    );
    expect(screen.getByRole("group", { name: "Trim" })).toBeInTheDocument();
    expect(screen.getByText("Original range")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("slider", { name: "Trim start" }), {
      target: { value: "30" },
    });
    expect(screen.queryByText("Original range")).not.toBeInTheDocument();
    expect(screen.getByText("30 – 60")).toBeInTheDocument();
  });

  it("syncs controlled pair changes", () => {
    const { rerender } = render(
      <RangeSliderControl name="Window" value={[10, 30]} min={0} max={100} />,
    );
    expect(screen.getByRole("slider", { name: "Window start" })).toHaveValue("10");
    expect(screen.getByRole("slider", { name: "Window end" })).toHaveValue("30");

    rerender(
      <RangeSliderControl name="Window" value={[15, 45]} min={0} max={100} />,
    );
    expect(screen.getByRole("slider", { name: "Window start" })).toHaveValue("15");
    expect(screen.getByRole("slider", { name: "Window end" })).toHaveValue("45");
  });

  it("allows both native inputs to receive focus", () => {
    render(
      <RangeSliderControl name="Span" value={[0, 100]} min={0} max={100} />,
    );
    const start = screen.getByRole("slider", { name: "Span start" });
    const end = screen.getByRole("slider", { name: "Span end" });

    start.focus();
    expect(start).toHaveFocus();
    end.focus();
    expect(end).toHaveFocus();
  });

  it("blocks callbacks when disabled and resets both values on double-click", () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    const { rerender } = render(
      <RangeSliderControl
        name="Band"
        value={[10, 90]}
        baseValue={[25, 75]}
        min={0}
        max={100}
        disabled
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );
    const start = screen.getByRole("slider", { name: "Band start" });
    fireEvent.change(start, { target: { value: "40" } });
    fireEvent.pointerUp(start);
    fireEvent.doubleClick(start);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onValueCommit).not.toHaveBeenCalled();

    rerender(
      <RangeSliderControl
        name="Band"
        value={[10, 90]}
        baseValue={[25, 75]}
        min={0}
        max={100}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );
    fireEvent.doubleClick(screen.getByRole("slider", { name: "Band end" }));
    expect(onValueChange).toHaveBeenCalledWith(
      [25, 75],
      expect.objectContaining({ history: "record" }),
    );
    expect(onValueCommit).toHaveBeenCalledWith([25, 75]);
  });
});
