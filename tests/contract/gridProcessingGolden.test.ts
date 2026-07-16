import { describe, expect, it } from "vitest";
import {
  assertGridProcessingGoldenManifestV1,
  assertGridProcessingGoldenMatches,
  sha256NormalizedRgba,
} from "../../core/processing/gridProcessingGolden";
import { GRID_PROCESSING_GOLDEN_INPUTS } from "./fixtures/gridProcessingGoldenInputs";
import { GRID_PROCESSING_GOLDEN_MANIFEST_V1 } from "./fixtures/gridProcessingGoldenManifestV1";

function cloneManifest(): Record<string, any> {
  return structuredClone(GRID_PROCESSING_GOLDEN_MANIFEST_V1);
}

describe("G1-05 grid processing golden baseline", () => {
  it("validates the reviewed closed manifest and all mandatory fixture classes", () => {
    expect(() => assertGridProcessingGoldenManifestV1(GRID_PROCESSING_GOLDEN_MANIFEST_V1)).not.toThrow();
    expect(GRID_PROCESSING_GOLDEN_MANIFEST_V1.fixtures.map((fixture) => fixture.id)).toEqual([
      "single-pixel-1x1",
      "single-row-1xn",
      "single-column-nx1",
      "detected-grid-3x3",
      "fully-transparent-grid",
      "seeded-noisy-pipeline",
      "non-divisible-3x3",
      "large-safe-4x4",
    ]);
    expect(GRID_PROCESSING_GOLDEN_INPUTS).toHaveLength(8);
    expect(Object.isFrozen(GRID_PROCESSING_GOLDEN_MANIFEST_V1)).toBe(true);
    expect(Object.isFrozen(GRID_PROCESSING_GOLDEN_MANIFEST_V1.fixtures[0]!.outputs[0])).toBe(true);
    expect(Object.isFrozen(GRID_PROCESSING_GOLDEN_INPUTS[0]!.recipe)).toBe(true);
    expect(GRID_PROCESSING_GOLDEN_MANIFEST_V1.fixtures.reduce(
      (sum, fixture) => sum + fixture.outputs.length, 0,
    )).toBe(59);
  });

  it("hashes exact normalized row-major RGBA including alpha and transparent RGB", async () => {
    const fixture = GRID_PROCESSING_GOLDEN_INPUTS[0]!;
    const pixels = fixture.createPixels();
    await expect(sha256NormalizedRgba(
      pixels.buffer as ArrayBuffer,
      fixture.width,
      fixture.height,
    )).resolves.toBe(GRID_PROCESSING_GOLDEN_MANIFEST_V1.fixtures[0]!.source.rgbaSha256);

    const transparentA = new Uint8ClampedArray([0, 0, 0, 0]);
    const transparentB = new Uint8ClampedArray([255, 0, 0, 0]);
    await expect(sha256NormalizedRgba(transparentA.buffer as ArrayBuffer, 1, 1)).resolves.not.toBe(
      await sha256NormalizedRgba(transparentB.buffer as ArrayBuffer, 1, 1),
    );
  });

  it("rejects unknown keys, accessors, sparse arrays, invalid hashes and duplicate fixture IDs", () => {
    const unknownRoot = { ...cloneManifest(), unexpected: true };
    expect(() => assertGridProcessingGoldenManifestV1(unknownRoot)).toThrow(TypeError);

    const unknownOutput = cloneManifest();
    unknownOutput.fixtures[0].outputs[0].unexpected = true;
    expect(() => assertGridProcessingGoldenManifestV1(unknownOutput)).toThrow(TypeError);

    let getterCalls = 0;
    const accessor = cloneManifest();
    Object.defineProperty(accessor.fixtures[0].source, "rgbaSha256", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "0".repeat(64);
      },
    });
    expect(() => assertGridProcessingGoldenManifestV1(accessor)).toThrow(TypeError);
    expect(getterCalls).toBe(0);

    const sparse = cloneManifest();
    delete sparse.fixtures[2];
    expect(() => assertGridProcessingGoldenManifestV1(sparse)).toThrow(TypeError);

    const uppercaseHash = cloneManifest();
    uppercaseHash.fixtures[0].source.rgbaSha256 = "A".repeat(64);
    expect(() => assertGridProcessingGoldenManifestV1(uppercaseHash)).toThrow(TypeError);

    const duplicate = cloneManifest();
    duplicate.fixtures[1].id = duplicate.fixtures[0].id;
    expect(() => assertGridProcessingGoldenManifestV1(duplicate)).toThrow(TypeError);

    const wrongOperationOrder = cloneManifest();
    wrongOperationOrder.fixtures[5].outputs[0].operations = ["crop", "chroma", "resize", "quantize"];
    expect(() => assertGridProcessingGoldenManifestV1(wrongOperationOrder)).toThrow(TypeError);

    const impossibleReduction = cloneManifest();
    impossibleReduction.fixtures[0].outputs[0].cropReductionRatio = 0.5;
    expect(() => assertGridProcessingGoldenManifestV1(impossibleReduction)).toThrow(TypeError);
  });

  it("reports valid hash and geometry drift without allowing a regenerated expectation to mask it", () => {
    const hashDrift = cloneManifest();
    hashDrift.fixtures[0].outputs[0].rgbaSha256 = "0".repeat(64);
    expect(() => assertGridProcessingGoldenMatches(hashDrift, GRID_PROCESSING_GOLDEN_MANIFEST_V1))
      .toThrow("Grid processing golden drift at manifest.fixtures[0].outputs[0].rgbaSha256.");

    const geometryDrift = cloneManifest();
    geometryDrift.fixtures[6].outputs[0].cellBounds.x = 1;
    geometryDrift.fixtures[6].outputs[0].contentBounds.x = 1;
    expect(() => assertGridProcessingGoldenMatches(geometryDrift, GRID_PROCESSING_GOLDEN_MANIFEST_V1))
      .toThrow("Grid processing golden drift at manifest.fixtures[6].outputs[0].cellBounds.x.");
  });

  it("detects a one-byte fixture tamper before the source buffer reaches the worker", async () => {
    const input = GRID_PROCESSING_GOLDEN_INPUTS[5]!;
    const pixels = input.createPixels();
    const expected = GRID_PROCESSING_GOLDEN_MANIFEST_V1.fixtures[5]!.source.rgbaSha256;
    await expect(sha256NormalizedRgba(pixels.buffer as ArrayBuffer, input.width, input.height)).resolves.toBe(expected);
    pixels[0] = pixels[0]! ^ 1;
    await expect(sha256NormalizedRgba(pixels.buffer as ArrayBuffer, input.width, input.height)).resolves.not.toBe(expected);
  });

  it("rejects detached, wrong-sized and non-ArrayBuffer surfaces", async () => {
    const detached = new Uint8ClampedArray(4);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    await expect(sha256NormalizedRgba(detached.buffer as ArrayBuffer, 1, 1)).rejects.toThrow(TypeError);
    await expect(sha256NormalizedRgba(new ArrayBuffer(3), 1, 1)).rejects.toThrow(TypeError);
    await expect(sha256NormalizedRgba(new Uint8Array(4) as unknown as ArrayBuffer, 1, 1)).rejects.toThrow(TypeError);
  });
});
