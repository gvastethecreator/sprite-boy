/**
 * Pure host-legacy safety policy: clamps, image src allowlist, load validation,
 * asset merge, history keys, and pixel caps shared with Slice source limits.
 */
import {
  AppMode,
  DEFAULT_PREFERENCES,
  type BuilderAsset,
  type FrameData,
  type GridConfig,
  type ImageMeta,
  type OnionSkinConfig,
  type ProjectState,
  type SpriteAnimation,
  type TemplateConfig,
  type UserPreferences,
} from "../types";
import { createSafeDownloadFileName } from "./safeDownloadFileName";

/** Keep aligned with features/slice/source/browserSourceDecoder defaults. */
export const HOST_MAX_IMAGE_WIDTH = 16_384;
export const HOST_MAX_IMAGE_HEIGHT = 16_384;
export const HOST_MAX_IMAGE_PIXELS = 64 * 1024 * 1024;

export const HOST_FPS_MIN = 1;
export const HOST_FPS_MAX = 60;
export const HOST_GRID_AXIS_MIN = 1;
export const HOST_GRID_AXIS_MAX = 256;

const ALLOWED_IMAGE_SRC =
  /^(?:data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml)(?:;|,)|blob:)/i;

export type HostImageSrcKind = "data-image" | "blob" | "rejected";

export function classifyHostImageSrc(src: unknown): HostImageSrcKind {
  if (typeof src !== "string" || src.length === 0) return "rejected";
  if (/^https?:\/\//i.test(src)) return "rejected";
  if (src.startsWith("blob:")) return "blob";
  if (/^data:image\//i.test(src)) return "data-image";
  return "rejected";
}

/** Allow data:image/* and in-session blob: URLs only — never bare http(s). */
export function isAllowedHostImageSrc(src: unknown): boolean {
  if (typeof src !== "string" || src.length === 0) return false;
  if (/^https?:\/\//i.test(src)) return false;
  return ALLOWED_IMAGE_SRC.test(src);
}

export function clampHostFps(value: unknown, fallback = 12): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(HOST_FPS_MAX, Math.max(HOST_FPS_MIN, Math.round(n)));
}

export function clampGridConfig(raw: unknown, fallback: GridConfig): GridConfig {
  if (!raw || typeof raw !== "object") return { ...fallback };
  const o = raw as Record<string, unknown>;
  const num = (key: string, def: number, min: number, max: number): number => {
    const v = o[key];
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  return {
    rows: num("rows", fallback.rows, HOST_GRID_AXIS_MIN, HOST_GRID_AXIS_MAX),
    cols: num("cols", fallback.cols, HOST_GRID_AXIS_MIN, HOST_GRID_AXIS_MAX),
    marginX: num("marginX", fallback.marginX, 0, 4096),
    marginY: num("marginY", fallback.marginY, 0, 4096),
    paddingX: num("paddingX", fallback.paddingX, 0, 4096),
    paddingY: num("paddingY", fallback.paddingY, 0, 4096),
  };
}

export function assertHostImageDimensions(
  width: number,
  height: number,
): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("Image dimensions are invalid.");
  }
  if (width > HOST_MAX_IMAGE_WIDTH || height > HOST_MAX_IMAGE_HEIGHT) {
    throw new Error(
      `Image exceeds max dimensions ${HOST_MAX_IMAGE_WIDTH}×${HOST_MAX_IMAGE_HEIGHT}.`,
    );
  }
  if (width * height > HOST_MAX_IMAGE_PIXELS) {
    throw new Error(
      `Image exceeds max pixel count ${HOST_MAX_IMAGE_PIXELS}.`,
    );
  }
}

/**
 * Session wins: keep previous assets (live blob URLs / concurrent adds),
 * then append hydrated rows whose ids are not already present.
 */
export function mergeHydratedBuilderAssets(
  previous: readonly BuilderAsset[],
  hydrated: readonly BuilderAsset[],
): BuilderAsset[] {
  const out: BuilderAsset[] = [];
  const seen = new Set<string>();
  for (const asset of previous) {
    out.push(asset);
    seen.add(asset.id);
  }
  for (const asset of hydrated) {
    if (seen.has(asset.id)) continue;
    out.push(asset);
    seen.add(asset.id);
  }
  return out;
}

export function collectOwnedBlobUrls(
  assets: readonly BuilderAsset[],
): string[] {
  return assets
    .map((a) => a.src)
    .filter((src) => typeof src === "string" && src.startsWith("blob:"));
}

export function revokeBlobUrls(urls: Iterable<string>): void {
  for (const url of urls) {
    try {
      if (typeof url === "string" && url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    } catch {
      // Best-effort revoke.
    }
  }
}

/**
 * Lightweight history key for ProjectState.
 * Fingerprints every durable structural field so useUndo does not treat
 * keyframe/hitbox/slot/free-object property edits as no-ops.
 * Never embeds multi-MB image payloads (data:/blob: use length+prefix only).
 */
export function projectStateHistoryKey(state: ProjectState): string {
  const srcKey = (src: string | undefined): string => {
    if (!src) return "";
    if (src.startsWith("data:")) return `d:${src.length}:${src.slice(5, 24)}`;
    if (src.startsWith("blob:")) return `b:${src.length}:${src.slice(-24)}`;
    return `s:${src.length}:${src.slice(0, 48)}`;
  };
  const num = (value: unknown): string =>
    typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  const bool = (value: unknown): string => (value ? "1" : "0");

  const frames = state.frames
    .map((f) => {
      const boxes = (f.hitboxes ?? [])
        .map(
          (h) =>
            `${h.id}:${h.type}:${num(h.x)},${num(h.y)},${num(h.w)},${num(h.h)}:${h.tag ?? ""}`,
        )
        .join(",");
      return `${f.id}:${num(f.x)},${num(f.y)},${num(f.w)},${num(f.h)}:${bool(f.hidden)}:[${boxes}]`;
    })
    .join(";");
  const assets = state.builderAssets
    .map((a) => `${a.id}:${a.name}:${num(a.width)}x${num(a.height)}:${srcKey(a.src)}`)
    .join(";");
  const anims = state.animations
    .map((a) => {
      const kfs = a.keyframes
        .map(
          (k) =>
            `${k.uid}:${num(k.sourceIndex)}:${num(k.pivotX)},${num(k.pivotY)}:${num(k.rotation)}:${num(k.scaleX)},${num(k.scaleY)}:${num(k.opacity)}`,
        )
        .join(",");
      return `${a.id}:${a.name}:${num(a.fps)}:${bool(a.loop)}:[${kfs}]`;
    })
    .join(";");
  const slots = Object.keys(state.builderSlots)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => {
      const s = state.builderSlots[Number(k)];
      if (!s) return `${k}:`;
      return [
        k,
        s.assetId,
        s.fitMode,
        s.alignment,
        num(s.scaleX),
        num(s.scaleY),
        bool(s.lockAspect),
        num(s.rotation),
        num(s.opacity),
        num(s.offsetX),
        num(s.offsetY),
        bool(s.flipX),
        bool(s.flipY),
      ].join(":");
    })
    .join(";");
  const free = state.builderFreeObjects
    .map(
      (o) =>
        `${o.id}:${o.assetId}:${num(o.x)},${num(o.y)},${num(o.w)},${num(o.h)}:${num(o.rotation)}:${bool(o.flipX)}:${bool(o.flipY)}:${num(o.opacity)}:${num(o.zIndex)}`,
    )
    .join(";");
  const meta = state.imageMeta
    ? `${state.imageMeta.name}:${num(state.imageMeta.width)}x${num(state.imageMeta.height)}:${srcKey(state.imageMeta.src)}`
    : "";
  const canvas = state.builderCanvas
    ? `${num(state.builderCanvas.width)}x${num(state.builderCanvas.height)}`
    : "";
  const slice = state.sliceGrid
    ? `sg:${state.sliceGrid.version}:${state.sliceGrid.manual.rows}x${state.sliceGrid.manual.cols}:${(state.sliceGrid.manual.rowBoundaries ?? []).join(",")}:${(state.sliceGrid.manual.columnBoundaries ?? []).join(",")}:${JSON.stringify(state.sliceGrid.recipe)}`
    : "";
  return [meta, canvas, frames, assets, anims, slots, free, state.aspectRatio ?? "", slice].join(
    "|",
  );
}

export function sanitizeHostDownloadBaseName(
  raw: unknown,
  fallback: string,
): string {
  const base =
    typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : fallback;
  try {
    const withExt = createSafeDownloadFileName(base, "bin");
    return withExt.slice(0, -".bin".length);
  } catch {
    return createSafeDownloadFileName(fallback, "bin").slice(0, -".bin".length);
  }
}

export function hostDownloadFileName(
  baseName: unknown,
  extension: string,
  fallbackBase = "studio",
): string {
  const safeBase = sanitizeHostDownloadBaseName(baseName, fallbackBase);
  return createSafeDownloadFileName(safeBase, extension);
}

function sanitizeImageMeta(raw: unknown): ImageMeta | null {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid imageMeta");
  }
  const o = raw as Record<string, unknown>;
  if (!isAllowedHostImageSrc(o.src)) {
    throw new Error("Image source scheme is not allowed");
  }
  const width = Number(o.width);
  const height = Number(o.height);
  assertHostImageDimensions(width, height);
  return {
    src: String(o.src),
    width,
    height,
    name: typeof o.name === "string" ? o.name : "image",
    fileSize: Number.isFinite(Number(o.fileSize)) ? Number(o.fileSize) : 0,
  };
}

function sanitizeFrames(raw: unknown): FrameData[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((f, i) => {
    if (!f || typeof f !== "object") throw new Error(`Invalid frame at ${i}`);
    const o = f as Record<string, unknown>;
    const id = Number(o.id);
    const x = Number(o.x);
    const y = Number(o.y);
    const w = Number(o.w);
    const h = Number(o.h);
    if (![id, x, y, w, h].every((n) => Number.isFinite(n))) {
      throw new Error(`Invalid frame numbers at ${i}`);
    }
    return {
      id,
      x,
      y,
      w,
      h,
      hidden: o.hidden === true,
      hitboxes: Array.isArray(o.hitboxes) ? (o.hitboxes as FrameData["hitboxes"]) : undefined,
    };
  });
}

function sanitizeAnimations(raw: unknown): SpriteAnimation[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a, i) => {
    if (!a || typeof a !== "object") throw new Error(`Invalid animation at ${i}`);
    const o = a as Record<string, unknown>;
    return {
      id: typeof o.id === "string" ? o.id : `anim-${i}`,
      name: typeof o.name === "string" ? o.name : `Anim ${i + 1}`,
      fps: clampHostFps(o.fps, 12),
      loop: o.loop !== false,
      keyframes: Array.isArray(o.keyframes) ? (o.keyframes as SpriteAnimation["keyframes"]) : [],
    };
  });
}

function sanitizeBuilderAssets(raw: unknown): BuilderAsset[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a, i) => {
    if (!a || typeof a !== "object") throw new Error(`Invalid asset at ${i}`);
    const o = a as Record<string, unknown>;
    if (!isAllowedHostImageSrc(o.src)) {
      throw new Error(`Asset source scheme is not allowed at ${i}`);
    }
    return {
      id: typeof o.id === "string" ? o.id : `asset-${i}`,
      src: String(o.src),
      name: typeof o.name === "string" ? o.name : "asset",
      width: Number.isFinite(Number(o.width)) ? Number(o.width) : 1,
      height: Number.isFinite(Number(o.height)) ? Number(o.height) : 1,
    };
  });
}

export interface ParsedLegacyProjectFile {
  project: ProjectState;
  ui?: Partial<{
    slicerGrid: GridConfig;
    builderGrid: GridConfig;
    templateConfig: TemplateConfig;
    currentMode: AppMode;
    onionSkin: OnionSkinConfig;
  }>;
}

type HostAppMode = AppMode;

const DEFAULT_GRID: GridConfig = {
  rows: 2,
  cols: 2,
  marginX: 0,
  marginY: 0,
  paddingX: 0,
  paddingY: 0,
};

export function parseLegacyProjectFile(data: unknown): ParsedLegacyProjectFile {
  if (data === null || typeof data !== "object" || !("project" in data)) {
    throw new Error("Invalid project file");
  }
  const root = data as Record<string, unknown>;
  const projectRaw = root.project;
  if (!projectRaw || typeof projectRaw !== "object") {
    throw new Error("Invalid project payload");
  }
  const p = projectRaw as Record<string, unknown>;
  const project: ProjectState = {
    imageMeta: sanitizeImageMeta(p.imageMeta ?? null),
    builderCanvas:
      p.builderCanvas && typeof p.builderCanvas === "object"
        ? {
            width: Math.max(1, Number((p.builderCanvas as { width?: number }).width) || 1024),
            height: Math.max(1, Number((p.builderCanvas as { height?: number }).height) || 1024),
          }
        : null,
    frames: sanitizeFrames(p.frames),
    builderSlots:
      p.builderSlots && typeof p.builderSlots === "object" && !Array.isArray(p.builderSlots)
        ? (p.builderSlots as ProjectState["builderSlots"])
        : {},
    builderFreeObjects: Array.isArray(p.builderFreeObjects)
      ? (p.builderFreeObjects as ProjectState["builderFreeObjects"])
      : [],
    animations: sanitizeAnimations(p.animations),
    builderAssets: sanitizeBuilderAssets(p.builderAssets),
    aspectRatio: typeof p.aspectRatio === "string" ? p.aspectRatio : undefined,
  };

  let ui: ParsedLegacyProjectFile["ui"];
  if (root.ui && typeof root.ui === "object") {
    const u = root.ui as Record<string, unknown>;
    ui = {};
    if (u.slicerGrid) ui.slicerGrid = clampGridConfig(u.slicerGrid, DEFAULT_GRID);
    if (u.builderGrid) ui.builderGrid = clampGridConfig(u.builderGrid, DEFAULT_GRID);
    if (u.templateConfig && typeof u.templateConfig === "object") {
      ui.templateConfig = u.templateConfig as TemplateConfig;
    }
    if (typeof u.currentMode === "string" && Object.values(AppMode).includes(u.currentMode as AppMode)) {
      ui.currentMode = u.currentMode as HostAppMode;
    }
    if (u.onionSkin && typeof u.onionSkin === "object") {
      ui.onionSkin = u.onionSkin as OnionSkinConfig;
    }
  }

  return { project, ui };
}

export function clampUserPreferences(raw: unknown): UserPreferences {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFERENCES };
  const merged = { ...DEFAULT_PREFERENCES, ...(raw as UserPreferences) };
  // Black accent was the historic default; on dark panels it kills primary CTAs.
  const accent = typeof merged.accentColor === "string" ? merged.accentColor.trim() : "";
  const accentRgb = accent.split(/\s+/).map(Number);
  const isBlackAccent =
    accent === "0 0 0" ||
    (accentRgb.length === 3 && accentRgb.every((channel) => Number.isFinite(channel) && channel === 0));
  return {
    ...merged,
    accentColor: isBlackAccent ? DEFAULT_PREFERENCES.accentColor : accent || DEFAULT_PREFERENCES.accentColor,
    defaultFps: clampHostFps(merged.defaultFps, DEFAULT_PREFERENCES.defaultFps),
    snapThreshold: Number.isFinite(merged.snapThreshold)
      ? Math.min(64, Math.max(1, Math.round(merged.snapThreshold)))
      : DEFAULT_PREFERENCES.snapThreshold,
  };
}

export function parseHostUiState(raw: unknown): {
  mode: HostAppMode;
  slicerGrid: GridConfig;
  builderGrid: GridConfig;
} {
  const defaults = {
    mode: AppMode.BUILDER,
    slicerGrid: { ...DEFAULT_GRID },
    builderGrid: { ...DEFAULT_GRID },
  };
  if (!raw || typeof raw !== "object") return defaults;
  const o = raw as Record<string, unknown>;
  const mode =
    typeof o.mode === "string" && Object.values(AppMode).includes(o.mode as AppMode)
      ? (o.mode as HostAppMode)
      : defaults.mode;
  return {
    mode,
    slicerGrid: clampGridConfig(o.slicerGrid, defaults.slicerGrid),
    builderGrid: clampGridConfig(o.builderGrid, defaults.builderGrid),
  };
}

/** True when interaction requires continuous canvas paints. */
export function hostCanvasNeedsContinuousPaint(input: {
  isPlaying?: boolean;
  dragMode?: string | null;
  dragSelectionRect?: unknown;
  isDragOverCanvas?: boolean;
  dragStartSlot?: number | null;
}): boolean {
  if (input.isPlaying) return true;
  if (input.dragSelectionRect) return true;
  if (input.isDragOverCanvas) return true;
  if (input.dragStartSlot !== null && input.dragStartSlot !== undefined) return true;
  const mode = input.dragMode;
  if (mode && mode !== "none" && mode !== "NONE" && mode !== "") return true;
  return false;
}
