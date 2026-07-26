import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VIDEO_IMPORT_LIMITS, type VideoPreflight } from "../../core/media";
import {
  SliceVideoImportPanel,
  type VideoImportAdapter,
} from "../../features/slice/video";

const PREFLIGHT: VideoPreflight = {
  byteSize: 4,
  mimeType: "video/mp4",
  durationUs: 1_000_000,
  timelineOffsetUs: 0,
  trackCount: 1,
  track: {
    index: 0,
    codec: "avc1.42001e",
    codedWidth: 16,
    codedHeight: 16,
    displayWidth: 16,
    displayHeight: 16,
    rotationDegrees: 0,
    frameRate: 2,
    sampleCount: 2,
  },
  decodable: true,
  variableFrameRate: false,
  sampleTimestampsUs: [0, 500_000],
};

function adapter(preflight: VideoPreflight = PREFLIGHT): VideoImportAdapter {
  return {
    preflight: vi.fn(async () => preflight),
    extractFrames: vi.fn(async () => []),
  };
}

function videoFile(): File {
  return new File([new Uint8Array([0, 0, 0, 1])], "walk.mp4", { type: "video/mp4" });
}

describe("SliceVideoImportPanel", () => {
  it("inspects a video, exposes Toolcraft controls and queues the exact selection", async () => {
    const onStart = vi.fn(async () => true);
    render(
      <SliceVideoImportPanel
        adapter={adapter()}
        file={videoFile()}
        onClose={vi.fn()}
        onChooseAnother={vi.fn()}
        onStart={onStart}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/Inspecting tracks/i);
    const importButton = await screen.findByRole("button", { name: "Import 2 frames" });
    expect(screen.getByText("16×16")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Time range" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Target FPS" }));
    fireEvent.change(screen.getByRole("slider", { name: "Target FPS" }), {
      target: { value: "4" },
    });
    fireEvent.click(importButton);

    await waitFor(() => expect(onStart).toHaveBeenCalledOnce());
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ name: "walk.mp4" }),
      {
        trackIndex: 0,
        range: { startUs: 0, endUs: 1_000_000 },
        sampling: { mode: "fps", fps: 4 },
      },
    );
  });

  it("blocks a codec the browser cannot decode", async () => {
    render(
      <SliceVideoImportPanel
        adapter={adapter({ ...PREFLIGHT, decodable: false })}
        file={videoFile()}
        onClose={vi.fn()}
        onChooseAnother={vi.fn()}
        onStart={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot decode the video codec/i);
    expect(screen.queryByRole("button", { name: /Import \d+ frame/ })).not.toBeInTheDocument();
  });

  it("shows the output cap and disables import for an oversized selection", async () => {
    const timestamps = Array.from(
      { length: VIDEO_IMPORT_LIMITS.maxOutputFrames + 1 },
      (_, index) => index * 1_000,
    );
    render(
      <SliceVideoImportPanel
        adapter={adapter({
          ...PREFLIGHT,
          durationUs: timestamps.at(-1)! + 1_000,
          sampleTimestampsUs: timestamps,
          track: { ...PREFLIGHT.track, sampleCount: timestamps.length },
        })}
        file={videoFile()}
        onClose={vi.fn()}
        onChooseAnother={vi.fn()}
        onStart={vi.fn()}
      />,
    );

    expect(await screen.findByText(new RegExp(`${VIDEO_IMPORT_LIMITS.maxOutputFrames}-frame limit`, "i"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Import ${timestamps.length} frames` })).toBeDisabled();
  });

  it("recovers when the queue action throws before returning", async () => {
    render(
      <SliceVideoImportPanel
        adapter={adapter()}
        file={videoFile()}
        onClose={vi.fn()}
        onChooseAnother={vi.fn()}
        onStart={() => { throw new Error("runner unavailable"); }}
      />,
    );

    const importButton = await screen.findByRole("button", { name: "Import 2 frames" });
    fireEvent.click(importButton);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be queued/i);
    expect(importButton).toBeEnabled();
  });
});
