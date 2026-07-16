import { describe, expect, it, vi } from "vitest";

import {
  SOURCE_ALLOWED_MIME_TYPES,
  SOURCE_MAX_FILE_SIZE_BYTES,
  SOURCE_MULTI_FILE_POLICY,
  prepareSourceFile,
  sanitizeSourceFileName,
  selectSourceFileInput,
  type SourceFileInput,
} from "../../features/slice/source/sourceFilePolicy";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x08, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
]);

function file(name: string, type: string, bytes: Uint8Array): SourceFileInput {
  const snapshot = bytes.slice();
  return {
    name,
    type,
    size: snapshot.byteLength,
    arrayBuffer: async () => snapshot.slice().buffer,
  };
}

describe("Slice source file policy (G0-01)", () => {
  it("requires both an allowed MIME and matching PNG/JPEG/WebP magic bytes", async () => {
    expect(SOURCE_ALLOWED_MIME_TYPES).toEqual(["image/jpeg", "image/png", "image/webp"]);
    for (const [name, type, bytes, format] of [
      ["sheet.png", "image/png", PNG, "png"],
      ["sheet.jpg", "image/jpeg", JPEG, "jpeg"],
      ["sheet.webp", "image/webp", WEBP, "webp"],
    ] as const) {
      const result = await prepareSourceFile(file(name, type, bytes));
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.source.metadata.format).toBe(format);
        expect(result.source.blob.type).toBe(type);
        expect(new Uint8Array(await result.source.blob.arrayBuffer())).toEqual(bytes);
      }
    }
  });

  it("rejects type spoofing, corrupt signatures, truncation and oversize before decode", async () => {
    await expect(prepareSourceFile(file("spoof.png", "image/png", JPEG))).resolves.toMatchObject({
      valid: false,
      error: { code: "magic-mismatch" },
    });
    await expect(prepareSourceFile(file("corrupt.jpg", "image/jpeg", new Uint8Array([1, 2, 3]))))
      .resolves.toMatchObject({ valid: false, error: { code: "magic-mismatch" } });
    await expect(prepareSourceFile(file("truncated.webp", "image/webp", WEBP.slice(0, 8))))
      .resolves.toMatchObject({ valid: false, error: { code: "magic-mismatch" } });

    const oversized = file("big.png", "image/png", PNG);
    await expect(prepareSourceFile({
      ...oversized,
      size: SOURCE_MAX_FILE_SIZE_BYTES + 1,
    })).resolves.toMatchObject({ valid: false, error: { code: "too-large" } });
    await expect(prepareSourceFile(file("real-bytes.png", "image/png", PNG), {
      maxBytes: PNG.byteLength - 1,
    })).resolves.toMatchObject({ valid: false, error: { code: "too-large" } });
  });

  it("normalizes a path-free safe filename and gives callers detached byte copies", async () => {
    const result = await prepareSourceFile(file("..\\secret\u0000\u202Ename.PNG", "image/png", PNG));
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.source.metadata.name).toBe("secret-name.png");
    const exposed = result.source.bytes as Uint8Array;
    exposed[0] = 0;
    expect((result.source.bytes as Uint8Array)[0]).toBe(0x89);
    expect(result.source.metadata.name).not.toContain("\\");
    expect(result.source.metadata.name).not.toContain("/");
    expect(sanitizeSourceFileName("CON", "png")).toBe("_CON.png");
  });

  it("states the multi-file policy explicitly and defaults to donor-compatible first-file selection", () => {
    expect(SOURCE_MULTI_FILE_POLICY).toBe("first");
    const first = file("first.png", "image/png", PNG);
    const second = file("second.png", "image/png", PNG);
    expect(selectSourceFileInput([first, second])).toEqual({ input: first, error: null });
    expect(selectSourceFileInput([first, second], "reject")).toMatchObject({
      input: null,
      error: { code: "multiple-files" },
    });
    const hostileArray = new Proxy([first, second], {
      get(target, property, receiver) {
        if (property === "slice") throw new Error("hostile list");
        return Reflect.get(target, property, receiver);
      },
    });
    expect(selectSourceFileInput(hostileArray)).toMatchObject({ input: first, error: null });
    expect(selectSourceFileInput({
      length: 2,
      item() { throw new Error("hostile item"); },
    } as never)).toMatchObject({ input: null, error: { code: "invalid-input" } });
    const hugeSparse = new Proxy([] as SourceFileInput[], {
      get(target, property, receiver) {
        if (property === "length") return Number.MAX_SAFE_INTEGER;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(selectSourceFileInput(hugeSparse, "reject")).toMatchObject({
      input: null,
      error: { code: "multiple-files" },
    });
    expect(selectSourceFileInput(hugeSparse, "first")).toMatchObject({
      input: null,
      error: { code: "invalid-input" },
    });
    let itemCalls = 0;
    const hugeList = {
      length: Number.MAX_SAFE_INTEGER,
      item() {
        itemCalls += 1;
        throw new Error("should only inspect first item");
      },
    };
    expect(selectSourceFileInput(hugeList as never, "reject")).toMatchObject({
      input: null,
      error: { code: "multiple-files" },
    });
    expect(itemCalls).toBe(0);
    expect(selectSourceFileInput(hugeList as never, "first")).toMatchObject({
      input: null,
      error: { code: "invalid-input" },
    });
    expect(itemCalls).toBe(1);
  });

  it("classifies revoked and accessor-backed picker payloads without repeated traps", () => {
    const first = file("first.png", "image/png", PNG);
    const revoked = Proxy.revocable([first], {});
    revoked.revoke();
    expect(selectSourceFileInput(revoked.proxy)).toMatchObject({
      input: null,
      error: { code: "invalid-input" },
    });

    const reads = { length: 0, first: 0 };
    const array = new Proxy([first], {
      get(target, property, receiver) {
        if (property === "length") reads.length += 1;
        if (property === "0") reads.first += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(selectSourceFileInput(array)).toEqual({ input: first, error: null });
    expect(reads).toEqual({ length: 1, first: 1 });

    let itemReads = 0;
    let lengthReads = 0;
    let itemCalls = 0;
    const list = {
      get item() {
        itemReads += 1;
        return () => {
          itemCalls += 1;
          return first;
        };
      },
      get length() {
        lengthReads += 1;
        return 1;
      },
    };
    expect(selectSourceFileInput(list as never)).toEqual({ input: first, error: null });
    expect({ itemReads, lengthReads, itemCalls }).toEqual({ itemReads: 1, lengthReads: 1, itemCalls: 1 });
  });

  it("canonicalizes boundary errors without invoking accessors or preserving identity/extras", async () => {
    const external = {
      code: "aborted",
      message: "C:\\private\\stack",
      retryable: false,
      stack: "private stack",
    };
    const canonical = await prepareSourceFile({
      ...file("sheet.png", "image/png", PNG),
      arrayBuffer: () => { throw external; },
    });
    expect(canonical.valid).toBe(false);
    if (canonical.valid) return;
    expect(canonical.error).not.toBe(external);
    expect(canonical.error).toEqual({
      code: "aborted",
      message: "Image source operation was aborted.",
      retryable: false,
    });
    expect(Object.keys(canonical.error)).toEqual(["code", "message", "retryable"]);
    expect(Object.isFrozen(canonical.error)).toBe(true);

    let getterCalls = 0;
    const accessorError = Object.defineProperties({}, {
      code: { enumerable: true, get() { getterCalls += 1; return "aborted"; } },
      message: { enumerable: true, get() { getterCalls += 1; return "private"; } },
      retryable: { enumerable: true, get() { getterCalls += 1; return true; } },
    });
    const fallback = await prepareSourceFile({
      ...file("sheet.png", "image/png", PNG),
      arrayBuffer: () => { throw accessorError; },
    });
    expect(getterCalls).toBe(0);
    expect(fallback).toMatchObject({ valid: false, error: { code: "read-failed" } });
  });

  it("rejects actual oversized bytes before allocating a detached copy", async () => {
    const slice = vi.spyOn(Uint8Array.prototype, "slice");
    const result = await prepareSourceFile({
      name: "lying.png",
      type: "image/png",
      size: 1,
      arrayBuffer: async () => new ArrayBuffer(64),
    }, { maxBytes: 8 });

    expect(result).toMatchObject({ valid: false, error: { code: "too-large" } });
    expect(slice).not.toHaveBeenCalled();
    slice.mockRestore();
  });
});
