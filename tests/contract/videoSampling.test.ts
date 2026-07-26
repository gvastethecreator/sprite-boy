import {
  detectVariableFrameRate,
  normalizeVideoTimeline,
  secondsToMicroseconds,
  selectVideoFrameTimestamps,
  VideoMediaError,
} from "@/core/media";

describe("video sampling policy", () => {
  it("rounds seconds into safe integer microseconds", () => {
    expect(secondsToMicroseconds(1 / 3)).toBe(333_333);
    expect(() => secondsToMicroseconds(Number.POSITIVE_INFINITY)).toThrow(VideoMediaError);
  });

  it("normalizes a positive media start to project time zero", () => {
    expect(normalizeVideoTimeline(250_000, 1_250_000)).toEqual({
      durationUs: 1_000_000,
      timelineOffsetUs: 250_000,
    });
    expect(normalizeVideoTimeline(-250_000, 1_000_000)).toEqual({
      durationUs: 1_000_000,
      timelineOffsetUs: 0,
    });
  });

  it("keeps every unique real frame in a half-open range", () => {
    expect(
      selectVideoFrameTimestamps(
        [750_000, 0, 250_000, 250_000, 500_000, -1],
        { startUs: 250_000, endUs: 750_000 },
        { mode: "all" },
      ),
    ).toEqual([250_000, 500_000]);
  });

  it("maps FPS targets to nearest real frames, breaks ties earlier and removes duplicates", () => {
    expect(
      selectVideoFrameTimestamps(
        [0, 100_000, 300_000, 700_000],
        { startUs: 0, endUs: 800_000 },
        { mode: "fps", fps: 4 },
      ),
    ).toEqual([0, 300_000, 700_000]);

    expect(
      selectVideoFrameTimestamps(
        [0, 200_000],
        { startUs: 0, endUs: 201_000 },
        { mode: "fps", fps: 10 },
      ),
    ).toEqual([0, 200_000]);
  });

  it("detects variable timing while tolerating microsecond rounding", () => {
    expect(detectVariableFrameRate([0, 250_000, 500_000, 750_000])).toBe(false);
    expect(detectVariableFrameRate([0, 333_333, 666_667, 1_000_000])).toBe(false);
    expect(detectVariableFrameRate([0, 100_000, 300_000, 700_000])).toBe(true);
  });

  it("rejects invalid ranges and excessive sample rates with typed errors", () => {
    expect(() =>
      selectVideoFrameTimestamps([0], { startUs: 1, endUs: 1 }, { mode: "all" }),
    ).toThrowError(expect.objectContaining({ code: "VIDEO_INVALID_INPUT" }));
    expect(() =>
      selectVideoFrameTimestamps([0], { startUs: 0, endUs: 1 }, { mode: "fps", fps: 241 }),
    ).toThrowError(expect.objectContaining({ code: "VIDEO_LIMIT_EXCEEDED" }));
  });
});
