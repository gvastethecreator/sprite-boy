import { describe, expect, it } from "vitest";
import { createEmptyStudioProject } from "../../core/project/factory";
import { validateStudioProject } from "../../core/project";
import type {
  AssetRecord,
  Layer,
  ProcessingRecipe,
  Region,
  StudioProject,
  VideoAssetMedia,
  VideoTrackMetadata,
} from "../../core/project/schema";

const NOW = "2026-01-01T00:00:00.000Z";

function emptyProject(): StudioProject {
  return createEmptyStudioProject({
    id: "video-contract-project",
    name: "Video contract project",
    now: NOW,
  });
}

function baseAssetFields(id: string, name: string): Omit<AssetRecord, "mimeType" | "width" | "height" | "media"> {
  return {
    id,
    name,
    blobKey: `blob-${id}`,
    contentHash: `hash-${id}`,
    byteSize: 256,
    createdAt: NOW,
    updatedAt: NOW,
    provenance: { source: "fixture" },
  };
}

function imageAsset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    ...baseAssetFields("asset-image", "Image asset"),
    mimeType: "image/png",
    width: 64,
    height: 32,
    media: { type: "image" },
    ...overrides,
    id: overrides.id ?? "asset-image",
  };
}

function videoTrack(overrides: Partial<VideoTrackMetadata> = {}): VideoTrackMetadata {
  return {
    index: 0,
    codec: "avc1.42E01E",
    codedWidth: 1920,
    codedHeight: 1080,
    displayWidth: 1920,
    displayHeight: 1080,
    rotationDegrees: 0,
    ...overrides,
  };
}

function videoMedia(overrides: Partial<VideoAssetMedia> = {}): VideoAssetMedia {
  const trackOverrides =
    overrides.track === undefined ? undefined : (overrides.track as Partial<VideoTrackMetadata>);
  return {
    type: "video",
    durationUs: 1_000_000,
    ...overrides,
    track: videoTrack(trackOverrides),
  };
}

function videoAsset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  const media =
    overrides.media === undefined
      ? videoMedia()
      : videoMedia(overrides.media as Partial<VideoAssetMedia>);
  return {
    ...baseAssetFields("asset-video", "Video asset"),
    mimeType: "video/mp4",
    width: 1920,
    height: 1080,
    ...overrides,
    id: overrides.id ?? "asset-video",
    media,
  };
}

function gridRecipe(sourceAssetId: string, overrides: Partial<ProcessingRecipe> = {}): ProcessingRecipe {
  return {
    id: "recipe-grid",
    kind: "grid-split",
    version: 1,
    sourceAssetId,
    layout: { mode: "auto" },
    crop: { threshold: 0, padding: 0 },
    chroma: {
      enabled: false,
      color: "#00FF00",
      tolerance: 0,
      smoothness: 0,
      spill: 0,
    },
    pixel: {
      enabled: false,
      size: 1,
      quantize: false,
      colors: 16,
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as ProcessingRecipe;
}

function videoRecipe(sourceAssetId: string, overrides: Partial<ProcessingRecipe> = {}): ProcessingRecipe {
  return {
    id: "recipe-video",
    kind: "video-extract",
    version: 1,
    sourceAssetId,
    trackIndex: 0,
    range: { startUs: 0, endUs: 500_000 },
    sampling: { mode: "all" },
    output: { mimeType: "image/png" },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as ProcessingRecipe;
}

function installAsset(project: StudioProject, asset: AssetRecord): void {
  project.assets[asset.id] = asset;
  if (!project.rootOrder.assetIds.includes(asset.id)) {
    project.rootOrder.assetIds.push(asset.id);
  }
}

function installRecipe(project: StudioProject, recipe: ProcessingRecipe): void {
  project.processingRecipes[recipe.id] = recipe;
}

function expectDiagnostic(
  result: ReturnType<typeof validateStudioProject>,
  code: string,
  path: string,
): void {
  expect(result.valid).toBe(false);
  expect(
    result.diagnostics.some((diagnostic) => diagnostic.code === code && diagnostic.path === path),
  ).toBe(true);
}

describe("video project durable schema contract", () => {
  it("accepts valid binary, image and video media on assets", () => {
    const project = emptyProject();
    installAsset(project, {
      ...baseAssetFields("asset-data", "Data asset"),
      mimeType: "application/octet-stream",
      width: 1,
      height: 1,
      media: { type: "binary" },
    });
    installAsset(project, imageAsset());
    installAsset(project, videoAsset());
    installAsset(
      project,
      videoAsset({
        id: "asset-video-opts",
        media: {
          type: "video",
          durationUs: 2_000_000,
          track: videoTrack({ frameRate: 24, sampleCount: 48, rotationDegrees: 90 }),
        },
      }),
    );

    const result = validateStudioProject(project);
    expect(result).toMatchObject({ valid: true, diagnostics: [], project });
  });

  it("accepts all-samples and FPS video-extract recipes", () => {
    const project = emptyProject();
    installAsset(project, videoAsset());
    installRecipe(project, videoRecipe("asset-video", { id: "recipe-all", sampling: { mode: "all" } }));
    installRecipe(
      project,
      videoRecipe("asset-video", {
        id: "recipe-fps",
        sampling: { mode: "fps", fps: 12 },
        range: { startUs: 10_000, endUs: 900_000 },
      }),
    );

    const result = validateStudioProject(project);
    expect(result).toMatchObject({ valid: true, diagnostics: [], project });
  });

  it("rejects wrong MIME for image and video media", () => {
    const imageWrong = emptyProject();
    installAsset(imageWrong, imageAsset({ mimeType: "video/mp4" }));
    expectDiagnostic(
      validateStudioProject(imageWrong),
      "INVALID_DOCUMENT",
      "$.assets.asset-image.mimeType",
    );

    const videoWrong = emptyProject();
    installAsset(videoWrong, videoAsset({ mimeType: "image/png" }));
    expectDiagnostic(
      validateStudioProject(videoWrong),
      "INVALID_DOCUMENT",
      "$.assets.asset-video.mimeType",
    );

    const binaryWrong = emptyProject();
    installAsset(binaryWrong, imageAsset({ media: { type: "binary" } }));
    expectDiagnostic(
      validateStudioProject(binaryWrong),
      "INVALID_DOCUMENT",
      "$.assets.asset-image.mimeType",
    );
  });

  it("rejects mismatched video display dimensions and invalid duration", () => {
    const dims = emptyProject();
    installAsset(
      dims,
      videoAsset({
        width: 1280,
        height: 720,
        media: {
          type: "video",
          durationUs: 1_000_000,
          track: videoTrack({ displayWidth: 1920, displayHeight: 1080 }),
        },
      }),
    );
    const dimResult = validateStudioProject(dims);
    expectDiagnostic(dimResult, "INVALID_DIMENSIONS", "$.assets.asset-video.media.track.displayWidth");
    expectDiagnostic(dimResult, "INVALID_DIMENSIONS", "$.assets.asset-video.media.track.displayHeight");

    const duration = emptyProject();
    installAsset(
      duration,
      videoAsset({
        media: {
          type: "video",
          durationUs: 0,
          track: videoTrack(),
        },
      }),
    );
    expectDiagnostic(
      validateStudioProject(duration),
      "INVALID_NUMBER",
      "$.assets.asset-video.media.durationUs",
    );
  });

  it("rejects invalid track fields and nested extra media keys", () => {
    const project = emptyProject();
    installAsset(
      project,
      videoAsset({
        media: {
          type: "video",
          durationUs: 1_000_000,
          track: {
            ...videoTrack({ index: -1, codec: "", rotationDegrees: 45 as 0 }),
            // extra nested key
            ...( { decoderHandle: "runtime" } as object),
          } as VideoTrackMetadata,
        },
      }),
    );
    const media = project.assets["asset-video"].media as unknown as Record<string, unknown>;
    media.blobUrl = "blob:runtime";
    const result = validateStudioProject(project);

    expectDiagnostic(result, "INVALID_NUMBER", "$.assets.asset-video.media.track.index");
    expectDiagnostic(result, "INVALID_DOCUMENT", "$.assets.asset-video.media.track.codec");
    expectDiagnostic(result, "INVALID_NUMBER", "$.assets.asset-video.media.track.rotationDegrees");
    expectDiagnostic(result, "INVALID_DOCUMENT", "$.assets.asset-video.media.track.decoderHandle");
    expectDiagnostic(result, "INVALID_DOCUMENT", "$.assets.asset-video.media.blobUrl");
  });

  it("rejects video-extract track, range, rate and output violations", () => {
    const project = emptyProject();
    installAsset(
      project,
      videoAsset({
        media: {
          type: "video",
          durationUs: 1_000_000,
          track: videoTrack({ index: 1 }),
        },
      }),
    );
    installRecipe(
      project,
      videoRecipe("asset-video", {
        trackIndex: 0,
        range: { startUs: 0, endUs: 2_000_000 },
        sampling: { mode: "fps", fps: 0 },
        output: { mimeType: "image/jpeg" as "image/png" },
      }),
    );
    const recipe = project.processingRecipes["recipe-video"] as unknown as Record<string, unknown>;
    (recipe.range as Record<string, unknown>).extra = true;
    const result = validateStudioProject(project);

    expectDiagnostic(result, "INVALID_NUMBER", "$.processingRecipes.recipe-video.trackIndex");
    expectDiagnostic(result, "INVALID_NUMBER", "$.processingRecipes.recipe-video.range.endUs");
    expectDiagnostic(result, "INVALID_DOCUMENT", "$.processingRecipes.recipe-video.range.extra");
    expectDiagnostic(result, "INVALID_NUMBER", "$.processingRecipes.recipe-video.sampling.fps");
    expectDiagnostic(result, "INVALID_DOCUMENT", "$.processingRecipes.recipe-video.output.mimeType");

    const start = emptyProject();
    installAsset(start, videoAsset());
    installRecipe(
      start,
      videoRecipe("asset-video", {
        range: { startUs: -1 as unknown as number, endUs: 10 },
      }),
    );
    expectDiagnostic(
      validateStudioProject(start),
      "INVALID_NUMBER",
      "$.processingRecipes.recipe-video.range.startUs",
    );
  });

  it("rejects endUs not greater than startUs and all-mode fps key", () => {
    const order = emptyProject();
    installAsset(order, videoAsset());
    installRecipe(
      order,
      videoRecipe("asset-video", {
        range: { startUs: 100, endUs: 100 },
      }),
    );
    expectDiagnostic(
      validateStudioProject(order),
      "INVALID_NUMBER",
      "$.processingRecipes.recipe-video.range.endUs",
    );

    const allFps = emptyProject();
    installAsset(allFps, videoAsset());
    installRecipe(allFps, videoRecipe("asset-video"));
    const sampling = (allFps.processingRecipes["recipe-video"] as Extract<
      ProcessingRecipe,
      { kind: "video-extract" }
    >).sampling as unknown as Record<
      string,
      unknown
    >;
    sampling.fps = 24;
    expectDiagnostic(
      validateStudioProject(allFps),
      "INVALID_DOCUMENT",
      "$.processingRecipes.recipe-video.sampling.fps",
    );
  });

  it("enforces image-only Region, Layer and grid sources and video-only extraction", () => {
    const project = emptyProject();
    const image = imageAsset();
    const video = videoAsset();
    installAsset(project, image);
    installAsset(project, video);

    const region: Region = {
      id: "region-video",
      assetId: video.id,
      bounds: { x: 0, y: 0, width: 16, height: 16 },
      createdAt: NOW,
      updatedAt: NOW,
    };
    project.regions[region.id] = region;
    project.rootOrder.regionIds.push(region.id);

    const compositionId = "composition-main";
    project.compositions[compositionId] = {
      id: compositionId,
      name: "Main",
      owner: { type: "project" },
      layerIds: ["layer-video"],
      width: 64,
      height: 32,
      createdAt: NOW,
      updatedAt: NOW,
    };
    project.rootOrder.compositionIds.push(compositionId);

    const layer: Layer = {
      id: "layer-video",
      compositionId,
      source: { type: "asset", id: video.id },
      transform: {
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
        flipX: false,
        flipY: false,
      },
      createdAt: NOW,
      updatedAt: NOW,
    };
    project.layers[layer.id] = layer;

    installRecipe(project, gridRecipe(video.id, { id: "recipe-grid-on-video" }));
    installRecipe(project, videoRecipe(image.id, { id: "recipe-extract-on-image" }));

    const result = validateStudioProject(project);
    expectDiagnostic(result, "INVALID_DOCUMENT", "$.regions.region-video.assetId");
    expectDiagnostic(result, "INVALID_DOCUMENT", "$.layers.layer-video.source.id");
    expectDiagnostic(result, "INVALID_DOCUMENT", "$.processingRecipes.recipe-grid-on-video.sourceAssetId");
    expectDiagnostic(
      result,
      "INVALID_DOCUMENT",
      "$.processingRecipes.recipe-extract-on-image.sourceAssetId",
    );
  });

  it("accepts image sources for Region, Layer and grid-split", () => {
    const project = emptyProject();
    installAsset(project, imageAsset());

    project.regions["region-image"] = {
      id: "region-image",
      assetId: "asset-image",
      bounds: { x: 0, y: 0, width: 8, height: 8 },
      createdAt: NOW,
      updatedAt: NOW,
    };
    project.rootOrder.regionIds.push("region-image");

    project.compositions["composition-main"] = {
      id: "composition-main",
      name: "Main",
      owner: { type: "project" },
      layerIds: ["layer-image"],
      width: 64,
      height: 32,
      createdAt: NOW,
      updatedAt: NOW,
    };
    project.rootOrder.compositionIds.push("composition-main");

    project.layers["layer-image"] = {
      id: "layer-image",
      compositionId: "composition-main",
      source: { type: "asset", id: "asset-image" },
      transform: {
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
        flipX: false,
        flipY: false,
      },
      createdAt: NOW,
      updatedAt: NOW,
    };

    installRecipe(project, gridRecipe("asset-image"));

    const result = validateStudioProject(project);
    expect(result).toMatchObject({ valid: true, diagnostics: [], project });
  });

  it("rejects missing media, bad discriminants and recipe version drift without throwing", () => {
    const missingMedia = emptyProject();
    const bare = imageAsset() as unknown as Record<string, unknown>;
    delete bare.media;
    installAsset(missingMedia, bare as unknown as AssetRecord);
    expect(() => validateStudioProject(missingMedia)).not.toThrow();
    expectDiagnostic(validateStudioProject(missingMedia), "INVALID_DOCUMENT", "$.assets.asset-image.media");

    const badMedia = emptyProject();
    installAsset(
      badMedia,
      imageAsset({ media: { type: "audio" } as unknown as AssetRecord["media"] }),
    );
    expectDiagnostic(
      validateStudioProject(badMedia),
      "INVALID_DOCUMENT",
      "$.assets.asset-image.media",
    );

    const badKind = emptyProject();
    installAsset(badKind, imageAsset());
    installRecipe(
      badKind,
      {
        id: "recipe-unknown",
        kind: "audio-mix",
        version: 2,
        sourceAssetId: "asset-image",
        createdAt: NOW,
        updatedAt: NOW,
      } as unknown as ProcessingRecipe,
    );
    const kindResult = validateStudioProject(badKind);
    expect(() => validateStudioProject(badKind)).not.toThrow();
    expectDiagnostic(kindResult, "INVALID_DOCUMENT", "$.processingRecipes.recipe-unknown.kind");
    expectDiagnostic(
      kindResult,
      "UNSUPPORTED_SCHEMA_VERSION",
      "$.processingRecipes.recipe-unknown.version",
    );
  });

  it("rejects runtime and browser-looking nested values via the JSON boundary", () => {
    const project = emptyProject();
    installAsset(project, videoAsset());
    const media = project.assets["asset-video"].media as unknown as Record<string, unknown>;
    media.objectUrl = "blob:http://localhost/lease";
    media.runtimeBlob = new Blob(["x"], { type: "video/mp4" });
    (media.track as Record<string, unknown>).decoder = () => "runtime";

    installRecipe(project, videoRecipe("asset-video"));
    const recipe = project.processingRecipes["recipe-video"] as unknown as Record<string, unknown>;
    recipe.jobState = { progress: 0.5 };
    (recipe.output as Record<string, unknown>).canvas = { width: 1 };

    const result = validateStudioProject(project);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "RUNTIME_URL")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "NON_JSON_VALUE")).toBe(true);
    expect(
      result.diagnostics.some(
        (d) => d.code === "NON_JSON_VALUE" && d.path === "$.assets.asset-video.media.runtimeBlob",
      ),
    ).toBe(true);
    expect(
      result.diagnostics.some(
        (d) =>
          d.code === "NON_JSON_VALUE" && d.path === "$.assets.asset-video.media.track.decoder",
      ),
    ).toBe(true);
  });
});
