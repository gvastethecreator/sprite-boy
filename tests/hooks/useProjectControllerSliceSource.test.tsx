import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useProjectController } from "../../hooks/useProjectController";

vi.mock("../../utils/db", () => ({
  addAsset: vi.fn().mockResolvedValue(undefined),
  dataURIToBlob: vi.fn(() => new Blob()),
  deleteAsset: vi.fn().mockResolvedValue(undefined),
  getAllAssets: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../utils/uiFeedback", () => ({
  uiFeedback: { play: vi.fn() },
}));

describe("useProjectController Slice ownership boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reset clears derived interaction/playback and revokes the owned BG preview once", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { result } = renderHook(() => useProjectController());
    await act(async () => Promise.resolve());

    act(() => {
      result.current.handleCreateCanvas(32, 16);
      result.current.handleAddAnimation();
      result.current.setSelectedIndex(0);
      result.current.setIsPlaying(true);
      result.current.setBgPreviewBlobUrl("blob:bg-preview-owned");
    });
    expect(result.current.frames).not.toHaveLength(0);
    expect(result.current.activeAnimationId).not.toBeNull();
    expect(result.current.selectedIndex).toBe(0);
    expect(result.current.isPlaying).toBe(true);

    const preferencesBefore = result.current.preferences;
    act(() => result.current.handleResetSliceSource());

    expect(result.current.frames).toEqual([]);
    expect(result.current.animations).toEqual([]);
    expect(result.current.builderCanvas).toBeNull();
    expect(result.current.activeAnimationId).toBeNull();
    expect(result.current.selectedIndex).toBeNull();
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.bgPreviewBlobUrl).toBeNull();
    expect(result.current.preferences).toBe(preferencesBefore);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:bg-preview-owned");
  });

  it("resolves a committed replacement despite hostile listener and handler cleanup", async () => {
    class HostileCleanupFileReader {
      static readonly EMPTY = 0;
      static readonly LOADING = 1;
      static readonly DONE = 2;
      readyState = HostileCleanupFileReader.EMPTY;
      result: string | ArrayBuffer | null = null;
      private loadHandler: ((event: ProgressEvent<FileReader>) => void) | null = null;
      private errorHandler: ((event: ProgressEvent<FileReader>) => void) | null = null;
      private abortHandler: ((event: ProgressEvent<FileReader>) => void) | null = null;

      get onload() { return this.loadHandler; }
      set onload(value) {
        if (value === null && this.loadHandler) throw new Error("onload cleanup setter failed");
        this.loadHandler = value;
      }
      get onerror() { return this.errorHandler; }
      set onerror(value) {
        if (value === null && this.errorHandler) throw new Error("onerror cleanup setter failed");
        this.errorHandler = value;
      }
      get onabort() { return this.abortHandler; }
      set onabort(value) {
        if (value === null && this.abortHandler) throw new Error("onabort cleanup setter failed");
        this.abortHandler = value;
      }
      readAsDataURL() {
        this.readyState = HostileCleanupFileReader.DONE;
        this.result = "data:image/png;base64,cGl4ZWxz";
        queueMicrotask(() => this.loadHandler?.call(this as never, {} as ProgressEvent<FileReader>));
      }
      abort() {
        this.readyState = HostileCleanupFileReader.DONE;
        this.abortHandler?.call(this as never, {} as ProgressEvent<FileReader>);
      }
    }

    class HostileCleanupImage {
      width = 12;
      height = 6;
      private loadHandler: ((event: Event) => void) | null = null;
      private errorHandler: ((event: Event | string) => void) | null = null;
      get onload() { return this.loadHandler; }
      set onload(value) {
        if (value === null && this.loadHandler) throw new Error("image onload cleanup failed");
        this.loadHandler = value;
      }
      get onerror() { return this.errorHandler; }
      set onerror(value) {
        if (value === null && this.errorHandler) throw new Error("image onerror cleanup failed");
        this.errorHandler = value;
      }
      set src(value: string) {
        if (value) queueMicrotask(() => this.loadHandler?.call(this as never, new Event("load")));
      }
    }

    vi.stubGlobal("FileReader", HostileCleanupFileReader);
    vi.stubGlobal("Image", HostileCleanupImage);
    const removeEventListener = vi.fn(() => { throw new Error("signal cleanup failed"); });
    const signal = {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener,
    } as unknown as AbortSignal;
    const { result } = renderHook(() => useProjectController());
    await act(async () => Promise.resolve());

    await act(async () => {
      await expect(result.current.handleUpload(
        new File(["pixels"], "hostile-cleanup.png", { type: "image/png" }),
        { signal },
      )).resolves.toBeUndefined();
    });

    expect(result.current.slicerImage).toMatchObject({
      name: "hostile-cleanup.png",
      width: 12,
      height: 6,
    });
    expect(removeEventListener).toHaveBeenCalledOnce();
  });

  it("aborts safely at startup without invoking a hostile aborted getter", async () => {
    const hostileGetter = vi.fn(() => { throw new Error("aborted getter executed"); });
    const removeEventListener = vi.fn();
    const signal = {
      get aborted() { return hostileGetter(); },
      addEventListener: vi.fn(),
      removeEventListener,
    } as unknown as AbortSignal;
    const { result } = renderHook(() => useProjectController());
    await act(async () => Promise.resolve());

    await act(async () => {
      await expect(result.current.handleUpload(
        new File(["pixels"], "hostile-start.png", { type: "image/png" }),
        { signal },
      )).rejects.toMatchObject({ name: "AbortError" });
    });

    expect(hostileGetter).not.toHaveBeenCalled();
    expect(removeEventListener).toHaveBeenCalledOnce();
    expect(result.current.slicerImage).toBeNull();
  });

  it("aborts terminally when the signal becomes hostile during image load", async () => {
    let readerLoad: ((event: ProgressEvent<FileReader>) => void) | null = null;
    class DeferredFileReader {
      static readonly EMPTY = 0;
      static readonly LOADING = 1;
      static readonly DONE = 2;
      readyState = DeferredFileReader.EMPTY;
      result: string | ArrayBuffer | null = null;
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;
      get onload() { return readerLoad; }
      set onload(value) { readerLoad = value; }
      readAsDataURL() {
        this.readyState = DeferredFileReader.DONE;
        this.result = "data:image/png;base64,cGl4ZWxz";
        queueMicrotask(() => readerLoad?.call(this as never, {} as ProgressEvent<FileReader>));
      }
      abort() { this.onabort?.call(this as never, {} as ProgressEvent<FileReader>); }
    }
    const hostileGetter = vi.fn(() => { throw new Error("late aborted getter executed"); });
    const removeEventListener = vi.fn();
    const signal = {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener,
    } as unknown as AbortSignal;
    class LateHostileImage {
      width = 16;
      height = 8;
      onload: ((event: Event) => void) | null = null;
      onerror: ((event: Event | string) => void) | null = null;
      set src(value: string) {
        if (!value) return;
        Object.defineProperty(signal, "aborted", {
          configurable: true,
          get: hostileGetter,
        });
        queueMicrotask(() => this.onload?.call(this as never, new Event("load")));
      }
    }
    vi.stubGlobal("FileReader", DeferredFileReader);
    vi.stubGlobal("Image", LateHostileImage);
    const { result } = renderHook(() => useProjectController());
    await act(async () => Promise.resolve());

    await act(async () => {
      await expect(result.current.handleUpload(
        new File(["pixels"], "hostile-late.png", { type: "image/png" }),
        { signal },
      )).rejects.toMatchObject({ name: "AbortError" });
    });

    expect(hostileGetter).not.toHaveBeenCalled();
    expect(removeEventListener).toHaveBeenCalledOnce();
    expect(result.current.slicerImage).toBeNull();
  });
});
