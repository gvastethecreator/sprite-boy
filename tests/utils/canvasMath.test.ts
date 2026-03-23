import { describe, it, expect } from "vitest";
import { getResizeHandle, calculateSnapping } from "../../utils/canvasMath";

describe("getResizeHandle", () => {
  // A 100x100 rectangle at (50, 50), scale=1
  const x = 50,
    y = 50,
    w = 100,
    h = 100,
    scale = 1;

  it("returns 'nw' when mouse is near top-left corner", () => {
    expect(getResizeHandle(50, 50, x, y, w, h, scale)).toBe("nw");
  });

  it("returns 'se' when mouse is near bottom-right corner", () => {
    expect(getResizeHandle(150, 150, x, y, w, h, scale)).toBe("se");
  });

  it("returns 'n' when mouse is near top-center edge", () => {
    expect(getResizeHandle(100, 50, x, y, w, h, scale)).toBe("n");
  });

  it("returns 'e' when mouse is near right-center edge", () => {
    expect(getResizeHandle(150, 100, x, y, w, h, scale)).toBe("e");
  });

  it("returns null when mouse is in the center (no handle)", () => {
    expect(getResizeHandle(100, 100, x, y, w, h, scale)).toBeNull();
  });

  it("scales handle hit area with zoom", () => {
    // At scale=2, handle size is halved → narrower hit zone
    expect(getResizeHandle(50, 50, x, y, w, h, 2)).toBe("nw");
  });
});

describe("calculateSnapping", () => {
  it("snaps to canvas left edge", () => {
    const result = calculateSnapping(
      3, 50, 40, 40, // x near 0
      [],
      200,
      200,
      5,
      1,
      true,
    );
    expect(result.x).toBe(0);
    expect(result.guides.length).toBeGreaterThan(0);
  });

  it("does not snap when disabled", () => {
    const result = calculateSnapping(3, 50, 40, 40, [], 200, 200, 5, 1, false);
    expect(result.x).toBe(3);
    expect(result.y).toBe(50);
    expect(result.guides).toHaveLength(0);
  });

  it("snaps to canvas center", () => {
    const result = calculateSnapping(
      78, 50, 40, 40, // center-x = 98 → near 100 (canvas center)
      [],
      200,
      200,
      5,
      1,
      true,
    );
    expect(result.x).toBe(80); // 100 - 40/2 = 80
  });

  it("snaps to other object edges", () => {
    const others = [{ x: 100, y: 0, w: 50, h: 50 }];
    const result = calculateSnapping(
      97, 60, 30, 30, // left edge at 97, other obj left at 100
      others,
      500,
      500,
      5,
      1,
      true,
    );
    expect(result.x).toBe(100);
  });
});
