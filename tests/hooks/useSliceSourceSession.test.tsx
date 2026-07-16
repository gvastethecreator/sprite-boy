import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useSliceSourceSession } from "../../features/slice/source/useSourceSession";
import type { SourceFileInput } from "../../features/slice/source/sourceFilePolicy";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function sourceFile(): SourceFileInput {
  return {
    name: "sheet.png",
    type: "image/png",
    size: PNG.byteLength,
    arrayBuffer: async () => PNG.slice().buffer,
  };
}

describe("useSliceSourceSession", () => {
  it("publishes the owned session snapshot and releases its decoded resource on unmount", async () => {
    const close = vi.fn();
    const decoder = {
      decode: vi.fn(async () => ({
        image: { kind: "test-image" },
        width: 8,
        height: 4,
        close,
      })),
    };
    const { result, unmount } = renderHook(() => useSliceSourceSession({ decoder }));

    await act(async () => {
      await result.current.select(sourceFile());
    });
    expect(result.current.snapshot).toMatchObject({
      status: "ready",
      metadata: { name: "sheet.png", width: 8, height: 4 },
    });
    expect(result.current.getBlob()).toBeInstanceOf(Blob);
    expect(close).not.toHaveBeenCalled();

    unmount();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
