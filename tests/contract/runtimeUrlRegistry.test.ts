import { describe, expect, it, vi } from "vitest";
import {
  AssetRepositoryError,
  RuntimeUrlRegistry,
} from "../../core/assets";
import type {
  AssetBlobLoader,
  RuntimeObjectUrlHost,
} from "../../core/assets";

function createHost() {
  let nextId = 0;
  return {
    createObjectURL: vi.fn(() => `blob:test-${++nextId}`),
    revokeObjectURL: vi.fn(),
  } satisfies RuntimeObjectUrlHost;
}

const blob = new Blob(["asset"], { type: "image/png" });

describe("RuntimeUrlRegistry (F2-04)", () => {
  it("shares one URL across owners and revokes only after the last release", async () => {
    const host = createHost();
    const load = vi.fn(async () => blob);
    const registry = new RuntimeUrlRegistry(load, { host });
    const firstOwner = {};
    const secondOwner = {};

    const [first, second] = await Promise.all([
      registry.acquire("asset-a", firstOwner),
      registry.acquire("asset-a", secondOwner),
    ]);
    expect(first).toBe(second);
    expect(load).toHaveBeenCalledTimes(1);
    expect(host.createObjectURL).toHaveBeenCalledTimes(1);
    expect(registry.leaseCount("asset-a")).toBe(2);

    registry.release("asset-a", firstOwner);
    expect(host.revokeObjectURL).not.toHaveBeenCalled();
    registry.release("asset-a", secondOwner);
    expect(host.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(first);
    expect(registry.hasLeases("asset-a")).toBe(false);
  });

  it("treats repeated acquire by the same owner as one idempotent lease", async () => {
    const host = createHost();
    const registry = new RuntimeUrlRegistry(async () => blob, { host });
    const owner = {};
    const first = await registry.acquire("asset-a", owner);
    const second = await registry.acquire("asset-a", owner);
    expect(second).toBe(first);
    expect(registry.leaseCount("asset-a")).toBe(1);
    registry.release("asset-a", owner);
    expect(host.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("releases every asset owned by one component without touching other owners", async () => {
    const host = createHost();
    const registry = new RuntimeUrlRegistry(async () => blob, { host });
    const component = {};
    const peer = {};
    await Promise.all([
      registry.acquire("asset-a", component),
      registry.acquire("asset-b", component),
      registry.acquire("asset-a", peer),
    ]);
    registry.releaseOwner(component);
    expect(registry.leaseCount("asset-a")).toBe(1);
    expect(registry.leaseCount("asset-b")).toBe(0);
    expect(host.revokeObjectURL).toHaveBeenCalledTimes(1);
    registry.releaseOwner(peer);
    expect(host.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("aborts only the canceled owner while another owner keeps the shared load", async () => {
    let resolveBlob!: (value: Blob) => void;
    let sharedSignal: AbortSignal | undefined;
    const load: AssetBlobLoader = (_assetId, options) => {
      sharedSignal = options?.signal;
      return new Promise((resolve) => { resolveBlob = resolve; });
    };
    const host = createHost();
    const registry = new RuntimeUrlRegistry(load, { host });
    const canceledOwner = {};
    const survivingOwner = {};
    const controller = new AbortController();
    const canceled = registry.acquire("asset-a", canceledOwner, { signal: controller.signal });
    const surviving = registry.acquire("asset-a", survivingOwner);
    controller.abort("component unmounted");
    await expect(canceled).rejects.toMatchObject({
      code: "ASSET_TRANSACTION_ABORTED",
      operation: "create-url",
    });
    expect(sharedSignal?.aborted).toBe(false);
    resolveBlob(blob);
    await expect(surviving).resolves.toBe("blob:test-1");
    expect(registry.leaseCount("asset-a")).toBe(1);
  });

  it("settles release promptly and revokes a late URL from a non-cooperative loader", async () => {
    let resolveBlob!: (value: Blob) => void;
    let loadSignal: AbortSignal | undefined;
    const load: AssetBlobLoader = (_assetId, options) => {
      loadSignal = options?.signal;
      return new Promise((resolve) => { resolveBlob = resolve; });
    };
    const host = createHost();
    const registry = new RuntimeUrlRegistry(load, { host });
    const owner = {};
    const pending = registry.acquire("asset-a", owner);
    for (let turn = 0; turn < 5 && !loadSignal; turn += 1) await Promise.resolve();
    registry.release("asset-a", owner);
    await expect(pending).rejects.toMatchObject({ code: "ASSET_LEASE_CONFLICT" });
    expect(loadSignal?.aborted).toBe(true);
    resolveBlob(blob);
    for (let turn = 0; turn < 5 && host.revokeObjectURL.mock.calls.length === 0; turn += 1) {
      await Promise.resolve();
    }
    expect(host.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:test-1");
    expect(registry.hasLeases("asset-a")).toBe(false);
  });

  it("normalizes loader and host failures and clears every provisional lease", async () => {
    const owner = {};
    const loaderFailure = new RuntimeUrlRegistry(
      async () => { throw new Error("loader exploded"); },
      { host: createHost() },
    );
    await expect(loaderFailure.acquire("asset-a", owner)).rejects.toMatchObject({
      code: "ASSET_STORAGE_UNAVAILABLE",
      operation: "create-url",
      assetId: "asset-a",
    });
    expect(loaderFailure.hasLeases("asset-a")).toBe(false);

    const host = createHost();
    host.createObjectURL.mockImplementation(() => { throw new Error("host exploded"); });
    const hostFailure = new RuntimeUrlRegistry(async () => blob, { host });
    await expect(hostFailure.acquire("asset-a", owner)).rejects.toMatchObject({
      code: "ASSET_STORAGE_UNAVAILABLE",
      operation: "create-url",
    });
    expect(hostFailure.hasLeases("asset-a")).toBe(false);
  });

  it("fails before loading when the Object URL host is unavailable", async () => {
    const load = vi.fn(() => new Promise<Blob>(() => undefined));
    const registry = new RuntimeUrlRegistry(load, { host: null });
    await expect(registry.acquire("asset-a", {})).rejects.toMatchObject({
      code: "ASSET_STORAGE_UNAVAILABLE",
      operation: "create-url",
      assetId: "asset-a",
    });
    expect(load).not.toHaveBeenCalled();
    expect(registry.hasLeases("asset-a")).toBe(false);
  });

  it("rejects missing blobs and duplicate host URLs without revoking the live owner", async () => {
    const missing = new RuntimeUrlRegistry(
      async () => undefined as unknown as Blob,
      { host: createHost() },
    );
    await expect(missing.acquire("asset-missing", {})).rejects.toMatchObject({
      code: "ASSET_BLOB_MISSING",
      operation: "create-url",
    });

    const host = {
      createObjectURL: vi.fn(() => "blob:duplicate"),
      revokeObjectURL: vi.fn(),
    } satisfies RuntimeObjectUrlHost;
    const registry = new RuntimeUrlRegistry(async () => blob, { host });
    const firstOwner = {};
    const first = await registry.acquire("asset-a", firstOwner);
    await expect(registry.acquire("asset-b", {})).rejects.toMatchObject({
      code: "ASSET_LEASE_CONFLICT",
      operation: "create-url",
      assetId: "asset-b",
    });
    expect(first).toBe("blob:duplicate");
    expect(registry.hasLeases("asset-a")).toBe(true);
    expect(host.revokeObjectURL).not.toHaveBeenCalled();
    registry.release("asset-a", firstOwner);
    expect(host.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:duplicate");
  });

  it("never lets a stale same-asset generation revoke the live generation URL", async () => {
    const resolvers: Array<(value: Blob) => void> = [];
    const load: AssetBlobLoader = () => new Promise((resolve) => {
      resolvers.push(resolve);
    });
    const host = {
      createObjectURL: vi.fn(() => "blob:duplicate-same-asset"),
      revokeObjectURL: vi.fn(),
    } satisfies RuntimeObjectUrlHost;
    const registry = new RuntimeUrlRegistry(load, { host });
    const staleOwner = {};
    const liveOwner = {};
    const stale = registry.acquire("asset-a", staleOwner);
    for (let turn = 0; turn < 5 && resolvers.length < 1; turn += 1) await Promise.resolve();
    registry.release("asset-a", staleOwner);
    await expect(stale).rejects.toMatchObject({ code: "ASSET_LEASE_CONFLICT" });

    const live = registry.acquire("asset-a", liveOwner);
    for (let turn = 0; turn < 5 && resolvers.length < 2; turn += 1) await Promise.resolve();
    resolvers[1](blob);
    await expect(live).resolves.toBe("blob:duplicate-same-asset");
    resolvers[0](blob);
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();

    expect(registry.leaseCount("asset-a")).toBe(1);
    expect(host.revokeObjectURL).not.toHaveBeenCalled();
    registry.release("asset-a", liveOwner);
    expect(host.revokeObjectURL)
      .toHaveBeenCalledExactlyOnceWith("blob:duplicate-same-asset");
  });

  it("contains revoke and diagnostic callback failures while completing cleanup", async () => {
    const diagnostics: string[] = [];
    const host = createHost();
    host.revokeObjectURL.mockImplementation(() => { throw new Error("cannot revoke"); });
    const registry = new RuntimeUrlRegistry(async () => blob, {
      host,
      onError(diagnostic) {
        diagnostics.push(`${diagnostic.code}:${diagnostic.operation}`);
        throw new Error("observer failed");
      },
    });
    const owner = {};
    await registry.acquire("asset-a", owner);
    expect(() => registry.release("asset-a", owner)).not.toThrow();
    expect(diagnostics).toEqual(["ASSET_STORAGE_UNAVAILABLE:release-url"]);
    expect(registry.hasLeases("asset-a")).toBe(false);
  });

  it("dispose revokes ready URLs, aborts pending loads and rejects future acquire", async () => {
    let pendingSignal: AbortSignal | undefined;
    const load: AssetBlobLoader = (assetId, options) => {
      if (assetId === "asset-ready") return Promise.resolve(blob);
      pendingSignal = options?.signal;
      return new Promise(() => undefined);
    };
    const host = createHost();
    const registry = new RuntimeUrlRegistry(load, { host });
    await registry.acquire("asset-ready", {});
    const pending = registry.acquire("asset-pending", {});
    for (let turn = 0; turn < 5 && !pendingSignal; turn += 1) await Promise.resolve();
    registry.dispose();
    await expect(pending).rejects.toMatchObject({ code: "ASSET_LEASE_CONFLICT" });
    expect(pendingSignal?.aborted).toBe(true);
    expect(host.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:test-1");
    expect(() => registry.dispose()).not.toThrow();
    await expect(registry.acquire("asset-ready", {})).rejects.toMatchObject({
      code: "ASSET_LEASE_CONFLICT",
    });
  });

  it("validates inputs before loading and keeps unknown releases idempotent", async () => {
    const load = vi.fn(async () => blob);
    const registry = new RuntimeUrlRegistry(load, { host: createHost() });
    await expect(registry.acquire("", {})).rejects.toBeInstanceOf(AssetRepositoryError);
    await expect(registry.acquire("asset-a", null as unknown as object))
      .rejects.toMatchObject({ code: "ASSET_INVALID_INPUT" });
    expect(load).not.toHaveBeenCalled();
    expect(() => registry.release("unknown", {})).not.toThrow();
    expect(() => registry.releaseOwner(null as unknown as object)).not.toThrow();
  });
});
