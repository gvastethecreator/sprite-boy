import { describe, expect, it } from "vitest";

import { normalizeModelMaskTensor } from "../../core/models/modelMask";

describe("model mask normalization", () => {
  it("converts float32 logits with a stable sigmoid", () => {
    expect(Array.from(normalizeModelMaskTensor({
      type: "float32",
      size: 3,
      data: new Float32Array([0, Math.log(3), -Math.log(3)]),
    }, 3, "float32", "sigmoid"))).toEqual([128, 191, 64]);
  });

  it("decodes float16 bits and applies BEN2 min-max normalization", () => {
    expect(Array.from(normalizeModelMaskTensor({
      type: "float16",
      size: 3,
      data: new Uint16Array([0x0000, 0x3800, 0x3c00]),
    }, 3, "float16", "min-max"))).toEqual([0, 128, 255]);
  });

  it.each([
    [
      "type",
      { type: "float16", size: 1, data: new Uint16Array([0]) },
      1,
      "float32" as const,
      "sigmoid" as const,
      /type/u,
    ],
    [
      "size",
      { type: "float32", size: 2, data: new Float32Array(2) },
      1,
      "float32" as const,
      "sigmoid" as const,
      /size/u,
    ],
    [
      "constant range",
      { type: "float16", size: 2, data: new Uint16Array([0x3c00, 0x3c00]) },
      2,
      "float16" as const,
      "min-max" as const,
      /usable range/u,
    ],
    [
      "non-finite value",
      { type: "float16", size: 2, data: new Uint16Array([0x0000, 0x7e00]) },
      2,
      "float16" as const,
      "min-max" as const,
      /invalid values/u,
    ],
  ])("rejects invalid %s", (_label, tensor, size, type, normalization, message) => {
    expect(() => normalizeModelMaskTensor(tensor, size, type, normalization)).toThrow(message);
  });
});
