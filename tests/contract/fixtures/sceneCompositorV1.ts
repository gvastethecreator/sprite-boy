import type { StudioProjectV1 } from "../../../core/project";

const TIMESTAMP = "2026-01-01T00:00:00.000Z";

const centerTransform = (flipX = false) => ({
  x: 1,
  y: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
  flipX,
  flipY: false,
});

export const sceneCompositorProjectFixture: StudioProjectV1 = {
  schemaVersion: 1,
  id: "scene-compositor-project",
  name: "Scene compositor pixels",
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
  rootOrder: {
    assetIds: ["asset-atlas"],
    regionIds: ["region-left", "region-right"],
    compositionIds: ["composition-main"],
    sequenceIds: ["sequence-main"],
  },
  assets: {
    "asset-atlas": {
      id: "asset-atlas",
      name: "atlas.rgba",
      blobKey: "asset/atlas",
      contentHash: "fixture:atlas",
      mimeType: "image/x-rgba-fixture",
      width: 4,
      height: 2,
      byteSize: 32,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      provenance: { source: "fixture" },
    },
  },
  regions: {
    "region-left": {
      id: "region-left",
      assetId: "asset-atlas",
      name: "Left",
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
    "region-right": {
      id: "region-right",
      assetId: "asset-atlas",
      name: "Right",
      bounds: { x: 2, y: 0, width: 2, height: 2 },
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
  },
  layers: {
    "layer-main-bottom": {
      id: "layer-main-bottom",
      compositionId: "composition-main",
      source: { type: "region", id: "region-left" },
      transform: centerTransform(),
      visible: true,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
    "layer-main-top": {
      id: "layer-main-top",
      compositionId: "composition-main",
      source: { type: "region", id: "region-right" },
      transform: { ...centerTransform(true), x: 2 },
      visible: true,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
    "layer-variant-bottom": {
      id: "layer-variant-bottom",
      compositionId: "composition-variant-a",
      source: { type: "region", id: "region-left" },
      transform: centerTransform(),
      visible: true,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
    "layer-variant-top": {
      id: "layer-variant-top",
      compositionId: "composition-variant-a",
      source: { type: "region", id: "region-right" },
      transform: { ...centerTransform(true), x: 2 },
      visible: true,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
  },
  compositions: {
    "composition-main": {
      id: "composition-main",
      name: "Main",
      owner: { type: "project" },
      layerIds: ["layer-main-bottom", "layer-main-top"],
      width: 3,
      height: 2,
      background: "#000000",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
    "composition-variant-a": {
      id: "composition-variant-a",
      name: "Variant A",
      owner: { type: "variantSet", variantSetId: "variant-main", variant: "A" },
      layerIds: ["layer-variant-bottom", "layer-variant-top"],
      width: 3,
      height: 2,
      background: "#000000",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
  },
  variantSets: {
    "variant-main": {
      id: "variant-main",
      celId: "cel-main",
      variants: { A: "composition-variant-a" },
      activeVariant: "A",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
  },
  cels: {
    "cel-main": {
      id: "cel-main",
      sequenceId: "sequence-main",
      source: { type: "variantSet", variantSetId: "variant-main" },
      durationMs: 100,
      pivot: { x: 1.5, y: 1 },
      transform: { flipY: true },
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
  },
  sequences: {
    "sequence-main": {
      id: "sequence-main",
      name: "Main",
      celIds: ["cel-main"],
      fps: 10,
      defaultDurationMs: 100,
      loop: true,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
  },
  collisionSets: {},
  processingRecipes: {},
  generatedArtifacts: {},
  workspace: {
    activeWorkspace: "assets",
    selectedAssetId: "asset-atlas",
    selectedRegionId: "region-left",
    selectedCompositionId: "composition-main",
    selectedVariantSetId: "variant-main",
    selectedSequenceId: "sequence-main",
    selectedCelIds: ["cel-main"],
  },
};

export interface RasterFixture {
  readonly width: number;
  readonly height: number;
  readonly pixels: readonly number[];
}

export const sceneCompositorRasterFixture: RasterFixture = Object.freeze({
  width: 4,
  height: 2,
  pixels: Object.freeze([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
    0, 255, 255, 255, 255, 0, 255, 255, 255, 255, 0, 255, 0, 0, 0, 255,
  ]),
});

export const sceneCompositorPixelGoldens = Object.freeze({
  asset: Object.freeze(["RGBW", "CMYK"]),
  region: Object.freeze(["RG", "CM"]),
  composition: Object.freeze(["RWB", "CKY"]),
  variant: Object.freeze(["RWB", "CKY"]),
  cel: Object.freeze(["CKY", "RWB"]),
});
