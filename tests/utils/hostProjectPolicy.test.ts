import { describe, expect, it } from "vitest";
import {
  assertHostImageDimensions,
  clampGridConfig,
  clampHostFps,
  clampUserPreferences,
  classifyHostImageSrc,
  hostCanvasNeedsContinuousPaint,
  hostDownloadFileName,
  isAllowedHostImageSrc,
  mergeHydratedBuilderAssets,
  parseLegacyProjectFile,
  projectStateHistoryKey,
  HOST_MAX_IMAGE_PIXELS,
} from "../../utils/hostProjectPolicy";
import { DEFAULT_PREFERENCES } from "../../types";
import {
  missingAssetIdsForCache,
  pruneAssetCacheEntries,
} from "../../utils/hostAssetCache";
import {
  destroyImageWorker,
  workerTransferListForPayload,
} from "../../utils/algorithms";
import { projectStateHistoryKey as historyKey } from "../../utils/hostProjectPolicy";
import type { ProjectState } from "../../types";

const emptyProject = (): ProjectState => ({
  imageMeta: null,
  builderCanvas: null,
  frames: [],
  builderSlots: {},
  builderFreeObjects: [],
  animations: [],
  builderAssets: [],
});

describe("hostProjectPolicy", () => {
  it("migrates historic black accent to the readable studio default", () => {
    const migrated = clampUserPreferences({
      ...DEFAULT_PREFERENCES,
      accentColor: "0 0 0",
    });
    expect(migrated.accentColor).toBe(DEFAULT_PREFERENCES.accentColor);
    expect(migrated.accentColor).not.toBe("0 0 0");
    const kept = clampUserPreferences({
      ...DEFAULT_PREFERENCES,
      accentColor: "34 197 94",
    });
    expect(kept.accentColor).toBe("34 197 94");
  });

  it("merges hydrated assets without wiping concurrent session adds", () => {
    const previous = [
      { id: "live", src: "blob:live", name: "live.png", width: 8, height: 8 },
    ];
    const hydrated = [
      { id: "db", src: "blob:db", name: "db.png", width: 4, height: 4 },
      { id: "live", src: "blob:stale", name: "stale.png", width: 1, height: 1 },
    ];
    const merged = mergeHydratedBuilderAssets(previous, hydrated);
    expect(merged.map((a) => a.id)).toEqual(["live", "db"]);
    expect(merged[0].src).toBe("blob:live");
  });

  it("rejects http(s) image sources and allows data/blob", () => {
    expect(classifyHostImageSrc("https://evil.example/x.png")).toBe("rejected");
    expect(isAllowedHostImageSrc("https://evil.example/x.png")).toBe(false);
    expect(isAllowedHostImageSrc("data:image/png;base64,aaa")).toBe(true);
    expect(isAllowedHostImageSrc("blob:http://localhost/uuid")).toBe(true);
  });

  it("parseLegacyProjectFile rejects bad shape and disallowed src", () => {
    expect(() => parseLegacyProjectFile(null)).toThrow();
    expect(() => parseLegacyProjectFile({ project: {} })).not.toThrow();
    expect(() =>
      parseLegacyProjectFile({
        project: {
          imageMeta: {
            src: "https://tracker.example/pixel",
            width: 10,
            height: 10,
            name: "x",
            fileSize: 1,
          },
          frames: [],
          builderAssets: [],
          animations: [],
          builderSlots: {},
          builderFreeObjects: [],
        },
      }),
    ).toThrow(/not allowed/);
  });

  it("accepts a minimal valid legacy project with data:image src", () => {
    const parsed = parseLegacyProjectFile({
      project: {
        imageMeta: {
          src: "data:image/png;base64,iVBORw0KGgo=",
          width: 2,
          height: 2,
          name: "ok",
          fileSize: 12,
        },
        frames: [{ id: 1, x: 0, y: 0, w: 2, h: 2 }],
        animations: [{ id: "a", name: "walk", fps: 0, loop: true, keyframes: [] }],
        builderAssets: [],
        builderSlots: {},
        builderFreeObjects: [],
      },
      ui: { slicerGrid: { rows: 9999, cols: -3, marginX: 0, marginY: 0, paddingX: 0, paddingY: 0 } },
    });
    expect(parsed.project.animations[0].fps).toBe(1);
    expect(parsed.ui?.slicerGrid?.rows).toBe(256);
    expect(parsed.ui?.slicerGrid?.cols).toBe(1);
  });

  it("clamps FPS and grid axes", () => {
    expect(clampHostFps(0)).toBe(1);
    expect(clampHostFps(120)).toBe(60);
    expect(clampHostFps(NaN, 12)).toBe(12);
    expect(clampGridConfig({ rows: 0, cols: 500 }, {
      rows: 2, cols: 2, marginX: 0, marginY: 0, paddingX: 0, paddingY: 0,
    })).toMatchObject({ rows: 1, cols: 256 });
  });

  it("sanitizes download names via export helper rules", () => {
    const name = hostDownloadFileName("../../evil:name", "gif", "animation");
    expect(name.endsWith(".gif")).toBe(true);
    expect(name).not.toContain("..");
    expect(name).not.toContain(":");
  });

  it("history key ignores multi-MB payload content equality cost", () => {
    const huge = "data:image/png;base64," + "A".repeat(200_000);
    const a = emptyProject();
    a.imageMeta = { src: huge, width: 1, height: 1, name: "a", fileSize: 1 };
    const b = emptyProject();
    b.imageMeta = { src: huge + "B", width: 1, height: 1, name: "a", fileSize: 1 };
    const keyA = projectStateHistoryKey(a);
    const keyB = projectStateHistoryKey(b);
    expect(keyA.length).toBeLessThan(5_000);
    expect(keyB.length).toBeLessThan(5_000);
    expect(keyA).not.toBe(keyB);
    // Same structure + same length prefix path differs by length fingerprint
    const c = emptyProject();
    c.imageMeta = { src: huge, width: 1, height: 1, name: "a", fileSize: 1 };
    expect(projectStateHistoryKey(c)).toBe(keyA);
  });

  it("enforces host pixel caps", () => {
    expect(() => assertHostImageDimensions(1, 1)).not.toThrow();
    // 10000² exceeds HOST_MAX_IMAGE_PIXELS while staying under per-axis max.
    expect(() => assertHostImageDimensions(10_000, 10_000)).toThrow(/pixel|dimensions/);
    expect(HOST_MAX_IMAGE_PIXELS).toBeGreaterThan(0);
  });

  it("prunes deleted asset ids from image cache", () => {
    const cache = { keep: 1, gone: 2 };
    const assets = [{ id: "keep", src: "blob:k", name: "k", width: 1, height: 1 }];
    expect(pruneAssetCacheEntries(cache, assets)).toEqual({ keep: 1 });
    expect(missingAssetIdsForCache({ keep: 1 }, assets)).toEqual([]);
    expect(missingAssetIdsForCache({}, assets).map((a) => a.id)).toEqual(["keep"]);
  });

  it("marks continuous paint only for play/drag", () => {
    expect(hostCanvasNeedsContinuousPaint({})).toBe(false);
    expect(hostCanvasNeedsContinuousPaint({ isPlaying: true })).toBe(true);
    expect(hostCanvasNeedsContinuousPaint({ dragMode: "PAN" })).toBe(true);
    expect(hostCanvasNeedsContinuousPaint({ dragMode: "NONE" })).toBe(false);
  });

  it("builds transfer lists for ArrayBuffer payloads", () => {
    const buf = new ArrayBuffer(16);
    expect(workerTransferListForPayload({ buffer: buf })).toEqual([buf]);
    expect(workerTransferListForPayload({})).toEqual([]);
  });

  it("exposes destroyImageWorker for timeout recovery", () => {
    expect(typeof destroyImageWorker).toBe("function");
    destroyImageWorker();
  });
});

describe("useUndo historyKey avoids stringify of project payloads", () => {
  it("historyKey length stays bounded for huge data URLs", () => {
    const huge = "data:image/png;base64," + "Z".repeat(500_000);
    const project = emptyProject();
    project.imageMeta = { src: huge, width: 8, height: 8, name: "big", fileSize: 1 };
    const key = historyKey(project);
    expect(key.includes(huge)).toBe(false);
    expect(key.length).toBeLessThan(2_000);
  });
});
