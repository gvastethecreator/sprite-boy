import { describe, expect, it, vi } from "vitest";
import {
  measureGzipAssets,
  validateGzipAssetPaths,
} from "../../scripts/studio-gzip-size.mjs";

describe("deterministic Node gzip measurement", () => {
  it("measures sorted physical initial assets at level 9", () => {
    const gzip = vi.fn()
      .mockReturnValueOnce(Buffer.alloc(3))
      .mockReturnValueOnce(Buffer.alloc(4));
    const result = measureGzipAssets([
      "dist/assets/vendor-B.js",
      "dist/assets/index-A.js",
    ], {
      lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false, size: 5 }),
      realpathSync: (path: string) => path,
      readFileSync: () => Buffer.alloc(5),
      gzipSync: gzip,
    });
    expect(result).toEqual({
      schemaVersion: 1,
      initialChunkCount: 2,
      initialJsBytes: 10,
      initialJsGzipBytes: 7,
    });
    expect(gzip).toHaveBeenNthCalledWith(1, Buffer.alloc(5), { level: 9 });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects traversal, duplicates and symlinked assets", () => {
    expect(() => validateGzipAssetPaths(["../private.js"])).toThrow(/invalid/);
    expect(() => validateGzipAssetPaths([
      "dist/assets/index-A.js",
      "dist/assets/index-A.js",
    ])).toThrow(/invalid/);
    expect(() => measureGzipAssets(["dist/assets/index-A.js"], {
      lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => true, size: 5 }),
      realpathSync: (path: string) => path,
    })).toThrow(/physical/);
    expect(() => measureGzipAssets(["dist/assets/index-A.js"], {
      lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false, size: 5 }),
      realpathSync: () => "D:/external/index-A.js",
    })).toThrow(/linked parent/);
  });
});
