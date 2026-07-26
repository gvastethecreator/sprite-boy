import { describe, expect, it } from "vitest";
import {
  hydrateAssetRecordMedia,
  resolveAssetMedia,
  sanitizeAssetMedia,
} from "../../core/assets";
import type { AssetRecord } from "../../core/project";

const baseRecord: AssetRecord = {
  id: "asset-media",
  name: "media.png",
  blobKey: `sha256:${"a".repeat(64)}`,
  contentHash: "a".repeat(64),
  mimeType: "image/png",
  media: { type: "image" },
  width: 32,
  height: 24,
  byteSize: 4,
  createdAt: "2026-07-25T00:00:00.000Z",
  updatedAt: "2026-07-25T00:00:00.000Z",
  provenance: { source: "fixture" },
};

describe("asset media boundary (V1-01)", () => {
  it("infers only safe legacy image and binary metadata", () => {
    expect(resolveAssetMedia(undefined, "image/png", 32, 24)).toEqual({ type: "image" });
    expect(resolveAssetMedia(undefined, "application/json", 32, 24)).toEqual({ type: "binary" });
    expect(() => resolveAssetMedia(undefined, "video/mp4", 32, 24))
      .toThrow(/inspected track metadata/);
  });

  it("validates and freezes inspected video metadata", () => {
    const media = sanitizeAssetMedia({
      type: "video",
      durationUs: 2_000_000,
      track: {
        index: 0,
        codec: "avc1.64001f",
        codedWidth: 32,
        codedHeight: 24,
        displayWidth: 32,
        displayHeight: 24,
        rotationDegrees: 0,
        frameRate: 12,
        sampleCount: 24,
      },
    }, "video/mp4", 32, 24);

    expect(media).toMatchObject({
      type: "video",
      durationUs: 2_000_000,
      track: { index: 0, codec: "avc1.64001f", frameRate: 12, sampleCount: 24 },
    });
    expect(Object.isFrozen(media)).toBe(true);
    expect(media.type === "video" && Object.isFrozen(media.track)).toBe(true);
  });

  it("rejects MIME, dimensions, extra fields and runtime handles", () => {
    const video = {
      type: "video",
      durationUs: 1,
      track: {
        index: 0,
        codec: "vp09",
        codedWidth: 32,
        codedHeight: 24,
        displayWidth: 31,
        displayHeight: 24,
        rotationDegrees: 0,
      },
    };
    expect(() => sanitizeAssetMedia({ type: "image" }, "video/mp4", 32, 24))
      .toThrow(/image MIME/);
    expect(() => sanitizeAssetMedia(video, "video/webm", 32, 24))
      .toThrow(/display dimensions/);
    expect(() => sanitizeAssetMedia({ type: "image", runtime: {} }, "image/png", 32, 24))
      .toThrow(/fields are invalid/);
  });

  it("hydrates legacy stored records without mutating them", () => {
    const legacy: Partial<AssetRecord> = { ...baseRecord };
    delete legacy.media;

    const hydrated = hydrateAssetRecordMedia(legacy as AssetRecord);

    expect(hydrated.media).toEqual({ type: "image" });
    expect(legacy).not.toHaveProperty("media");
  });
});
