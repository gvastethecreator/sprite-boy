import { describe, expect, it, vi } from "vitest";

import {
  createSourceSession,
} from "../../features/slice/source/sourceSession";
import {
  createBrowserSourceDecoder,
  type DecodedSourceImage,
  type SourceDecoder,
} from "../../features/slice/source/browserSourceDecoder";
import type { SourceFileInput } from "../../features/slice/source/sourceFilePolicy";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
]);

function file(name = "sheet.png", bytes = PNG): SourceFileInput {
  const snapshot = bytes.slice();
  return {
    name,
    type: "image/png",
    size: snapshot.byteLength,
    arrayBuffer: async () => snapshot.slice().buffer,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function decoded(width = 16, height = 8, close = vi.fn()): DecodedSourceImage {
  return { image: { width, height }, width, height, close };
}

describe("Slice source session (G0-01)", () => {
  it("runs idle → validating → decoding → ready and publishes immutable metadata/blob", async () => {
    const decoder: SourceDecoder = {
      decode: vi.fn(async () => decoded()),
    };
    const session = createSourceSession({ decoder });
    const states: string[] = [];
    session.subscribe(() => states.push(session.getSnapshot().status));

    const input = file("folder\\Mutable.png");
    const result = await session.select(input);
    expect(result.status).toBe("ready");
    expect(states).toEqual(["validating", "decoding", "ready"]);
    expect(result.metadata).toMatchObject({ name: "Mutable.png", width: 16, height: 8, pixelCount: 128 });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.metadata)).toBe(true);
    expect(session.getBlob()).toBeInstanceOf(Blob);
    expect((await session.getBlob()!.arrayBuffer()).byteLength).toBe(PNG.byteLength);
  });

  it("captures mutable input metadata and keeps decode errors data-only", async () => {
    const input = file("original.png");
    const decoder: SourceDecoder = {
      decode: vi.fn(async () => {
        (input as unknown as { name?: string; type?: string }).name = "changed.png";
        (input as unknown as { name?: string; type?: string }).type = "image/jpeg";
        throw new Error("private path C:\\secret\\source.png");
      }),
    };
    const session = createSourceSession({ decoder });
    const result = await session.select(input);
    expect(result.status).toBe("error");
    expect(result.error).toMatchObject({ code: "decode", retryable: true });
    expect(Object.keys(result.error ?? {})).toEqual(["code", "message", "retryable"]);
    expect(JSON.stringify(result.error)).not.toMatch(/secret|source\.png|stack|path/i);

    const hostile = new Proxy({ code: "decode", message: "C:\\private\\stack", retryable: true }, {
      get() { throw new Error("hostile accessor"); },
    });
    const hostileSession = createSourceSession({
      decoder: { decode: vi.fn(async () => { throw hostile; }) },
    });
    const hostileResult = await hostileSession.select(file());
    expect(hostileResult).toMatchObject({ status: "error", error: { code: "decode" } });
    expect(JSON.stringify(hostileResult.error)).not.toMatch(/private|stack|path/i);

    const external = { code: "memory", message: "private", retryable: true, stack: "private" };
    const canonicalSession = createSourceSession({
      decoder: { decode: vi.fn(async () => { throw external; }) },
    });
    const canonical = await canonicalSession.select(file());
    expect(canonical.error).not.toBe(external);
    expect(canonical.error).toEqual({
      code: "memory",
      message: "Image source dimensions exceed the safe decode limits.",
      retryable: false,
    });
    expect(Object.keys(canonical.error ?? {})).toEqual(["code", "message", "retryable"]);
    expect(Object.isFrozen(canonical.error)).toBe(true);

    let getterCalls = 0;
    const accessorError = Object.defineProperties({}, {
      code: { enumerable: true, get() { getterCalls += 1; return "memory"; } },
      message: { enumerable: true, get() { getterCalls += 1; return "private"; } },
      retryable: { enumerable: true, get() { getterCalls += 1; return false; } },
    });
    const accessorSession = createSourceSession({
      decoder: { decode: vi.fn(async () => { throw accessorError; }) },
    });
    expect((await accessorSession.select(file())).error?.code).toBe("decode");
    expect(getterCalls).toBe(0);
  });

  it("finishes early multi-file operations and removes the external abort listener once", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const decoder: SourceDecoder = { decode: vi.fn(async () => decoded()) };
    const session = createSourceSession({ decoder, multiFilePolicy: "reject" });

    const result = await session.select([file("a.png"), file("b.png")], { signal: controller.signal });
    expect(result).toMatchObject({ status: "error", error: { code: "multiple-files" } });
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(decoder.decode).not.toHaveBeenCalled();
    const generation = result.generation;
    controller.abort();
    expect(session.getSnapshot().generation).toBe(generation);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("rejects pre-abort, zero dimensions and pixel bombs before publishing ready", async () => {
    const controller = new AbortController();
    controller.abort();
    const decoder: SourceDecoder = { decode: vi.fn(async () => decoded()) };
    const session = createSourceSession({ decoder });
    const aborted = await session.select(file(), { signal: controller.signal });
    expect(aborted).toMatchObject({
      status: "error",
      error: { code: "aborted", retryable: false },
    });
    expect(decoder.decode).not.toHaveBeenCalled();
    expect(await session.retry()).toBe(aborted);

    const zeroClose = vi.fn();
    const zero = createSourceSession({
      decoder: { decode: vi.fn(async () => decoded(0, 8, zeroClose)) },
    });
    expect((await zero.select(file())).error?.code).toBe("decode");
    expect(zeroClose).toHaveBeenCalledTimes(1);

    const hugeClose = vi.fn();
    const huge = createSourceSession({
      maxWidth: 100,
      maxHeight: 100,
      maxPixels: 10_000,
      decoder: { decode: vi.fn(async () => decoded(101, 100, hugeClose)) },
    });
    expect((await huge.select(file())).error?.code).toBe("memory");
    expect(hugeClose).toHaveBeenCalledTimes(1);
  });

  it("does not advertise an inert retry before source bytes have been captured", async () => {
    const arrayBuffer = vi.fn(async () => { throw new Error("transient read failure"); });
    const session = createSourceSession({
      decoder: { decode: vi.fn(async () => decoded()) },
    });
    const failed = await session.select({
      name: "unreadable.png",
      type: "image/png",
      size: PNG.byteLength,
      arrayBuffer,
    });

    expect(failed).toMatchObject({
      status: "error",
      error: { code: "read-failed", retryable: false },
    });
    expect(await session.retry()).toBe(failed);
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("suppresses a late generation and closes each stale decoded image exactly once", async () => {
    const first = deferred<DecodedSourceImage>();
    const second = deferred<DecodedSourceImage>();
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const decoder: SourceDecoder = {
      decode: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
    };
    const session = createSourceSession({ decoder });
    const firstRun = session.select(file("first.png"));
    await vi.waitFor(() => expect(decoder.decode).toHaveBeenCalledTimes(1));
    const secondRun = session.select(file("second.png"));
    first.resolve(decoded(4, 4, firstClose));
    second.resolve(decoded(8, 8, secondClose));
    await firstRun;
    const ready = await secondRun;
    expect(ready.status).toBe("ready");
    if (ready.status !== "ready") throw new Error("second source did not become ready");
    expect(ready.metadata.name).toBe("second.png");
    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(secondClose).toHaveBeenCalledTimes(0);
  });

  it("retries a failed decode, atomically retains a ready source on bad replacement, and resets", async () => {
    const nextClose = vi.fn();
    const decoder: SourceDecoder = {
      decode: vi.fn()
        .mockRejectedValueOnce(new Error("corrupt"))
        .mockResolvedValueOnce(decoded(3, 3, nextClose)),
    };
    const session = createSourceSession({ decoder });
    expect((await session.select(file("old.png"))).status).toBe("error");
    expect((await session.retry()).status).toBe("ready");

    // A valid current source survives an invalid replacement until G0-04 adds
    // confirmation UI around the swap.
    const retained = session.getSnapshot();
    const invalid = await session.select(file("bad.jpg", new Uint8Array([1, 2, 3])));
    expect(invalid.status).toBe("error");
    expect(invalid.source).toBe(retained.source);
    expect(invalid.metadata).toBe(retained.metadata);
    expect(session.getBlob()).not.toBeNull();

    session.reset();
    expect(session.getSnapshot()).toMatchObject({ status: "idle", source: null, error: null });
    expect(session.getBlob()).toBeNull();
    expect(nextClose).toHaveBeenCalledTimes(1);
  });

  it("closes the previous ready resource once after an atomic successful replacement", async () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const decoder: SourceDecoder = {
      decode: vi.fn()
        .mockResolvedValueOnce(decoded(4, 4, firstClose))
        .mockResolvedValueOnce(decoded(8, 8, secondClose)),
    };
    const session = createSourceSession({ decoder });
    expect((await session.select(file("first.png"))).status).toBe("ready");
    expect((await session.select(file("second.png"))).status).toBe("ready");
    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(secondClose).toHaveBeenCalledTimes(0);
    session.dispose();
    expect(secondClose).toHaveBeenCalledTimes(1);
  });

  it("keeps committed source and metadata paired while a separate candidate is pending or fails", async () => {
    const replacement = deferred<DecodedSourceImage>();
    const decoder: SourceDecoder = {
      decode: vi.fn()
        .mockResolvedValueOnce(decoded(4, 5))
        .mockImplementationOnce(() => replacement.promise),
    };
    const session = createSourceSession({ decoder, maxWidth: 10, maxHeight: 10, maxPixels: 100 });
    const committed = await session.select(file("committed.png"));
    expect(committed.status).toBe("ready");

    const run = session.select(file("candidate.png"));
    await vi.waitFor(() => expect(decoder.decode).toHaveBeenCalledTimes(2));
    const pending = session.getSnapshot();
    expect(pending).toMatchObject({
      status: "decoding",
      source: committed.source,
      metadata: committed.metadata,
      candidateMetadata: { name: "candidate.png" },
    });

    const candidateClose = vi.fn();
    replacement.resolve(decoded(11, 5, candidateClose));
    const failed = await run;
    expect(failed).toMatchObject({
      status: "error",
      source: committed.source,
      metadata: committed.metadata,
      candidateMetadata: { name: "candidate.png" },
      error: { code: "memory", retryable: false },
    });
    expect(candidateClose).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(decoder.decode).mock.calls.length;
    expect(await session.retry()).toBe(failed);
    expect(decoder.decode).toHaveBeenCalledTimes(calls);
  });

  it("normalizes hostile decoded values once and cleans failed candidates exactly once", async () => {
    const reads = { image: 0, width: 0, height: 0, close: 0 };
    const close = vi.fn(function(this: unknown) {
      expect(this).toBe(raw);
    });
    const raw: Record<string, unknown> = {
      get image() { reads.image += 1; return reads.image === 1 ? { frame: 1 } : null; },
      get width() { reads.width += 1; return reads.width === 1 ? 7 : 0; },
      get height() { reads.height += 1; return reads.height === 1 ? 6 : 0; },
      get close() { reads.close += 1; return close; },
    };
    const session = createSourceSession({
      decoder: { decode: vi.fn(async () => raw as unknown as DecodedSourceImage) },
    });
    const ready = await session.select(file());
    expect(ready).toMatchObject({ status: "ready", source: { width: 7, height: 6 } });
    expect(reads).toEqual({ image: 1, width: 1, height: 1, close: 1 });
    session.dispose();
    session.dispose();
    expect(close).toHaveBeenCalledTimes(1);

    const failingClose = vi.fn();
    const failingRaw = {
      image: { frame: 2 },
      width: 4,
      get height(): number { throw new Error("hostile height"); },
      close: failingClose,
    };
    const failing = createSourceSession({
      decoder: { decode: vi.fn(async () => failingRaw as unknown as DecodedSourceImage) },
    });
    expect((await failing.select(file())).status).toBe("error");
    expect(failingClose).toHaveBeenCalledTimes(1);

    const nullClose = vi.fn();
    const nullImage = createSourceSession({
      decoder: { decode: vi.fn(async () => ({ image: null, width: 4, height: 4, close: nullClose })) },
    });
    expect((await nullImage.select(file())).status).toBe("error");
    expect(nullImage.getSnapshot().status).not.toBe("ready");
    expect(nullClose).toHaveBeenCalledTimes(1);
  });

  it("clears a retry candidate when a newer selection fails before decode", async () => {
    const decoder: SourceDecoder = { decode: vi.fn(async () => { throw new Error("transient"); }) };
    const session = createSourceSession({ decoder, multiFilePolicy: "reject" });
    const retryable = await session.select(file("retryable.png"));
    expect(retryable).toMatchObject({ status: "error", error: { retryable: true } });
    const early = await session.select([file("a.png"), file("b.png")]);
    expect(early).toMatchObject({ status: "error", error: { code: "multiple-files", retryable: false } });
    expect(await session.retry()).toBe(early);
    expect(decoder.decode).toHaveBeenCalledTimes(1);
  });

  it("aborts before release on dispose, prevents late commits, and isolates listener failures/lifecycle", async () => {
    const pending = deferred<DecodedSourceImage>();
    const close = vi.fn();
    const decoder: SourceDecoder = { decode: vi.fn(() => pending.promise) };
    const session = createSourceSession({ decoder });
    const healthy = vi.fn();
    const failing = vi.fn(() => { throw new Error("listener"); });
    session.subscribe(failing);
    session.subscribe(healthy);
    const run = session.select(file());
    await vi.waitFor(() => expect(decoder.decode).toHaveBeenCalledTimes(1));
    session.dispose();
    pending.resolve(decoded(2, 2, close));
    await run;
    expect(session.getSnapshot()).toMatchObject({ status: "idle", disposed: true, source: null });
    expect(close).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalled();

    const before = healthy.mock.calls.length;
    session.reset();
    await session.select(file());
    expect(healthy.mock.calls.length).toBe(before);
  });

  it("hardens the injectable browser decoder: real primitive path, abort cleanup, limits and close binding", async () => {
    const imageClose = vi.fn();
    const image = { width: 2, height: 3, close: imageClose } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn(async () => image);
    const decoder = createBrowserSourceDecoder({ createImageBitmap });
    const decodedResult = await decoder.decode(new Blob([PNG], { type: "image/png" }));
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(decodedResult).toMatchObject({ width: 2, height: 3, image });
    decodedResult.close?.();
    expect(imageClose).toHaveBeenCalledTimes(1);

    const pending = deferred<ImageBitmap>();
    const lateClose = vi.fn();
    const abortController = new AbortController();
    const abortingDecoder = createBrowserSourceDecoder({
      createImageBitmap: vi.fn(() => pending.promise),
    });
    const abortRun = abortingDecoder.decode(new Blob([PNG]), { signal: abortController.signal });
    abortController.abort();
    await expect(abortRun).rejects.toMatchObject({ code: "cancelled" });
    pending.resolve({ width: 4, height: 4, close: lateClose } as unknown as ImageBitmap);
    await vi.waitFor(() => expect(lateClose).toHaveBeenCalledTimes(1));

    const zeroClose = vi.fn();
    await expect(createBrowserSourceDecoder({
      createImageBitmap: vi.fn(async () => ({ width: 0, height: 3, close: zeroClose } as unknown as ImageBitmap)),
    }).decode(new Blob([PNG]))).rejects.toMatchObject({ code: "decode" });
    expect(zeroClose).toHaveBeenCalledTimes(1);

    const memoryClose = vi.fn();
    await expect(createBrowserSourceDecoder({
      maxPixels: 16,
      createImageBitmap: vi.fn(async () => ({ width: 8, height: 8, close: memoryClose } as unknown as ImageBitmap)),
    }).decode(new Blob([PNG]))).rejects.toMatchObject({ code: "memory" });
    expect(memoryClose).toHaveBeenCalledTimes(1);

    const hostile = new Proxy({ width: 2, height: 2, image: {}, close: vi.fn() }, {
      get() { throw new Error("private path"); },
    });
    await expect(createBrowserSourceDecoder({
      decode: vi.fn(async () => hostile as unknown as DecodedSourceImage),
    }).decode(new Blob([PNG]))).rejects.toMatchObject({ code: "decode" });

    const external = { code: "memory", message: "private stack", retryable: true, stack: "private" };
    const externalDecoder = createBrowserSourceDecoder({
      decode: vi.fn(async () => { throw external; }),
    });
    const caught = await externalDecoder.decode(new Blob([PNG])).catch((error: unknown) => error);
    expect(caught).not.toBe(external);
    expect(caught).toEqual({
      code: "memory",
      message: "Image source dimensions exceed the safe decode limits.",
      retryable: false,
    });
    expect(Object.keys(caught as object)).toEqual(["code", "message", "retryable"]);
    expect(Object.isFrozen(caught)).toBe(true);

    let getterCalls = 0;
    const accessorError = Object.defineProperties({}, {
      code: { enumerable: true, get() { getterCalls += 1; return "memory"; } },
      message: { enumerable: true, get() { getterCalls += 1; return "private"; } },
      retryable: { enumerable: true, get() { getterCalls += 1; return false; } },
    });
    await expect(createBrowserSourceDecoder({
      decode: vi.fn(async () => { throw accessorError; }),
    }).decode(new Blob([PNG]))).rejects.toMatchObject({ code: "decode" });
    expect(getterCalls).toBe(0);
  });

  it("contains hostile AbortSignal hosts and closes a bitmap that arrives after listener setup fails", async () => {
    const pending = deferred<ImageBitmap>();
    const lateClose = vi.fn();
    let accessorCalls = 0;
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const hostileListenerSignal = {
      get aborted() {
        accessorCalls += 1;
        throw new Error("revoked aborted accessor");
      },
      addEventListener,
      removeEventListener,
    } as unknown as AbortSignal;
    const decoder = createBrowserSourceDecoder({
      createImageBitmap: vi.fn(() => pending.promise),
    });

    const run = decoder.decode(new Blob([PNG]), { signal: hostileListenerSignal });
    await expect(run).rejects.toMatchObject({ code: "cancelled", retryable: true });
    expect(accessorCalls).toBe(0);
    expect(addEventListener).not.toHaveBeenCalled();
    expect(removeEventListener).not.toHaveBeenCalled();
    expect(decoder).toBeDefined();

    const controller = new AbortController();
    const nativeAdd = AbortSignal.prototype.addEventListener;
    const addSpy = vi.spyOn(AbortSignal.prototype, "addEventListener").mockImplementation(function (
      this: AbortSignal,
      ...args: Parameters<AbortSignal["addEventListener"]>
    ): void {
      if (this === controller.signal && args[0] === "abort") {
        throw new Error("native listener setup failed");
      }
      Reflect.apply(nativeAdd, this, args);
    });
    const nativeDecoder = createBrowserSourceDecoder({
      createImageBitmap: vi.fn(() => pending.promise),
    });
    const nativeRun = nativeDecoder.decode(new Blob([PNG]), { signal: controller.signal });
    await expect(nativeRun).rejects.toMatchObject({ code: "cancelled", retryable: true });
    addSpy.mockRestore();
    pending.resolve({ width: 4, height: 4, close: lateClose } as unknown as ImageBitmap);
    await vi.waitFor(() => expect(lateClose).toHaveBeenCalledTimes(1));

    const createImageBitmap = vi.fn(async () => (
      { width: 2, height: 2, close: vi.fn() } as unknown as ImageBitmap
    ));
    const hostileAccessorSignal = Object.defineProperties({}, {
      aborted: { get() { throw new Error("revoked aborted accessor"); } },
      addEventListener: { value: vi.fn() },
      removeEventListener: { value: vi.fn() },
    }) as AbortSignal;
    await expect(createBrowserSourceDecoder({ createImageBitmap }).decode(
      new Blob([PNG]),
      { signal: hostileAccessorSignal },
    )).rejects.toMatchObject({ code: "cancelled" });
    expect(createImageBitmap).not.toHaveBeenCalled();

    const cleanupController = new AbortController();
    const nativeRemove = AbortSignal.prototype.removeEventListener;
    const removeSpy = vi.spyOn(AbortSignal.prototype, "removeEventListener").mockImplementation(function (
      this: AbortSignal,
      ...args: Parameters<AbortSignal["removeEventListener"]>
    ): void {
      if (this === cleanupController.signal && args[0] === "abort") {
        throw new Error("listener cleanup failed");
      }
      Reflect.apply(nativeRemove, this, args);
    });
    await expect(createBrowserSourceDecoder({
      createImageBitmap: vi.fn(async () => (
        { width: 3, height: 2, close: vi.fn() } as unknown as ImageBitmap
      )),
    }).decode(new Blob([PNG]), { signal: cleanupController.signal })).resolves.toMatchObject({
      width: 3,
      height: 2,
    });
    removeSpy.mockRestore();
  });
});
