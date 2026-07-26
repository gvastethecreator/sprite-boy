// @vitest-environment node
import { MediabunnyVideoAdapter, VIDEO_IMPORT_LIMITS, VideoMediaError } from "@/core/media";
import { cfrMp4Blob, vfrMp4Blob } from "./fixtures/videoFixtures";

describe("MediabunnyVideoAdapter preflight", () => {
  const adapter = new MediabunnyVideoAdapter();

  it("reads a constant-rate MP4 without decoding frame pixels", async () => {
    const result = await adapter.preflight(cfrMp4Blob());

    expect(result.mimeType).toBe("video/mp4");
    expect(result.trackCount).toBe(1);
    expect(result.track.index).toBe(0);
    expect(result.track.codec).toMatch(/^avc1/);
    expect(result.track.displayWidth).toBe(16);
    expect(result.track.displayHeight).toBe(16);
    expect(result.track.sampleCount).toBe(4);
    expect(result.sampleTimestampsUs).toEqual([0, 250_000, 500_000, 750_000]);
    expect(result.variableFrameRate).toBe(false);
  });

  it("reads and flags a variable-rate MP4 fixture", async () => {
    const result = await adapter.preflight(vfrMp4Blob());

    expect(result.track.sampleCount).toBe(4);
    expect(result.sampleTimestampsUs).toEqual([0, 100_000, 300_000, 700_000]);
    expect(result.variableFrameRate).toBe(true);
  });

  it("reports the browser codec gate before attempting pixel decode", async () => {
    await expect(
      adapter.extractFrames(cfrMp4Blob(), {
        trackIndex: 0,
        range: { startUs: 0, endUs: 1_000_000 },
        sampling: { mode: "all" },
      }),
    ).rejects.toMatchObject({ code: "VIDEO_CODEC_UNSUPPORTED" });
  });

  it("returns stable typed errors for invalid input, missing tracks and cancellation", async () => {
    const cancelled = new AbortController();
    cancelled.abort();

    await expect(adapter.preflight(new Blob())).rejects.toMatchObject({ code: "VIDEO_INVALID_INPUT" });
    await expect(adapter.preflight(new Blob(["plain text"], { type: "text/plain" }))).rejects.toMatchObject({
      code: "VIDEO_UNSUPPORTED_FORMAT",
    });
    await expect(adapter.preflight(cfrMp4Blob(), { trackIndex: 1 })).rejects.toMatchObject({
      code: "VIDEO_TRACK_NOT_FOUND",
    });
    await expect(adapter.preflight(cfrMp4Blob(), { signal: cancelled.signal })).rejects.toMatchObject({
      code: "VIDEO_CANCELLED",
    });
  });

  it("does not expose its internal cause in diagnostics", () => {
    const error = new VideoMediaError("VIDEO_DECODE_FAILED", "falló", {
      cause: new Error("ruta privada"),
      details: { codec: "avc1" },
    });

    expect(error.toDiagnostic()).toEqual({
      code: "VIDEO_DECODE_FAILED",
      message: "falló",
      details: { codec: "avc1" },
    });
    expect(JSON.stringify(error.toDiagnostic())).not.toContain("ruta privada");
  });

  it("rejects an oversized file before media parsing", async () => {
    class OversizedVideoBlob extends Blob {
      override get size(): number {
        return VIDEO_IMPORT_LIMITS.maxFileBytes + 1;
      }
    }

    await expect(adapter.preflight(
      new OversizedVideoBlob([new Uint8Array([0])], { type: "video/mp4" }),
    )).rejects.toMatchObject({ code: "VIDEO_LIMIT_EXCEEDED" });
  });
});
