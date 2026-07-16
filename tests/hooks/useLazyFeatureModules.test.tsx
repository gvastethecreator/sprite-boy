import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBuilderLogic } from "../../hooks/domains/useBuilderLogic";
import { useExportLogic } from "../../hooks/domains/useExportLogic";
import { analyzeImageBlob } from "../../utils/lazyFeatureModules";
import {
  AppMode,
  DEFAULT_PREFERENCES,
  type GridConfig,
  type ProjectState,
} from "../../types";

const mocks = vi.hoisted(() => ({
  addAsset: vi.fn().mockResolvedValue(undefined),
  analyzeImage: vi.fn().mockResolvedValue({ summary: "two rows" }),
  createGif: vi.fn(),
  generateAsync: vi.fn().mockResolvedValue(new Blob(["zip"])),
  generateSprite: vi.fn().mockResolvedValue("data:image/png;base64,cGl4ZWw="),
  zipFile: vi.fn(),
}));

vi.mock("../../utils/aiService", () => ({
  analyzeImage: mocks.analyzeImage,
  generateSprite: mocks.generateSprite,
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
  mocks.analyzeImage.mockResolvedValue({ summary: "two rows" });
  mocks.generateAsync.mockResolvedValue(new Blob(["zip"]));
  mocks.generateSprite.mockResolvedValue("data:image/png;base64,cGl4ZWw=");
  mocks.createGif.mockImplementation((_options, callback) => callback({
    error: false,
    image: "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==",
  }));
});

describe("lazy feature modules", () => {
  it("loads AI generation on demand and commits the generated asset", async () => {
    let current = project();
    const setProject = vi.fn((update: (previous: ProjectState) => ProjectState) => {
      current = update(current);
    });
    const setLoading = vi.fn();
    const setMessage = vi.fn();
    const notify = vi.fn();
    const selected = vi.fn();
    const { result } = renderHook(() => useBuilderLogic(
      current,
      setProject,
      setProject,
      { ...DEFAULT_PREFERENCES, soundEnabled: false },
      notify,
      setLoading,
      setMessage,
    ));

    expect(mocks.generateSprite).not.toHaveBeenCalled();
    await act(() => result.current.runGeneration(
      "walk cycle",
      [],
      null,
      selected,
      "gemini-2.5-flash-image",
      "new_image",
    ));

    expect(mocks.generateSprite).toHaveBeenCalledWith(
      [],
      "walk cycle",
      "gemini-2.5-flash-image",
      "new_image",
    );
    expect(mocks.addAsset).toHaveBeenCalledOnce();
    expect(current.builderAssets).toHaveLength(1);
    expect(setLoading.mock.calls).toEqual([[true], [false]]);
    expect(notify).toHaveBeenCalledWith("Generation complete", "success");
  });

  it("contains a lazy AI failure and always releases loading state", async () => {
    mocks.generateSprite.mockRejectedValueOnce(new Error("provider unavailable"));
    let current = project();
    const setProject = vi.fn((update: (previous: ProjectState) => ProjectState) => {
      current = update(current);
    });
    const setLoading = vi.fn();
    const notify = vi.fn();
    const { result } = renderHook(() => useBuilderLogic(
      current,
      setProject,
      setProject,
      { ...DEFAULT_PREFERENCES, soundEnabled: false },
      notify,
      setLoading,
      vi.fn(),
    ));

    await act(() => result.current.runGeneration(
      "walk cycle",
      [],
      null,
      vi.fn(),
      "gemini-2.5-flash-image",
      "new_image",
    ));

    expect(mocks.addAsset).not.toHaveBeenCalled();
    expect(current.builderAssets).toEqual([]);
    expect(setLoading.mock.calls).toEqual([[true], [false]]);
    expect(notify).toHaveBeenCalledWith("Gen error: provider unavailable", "error");
  });

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

  it("reads the input before loading AI analysis and returns its result", async () => {
    const result = await analyzeImageBlob(new Blob(["sprite"], { type: "image/png" }));

    expect(mocks.analyzeImage).toHaveBeenCalledOnce();
    expect(mocks.analyzeImage.mock.calls[0]?.[0]).toMatch(/^data:image\/png;base64,/u);
    expect(result).toEqual({ summary: "two rows" });
  });
});
