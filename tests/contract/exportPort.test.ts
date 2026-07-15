import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_EXPORT_ARTIFACT_BYTES,
  ExportPortError,
  createExportFileName,
  createExportFormatRegistry,
  createExportPort,
  type ArtifactWriteRequest,
  type ArtifactWriteReceipt,
  type ArtifactWriter,
  type ExportFormatDescriptor,
  type ExportFormatProvider,
  type ExportProviderRequest,
  type ExportRequest,
} from "../../core/export";

const COMPLETED_AT = "2026-07-15T18:00:00.000Z";
const PNG_FORMAT: ExportFormatDescriptor = {
  id: "raster.png",
  label: "PNG image",
  category: "raster-image",
  fileExtension: "png",
  mimeType: "image/png",
};

const BASE_REQUEST: ExportRequest<{ readonly pixels: string }> = {
  requestId: "request-export-1",
  artifactId: "artifact-export-1",
  projectId: "project-1",
  revision: 7,
  formatId: PNG_FORMAT.id,
  baseName: "hero-idle",
  source: { pixels: "canonical" },
};

function pngBlob(value = "png-payload"): Blob {
  return new Blob([value], { type: "image/png" });
}

function providerWith(
  encode: ExportFormatProvider["encode"],
  format: ExportFormatDescriptor = PNG_FORMAT,
): ExportFormatProvider {
  return { format, encode };
}

function matchingReceipt(request: ArtifactWriteRequest): ArtifactWriteReceipt {
  return {
    requestId: request.artifact.requestId,
    artifactId: request.artifact.artifactId,
    fileName: request.artifact.fileName,
    bytesWritten: request.artifact.byteSize,
  };
}

function fakeWriter(
  write: ArtifactWriter["write"] = matchingReceipt,
  id = "memory-writer",
) {
  return {
    id,
    write: vi.fn(write),
  } satisfies ArtifactWriter;
}

function makePort({
  encode = () => pngBlob(),
  writer = fakeWriter(),
  maxArtifactBytes,
  now = () => COMPLETED_AT,
}: {
  readonly encode?: ExportFormatProvider["encode"];
  readonly writer?: ArtifactWriter;
  readonly maxArtifactBytes?: number;
  readonly now?: () => string;
} = {}) {
  const provider = providerWith(vi.fn(encode));
  const registry = createExportFormatRegistry([provider]);
  const port = createExportPort({
    registry,
    writer,
    ...(maxArtifactBytes === undefined ? {} : { maxArtifactBytes }),
    now,
  });
  return { port, provider, registry, writer };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("ExportFormatRegistry", () => {
  it("captures executable providers and exposes frozen deterministic descriptors", async () => {
    const mutableFormat = { ...PNG_FORMAT };
    const originalEncode = vi.fn(() => pngBlob("original"));
    const mutableProvider: ExportFormatProvider = {
      format: mutableFormat,
      encode: originalEncode,
    };
    const registry = createExportFormatRegistry([mutableProvider]);

    mutableFormat.label = "Mutated";
    mutableProvider.encode = () => pngBlob("replacement");

    const listed = registry.list();
    expect(listed).toEqual([PNG_FORMAT]);
    expect(listed).toBe(registry.list());
    expect(Object.isFrozen(listed)).toBe(true);
    expect(Object.isFrozen(listed[0])).toBe(true);
    expect(registry.has("raster.png")).toBe(true);
    expect(registry.get("missing")).toBeUndefined();

    const resolved = registry.resolve("raster.png");
    expect(Object.isFrozen(resolved)).toBe(true);
    await expect(Promise.resolve(resolved.encode(Object.freeze({
      ...BASE_REQUEST,
      format: listed[0],
      fileName: "hero-idle.png",
    })))).resolves.toBeInstanceOf(Blob);
    expect(originalEncode).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate IDs, invalid descriptors and inert providers", () => {
    expect(() => createExportFormatRegistry([
      providerWith(() => pngBlob()),
      providerWith(() => pngBlob()),
    ])).toThrowError(expect.objectContaining({ code: "EXPORT_FORMAT_CONFLICT" }));

    const invalidDescriptors: unknown[] = [
      { ...PNG_FORMAT, id: "PNG" },
      { ...PNG_FORMAT, label: " " },
      { ...PNG_FORMAT, category: "document" },
      { ...PNG_FORMAT, fileExtension: ".png" },
      { ...PNG_FORMAT, mimeType: "Image/PNG" },
    ];
    for (const format of invalidDescriptors) {
      expect(() => createExportFormatRegistry([
        providerWith(() => pngBlob(), format as ExportFormatDescriptor),
      ])).toThrowError(expect.objectContaining({ code: "EXPORT_FORMAT_INVALID" }));
    }
    expect(() => createExportFormatRegistry([
      { format: PNG_FORMAT } as ExportFormatProvider,
    ])).toThrowError(expect.objectContaining({ code: "EXPORT_FORMAT_INVALID" }));
  });

  it("contains hostile descriptor and provider getters", () => {
    const hostileFormat = Object.defineProperty({}, "id", {
      get() {
        throw new Error("private descriptor detail");
      },
    });
    expect(() => createExportFormatRegistry([
      providerWith(() => pngBlob(), hostileFormat as ExportFormatDescriptor),
    ])).toThrowError(expect.objectContaining({
      code: "EXPORT_FORMAT_INVALID",
      message: "Export format descriptor could not be read.",
    }));

    const hostileProvider = Object.defineProperty({ format: PNG_FORMAT }, "encode", {
      get() {
        throw new Error("private provider getter detail");
      },
    });
    expect(() => createExportFormatRegistry([
      hostileProvider as ExportFormatProvider,
    ])).toThrowError(expect.objectContaining({
      code: "EXPORT_FORMAT_INVALID",
      message: "Export format provider could not be read.",
    }));
  });
});

describe("createExportFileName", () => {
  it("normalizes paths, duplicate extensions, device names and unsafe characters", () => {
    expect(createExportFileName("  Hero/Idle.PNG  ", "png")).toBe("Hero-Idle.png");
    expect(createExportFileName("CON", "png")).toBe("_CON.png");
    expect(createExportFileName("CON.txt", "png")).toBe("_CON.txt.png");
    expect(createExportFileName("COM1.backup", "png")).toBe("_COM1.backup.png");
    expect(createExportFileName("report\u202Egnp", "png")).toBe("report-gnp.png");
    expect(createExportFileName("zero\u200Bwidth", "png")).toBe("zero-width.png");
    expect(createExportFileName(".../../../", "png")).toBe("-..-..-.png");
    expect(() => createExportFileName("hero", "../png")).toThrowError(
      expect.objectContaining({ code: "EXPORT_INVALID_REQUEST" }),
    );
    expect(() => createExportFileName("...", "png")).toThrowError(
      expect.objectContaining({ code: "EXPORT_INVALID_REQUEST" }),
    );
  });
});

describe("ExportPort", () => {
  it("validates, writes and publishes an immutable exact artifact receipt", async () => {
    const blob = pngBlob("exact-payload");
    const encode = vi.fn((request: ExportProviderRequest) => {
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.format)).toBe(true);
      expect(request).toMatchObject({
        requestId: BASE_REQUEST.requestId,
        artifactId: BASE_REQUEST.artifactId,
        projectId: BASE_REQUEST.projectId,
        revision: BASE_REQUEST.revision,
        fileName: "Hero-Idle.png",
        source: BASE_REQUEST.source,
      });
      return blob;
    });
    const writer = fakeWriter((request) => {
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.artifact)).toBe(true);
      expect(request.artifact.blob).toBe(blob);
      return matchingReceipt(request);
    });
    const { port } = makePort({ encode, writer });

    const result = await port.run({ ...BASE_REQUEST, baseName: " Hero/Idle.PNG " });
    expect(result.artifact).toEqual(expect.objectContaining({
      requestId: BASE_REQUEST.requestId,
      artifactId: BASE_REQUEST.artifactId,
      projectId: BASE_REQUEST.projectId,
      revision: 7,
      formatId: "raster.png",
      category: "raster-image",
      fileName: "Hero-Idle.png",
      fileExtension: "png",
      mimeType: "image/png",
      byteSize: blob.size,
      blob,
    }));
    expect(result.receipt).toEqual({
      writerId: "memory-writer",
      requestId: BASE_REQUEST.requestId,
      artifactId: BASE_REQUEST.artifactId,
      fileName: "Hero-Idle.png",
      bytesWritten: blob.size,
      completedAt: COMPLETED_AT,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.artifact)).toBe(true);
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(port.maxArtifactBytes).toBe(DEFAULT_MAX_EXPORT_ARTIFACT_BYTES);
    expect(port.listFormats()).toEqual([PNG_FORMAT]);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(writer.write).toHaveBeenCalledTimes(1);
  });

  it("captures request identities before async provider execution", async () => {
    const encoded = deferred<Blob>();
    const encode = vi.fn(() => encoded.promise);
    const writer = fakeWriter();
    const { port } = makePort({ encode, writer });
    const mutable = { ...BASE_REQUEST, source: { pixels: "before" } };

    const resultPromise = port.run(mutable);
    mutable.requestId = "request-mutated";
    mutable.artifactId = "artifact-mutated";
    mutable.projectId = "project-mutated";
    mutable.revision = 999;
    mutable.formatId = "missing";
    mutable.baseName = "mutated";
    mutable.source = { pixels: "after" };
    encoded.resolve(pngBlob());

    const result = await resultPromise;
    expect(result.artifact).toMatchObject({
      requestId: BASE_REQUEST.requestId,
      artifactId: BASE_REQUEST.artifactId,
      projectId: BASE_REQUEST.projectId,
      revision: BASE_REQUEST.revision,
      fileName: "hero-idle.png",
    });
    expect(encode).toHaveBeenCalledWith(expect.objectContaining({
      source: { pixels: "before" },
    }));
  });

  it("captures the writer and visible registry snapshot at construction", async () => {
    const originalWrite = vi.fn(matchingReceipt);
    const writer = fakeWriter(originalWrite);
    const { port } = makePort({ writer });
    writer.id = "mutated-writer";
    writer.write = vi.fn(() => {
      throw new Error("replacement should not run");
    });

    const formats = port.listFormats();
    expect(Object.isFrozen(formats)).toBe(true);
    expect(Object.isFrozen(formats[0])).toBe(true);
    const result = await port.run(BASE_REQUEST);
    expect(result.receipt.writerId).toBe("memory-writer");
    expect(originalWrite).toHaveBeenCalledTimes(1);
    expect(writer.write).not.toHaveBeenCalled();
  });

  it("rejects unsupported formats and invalid requests before provider or writer work", async () => {
    const encode = vi.fn(() => pngBlob());
    const writer = fakeWriter();
    const { port } = makePort({ encode, writer });
    const invalidRequests: Array<[Partial<ExportRequest>, string]> = [
      [{ requestId: "" }, "EXPORT_INVALID_REQUEST"],
      [{ artifactId: "" }, "EXPORT_INVALID_REQUEST"],
      [{ projectId: "" }, "EXPORT_INVALID_REQUEST"],
      [{ revision: -1 }, "EXPORT_INVALID_REQUEST"],
      [{ revision: Number.MAX_SAFE_INTEGER + 1 }, "EXPORT_INVALID_REQUEST"],
      [{ formatId: "" }, "EXPORT_INVALID_REQUEST"],
      [{ baseName: "..." }, "EXPORT_INVALID_REQUEST"],
      [{ signal: { aborted: false } as AbortSignal }, "EXPORT_INVALID_REQUEST"],
      [{ formatId: "archive.zip" }, "EXPORT_UNSUPPORTED_FORMAT"],
    ];

    for (const [patch, code] of invalidRequests) {
      await expect(port.run({ ...BASE_REQUEST, ...patch })).rejects.toMatchObject({ code });
    }
    expect(encode).not.toHaveBeenCalled();
    expect(writer.write).not.toHaveBeenCalled();
  });

  it("contains hostile request getters before resolving a format", async () => {
    const encode = vi.fn(() => pngBlob());
    const writer = fakeWriter();
    const { port } = makePort({ encode, writer });
    const hostileRequest = Object.defineProperty({ ...BASE_REQUEST }, "artifactId", {
      get() {
        throw new Error("private request getter detail");
      },
    });

    await expect(port.run(hostileRequest)).rejects.toMatchObject({
      code: "EXPORT_INVALID_REQUEST",
      message: "Export request could not be read.",
    });
    expect(encode).not.toHaveBeenCalled();
    expect(writer.write).not.toHaveBeenCalled();
  });

  it("contains synchronous and asynchronous provider failures without leaking details", async () => {
    const syncWriter = fakeWriter();
    const syncPort = makePort({
      encode: () => {
        throw new Error("private provider credential");
      },
      writer: syncWriter,
    }).port;
    await expect(syncPort.run(BASE_REQUEST)).rejects.toMatchObject({
      code: "EXPORT_PROVIDER_FAILED",
      retryable: true,
      message: "The export provider could not generate the artifact.",
    });
    await expect(syncPort.run(BASE_REQUEST)).rejects.not.toThrow(/credential/);
    expect(syncWriter.write).not.toHaveBeenCalled();

    const asyncWriter = fakeWriter();
    const asyncPort = makePort({
      encode: async () => {
        throw new Error("private async provider detail");
      },
      writer: asyncWriter,
    }).port;
    await expect(asyncPort.run(BASE_REQUEST)).rejects.toMatchObject({
      code: "EXPORT_PROVIDER_FAILED",
      retryable: true,
    });
    expect(asyncWriter.write).not.toHaveBeenCalled();

    const spoofedAbortPort = makePort({
      encode: () => {
        throw new ExportPortError("EXPORT_ABORTED", "spoofed private abort");
      },
    }).port;
    await expect(spoofedAbortPort.run(BASE_REQUEST)).rejects.toMatchObject({
      code: "EXPORT_PROVIDER_FAILED",
      message: "The export provider could not generate the artifact.",
    });
  });

  it("blocks zero-byte, forged, MIME-mismatched and oversized artifacts before write", async () => {
    const cases: Array<{
      readonly encode: ExportFormatProvider["encode"];
      readonly code: string;
      readonly maxArtifactBytes?: number;
    }> = [
      { encode: () => new Blob([], { type: "image/png" }), code: "EXPORT_ARTIFACT_INVALID" },
      { encode: () => new Blob(["x"], { type: "image/webp" }), code: "EXPORT_ARTIFACT_INVALID" },
      {
        encode: (() => ({ size: 1, type: "image/png" })) as unknown as ExportFormatProvider["encode"],
        code: "EXPORT_ARTIFACT_INVALID",
      },
      {
        encode: () => pngBlob("four"),
        code: "EXPORT_ARTIFACT_TOO_LARGE",
        maxArtifactBytes: 3,
      },
    ];

    for (const testCase of cases) {
      const writer = fakeWriter();
      const { port } = makePort({
        encode: testCase.encode,
        writer,
        maxArtifactBytes: testCase.maxArtifactBytes,
      });
      await expect(port.run(BASE_REQUEST)).rejects.toMatchObject({
        code: testCase.code,
        retryable: false,
      });
      expect(writer.write).not.toHaveBeenCalled();
    }
  });

  it("uses native Blob slots instead of hostile own size and type getters", async () => {
    const blob = pngBlob("native-bytes");
    Object.defineProperties(blob, {
      size: { get: () => 0 },
      type: { get: () => "image/webp" },
    });
    const writer = fakeWriter();
    const { port } = makePort({ encode: () => blob, writer });

    const result = await port.run(BASE_REQUEST);
    expect(result.artifact.byteSize).toBe("native-bytes".length);
    expect(result.artifact.mimeType).toBe("image/png");
    expect(writer.write).toHaveBeenCalledTimes(1);
  });

  it("contains writer failures and validates every receipt field", async () => {
    const syncPort = makePort({
      writer: fakeWriter(() => {
        throw new Error("private destination path");
      }),
    }).port;
    await expect(syncPort.run(BASE_REQUEST)).rejects.toMatchObject({
      code: "EXPORT_WRITER_FAILED",
      retryable: true,
      message: "The artifact writer could not complete the export.",
    });
    await expect(syncPort.run(BASE_REQUEST)).rejects.not.toThrow(/destination/);

    const spoofedAbortPort = makePort({
      writer: fakeWriter(() => {
        throw new ExportPortError("EXPORT_ABORTED", "spoofed writer abort");
      }),
    }).port;
    await expect(spoofedAbortPort.run(BASE_REQUEST)).rejects.toMatchObject({
      code: "EXPORT_WRITER_FAILED",
      message: "The artifact writer could not complete the export.",
    });

    const mismatches: Array<(request: ArtifactWriteRequest) => ArtifactWriteReceipt> = [
      (request) => ({ ...matchingReceipt(request), requestId: "wrong-request" }),
      (request) => ({ ...matchingReceipt(request), artifactId: "wrong-artifact" }),
      (request) => ({ ...matchingReceipt(request), fileName: "wrong.png" }),
      (request) => ({ ...matchingReceipt(request), bytesWritten: 0 }),
    ];
    for (const mismatch of mismatches) {
      const { port } = makePort({ writer: fakeWriter(mismatch) });
      await expect(port.run(BASE_REQUEST)).rejects.toMatchObject({
        code: "EXPORT_RECEIPT_INVALID",
        retryable: false,
      });
    }

    const hostileReceipt = Object.defineProperty({}, "requestId", {
      get() {
        throw new Error("private receipt getter detail");
      },
    });
    const hostilePort = makePort({
      writer: fakeWriter(() => hostileReceipt as ArtifactWriteReceipt),
    }).port;
    await expect(hostilePort.run(BASE_REQUEST)).rejects.toMatchObject({
      code: "EXPORT_RECEIPT_INVALID",
      message: "Artifact writer returned an invalid receipt.",
    });
  });

  it("rejects invalid completion clocks and construction options", async () => {
    const invalidClock = makePort({ now: () => "not-a-time" }).port;
    await expect(invalidClock.run(BASE_REQUEST)).rejects.toMatchObject({
      code: "EXPORT_RECEIPT_INVALID",
    });
    const throwingClock = makePort({
      now: () => {
        throw new Error("clock detail");
      },
    }).port;
    await expect(throwingClock.run(BASE_REQUEST)).rejects.toMatchObject({
      code: "EXPORT_RECEIPT_INVALID",
      message: "The export completion timestamp is invalid.",
    });

    const registry = createExportFormatRegistry([providerWith(() => pngBlob())]);
    expect(() => createExportPort({
      registry,
      writer: fakeWriter(),
      maxArtifactBytes: 0,
    })).toThrowError(expect.objectContaining({ code: "EXPORT_INVALID_REQUEST" }));
    expect(() => createExportPort({
      registry,
      writer: { id: "", write: matchingReceipt },
    })).toThrowError(expect.objectContaining({ code: "EXPORT_INVALID_REQUEST" }));
    expect(() => createExportPort({
      registry,
      writer: { id: "memory/writer", write: matchingReceipt },
    })).toThrowError(expect.objectContaining({ code: "EXPORT_INVALID_REQUEST" }));

    const hostileRegistry = {
      list: () => [PNG_FORMAT],
      has: () => true,
      get: () => PNG_FORMAT,
      resolve: () => {
        throw new ExportPortError("EXPORT_UNSUPPORTED_FORMAT", "private registry detail");
      },
    };
    expect(() => createExportPort({
      registry: hostileRegistry,
      writer: fakeWriter(),
      now: () => COMPLETED_AT,
    })).toThrowError(expect.objectContaining({
      code: "EXPORT_FORMAT_INVALID",
      message: 'Listed export format "raster.png" has no valid provider.',
    }));
  });

  it("rejects registry descriptor drift and hidden executable formats", async () => {
    const jpegDrift = {
      ...PNG_FORMAT,
      category: "raster-image" as const,
      fileExtension: "jpg",
      mimeType: "image/jpeg",
    };
    const driftRegistry = {
      list: () => [PNG_FORMAT],
      has: () => true,
      get: () => PNG_FORMAT,
      resolve: () => providerWith(() => new Blob(["jpg"], { type: "image/jpeg" }), jpegDrift),
    };
    expect(() => createExportPort({
      registry: driftRegistry,
      writer: fakeWriter(),
    })).toThrowError(expect.objectContaining({ code: "EXPORT_FORMAT_CONFLICT" }));

    const hiddenRegistry = {
      list: () => [] as ExportFormatDescriptor[],
      has: () => true,
      get: () => PNG_FORMAT,
      resolve: () => providerWith(() => pngBlob()),
    };
    const hiddenPort = createExportPort({
      registry: hiddenRegistry,
      writer: fakeWriter(),
      now: () => COMPLETED_AT,
    });
    await expect(hiddenPort.run(BASE_REQUEST)).rejects.toMatchObject({
      code: "EXPORT_UNSUPPORTED_FORMAT",
      message: "The requested export format is not available.",
    });
  });

  it("contains hostile registry list accessors during construction", () => {
    const hostileList = [] as ExportFormatDescriptor[];
    Object.defineProperty(hostileList, "0", {
      configurable: true,
      get() {
        throw new Error("private list element");
      },
    });
    Object.defineProperty(hostileList, "length", { value: 1 });
    const registry = {
      list: () => hostileList,
      has: () => false,
      get: () => undefined,
      resolve: () => providerWith(() => pngBlob()),
    };

    expect(() => createExportPort({
      registry,
      writer: fakeWriter(),
    })).toThrowError(expect.objectContaining({
      code: "EXPORT_INVALID_REQUEST",
      message: "Export format registry could not be listed.",
    }));
  });

  it("aborts before encode and while provider work is pending without writing", async () => {
    const preAborted = new AbortController();
    preAborted.abort("stop");
    const preEncode = vi.fn(() => pngBlob());
    const preWriter = fakeWriter();
    const prePort = makePort({ encode: preEncode, writer: preWriter }).port;
    await expect(prePort.run({
      ...BASE_REQUEST,
      signal: preAborted.signal,
    })).rejects.toMatchObject({ code: "EXPORT_ABORTED", retryable: false });
    expect(preEncode).not.toHaveBeenCalled();
    expect(preWriter.write).not.toHaveBeenCalled();

    const pending = deferred<Blob>();
    const encode = vi.fn(() => pending.promise);
    const writer = fakeWriter();
    const port = makePort({ encode, writer }).port;
    const controller = new AbortController();
    const result = port.run({ ...BASE_REQUEST, signal: controller.signal });
    await vi.waitFor(() => expect(encode).toHaveBeenCalledTimes(1));
    controller.abort(new Error("private abort reason"));
    await expect(result).rejects.toMatchObject({
      code: "EXPORT_ABORTED",
      message: "Export was cancelled.",
    });
    expect(writer.write).not.toHaveBeenCalled();
    pending.resolve(pngBlob("late"));
  });

  it("uses native AbortSignal slots and listeners instead of hostile own properties", async () => {
    const shadowed = new AbortController();
    Object.defineProperties(shadowed.signal, {
      aborted: {
        configurable: true,
        get() {
          throw new Error("private signal getter");
        },
      },
      addEventListener: {
        configurable: true,
        get() {
          throw new Error("private add listener getter");
        },
      },
      removeEventListener: {
        configurable: true,
        get() {
          throw new Error("private remove listener getter");
        },
      },
    });
    const livePort = makePort().port;
    await expect(livePort.run({
      ...BASE_REQUEST,
      signal: shadowed.signal,
    })).resolves.toMatchObject({
      artifact: { artifactId: BASE_REQUEST.artifactId },
    });

    const alreadyAborted = new AbortController();
    alreadyAborted.abort("stop");
    Object.defineProperty(alreadyAborted.signal, "aborted", {
      configurable: true,
      value: false,
    });
    const encode = vi.fn(() => pngBlob());
    const writer = fakeWriter();
    const abortedPort = makePort({ encode, writer }).port;
    await expect(abortedPort.run({
      ...BASE_REQUEST,
      signal: alreadyAborted.signal,
    })).rejects.toMatchObject({
      code: "EXPORT_ABORTED",
      message: "Export was cancelled.",
    });
    expect(encode).not.toHaveBeenCalled();
    expect(writer.write).not.toHaveBeenCalled();
  });

  it("aborts while a writer is pending and suppresses a late receipt", async () => {
    const pending = deferred<ArtifactWriteReceipt>();
    const writer = fakeWriter(() => pending.promise);
    const { port } = makePort({ writer });
    const controller = new AbortController();
    const result = port.run({ ...BASE_REQUEST, signal: controller.signal });
    await vi.waitFor(() => expect(writer.write).toHaveBeenCalledTimes(1));
    const request = vi.mocked(writer.write).mock.calls[0][0];

    controller.abort("cancel");
    await expect(result).rejects.toMatchObject({ code: "EXPORT_ABORTED" });
    pending.resolve(matchingReceipt(request));
  });

  it("marks only provider and writer failures as retryable", () => {
    const retryable = new ExportPortError("EXPORT_PROVIDER_FAILED", "safe");
    const terminal = new ExportPortError("EXPORT_ARTIFACT_TOO_LARGE", "safe");
    expect(retryable.retryable).toBe(true);
    expect(terminal.retryable).toBe(false);
    expect(new Set(Object.keys(retryable))).toEqual(new Set(["name", "code", "retryable"]));
  });
});
