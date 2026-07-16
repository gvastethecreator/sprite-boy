import type {
  GridProcessingGoldenManifestV1,
  GridProcessingGoldenOutputV1,
} from "../../../core/processing/gridProcessingGolden";
import type { GridProcessingOperation, GridProcessingWarningCode } from "../../../core/processing/gridProcessingProtocol";

interface OutputGridBaseline {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  readonly widths: readonly number[];
  readonly heights: readonly number[];
  readonly dimensions?: readonly (readonly [number, number])[];
  readonly hashes: readonly string[];
  readonly operations?: readonly GridProcessingOperation[];
  readonly warnings?: readonly GridProcessingWarningCode[];
  readonly empty?: boolean;
}

function outputs(baseline: OutputGridBaseline): readonly GridProcessingGoldenOutputV1[] {
  const cols = baseline.xs.length;
  return baseline.hashes.map((rgbaSha256, index) => {
    const row = Math.floor(index / cols);
    const column = index % cols;
    const width = baseline.widths[column]!;
    const height = baseline.heights[row]!;
    const x = baseline.xs[column]!;
    const y = baseline.ys[row]!;
    const dimensions = baseline.dimensions?.[index] ?? (baseline.empty ? [1, 1] : [width, height]);
    return {
      index,
      row,
      column,
      cellBounds: { x, y, width, height },
      contentBounds: baseline.empty ? null : { x, y, width, height },
      dimensions: { width: dimensions[0], height: dimensions[1] },
      cropReductionRatio: baseline.empty ? 1 : 0,
      operations: baseline.operations ?? [],
      warnings: baseline.warnings ?? [],
      rgbaSha256,
    };
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const EMPTY_RGBA_SHA256 = "df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119";

/**
 * Reviewed G1-05 baseline. It deliberately contains no request IDs, progress or timing.
 * Change these literals only for an intentional algorithm revision with new review evidence.
 */
export const GRID_PROCESSING_GOLDEN_MANIFEST_V1 = deepFreeze({
  version: 1,
  algorithmBaseline: "grid-splitter-port-v1",
  rgbaNormalization: "rgba8-srgb-row-major-v1",
  fixtures: [
    {
      id: "single-pixel-1x1",
      source: { width: 1, height: 1, rgbaSha256: "1a835ed8734f86355ca5b835d824d486993aabf1913cd3a011b7446c0514b7c9" },
      layout: { origin: "manual", rows: 1, cols: 1 },
      outputs: outputs({
        xs: [0], ys: [0], widths: [1], heights: [1],
        hashes: ["1a835ed8734f86355ca5b835d824d486993aabf1913cd3a011b7446c0514b7c9"],
      }),
      summary: { outputCount: 1, outputPixelCount: 1, cropReductionRatio: 0, warnings: [] },
    },
    {
      id: "single-row-1xn",
      source: { width: 7, height: 1, rgbaSha256: "8a980f24dd19730618131ed9550ce7a0f65cd8d0dc4699d3607809b3abb47420" },
      layout: { origin: "manual", rows: 1, cols: 7 },
      outputs: outputs({
        xs: [0, 1, 2, 3, 4, 5, 6], ys: [0], widths: [1, 1, 1, 1, 1, 1, 1], heights: [1],
        hashes: [
          "34aaa746c25a0f105c4316bbb1f009aa359f49582656ee97d73c58132d563423",
          "6ebdf4c6462a821715a424b06786803d63ade6d5b9ddd6f79b8bd4bb35333cc1",
          "a7ac69f02bd37f96c5fbb8b9a52ac6507b8a7e282fda479e7c6909b6ff1bb2d4",
          "67cee544bb702455b5e46bf77081244e1612d9efc0c91c194fc307e693a418e0",
          "416eed8f6b25cf2b26d1396b9a0c5b6b79ba5bc36cb63572362d09e97d54fc5d",
          "f341dfaf2adeae5c2ff4e26d140c54a552154c10a61b28955622c0fbc6c7a74d",
          "fecf6976a77f2c74b77f00c687806ad36c9071bfc20f09c3b9521f8a7c57c85a",
        ],
      }),
      summary: { outputCount: 7, outputPixelCount: 7, cropReductionRatio: 0, warnings: [] },
    },
    {
      id: "single-column-nx1",
      source: { width: 1, height: 7, rgbaSha256: "d292d287c832b4489b6a90c7f86cff6eb39cad70b59497157cab010d06f4b6c8" },
      layout: { origin: "manual", rows: 7, cols: 1 },
      outputs: outputs({
        xs: [0], ys: [0, 1, 2, 3, 4, 5, 6], widths: [1], heights: [1, 1, 1, 1, 1, 1, 1],
        hashes: [
          "3e6f9aae16382bf563d8991b6da1b92213911f0dd5deea3ecaccf2f35a56794a",
          "a32db2c152ece43fd680ba38610401be2b58f8fbf807cadb5bd0ccddbc7cc2c4",
          "6068c4a38dd14f0869299a2eed4c93be8013701706ddec825877ad14710b56ab",
          "3a93780280f83c8aa8e069ef2ad67ad6cb7d7b8c402ede2dc208ef99da561f42",
          "94eaf581b3f3e82fe7224b846ee45004495a8ccdf731fe50a7c0b92991596c37",
          "bf2feb4da7356b9bdab623b76297f4e26f8328281ded1cda1a7b626ab74dcc00",
          "1c5ea75260be947046184f0246930f8db0503511828739d0da56fa0f7c28fa07",
        ],
      }),
      summary: { outputCount: 7, outputPixelCount: 7, cropReductionRatio: 0, warnings: [] },
    },
    {
      id: "detected-grid-3x3",
      source: { width: 17, height: 17, rgbaSha256: "bbc67ec55e14a33a0edd88a1b43bd4420881f7defb1254868caf40c11ab419ca" },
      layout: { origin: "detected", rows: 3, cols: 3 },
      outputs: outputs({
        xs: [1, 7, 13], ys: [1, 7, 13], widths: [3, 3, 3], heights: [3, 3, 3],
        operations: ["crop"],
        hashes: [
          "9f14ee406bccf07eee31103c29f8078afd783d95b350fa3076e1509d1de684eb",
          "f5555f8764aade1b5a4de9bef410f5279820b6169b6f6d79804f2fe8b7e42452",
          "32e3175e764e11374c78f055f3e2c50212240935bf78f1c705b3bc440c36f3cd",
          "716439c35f4e1807caf8f9ec9b58055492135075682bac83b4a5f2a2c73d9e9d",
          "dd678f50ea9c2c2b33626709734836c5c4b75e5479a8f813297d18f23a411311",
          "f7482a72bd490928f8e58d90092f3d691a2594078279367685e060c1641cbd19",
          "ef0d0238052af9e1f14adf0ca4dcc6ebb32dd68cb725ed713940a3890dd015d5",
          "28ae0ab1d908d56aed9eef2cc19f8f2f3c736ae5b1197122d7a7cbbce26359a9",
          "06661a4690350acc2fedcf997e219fd4c81acf1cdb0e87518af31d91340e8d7e",
        ],
      }),
      summary: { outputCount: 9, outputPixelCount: 81, cropReductionRatio: 0, warnings: [] },
    },
    {
      id: "fully-transparent-grid",
      source: { width: 4, height: 4, rgbaSha256: "f5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b" },
      layout: { origin: "manual", rows: 2, cols: 2 },
      outputs: outputs({
        xs: [0, 2], ys: [0, 2], widths: [2, 2], heights: [2, 2], empty: true,
        operations: ["crop"], warnings: ["empty-output"],
        hashes: [EMPTY_RGBA_SHA256, EMPTY_RGBA_SHA256, EMPTY_RGBA_SHA256, EMPTY_RGBA_SHA256],
      }),
      summary: { outputCount: 4, outputPixelCount: 4, cropReductionRatio: 1, warnings: ["empty-output"] },
    },
    {
      id: "seeded-noisy-pipeline",
      source: { width: 17, height: 13, rgbaSha256: "4cebadeb2ffc2eaa3053bb0cd0cb696b89310c9765d674605643892ea2b392d5" },
      layout: { origin: "manual", rows: 2, cols: 3 },
      outputs: outputs({
        xs: [0, 5, 10], ys: [0, 6], widths: [5, 5, 7], heights: [6, 7],
        dimensions: [[5, 6], [5, 6], [6, 5], [4, 6], [4, 6], [6, 6]],
        operations: ["chroma", "crop", "resize", "quantize"],
        hashes: [
          "9ab348ff8480d137048fa8b056170fbee030a16dd1fcdcec6863faf588a652f0",
          "c50e6fd93c985b87a90bada7e522a55d92e697c862dcd898177a73539df54edd",
          "4a0b216a62e329ff95eff44c3d50fe00d75c618277f10fe9127ff310ac44c10c",
          "c798b5c164057390cb0f2367d06f5191b5c75be01441eebd0a6cf0d3e4fac166",
          "c00ce1a45cdf4687822f672427939b09b90df7e42227e11d751416dbfffec32a",
          "836f536e73d1058a3d9efbe6e3389c7882bd616590db78f12e1cdceb6d8b1a9a",
        ],
      }),
      summary: { outputCount: 6, outputPixelCount: 174, cropReductionRatio: 0, warnings: [] },
    },
    {
      id: "non-divisible-3x3",
      source: { width: 10, height: 7, rgbaSha256: "00807bfacdda92c30f40b35a7bee59724f2ec75e8da117b7f8fbee539cb5c8ad" },
      layout: { origin: "manual", rows: 3, cols: 3 },
      outputs: outputs({
        xs: [0, 3, 6], ys: [0, 2, 4], widths: [3, 3, 4], heights: [2, 2, 3],
        hashes: [
          "472c7d3ce36f1c0b46bd0c9de3e167936860040ef090e3467e99447e2ab4ad70",
          "52fc5a9203a045174ae8a70492bae81477c11b23c0fdac15d18342d62b73b490",
          "9d2ff4d84417a94aaebaa3883fd85567fcb51545475933a12b497b4ebac981a5",
          "d725b05a70ca0a806ade32d97f8df98ba43e44e6061a3315721585d5d755cc63",
          "8507d10121b158a1bbd3b07b88c4fb105ac9db63b373a7bbbe7e478adb50da0c",
          "ca0a9cb1fa88f549ba99bf0b44a0ce653bb6d420c33aa9ecb22f47b62d5e19ba",
          "444ba87a1a475c124141acad06ef20e09b5cfdc78b6a0ca57a4cf9393e0100b2",
          "13121e2184acd60c1f7e6ab25f1b1b9ec0da6880d5835b9fcf8e78cc0b0c94bd",
          "ca24e4fccdd437fc94e031eb42b9b3ffd92eef0c58f9be9805f5e7d58be93793",
        ],
      }),
      summary: { outputCount: 9, outputPixelCount: 70, cropReductionRatio: 0, warnings: [] },
    },
    {
      id: "large-safe-4x4",
      source: { width: 512, height: 384, rgbaSha256: "f43c688075cece78e3953c440fed3a11e4e500fbd93136b8a139e98699d92a17" },
      layout: { origin: "manual", rows: 4, cols: 4 },
      outputs: outputs({
        xs: [0, 128, 256, 384], ys: [0, 96, 192, 288],
        widths: [128, 128, 128, 128], heights: [96, 96, 96, 96],
        hashes: [
          "89aea53b95dc4cb5cb0f07ba99292434d257671d66d3ed78031f92597bcd228f",
          "2fe99f4bfb20cdd34366ef0a2214c729fd57c29c0ea48e17f706d333aa40baca",
          "e423b8cc57f1aa825d10d2ff3f95681170752ec8676584d53bd3cde96ce9c3ea",
          "3f46911be19a1da5b1797253686fbf7a229bb921ce040b1876e21bb71fe622bd",
          "5b631a32df053f05f35cae99bf32bab4954c57128acab7c08f762b902126439c",
          "b1dfc0d46227c74ba14b6cda71fb54c2b9219b34a2b81df53851bf9745611bb6",
          "eca3581385b1748f724ddb18875bee8825995b3f5a961c36b68c1a040b57d929",
          "56f4c0ddcc62f5d8d06e574c470c03a77e6cd8d2a36f818a2a1d89ae4bce686e",
          "5e5e5922c5a15f4259771121bd921289f70db0f72ff0eab7bdf3b73918a39d7d",
          "7d80c79ec7d7569604932b35ba0c5fd35df35a8d766d782b1c785fb3805eb4fd",
          "fcddcdb5206464a931e97676580ee33f62727c6ccefcf4b195017dc128724801",
          "fc02d326464a2ddbcf60033dd991d7c3d9f41657c7a0660d5dfe672cb5277c9c",
          "5fa4d1645c1020ce6ba79c2b29e142beaed79bf08cae6915170c58fb6c2e286b",
          "60092970882a6555bb74f2ca9aa67791d59c36a8ed446ac35382f3ecac3438bd",
          "240e2504c0ab8cca0ba284adafdebd0f27c1cd7e80cbf40475de9a3abfcb0246",
          "d6627fc2b3b605529b9f8490b346532a9e8fe6770859973e24e93ca36041ae13",
        ],
      }),
      summary: { outputCount: 16, outputPixelCount: 196_608, cropReductionRatio: 0, warnings: [] },
    },
  ],
} as const satisfies GridProcessingGoldenManifestV1);
