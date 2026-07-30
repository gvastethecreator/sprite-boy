import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type ReactElement,
} from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import type { AssetRepository } from "../../../core/assets";
import {
  createBrowserSceneViewport,
  createSceneProjection,
  type BrowserSceneViewport,
  type BrowserSceneViewportOptions,
  type SceneAssetDescriptor,
  type SceneProjection,
} from "../../../core/render";
import type { ProjectStore } from "../../../core/stores";
import type { DeepReadonly, ProjectStoreState, WorkspaceState } from "../../../core/stores";
import { useWorkspaceStore } from "../../../contexts/StudioStoreContext";
import {
  useProjectStoreSelector,
  useWorkspaceStoreSelector,
} from "../../../hooks/useStudioStoreSelector";
import { resolveFittedSceneViewport } from "./sceneViewportFit";

export type ComposeViewportFactory = (
  options: BrowserSceneViewportOptions,
) => Pick<BrowserSceneViewport, "invalidate" | "dispose">;

export type ComposeBitmapDecoder = (
  source: ImageBitmapSource,
) => Promise<ImageBitmap>;

export interface ComposeCanvasWorkspaceProps {
  readonly store: ProjectStore;
  readonly assets: AssetRepository;
  readonly viewportFactory?: ComposeViewportFactory;
  readonly bitmapDecoder?: ComposeBitmapDecoder;
  readonly projectionFactory?: (
    project: DeepReadonly<ProjectStoreState>,
    workspace: DeepReadonly<WorkspaceState>,
  ) => SceneProjection;
  readonly ariaLabel?: string | null;
  readonly className?: string;
  readonly hideDiagnostics?: boolean;
  readonly transparentBackground?: boolean;
  readonly style?: CSSProperties;
  readonly overlay?: ReactNode;
}

const MAX_BITMAP_CACHE = 8;

function fitProjectionToHost(
  projection: SceneProjection,
  width: number,
  height: number,
): SceneProjection {
  const canvas = projection.canvas;
  if (
    !canvas ||
    width <= 0 ||
    height <= 0 ||
    canvas.width <= 0 ||
    canvas.height <= 0
  ) {
    return projection;
  }

  const viewport = resolveFittedSceneViewport(
    projection.viewport,
    canvas.width,
    canvas.height,
    width,
    height,
  );
  if (viewport === projection.viewport) return projection;
  return Object.freeze({ ...projection, viewport });
}

function defaultBitmapDecoder(source: ImageBitmapSource): Promise<ImageBitmap> {
  const createBitmap = globalThis.createImageBitmap;
  if (typeof createBitmap !== "function") {
    return Promise.reject(
      new Error("createImageBitmap is not available in this environment"),
    );
  }
  return createBitmap(source);
}

function assetCacheKey(descriptor: SceneAssetDescriptor): string {
  return [
    descriptor.assetId,
    descriptor.blobKey,
    descriptor.contentHash,
    descriptor.mimeType,
    String(descriptor.width),
    String(descriptor.height),
  ].join("\0");
}

function descriptorsMatch(
  asset: {
    readonly id: string;
    readonly blobKey: string;
    readonly contentHash: string;
    readonly mimeType: string;
    readonly width: number;
    readonly height: number;
  },
  descriptor: SceneAssetDescriptor,
): boolean {
  return (
    asset.id === descriptor.assetId &&
    asset.blobKey === descriptor.blobKey &&
    asset.contentHash === descriptor.contentHash &&
    asset.mimeType === descriptor.mimeType &&
    asset.width === descriptor.width &&
    asset.height === descriptor.height
  );
}

function normalizeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  return fallback;
}

function isAbortError(error: unknown): boolean {
  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "AbortError"
  ) {
    return true;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  return false;
}

interface BitmapCacheEntry {
  readonly token: number;
  readonly promise: Promise<ImageBitmap>;
  bitmap: ImageBitmap | null;
}

interface BitmapCache {
  resolve(asset: SceneAssetDescriptor): Promise<ImageBitmap>;
  closeAll(): void;
}

function createBitmapCache(options: {
  store: ProjectStore;
  assets: AssetRepository;
  decode: ComposeBitmapDecoder;
  closedBitmaps: WeakSet<ImageBitmap>;
  onError: (message: string) => void;
}): BitmapCache {
  const { store, assets, decode, closedBitmaps, onError } = options;
  const entries = new Map<string, BitmapCacheEntry>();
  const order: string[] = [];
  let disposed = false;
  let nextToken = 1;
  const abortController = new AbortController();

  const closeBitmap = (bitmap: ImageBitmap): void => {
    if (closedBitmaps.has(bitmap)) {
      return;
    }
    closedBitmaps.add(bitmap);
    bitmap.close();
  };

  const ownsRequest = (key: string, token: number): boolean => {
    if (disposed) {
      return false;
    }
    const entry = entries.get(key);
    return entry !== undefined && entry.token === token;
  };

  const removeEntry = (key: string, token: number): void => {
    const entry = entries.get(key);
    if (!entry || entry.token !== token) {
      return;
    }
    entries.delete(key);
    const index = order.indexOf(key);
    if (index >= 0) {
      order.splice(index, 1);
    }
  };

  const touch = (key: string): void => {
    const index = order.indexOf(key);
    if (index >= 0) {
      order.splice(index, 1);
    }
    order.push(key);
  };

  const evictIfNeeded = (): void => {
    while (order.length > MAX_BITMAP_CACHE) {
      const oldest = order.shift();
      if (oldest === undefined) {
        break;
      }
      const entry = entries.get(oldest);
      if (!entry) {
        continue;
      }
      entries.delete(oldest);
      if (entry.bitmap) {
        closeBitmap(entry.bitmap);
      }
      // Pending work closes itself when token ownership is lost.
    }
  };

  return {
    resolve(descriptor: SceneAssetDescriptor): Promise<ImageBitmap> {
      if (disposed) {
        return Promise.reject(
          new Error("Compose asset cache disposed"),
        );
      }

      const key = assetCacheKey(descriptor);
      const existing = entries.get(key);
      if (existing) {
        touch(key);
        return existing.promise;
      }

      const token = nextToken;
      nextToken += 1;

      const promise = (async (): Promise<ImageBitmap> => {
        try {
          const snapshot = store.getSnapshot();
          const projectAsset = snapshot.project.assets[descriptor.assetId];
          if (!projectAsset) {
            throw new Error(`Compose asset missing: ${descriptor.assetId}`);
          }
          if (!descriptorsMatch(projectAsset, descriptor)) {
            throw new Error(
              `Compose asset descriptor mismatch for ${descriptor.assetId}`,
            );
          }

          const blob = await assets.getBlob(descriptor.assetId, {
            signal: abortController.signal,
          });
          if (!ownsRequest(key, token)) {
            throw new Error("Compose asset resolve lost ownership");
          }

          const bitmap = await decode(blob);
          if (!ownsRequest(key, token)) {
            closeBitmap(bitmap);
            throw new Error("Compose asset resolve lost ownership");
          }

          if (bitmap.width === 0 || bitmap.height === 0) {
            closeBitmap(bitmap);
            throw new Error(
              `Compose asset bitmap has zero dimensions: ${descriptor.assetId}`,
            );
          }

          const live = entries.get(key);
          if (!live || live.token !== token) {
            closeBitmap(bitmap);
            throw new Error("Compose asset resolve lost ownership");
          }
          live.bitmap = bitmap;
          return bitmap;
        } catch (error: unknown) {
          const stillOwns = ownsRequest(key, token);
          removeEntry(key, token);

          if (disposed || isAbortError(error)) {
            throw error;
          }
          if (
            error instanceof Error &&
            error.message === "Compose asset resolve lost ownership"
          ) {
            throw error;
          }

          if (stillOwns) {
            const message = normalizeErrorMessage(
              error,
              `Compose asset resolve failed: ${descriptor.assetId}`,
            );
            onError(message);
          }
          throw error;
        }
      })();

      const entry: BitmapCacheEntry = {
        token,
        promise,
        bitmap: null,
      };
      entries.set(key, entry);
      touch(key);
      evictIfNeeded();
      return promise;
    },
    closeAll(): void {
      disposed = true;
      abortController.abort();
      for (const entry of entries.values()) {
        if (entry.bitmap) {
          closeBitmap(entry.bitmap);
        }
      }
      entries.clear();
      order.length = 0;
    },
  };
}

export function ComposeCanvasWorkspace(
  props: ComposeCanvasWorkspaceProps,
): ReactElement {
  const {
    store,
    assets,
    viewportFactory,
    bitmapDecoder,
    projectionFactory,
    ariaLabel = "Compose canvas",
    className = "",
    hideDiagnostics = false,
    transparentBackground = false,
    style,
    overlay,
  } = props;
  const workspace = useWorkspaceStore();
  const projectRevision = useProjectStoreSelector(
    store,
    (state) => state.revision,
  );
  const composeViewport = useWorkspaceStoreSelector(
    workspace,
    (state) => state.viewports.compose,
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<Pick<
    BrowserSceneViewport,
    "invalidate" | "dispose"
  > | null>(null);
  const cacheRef = useRef<BitmapCache | null>(null);
  const closedBitmapsRef = useRef<WeakSet<ImageBitmap>>(new WeakSet());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const decode = bitmapDecoder ?? defaultBitmapDecoder;
  const factory = viewportFactory ?? createBrowserSceneViewport;

  const disposeLive = useCallback((): void => {
    const viewport = viewportRef.current;
    viewportRef.current = null;
    if (viewport) {
      viewport.dispose();
    }
    const cache = cacheRef.current;
    cacheRef.current = null;
    if (cache) {
      cache.closeAll();
    }
  }, []);

  useEffect(() => {
    let active = true;
    const canvas = canvasRef.current;
    const resizeTarget = containerRef.current;
    if (!canvas || !resizeTarget) {
      return;
    }

    const projectId = store.getSnapshot().project.id;
    if (assets.projectId !== projectId) {
      setErrorMessage(
        `Asset repository project mismatch: expected ${projectId}, got ${assets.projectId}`,
      );
      return;
    }

    setErrorMessage(null);
    const closedBitmaps = closedBitmapsRef.current;
    const cache = createBitmapCache({
      store,
      assets,
      decode,
      closedBitmaps,
      onError: (message) => {
        if (!active) {
          return;
        }
        setErrorMessage(message);
      },
    });
    cacheRef.current = cache;

    try {
      const viewport = factory({
        canvas,
        resizeTarget,
        getProjection: () => {
          const projectSnapshot = store.getSnapshot();
          const workspaceSnapshot = workspace.getSnapshot();
          const projection = projectionFactory
            ? projectionFactory(projectSnapshot, workspaceSnapshot)
            : createSceneProjection(projectSnapshot, workspaceSnapshot);
          return fitProjectionToHost(
            projection,
            resizeTarget.clientWidth,
            resizeTarget.clientHeight,
          );
        },
        resolver: {
          resolve(asset: SceneAssetDescriptor) {
            return cache.resolve(asset);
          },
        },
        onDiagnostic: (diagnostic) => {
          if (!active) {
            return;
          }
          setErrorMessage(diagnostic.message);
        },
      });
      viewportRef.current = viewport;
    } catch (error: unknown) {
      disposeLive();
      if (!active) {
        return;
      }
      setErrorMessage(
        normalizeErrorMessage(error, "Failed to create compose viewport"),
      );
    }

    return () => {
      active = false;
      disposeLive();
    };
  }, [store, assets, workspace, decode, factory, projectionFactory, retryToken, disposeLive]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    viewport.invalidate({
      reason: "scene",
      projectRevision,
    });
  }, [projectRevision, retryToken]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    viewport.invalidate({ reason: "viewport" });
  }, [composeViewport]);

  const handleRetry = useCallback((): void => {
    setErrorMessage(null);
    disposeLive();
    setRetryToken((value) => value + 1);
  }, [disposeLive]);

  return (
    <div
      className={`flex h-full min-h-0 w-full flex-col ${transparentBackground ? "bg-transparent" : "bg-workspace"} ${className}`}
      style={style}
    >
      {errorMessage && !hideDiagnostics ? (
        <div
          role="alert"
          className="m-2 flex items-start gap-2 rounded border border-border/20 bg-surface px-3 py-2 text-sm text-textMain"
        >
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0 text-textMuted"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-textMain">{errorMessage}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-2 inline-flex items-center gap-1.5 rounded border border-border/20 bg-workspace px-2 py-1 text-xs text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Retry render
            </button>
          </div>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="relative min-h-[240px] flex-1 overflow-hidden border border-border/20 bg-workspace"
      >
        <canvas
          ref={canvasRef}
          aria-label={ariaLabel ?? undefined}
          aria-hidden={ariaLabel === null ? true : undefined}
          className="block h-full min-h-[240px] w-full"
        />
        {overlay}
      </div>
    </div>
  );
}

export default ComposeCanvasWorkspace;
