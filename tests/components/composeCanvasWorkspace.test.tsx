import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssetRepository } from "../../core/assets";
import type { BrowserSceneViewportOptions } from "../../core/render";
import { createProjectStore } from "../../core/stores";
import { StudioLocalStoresProvider } from "../../contexts/StudioStoreContext";
import {
  ComposeCanvasWorkspace,
  type ComposeBitmapDecoder,
  type ComposeViewportFactory,
} from "../../features/compose/canvas/ComposeCanvasWorkspace";
import { studioProjectV1Fixture } from "../contract/fixtures/studioProjectV1";

function repository(
  getBlob: AssetRepository["getBlob"],
): AssetRepository {
  return {
    projectId: studioProjectV1Fixture.id,
    put: vi.fn(),
    getMetadata: vi.fn(),
    getBlob,
    list: vi.fn(async () => []),
    verify: vi.fn(),
    scanIntegrity: vi.fn(),
    remove: vi.fn(),
    exportMany: vi.fn(),
    createRuntimeUrl: vi.fn(),
    releaseRuntimeUrl: vi.fn(),
    releaseOwner: vi.fn(),
    dispose: vi.fn(),
  } as unknown as AssetRepository;
}

function deferred<T>() {
  const holders: {
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  } = {
    resolve: (_value: T | PromiseLike<T>): void => {
      throw new Error("Deferred resolver unavailable");
    },
    reject: (_reason?: unknown): void => {
      throw new Error("Deferred resolver unavailable");
    },
  };
  const promise = new Promise<T>((res, rej) => {
    holders.resolve = res;
    holders.reject = rej;
  });
  return {
    promise,
    resolve: (value: T | PromiseLike<T>) => holders.resolve(value),
    reject: (reason?: unknown) => holders.reject(reason),
  };
}

function bitmap(close = vi.fn()) {
  return {
    width: 256,
    height: 128,
    close,
  } as unknown as ImageBitmap;
}

function requireEntry<T>(items: readonly T[], index: number): T {
  const entry = items[index];
  if (entry === undefined) {
    throw new Error(`Missing entry at index ${index}`);
  }
  return entry;
}

function renderComposeCanvas(options: {
  assets: AssetRepository;
  bitmapDecoder?: ComposeBitmapDecoder;
  viewportFactory?: ComposeViewportFactory;
}) {
  const project = structuredClone(studioProjectV1Fixture);
  const store = createProjectStore(project, {
    context: {
      nextId: () => "unused",
      now: () => "2026-07-25T00:00:00.000Z",
    },
  });

  const captures: BrowserSceneViewportOptions[] = [];
  const viewports: Array<{ invalidate: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> =
    [];

  const viewportFactory: ComposeViewportFactory =
    options.viewportFactory ??
    ((viewportOptions) => {
      captures.push(viewportOptions);
      const viewport = {
        invalidate: vi.fn(),
        dispose: vi.fn(),
      };
      viewports.push(viewport);
      return viewport;
    });

  const result = render(
    <StudioLocalStoresProvider>
      <ComposeCanvasWorkspace
        store={store}
        assets={options.assets}
        viewportFactory={viewportFactory}
        bitmapDecoder={options.bitmapDecoder}
      />
    </StudioLocalStoresProvider>,
  );

  return { store, captures, viewports, ...result };
}

describe("ComposeCanvasWorkspace", () => {
  it("projects a Region crop and invalidates the current revision", () => {
    const assets = repository(vi.fn(async () => new Blob()));
    const { captures, viewports } = renderComposeCanvas({ assets });

    const first = requireEntry(captures, 0);
    const projection = first.getProjection();
    const root = projection.root;
    expect(root?.kind).toBe("composition");
    if (root?.kind !== "composition") {
      throw new Error("Expected composition root");
    }
    expect(root.compositionId).toBe("composition-project");

    const layer = requireEntry(root.layers, 0);
    expect(layer.source.sourceRect).toEqual({
      x: 0,
      y: 0,
      width: 128,
      height: 128,
    });

    const viewport = requireEntry(viewports, 0);
    expect(viewport.invalidate).toHaveBeenCalledWith({
      reason: "scene",
      projectRevision: 0,
    });

    const canvas = screen.getByLabelText("Compose canvas");
    expect(canvas.tagName).toBe("CANVAS");
  });

  it("fits and centers an oversized composition without changing the store viewport", () => {
    const assets = repository(vi.fn(async () => new Blob()));
    const { captures } = renderComposeCanvas({ assets });
    const canvas = screen.getByLabelText("Compose canvas");
    const resizeTarget = canvas.parentElement;
    if (!resizeTarget) throw new Error("Missing Compose resize target");
    Object.defineProperties(resizeTarget, {
      clientWidth: { configurable: true, value: 64 },
      clientHeight: { configurable: true, value: 96 },
    });

    const projection = requireEntry(captures, 0).getProjection();

    expect(projection.viewport.scale).toBeCloseTo(0.45);
    expect(projection.viewport.offset.x).toBeCloseTo(3.2);
    expect(projection.viewport.offset.y).toBeCloseTo(19.2);
  });

  it("reuses a decoded bitmap and closes it with the viewport", async () => {
    const pngBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const getBlob = vi.fn(async () => pngBlob);
    const fakeBitmap = bitmap();
    const bitmapDecoder = vi.fn(async () => fakeBitmap);

    const assets = repository(getBlob);
    const { captures, viewports, unmount } = renderComposeCanvas({
      assets,
      bitmapDecoder,
    });

    const first = requireEntry(captures, 0);
    const projection = first.getProjection();
    const root = projection.root;
    if (root?.kind !== "composition") {
      throw new Error("Expected composition root");
    }
    const layer = requireEntry(root.layers, 0);
    const asset = layer.source.asset;

    const firstResult = await first.resolver.resolve(asset);
    const secondResult = await first.resolver.resolve(asset);

    expect(firstResult).toBe(fakeBitmap);
    expect(secondResult).toBe(fakeBitmap);
    expect(getBlob).toHaveBeenCalledTimes(1);
    expect(bitmapDecoder).toHaveBeenCalledTimes(1);

    unmount();

    const viewport = requireEntry(viewports, 0);
    expect(viewport.dispose).toHaveBeenCalledTimes(1);
    expect(fakeBitmap.close).toHaveBeenCalledTimes(1);
  });

  it("closes a decode that resolves after unmount", async () => {
    const pending = deferred<ImageBitmap>();
    const bitmapDecoder = vi.fn(async () => pending.promise);
    const getBlob = vi.fn(async () => new Blob([new Uint8Array([1])], { type: "image/png" }));
    const close = vi.fn();
    const fakeBitmap = bitmap(close);

    const assets = repository(getBlob);
    const { captures, unmount } = renderComposeCanvas({
      assets,
      bitmapDecoder,
    });

    const first = requireEntry(captures, 0);
    const projection = first.getProjection();
    const root = projection.root;
    if (root?.kind !== "composition") {
      throw new Error("Expected composition root");
    }
    const layer = requireEntry(root.layers, 0);
    const asset = layer.source.asset;

    const resolvePromise = first.resolver.resolve(asset);
    await waitFor(() => {
      expect(bitmapDecoder).toHaveBeenCalled();
    });

    const rejection = expect(resolvePromise).rejects.toThrow("lost ownership");
    unmount();
    pending.resolve(fakeBitmap);
    await rejection;

    expect(close).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports a resolver failure and retries with a fresh cache", async () => {
    const pngBlob = new Blob([new Uint8Array([9])], { type: "image/png" });
    const getBlob = vi
      .fn()
      .mockRejectedValueOnce(new Error("asset unavailable"))
      .mockResolvedValueOnce(pngBlob);
    const fakeBitmap = bitmap();
    const bitmapDecoder = vi.fn(async () => fakeBitmap);

    const assets = repository(getBlob);
    const { captures, viewports } = renderComposeCanvas({
      assets,
      bitmapDecoder,
    });

    const first = requireEntry(captures, 0);
    const projection = first.getProjection();
    const root = projection.root;
    if (root?.kind !== "composition") {
      throw new Error("Expected composition root");
    }
    const layer = requireEntry(root.layers, 0);
    const asset = layer.source.asset;

    await expect(first.resolver.resolve(asset)).rejects.toThrow("asset unavailable");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("asset unavailable");

    fireEvent.click(screen.getByRole("button", { name: "Retry render" }));

    await waitFor(() => {
      expect(captures.length).toBe(2);
    });

    const oldViewport = requireEntry(viewports, 0);
    expect(oldViewport.dispose).toHaveBeenCalled();

    const second = requireEntry(captures, 1);
    const secondProjection = second.getProjection();
    const secondRoot = secondProjection.root;
    if (secondRoot?.kind !== "composition") {
      throw new Error("Expected composition root");
    }
    const secondLayer = requireEntry(secondRoot.layers, 0);
    const secondAsset = secondLayer.source.asset;

    const result = await second.resolver.resolve(secondAsset);
    expect(result).toBe(fakeBitmap);
    expect(getBlob).toHaveBeenCalledTimes(2);
  });
});
