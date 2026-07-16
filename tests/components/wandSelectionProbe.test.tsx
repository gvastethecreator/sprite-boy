import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IRREGULAR_REGION_DONOR_DEFAULTS } from "../../core/processing/irregularRegionDetection";
import {
  createEmptyWandSelection,
  selectWandComponent,
  WandSelectionProbe,
} from "../../features/slice/irregular";

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

describe("WandSelectionProbe visual golden", () => {
  it("renders deterministic exact mask and aggregate bounds without an interactive focus target", () => {
    const pixels = new Uint8ClampedArray(6 * 4 * 4);
    for (const [x, y] of [[1, 0], [1, 1], [2, 1], [3, 1], [3, 2], [3, 3]]) {
      pixels[(y! * 6 + x!) * 4 + 3] = 255;
    }
    const selection = selectWandComponent(createEmptyWandSelection(), {
      sourceAssetId: "asset-visual",
      pixels,
      width: 6,
      height: 4,
      seed: { x: 2, y: 1 },
      mode: "replace",
      options: {
        ...IRREGULAR_REGION_DONOR_DEFAULTS,
        minPixelCount: 1,
        minWidth: 1,
        minHeight: 1,
      },
    }).selection;

    const { container } = render(<WandSelectionProbe selection={selection} />);
    const probe = screen.getByRole("img", { name: "Wand selection mask preview" });
    expect(probe).toHaveAttribute("viewBox", "0 0 6 4");
    expect(probe).toHaveAttribute("data-component-count", "1");
    expect(probe).toHaveAttribute("data-pixel-count", "6");
    expect(container.querySelector("path")).toHaveAttribute(
      "d",
      "M1 0h1v1h-1zM1 1h3v1h-3zM3 2h1v1h-1zM3 3h1v1h-1z",
    );
    expect(container.querySelector("[data-selection-bounds='true']")).toMatchObject({
      tagName: "rect",
    });
    expect(container.querySelectorAll("button, input, [tabindex]")).toHaveLength(0);
    expect(fnv1a(probe.outerHTML)).toBe("75574a8d");
  });
});
