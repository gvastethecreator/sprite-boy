import {
  GRID_PROCESSING_GOLDEN_VERSION,
  GRID_PROCESSING_RGBA_NORMALIZATION,
  assertGridProcessingGoldenMatches,
  captureGridProcessingGoldenFixture,
  sha256NormalizedRgba,
  type GridProcessingGoldenManifestV1,
} from "../core/processing/gridProcessingGolden";
import { createGridProcessingClient } from "../features/slice/processing/gridProcessingClient";
import {
  GRID_PROCESSING_GOLDEN_INPUTS,
  createGoldenProcessRequest,
} from "../tests/contract/fixtures/gridProcessingGoldenInputs";
import { GRID_PROCESSING_GOLDEN_MANIFEST_V1 } from "../tests/contract/fixtures/gridProcessingGoldenManifestV1";

export async function captureCurrentGridProcessingGoldenManifest(): Promise<GridProcessingGoldenManifestV1> {
  const fixtures = [];
  for (const input of GRID_PROCESSING_GOLDEN_INPUTS) {
    const pixels = input.createPixels();
    const sourceHash = await sha256NormalizedRgba(pixels.buffer as ArrayBuffer, input.width, input.height);
    const request = createGoldenProcessRequest(input, pixels);
    const result = await createGridProcessingClient().process({ request });
    fixtures.push(await captureGridProcessingGoldenFixture(input.id, {
      width: input.width,
      height: input.height,
      rgbaSha256: sourceHash,
    }, result));
  }
  return {
    version: GRID_PROCESSING_GOLDEN_VERSION,
    algorithmBaseline: "grid-splitter-port-v1",
    rgbaNormalization: GRID_PROCESSING_RGBA_NORMALIZATION,
    fixtures,
  };
}

if (import.meta.main) {
  const actual = await captureCurrentGridProcessingGoldenManifest();
  if (process.argv.includes("--capture")) {
    process.stdout.write(`${JSON.stringify(actual)}\n`);
  } else {
    assertGridProcessingGoldenMatches(actual, GRID_PROCESSING_GOLDEN_MANIFEST_V1);
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      status: "pass",
      fixtureCount: actual.fixtures.length,
      outputCount: actual.fixtures.reduce((sum, fixture) => sum + fixture.outputs.length, 0),
      normalization: actual.rgbaNormalization,
      fixtureIds: actual.fixtures.map((fixture) => fixture.id),
    })}\n`);
  }
}
