import { describe, expect, it } from "vitest";
import { snapComposeLayer, type ComposeSnapItem } from "../../features/compose/guides/composeGuideGeometry";

function item(patch: Partial<ComposeSnapItem> = {}): ComposeSnapItem {
  return {
    id: "moving",
    x: 50,
    y: 50,
    width: 20,
    height: 10,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    ...patch,
  };
}

describe("Compose guide geometry", () => {
  it("snaps center axes to the canvas in scene units", () => {
    expect(snapComposeLayer({
      moving: item({ x: 52, y: 48 }),
      others: [],
      canvas: { width: 100, height: 100 },
      viewportScale: 2,
      toleranceCssPx: 6,
    })).toEqual({
      x: 50,
      y: 50,
      guides: [{ axis: "x", position: 50 }, { axis: "y", position: 50 }],
    });
  });

  it("snaps rotated axis-aligned bounds to another visible layer", () => {
    const result = snapComposeLayer({
      moving: item({ x: 64, y: 50, rotation: 90 }),
      others: [item({ id: "reference", x: 50, width: 20, height: 20 })],
      canvas: { width: 200, height: 200 },
      viewportScale: 1,
      toleranceCssPx: 4,
    });
    expect(result.x).toBe(65);
    expect(result.guides).toContainEqual({ axis: "x", position: 60 });
  });

  it("prefers canvas guides for exact ties and skips hidden layers", () => {
    const result = snapComposeLayer({
      moving: item({ x: 49 }),
      others: [item({ id: "hidden", x: 49, visible: false })],
      canvas: { width: 100, height: 100 },
      viewportScale: 1,
      toleranceCssPx: 2,
    });
    expect(result.x).toBe(50);
    expect(result.guides[0]).toEqual({ axis: "x", position: 50 });
  });

  it("can disable snapping without validating unrelated candidates", () => {
    expect(snapComposeLayer({
      moving: item({ x: 12, y: 13 }),
      others: [{ ...item(), x: Number.NaN }],
      canvas: { width: 100, height: 100 },
      viewportScale: 1,
      enabled: false,
    })).toEqual({ x: 12, y: 13, guides: [] });
  });

  it("rejects hostile or unsupported geometry", () => {
    expect(() => snapComposeLayer({
      moving: item({ width: 0 }),
      others: [],
      canvas: { width: 100, height: 100 },
      viewportScale: 1,
    })).toThrow("Layer width must be positive");
    expect(() => snapComposeLayer({
      moving: item(),
      others: [],
      canvas: { width: 100, height: 100 },
      viewportScale: 0,
    })).toThrow("Viewport scale must be positive");
    expect(() => snapComposeLayer({
      moving: item(),
      others: [],
      canvas: { width: 100, height: 100 },
      viewportScale: 1,
      toleranceCssPx: 65,
    })).toThrow("Guide tolerance is invalid");
  });
});
