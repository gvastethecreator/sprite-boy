import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { IRREGULAR_REGION_DONOR_DEFAULTS } from "../../core/processing/irregularRegionDetection";
import { WandSelectionProbe } from "../../features/slice/irregular/WandSelectionProbe";
import { mapWandClientPointToSource } from "../../features/slice/irregular/wandCoordinates";
import {
  createEmptyWandSelection,
  selectWandComponent,
} from "../../features/slice/irregular/wandSelection";

export interface WandSelectionBrowserEvidence {
  readonly componentCount: number;
  readonly pixelCount: number;
  readonly bounds: string;
  readonly path: string;
  readonly focusTargetCount: number;
  readonly sourcePoint: string;
}

export async function runWandSelectionBrowserJourney(): Promise<WandSelectionBrowserEvidence> {
  const pixels = new Uint8ClampedArray(6 * 4 * 4);
  for (const [x, y] of [[1, 0], [1, 1], [2, 1], [3, 1], [3, 2], [3, 3]]) {
    pixels[(y! * 6 + x!) * 4 + 3] = 255;
  }
  const selection = selectWandComponent(createEmptyWandSelection(), {
    sourceAssetId: "asset-browser-wand",
    pixels,
    width: 6,
    height: 4,
    seed: { x: 2, y: 1 },
    mode: "replace",
    options: { ...IRREGULAR_REGION_DONOR_DEFAULTS, minPixelCount: 1, minWidth: 1, minHeight: 1 },
  }).selection;
  const host = document.querySelector("#probe");
  if (!(host instanceof HTMLElement)) throw new Error("Wand browser probe host is missing.");
  const root = createRoot(host);
  flushSync(() => root.render(createElement(WandSelectionProbe, { selection })));
  const svg = host.querySelector("svg");
  const path = host.querySelector("path");
  const bounds = host.querySelector("[data-selection-bounds='true']");
  if (!svg || !path || !bounds) throw new Error("Wand browser probe did not render.");
  const sourcePoint = mapWandClientPointToSource(
    { clientX: 136, clientY: 73 },
    {
      canvasClientLeft: 100,
      canvasClientTop: 50,
      devicePixelRatio: 2,
      zoom: 3,
      sourceOriginCanvasX: 20,
      sourceOriginCanvasY: 10,
      sourceWidth: 20,
      sourceHeight: 10,
    },
  );
  return Object.freeze({
    componentCount: Number(svg.getAttribute("data-component-count")),
    pixelCount: Number(svg.getAttribute("data-pixel-count")),
    bounds: [bounds.getAttribute("x"), bounds.getAttribute("y"), bounds.getAttribute("width"), bounds.getAttribute("height")].join(","),
    path: path.getAttribute("d") ?? "",
    focusTargetCount: host.querySelectorAll("button, input, [tabindex]").length,
    sourcePoint: sourcePoint ? `${sourcePoint.x},${sourcePoint.y}` : "outside",
  });
}
