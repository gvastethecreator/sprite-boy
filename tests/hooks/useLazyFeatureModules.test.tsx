import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useExportLogic } from "../../hooks/domains/useExportLogic";
import {
  AppMode,
  type GridConfig,
  type ProjectState,
} from "../../types";

const mocks = vi.hoisted(() => ({
  addAsset: vi.fn().mockResolvedValue(undefined),
  createGif: vi.fn(),
  generateAsync: vi.fn().mockResolvedValue(new Blob(["zip"])),
  zipFile: vi.fn(),
}));

vi.mock("../../utils/db", () => ({
  addAsset: mocks.addAsset,
  dataURIToBlob: () => new Blob(["pixel"], { type: "image/png" }),
  deleteAsset: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/uiFeedback", () => ({ uiFeedback: { play: vi.fn() } }));

vi.mock("jszip", () => ({
  default: class JSZipMock {
    folder() {
      return { file: mocks.zipFile };
    }

    generateAsync(options: { type: "blob" }) {
      return mocks.generateAsync(options);
    }
  },
}));

vi.mock("gifshot", () => ({
  default: { createGIF: mocks.createGif },
}));

const grid: GridConfig = {
  rows: 1,
  cols: 1,
  marginX: 0,
  marginY: 0,
  paddingX: 0,
  paddingY: 0,
};

function project(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    imageMeta: null,
    builderCanvas: null,
    frames: [],
    builderSlots: {},
    builderFreeObjects: [],
    animations: [],
    builderAssets: [],
    aspectRatio: "1:1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.addAsset.mockResolvedValue(undefined);
  mocks.generateAsync.mockResolvedValue(new Blob(["zip"]));
  mocks.createGif.mockImplementation((_options, callback) => callback({
    error: false,
    image: "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==",
  }));
});

describe("deferred export feature modules", () => {
  it("loads ZIP and GIF codecs only from their export actions", async () => {
    const state = project({
      frames: [{ id: 1, x: 0, y: 0, w: 16, h: 16, hidden: false }],
      animations: [{
        id: "walk",
        name: "Walk",
        fps: 12,
        loop: true,
        keyframes: [{
          uid: "keyframe-1",
          sourceIndex: 1,
          pivotX: 0.5,
          pivotY: 0.5,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
        }],
      }],
    });
    const notify = vi.fn();
    const { result } = renderHook(() => useExportLogic({
      project: state,
      currentMode: AppMode.BUILDER,
      activeGrid: grid,
      builderGrid: grid,
      setIsLoading: vi.fn(),
      setLoadingMessage: vi.fn(),
      notify,
    }));
    const canvas = { exportFrame: vi.fn().mockResolvedValue("data:image/png;base64,cGl4ZWw=") };
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    await act(() => result.current.handleExportZip(canvas));
    await act(() => result.current.handleExportGif("walk", canvas));

    expect(mocks.zipFile).toHaveBeenCalledWith("frame_1.png", "cGl4ZWw=", { base64: true });
    expect(mocks.generateAsync).toHaveBeenCalledWith({ type: "blob" });
    expect(mocks.createGif).toHaveBeenCalledWith(
      expect.objectContaining({ images: ["data:image/png;base64,cGl4ZWw="], interval: 1 / 12 }),
      expect.any(Function),
    );
    expect(click).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith("ZIP downloaded", "success");
    expect(notify).toHaveBeenCalledWith("GIF Exported", "success");
    click.mockRestore();
  });

});
