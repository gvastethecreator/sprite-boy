import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useProjectController } from "../../hooks/useProjectController";
import type { ProjectState } from "../../types";

const removeBackground = vi.hoisted(() => vi.fn());

vi.mock("../../utils/algorithms", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../utils/algorithms")>(),
  removeBackground,
}));

vi.mock("../../utils/db", () => ({
  addAsset: vi.fn().mockResolvedValue(undefined),
  dataURIToBlob: vi.fn(() => new Blob()),
  deleteAsset: vi.fn().mockResolvedValue(undefined),
  getAllAssets: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../utils/uiFeedback", () => ({
  uiFeedback: { play: vi.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function projectFile(): File {
  const project: ProjectState = {
    imageMeta: {
      src: "data:image/png;base64,canonical-source",
      width: 8,
      height: 8,
      name: "source.png",
      fileSize: 64,
    },
    builderCanvas: { width: 8, height: 8 },
    frames: [],
    builderSlots: {},
    builderFreeObjects: [],
    animations: [],
    builderAssets: [],
    aspectRatio: "1:1",
  };
  return new File([JSON.stringify({ project })], "project.json", { type: "application/json" });
}

describe("canonical workspace background-operation quarantine", () => {
  beforeEach(() => {
    removeBackground.mockReset();
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
        key: (index: number) => Array.from(values.keys())[index] ?? null,
        get length() { return values.size; },
      },
    });
  });

  it("aborts late preview/apply work and revokes the active preview on transition", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:bg-active");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { result } = renderHook(() => useProjectController());
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      expect(await result.current.handleLoadProject(projectFile())).toBe(true);
    });

    removeBackground.mockResolvedValueOnce(new Blob([new Uint8Array([1])], { type: "image/png" }));
    act(() => result.current.handlePreviewBackground("#00ff00", 15, 20));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.bgPreviewBlobUrl).toBe("blob:bg-active");

    act(() => result.current.clearLegacyCanvasInteractionState());
    expect(result.current.bgPreviewBlobUrl).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:bg-active");

    const preview = deferred<Blob | null>();
    removeBackground.mockReturnValueOnce(preview.promise);
    act(() => result.current.handlePreviewBackground("#00ff00", 15, 20));
    act(() => result.current.clearLegacyCanvasInteractionState());
    await act(async () => {
      preview.resolve(new Blob([new Uint8Array([2])], { type: "image/png" }));
      await preview.promise;
      await Promise.resolve();
    });
    expect(result.current.bgPreviewBlobUrl).toBeNull();
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    const apply = deferred<Blob | null>();
    removeBackground.mockReturnValueOnce(apply.promise);
    const sourceBefore = result.current.slicerImage?.src;
    act(() => result.current.handleRemoveBackground("#00ff00", 15, 20));
    act(() => result.current.clearLegacyCanvasInteractionState());
    await act(async () => {
      apply.resolve(new Blob([new Uint8Array([3])], { type: "image/png" }));
      await apply.promise;
      await Promise.resolve();
    });
    expect(result.current.slicerImage?.src).toBe(sourceBefore);
    expect(result.current.bgPreviewBlobUrl).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
