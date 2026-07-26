import { describe, expect, it } from "vitest";
import { resolveFittedSceneViewport } from "../../features/compose/canvas/sceneViewportFit";

describe("resolveFittedSceneViewport", () => {
  it("enlarges and centers an untouched pixel-art canvas at a whole-number scale", () => {
    expect(resolveFittedSceneViewport(
      { scale: 1, offset: { x: 0, y: 0 } },
      64,
      32,
      640,
      360,
    )).toEqual({ scale: 9, offset: { x: 32, y: 36 } });
  });

  it("preserves an intentional view that already fits", () => {
    const viewport = { scale: 2, offset: { x: 18, y: 24 } };
    expect(resolveFittedSceneViewport(viewport, 64, 32, 640, 360)).toBe(viewport);
  });

  it("limits extreme enlargement", () => {
    expect(resolveFittedSceneViewport(
      { scale: 1, offset: { x: 0, y: 0 } },
      1,
      1,
      1200,
      800,
    )).toEqual({ scale: 24, offset: { x: 588, y: 388 } });
  });
});
