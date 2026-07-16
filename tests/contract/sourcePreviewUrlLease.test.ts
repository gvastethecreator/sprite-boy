import { describe, expect, it, vi } from "vitest";

import { createSourcePreviewUrlLease } from "../../features/slice/source/sourcePreviewUrlLease";

describe("source preview URL lease (G0-03)", () => {
  it("owns exactly one URL and revokes it once", () => {
    const host = {
      createObjectURL: vi.fn(() => "blob:source-1"),
      revokeObjectURL: vi.fn(),
    };
    const result = createSourcePreviewUrlLease(new Blob(["pixels"]), { host });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lease.url).toBe("blob:source-1");
    expect(result.lease.released).toBe(false);
    result.lease.release();
    result.lease.release();
    expect(result.lease.released).toBe(true);
    expect(host.createObjectURL).toHaveBeenCalledTimes(1);
    expect(host.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:source-1");
  });

  it("rejects missing or throwing hosts without leaking a lease", () => {
    expect(createSourcePreviewUrlLease(new Blob(), { host: null })).toMatchObject({
      ok: false,
      error: { code: "host-unavailable" },
    });
    const result = createSourcePreviewUrlLease(new Blob(), {
      host: {
        createObjectURL: () => { throw new Error("host failed"); },
        revokeObjectURL: vi.fn(),
      },
    });
    expect(result).toMatchObject({ ok: false, error: { code: "create-failed" } });
  });

  it("revokes invalid host output and contains hostile cleanup observers", () => {
    const releaseObserver = vi.fn(() => { throw new Error("observer failed"); });
    const invalidHost = {
      createObjectURL: vi.fn(() => "https://not-an-object-url.test/source"),
      revokeObjectURL: vi.fn(),
    };
    const invalid = createSourcePreviewUrlLease(new Blob(), { host: invalidHost });
    expect(invalid).toMatchObject({ ok: false, error: { code: "invalid-url" } });
    expect(invalidHost.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      "https://not-an-object-url.test/source",
    );

    const lease = createSourcePreviewUrlLease(new Blob(), {
      host: {
        createObjectURL: () => "blob:hostile-release",
        revokeObjectURL: () => { throw new Error("revoked host"); },
      },
      onReleaseError: releaseObserver,
    });
    expect(lease.ok).toBe(true);
    if (!lease.ok) return;
    expect(() => lease.lease.release()).not.toThrow();
    expect(lease.lease.released).toBe(true);
    expect(releaseObserver).toHaveBeenCalledOnce();
  });

  it("contains hostile host accessors", () => {
    const host = {
      get createObjectURL(): (blob: Blob) => string {
        throw new Error("revoked host object");
      },
      revokeObjectURL: vi.fn(),
    };
    expect(() => createSourcePreviewUrlLease(new Blob(), { host })).not.toThrow();
    expect(createSourcePreviewUrlLease(new Blob(), { host })).toMatchObject({
      ok: false,
      error: { code: "host-unavailable" },
    });
  });
});
