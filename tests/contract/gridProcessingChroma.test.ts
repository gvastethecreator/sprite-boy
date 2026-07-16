import { describe, expect, it } from "vitest";
import { applyAdvancedChromaKey } from "../../core/processing/gridProcessingAlgorithms";

function apply(
  source: readonly number[],
  color: string,
  tolerance: number,
  smoothness: number,
  spill: number,
): readonly number[] {
  const pixels = new Uint8ClampedArray(source);
  applyAdvancedChromaKey(pixels, source.length / 4, 1, color, tolerance, smoothness, spill);
  return [...pixels];
}

describe("G4-01 chroma alpha and color goldens", () => {
  it("freezes the donor green-screen alpha, feather and foreground golden", () => {
    const source = [
      0, 255, 0, 255,
      10, 250, 10, 200,
      0, 200, 0, 255,
      255, 0, 0, 127,
      210, 150, 120, 255,
      0, 255, 0, 0,
    ];
    const original = [...source];

    expect(apply(source, "#00ff00", 10, 20, 100)).toEqual([
      0, 0, 0, 0,
      10, 10, 10, 0,
      0, 55, 0, 70,
      255, 0, 0, 127,
      210, 150, 120, 255,
      0, 255, 0, 0,
    ]);
    expect(source).toEqual(original);
  });

  it("keeps tolerance endpoints and smooth feathering monotonic", () => {
    const gradient = [
      0, 255, 0, 255,
      16, 255, 16, 255,
      32, 255, 32, 255,
      64, 255, 64, 255,
      255, 0, 255, 255,
    ];
    const alpha = (pixels: readonly number[]) => pixels.filter((_, index) => index % 4 === 3);
    const minimum = alpha(apply(gradient, "#00ff00", 0, 0, 0));
    const keyed = alpha(apply(gradient, "#00ff00", 10, 0, 0));
    const feathered = alpha(apply(gradient, "#00ff00", 10, 20, 0));
    const maximum = alpha(apply(gradient, "#00ff00", 100, 0, 0));

    expect(minimum).toEqual([255, 255, 255, 255, 255]);
    expect(keyed).toEqual([0, 0, 255, 255, 255]);
    expect(feathered).toEqual([0, 0, 2, 255, 255]);
    expect(maximum).toEqual([0, 0, 0, 0, 255]);
    for (let index = 0; index < keyed.length; index += 1) {
      expect(maximum[index]).toBeLessThanOrEqual(feathered[index]!);
      expect(feathered[index]).toBeLessThanOrEqual(minimum[index]!);
    }
  });

  it("suppresses only the dominant green or blue spill channel near the key", () => {
    const greenSource = [30, 170, 40, 255];
    const greenNoSpill = apply(greenSource, "#00ff00", 20, 20, 0);
    const greenSpill = apply(greenSource, "#00ff00", 20, 20, 100);
    expect(greenSpill[0]).toBe(greenNoSpill[0]);
    expect(greenSpill[1]).toBeLessThan(greenNoSpill[1]!);
    expect(greenSpill[2]).toBe(greenNoSpill[2]);
    expect(greenSpill[3]).toBe(greenNoSpill[3]);

    const blueSource = [35, 45, 180, 255];
    const blueNoSpill = apply(blueSource, "#0000ff", 20, 20, 0);
    const blueSpill = apply(blueSource, "#0000ff", 20, 20, 100);
    expect(blueSpill[0]).toBe(blueNoSpill[0]);
    expect(blueSpill[1]).toBe(blueNoSpill[1]);
    expect(blueSpill[2]).toBeLessThan(blueNoSpill[2]!);
    expect(blueSpill[3]).toBe(blueNoSpill[3]);

    expect(apply([210, 150, 120, 255], "#00ff00", 20, 20, 100))
      .toEqual([210, 150, 120, 255]);
  });

  it("is byte-deterministic for repeated seeded alpha and color fixtures", () => {
    let state = 0x47342d3031;
    const source = new Uint8ClampedArray(256 * 4);
    for (let index = 0; index < source.length; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      source[index] = state & 0xff;
    }
    const first = source.slice();
    const second = source.slice();
    applyAdvancedChromaKey(first, 256, 1, "#00ff00", 37, 42, 61);
    applyAdvancedChromaKey(second, 256, 1, "#00ff00", 37, 42, 61);
    expect(first).toEqual(second);
  });
});
