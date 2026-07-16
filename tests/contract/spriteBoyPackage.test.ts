import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import {
  SPRITEBOY_PACKAGE_FORMAT,
  SPRITEBOY_PACKAGE_MIME,
  SpriteBoyPackageError,
  exportSpriteBoyPackage,
  importSpriteBoyPackage,
  isSpriteBoyPackageError,
} from "../../core/persistence";
import type {
  SpriteBoyPackageAssetSource,
  SpriteBoyPackageExportOptions,
} from "../../core/persistence";
import { createEmptyStudioProject } from "../../core/project";
import type { AssetRecord, StudioProjectV1 } from "../../core/project";

const TIMESTAMP = "2026-07-14T00:00:00.000Z";
const ALPHA_HASH = "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8";
const BETA_HASH = "f44e64e75f3948e9f73f8dfa94721c4ce8cbb4f265c4790c702b2d41cfbf2753";

function blobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function asset(
  id: string,
  name: string,
  contentHash: string,
  byteSize: number,
): AssetRecord {
  return {
    id,
    name,
    blobKey: `sha256:${contentHash}`,
    contentHash,
    mimeType: "image/png",
    width: 1,
    height: 1,
    byteSize,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    provenance: { source: "fixture" },
  };
}

function packageProject(includeDuplicate = false): StudioProjectV1 {
  const project = createEmptyStudioProject({
    id: "package-project",
    name: "Portable package",
    now: TIMESTAMP,
  });
  project.assets.alpha = asset("alpha", "alpha.png", ALPHA_HASH, 5);
  project.assets.beta = asset("beta", "beta.png", BETA_HASH, 4);
  project.rootOrder.assetIds.push("alpha", "beta");
  if (includeDuplicate) {
    project.assets["alpha-copy"] = asset("alpha-copy", "alpha-copy.png", ALPHA_HASH, 5);
    project.rootOrder.assetIds.push("alpha-copy");
  }
  return project;
}

function packageSource() {
  const getBlob = vi.fn(async (assetId: string): Promise<Blob> => {
    if (assetId === "alpha" || assetId === "alpha-copy") {
      return new Blob(["alpha"], { type: "image/png" });
    }
    if (assetId === "beta") return new Blob(["beta"], { type: "image/png" });
    throw new Error(`missing ${assetId}`);
  });
  return { getBlob };
}

async function captureError(work: () => unknown): Promise<SpriteBoyPackageError> {
  try {
    await work();
  } catch (error) {
    expect(isSpriteBoyPackageError(error)).toBe(true);
    return error as SpriteBoyPackageError;
  }
  throw new Error("Expected SpriteBoyPackageError.");
}

async function packageBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

async function repack(
  original: Blob,
  mutate: (zip: JSZip) => void | Promise<void>,
): Promise<Blob> {
  const zip = await JSZip.loadAsync(await original.arrayBuffer());
  await mutate(zip);
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "DOS",
  });
  return new Blob([blobPart(bytes)], { type: SPRITEBOY_PACKAGE_MIME });
}

async function duplicatePhysicalEntry(original: Blob, targetPath: string): Promise<Blob> {
  const bytes = await packageBytes(original);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("Fixture ZIP end record missing.");
  const centralOffset = view.getUint32(endOffset + 16, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  let position = centralOffset;
  let duplicate: Uint8Array | undefined;
  for (let index = 0; index < entryCount; index += 1) {
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    const name = new TextDecoder().decode(bytes.subarray(position + 46, position + 46 + nameLength));
    if (name === targetPath) duplicate = bytes.slice(position, position + recordLength);
    position += recordLength;
  }
  if (!duplicate) throw new Error(`Fixture ZIP entry ${targetPath} missing.`);
  const output = new Uint8Array(bytes.byteLength + duplicate.byteLength);
  output.set(bytes.subarray(0, endOffset));
  output.set(duplicate, endOffset);
  output.set(bytes.subarray(endOffset), endOffset + duplicate.byteLength);
  const outputView = new DataView(output.buffer);
  const shiftedEnd = endOffset + duplicate.byteLength;
  outputView.setUint16(shiftedEnd + 8, entryCount + 1, true);
  outputView.setUint16(shiftedEnd + 10, entryCount + 1, true);
  outputView.setUint32(shiftedEnd + 12, centralSize + duplicate.byteLength, true);
  return new Blob([blobPart(output)], { type: SPRITEBOY_PACKAGE_MIME });
}

interface PhysicalArchiveView {
  bytes: Uint8Array;
  view: DataView;
  endOffset: number;
  centralOffset: number;
  localOffset: number;
}

async function patchPhysicalArchive(
  original: Blob,
  patch: (archive: PhysicalArchiveView) => void,
): Promise<Blob> {
  const bytes = (await packageBytes(original)).slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("Fixture ZIP end record missing.");
  const centralOffset = view.getUint32(endOffset + 16, true);
  const localOffset = view.getUint32(centralOffset + 42, true);
  patch({ bytes, view, endOffset, centralOffset, localOffset });
  return new Blob([blobPart(bytes)], { type: SPRITEBOY_PACKAGE_MIME });
}

async function repackManifest(
  original: Blob,
  mutate: (manifest: Record<string, unknown>, zip: JSZip) => void | Promise<void>,
): Promise<Blob> {
  return repack(original, async (zip) => {
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    ) as Record<string, unknown>;
    await mutate(manifest, zip);
    zip.file("manifest.json", JSON.stringify(manifest));
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("portable .spriteboy package (F3-04)", () => {
  it("exports and imports a fully verified clean-profile package", async () => {
    const project = packageProject();
    const source = packageSource();
    const portable = await exportSpriteBoyPackage(project, source);

    expect(portable.type).toBe(SPRITEBOY_PACKAGE_MIME);
    expect(portable.size).toBeGreaterThan(0);
    expect(source.getBlob).toHaveBeenCalledTimes(2);
    const zip = await JSZip.loadAsync(await portable.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual([
      `assets/${ALPHA_HASH}.png`,
      `assets/${BETA_HASH}.png`,
      "manifest.json",
      "project.json",
    ].sort());
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest).toMatchObject({
      format: SPRITEBOY_PACKAGE_FORMAT,
      formatVersion: 1,
      project: { path: "project.json", schemaVersion: 1 },
      blobs: [
        {
          path: `assets/${ALPHA_HASH}.png`,
          blobKey: `sha256:${ALPHA_HASH}`,
          contentHash: ALPHA_HASH,
          mimeType: "image/png",
          byteSize: 5,
          assetIds: ["alpha"],
        },
        {
          path: `assets/${BETA_HASH}.png`,
          blobKey: `sha256:${BETA_HASH}`,
          contentHash: BETA_HASH,
          mimeType: "image/png",
          byteSize: 4,
          assetIds: ["beta"],
        },
      ],
    });

    const imported = await importSpriteBoyPackage(portable);
    expect(imported.project).toEqual(project);
    expect(imported.manifest).toEqual(manifest);
    expect(imported.blobs.map(({ blobKey, assetIds }) => ({ blobKey, assetIds }))).toEqual([
      { blobKey: `sha256:${ALPHA_HASH}`, assetIds: ["alpha"] },
      { blobKey: `sha256:${BETA_HASH}`, assetIds: ["beta"] },
    ]);
    expect(await imported.blobs[0].blob.text()).toBe("alpha");
    expect(await imported.blobs[1].blob.text()).toBe("beta");
    expect(Object.isFrozen(imported.manifest)).toBe(true);
    expect(Object.isFrozen(imported.blobs)).toBe(true);
  });

  it("deduplicates shared content into one ZIP entry and one provider read", async () => {
    const project = packageProject(true);
    delete project.assets.beta;
    project.rootOrder.assetIds = project.rootOrder.assetIds.filter((id) => id !== "beta");
    const source = packageSource();
    const portable = await exportSpriteBoyPackage(project, source);
    const imported = await importSpriteBoyPackage(portable);

    expect(source.getBlob).toHaveBeenCalledOnce();
    expect(source.getBlob).toHaveBeenCalledWith("alpha", { signal: undefined });
    expect(imported.manifest.blobs).toHaveLength(1);
    expect(imported.manifest.blobs[0].assetIds).toEqual(["alpha", "alpha-copy"]);
    expect(imported.blobs).toHaveLength(1);
  });

  it("produces byte-identical archives for identical inputs", async () => {
    const project = packageProject();
    const first = await exportSpriteBoyPackage(project, packageSource());
    const second = await exportSpriteBoyPackage(structuredClone(project), packageSource());

    expect(await packageBytes(first)).toEqual(await packageBytes(second));
  });

  it("rejects missing and metadata-mismatched export payloads with private causes", async () => {
    const missing = packageSource();
    missing.getBlob.mockRejectedValueOnce(new Error("private storage detail"));
    const missingError = await captureError(() => exportSpriteBoyPackage(packageProject(), missing));
    expect(missingError).toMatchObject({
      code: "SPRITEBOY_PACKAGE_ASSET_MISSING",
      operation: "export",
      assetId: "alpha",
    });
    expect(missingError.toDiagnostic()).not.toHaveProperty("cause");
    expect(JSON.stringify(missingError.toDiagnostic())).not.toContain("private storage detail");

    const mismatch = packageSource();
    mismatch.getBlob.mockResolvedValueOnce(new Blob(["wrong"], { type: "image/png" }));
    await expect(captureError(() => exportSpriteBoyPackage(packageProject(), mismatch)))
      .resolves.toMatchObject({
        code: "SPRITEBOY_PACKAGE_INTEGRITY_MISMATCH",
        operation: "export",
        assetId: "alpha",
      });

    const contradictorySharedMetadata = packageProject(true);
    delete contradictorySharedMetadata.assets.beta;
    contradictorySharedMetadata.rootOrder.assetIds = ["alpha", "alpha-copy"];
    contradictorySharedMetadata.assets["alpha-copy"].width = 2;
    await expect(captureError(() => exportSpriteBoyPackage(
      contradictorySharedMetadata,
      packageSource(),
    ))).resolves.toMatchObject({
      code: "SPRITEBOY_PACKAGE_PROJECT_INVALID",
      assetId: "alpha-copy",
    });
  });

  it("rejects project, blob, missing-entry and unexpected-entry tampering", async () => {
    const portable = await exportSpriteBoyPackage(packageProject(), packageSource());
    const projectTampered = await repack(portable, (zip) => {
      zip.file("project.json", "{}");
    });
    await expect(captureError(() => importSpriteBoyPackage(projectTampered)))
      .resolves.toMatchObject({
        code: "SPRITEBOY_PACKAGE_INTEGRITY_MISMATCH",
        path: "project.json",
      });

    const blobTampered = await repack(portable, (zip) => {
      zip.file(`assets/${ALPHA_HASH}.png`, "bravo", { createFolders: false });
    });
    await expect(captureError(() => importSpriteBoyPackage(blobTampered)))
      .resolves.toMatchObject({
        code: "SPRITEBOY_PACKAGE_INTEGRITY_MISMATCH",
        path: `assets/${ALPHA_HASH}.png`,
      });

    const missing = await repack(portable, (zip) => {
      zip.remove(`assets/${ALPHA_HASH}.png`);
    });
    await expect(captureError(() => importSpriteBoyPackage(missing)))
      .resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_INVALID_ARCHIVE" });

    const unexpected = await repack(portable, (zip) => {
      zip.file("unexpected.txt", "nope", { createFolders: false });
    });
    await expect(captureError(() => importSpriteBoyPackage(unexpected)))
      .resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_INVALID_ARCHIVE" });

    const duplicate = await duplicatePhysicalEntry(portable, "manifest.json");
    await expect(captureError(() => importSpriteBoyPackage(duplicate)))
      .resolves.toMatchObject({
        code: "SPRITEBOY_PACKAGE_INVALID_ARCHIVE",
        path: "manifest.json",
      });

    const directory = await repack(portable, (zip) => {
      zip.folder("unexpected-directory");
    });
    await expect(captureError(() => importSpriteBoyPackage(directory)))
      .resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_INVALID_ARCHIVE" });
  });

  it("rejects manifest drift, unsupported versions and unsafe paths", async () => {
    const portable = await exportSpriteBoyPackage(packageProject(), packageSource());
    const drift = await repack(portable, async (zip) => {
      const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
      manifest.blobs[0].assetIds = ["beta"];
      zip.file("manifest.json", JSON.stringify(manifest));
    });
    await expect(captureError(() => importSpriteBoyPackage(drift)))
      .resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_MANIFEST_INVALID" });

    const future = await repack(portable, async (zip) => {
      const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
      manifest.formatVersion = 99;
      zip.file("manifest.json", JSON.stringify(manifest));
    });
    await expect(captureError(() => importSpriteBoyPackage(future)))
      .resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_MANIFEST_INVALID" });

    const unsafe = await repack(portable, (zip) => {
      zip.file("../escape.txt", "nope", { createFolders: false });
    });
    await expect(captureError(() => importSpriteBoyPackage(unsafe)))
      .resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_INVALID_ARCHIVE" });
  });

  it("enforces compressed/input, entry and declared-uncompressed limits", async () => {
    const portable = await exportSpriteBoyPackage(packageProject(), packageSource());
    await expect(captureError(() => importSpriteBoyPackage(portable, {
      maxPackageBytes: portable.size - 1,
    }))).resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_LIMIT_EXCEEDED" });
    await expect(captureError(() => importSpriteBoyPackage(portable, {
      maxEntries: 2,
    }))).resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_LIMIT_EXCEEDED" });
    await expect(captureError(() => importSpriteBoyPackage(portable, {
      maxUncompressedBytes: 8,
    }))).resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_LIMIT_EXCEEDED" });
  });

  it("aborts before export/import and races a non-cooperative asset source", async () => {
    const before = new AbortController();
    before.abort("before");
    await expect(captureError(() => exportSpriteBoyPackage(packageProject(), packageSource(), {
      signal: before.signal,
    }))).resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_ABORTED", operation: "export" });

    const portable = await exportSpriteBoyPackage(packageProject(), packageSource());
    await expect(captureError(() => importSpriteBoyPackage(portable, { signal: before.signal })))
      .resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_ABORTED", operation: "import" });

    const during = new AbortController();
    const started = vi.fn(() => new Promise<Blob>(() => undefined));
    const pending = exportSpriteBoyPackage(packageProject(), { getBlob: started }, {
      signal: during.signal,
    });
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
    during.abort("during");
    await expect(captureError(() => pending)).resolves.toMatchObject({
      code: "SPRITEBOY_PACKAGE_ABORTED",
      operation: "export",
    });

    const importDuring = new AbortController();
    const loadSpy = vi.spyOn(JSZip, "loadAsync").mockImplementationOnce(
      () => new Promise<JSZip>(() => undefined),
    );
    try {
      const pendingImport = importSpriteBoyPackage(portable, { signal: importDuring.signal });
      await vi.waitFor(() => expect(loadSpy).toHaveBeenCalledOnce());
      importDuring.abort("during-import");
      await expect(captureError(() => pendingImport)).resolves.toMatchObject({
        code: "SPRITEBOY_PACKAGE_ABORTED",
        operation: "import",
      });
    } finally {
      loadSpy.mockRestore();
    }
  });

  it("rejects source/options accessors without executing them and normalizes hostile Blobs", async () => {
    let optionReads = 0;
    const hostileOptions: Record<string, unknown> = {};
    Object.defineProperty(hostileOptions, "signal", {
      enumerable: true,
      get() {
        optionReads += 1;
        return undefined;
      },
    });
    await expect(captureError(() => exportSpriteBoyPackage(
      packageProject(),
      packageSource(),
      hostileOptions as SpriteBoyPackageExportOptions,
    ))).resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_INVALID_INPUT" });
    expect(optionReads).toBe(0);

    let sourceReads = 0;
    const hostileSource: Record<string, unknown> = {};
    Object.defineProperty(hostileSource, "getBlob", {
      enumerable: true,
      get() {
        sourceReads += 1;
        return async () => new Blob(["alpha"], { type: "image/png" });
      },
    });
    await expect(captureError(() => exportSpriteBoyPackage(
      packageProject(),
      hostileSource as unknown as SpriteBoyPackageAssetSource,
    ))).resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_INVALID_INPUT" });
    expect(sourceReads).toBe(0);

    const portable = await exportSpriteBoyPackage(packageProject(), packageSource());
    let blobMethodReads = 0;
    Object.defineProperty(portable, "arrayBuffer", {
      configurable: true,
      get() {
        blobMethodReads += 1;
        throw new Error("hostile own Blob method");
      },
    });
    const imported = await importSpriteBoyPackage(portable);
    expect(imported.project.id).toBe("package-project");
    expect(blobMethodReads).toBe(0);
  });

  it("closes invalid option, source, project and input boundaries", async () => {
    const invalidExportOptions: unknown[] = [
      null,
      [],
      new Date(),
      { unsupported: true },
      { compressionLevel: -1 },
      { compressionLevel: 1.5 },
      { compressionLevel: 10 },
      { signal: {} },
    ];
    const hiddenOption = {};
    Object.defineProperty(hiddenOption, "compressionLevel", { enumerable: false, value: 6 });
    invalidExportOptions.push(hiddenOption);

    for (const options of invalidExportOptions) {
      await expect(captureError(() => exportSpriteBoyPackage(
        packageProject(),
        packageSource(),
        options as SpriteBoyPackageExportOptions,
      ))).resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_INVALID_INPUT" });
    }

    for (const options of [
      { maxPackageBytes: 0 },
      { maxEntries: 1.5 },
      { maxUncompressedBytes: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      await expect(captureError(() => importSpriteBoyPackage(
        new Blob(),
        options,
      ))).resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_INVALID_INPUT" });
    }

    for (const source of [null, {}, { getBlob: true }]) {
      await expect(captureError(() => exportSpriteBoyPackage(
        packageProject(),
        source as unknown as SpriteBoyPackageAssetSource,
      ))).resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_INVALID_INPUT" });
    }

    await expect(captureError(() => exportSpriteBoyPackage(
      {} as StudioProjectV1,
      packageSource(),
    ))).resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_PROJECT_INVALID" });

    const nonBlobSource = {
      getBlob: vi.fn(async () => ({ bytes: "not-a-blob" }) as unknown as Promise<Blob>),
    };
    await expect(captureError(() => exportSpriteBoyPackage(packageProject(), nonBlobSource)))
      .resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_INTEGRITY_MISMATCH" });

    await expect(captureError(() => importSpriteBoyPackage({} as Blob)))
      .resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_INVALID_INPUT" });
  });

  it("rejects every malformed manifest shape before project persistence", async () => {
    const portable = await exportSpriteBoyPackage(packageProject(), packageSource());
    const mutations: Array<(manifest: Record<string, unknown>) => void> = [
      (manifest) => { manifest.extra = true; },
      (manifest) => { manifest.project = null; },
      (manifest) => { (manifest.project as Record<string, unknown>).sha256 = ""; },
      (manifest) => { (manifest.project as Record<string, unknown>).path = "other.json"; },
      (manifest) => { manifest.blobs = {}; },
      (manifest) => { (manifest.blobs as unknown[])[0] = null; },
      (manifest) => { (manifest.blobs as Array<Record<string, unknown>>)[0].contentHash = "bad"; },
      (manifest) => { (manifest.blobs as Array<Record<string, unknown>>)[0].assetIds = []; },
      (manifest) => {
        (manifest.blobs as Array<Record<string, unknown>>)[0].assetIds = ["beta", "alpha"];
      },
      (manifest) => { (manifest.blobs as Array<Record<string, unknown>>)[0].byteSize = -1; },
    ];

    for (const mutate of mutations) {
      const malformed = await repackManifest(portable, mutate);
      await expect(captureError(() => importSpriteBoyPackage(malformed)))
        .resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_MANIFEST_INVALID" });
    }

    const nullManifest = await repack(portable, (zip) => {
      zip.file("manifest.json", "null");
    });
    await expect(captureError(() => importSpriteBoyPackage(nullManifest)))
      .resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_MANIFEST_INVALID" });
  });

  it("preflights malformed physical ZIP structures before inflation", async () => {
    const portable = await exportSpriteBoyPackage(packageProject(), packageSource());
    const malformedArchives: Blob[] = [
      new Blob([new Uint8Array(8)], { type: SPRITEBOY_PACKAGE_MIME }),
      await patchPhysicalArchive(portable, ({ view, endOffset }) => {
        view.setUint32(endOffset, 0, true);
      }),
      await patchPhysicalArchive(portable, ({ view, endOffset }) => {
        view.setUint16(endOffset + 4, 1, true);
      }),
      await patchPhysicalArchive(portable, ({ view, centralOffset }) => {
        view.setUint32(centralOffset, 0, true);
      }),
      await patchPhysicalArchive(portable, ({ view, centralOffset }) => {
        view.setUint16(centralOffset + 8, 1, true);
      }),
      await patchPhysicalArchive(portable, ({ bytes, centralOffset }) => {
        bytes[centralOffset + 46] = 0x80;
      }),
      await patchPhysicalArchive(portable, ({ view, localOffset }) => {
        view.setUint32(localOffset, 0, true);
      }),
      await patchPhysicalArchive(portable, ({ bytes, view, localOffset }) => {
        const nameLength = view.getUint16(localOffset + 26, true);
        bytes[localOffset + 30 + nameLength - 1] ^= 1;
      }),
    ];

    for (const malformed of malformedArchives) {
      await expect(captureError(() => importSpriteBoyPackage(malformed)))
        .resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_INVALID_ARCHIVE" });
    }
  });

  it("reports malformed content and lower-level ZIP generation failures", async () => {
    const portable = await exportSpriteBoyPackage(packageProject(), packageSource());
    const missingManifest = await repack(portable, (zip) => {
      zip.remove("manifest.json");
    });
    await expect(captureError(() => importSpriteBoyPackage(missingManifest)))
      .resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_ASSET_MISSING" });

    const invalidUtf8 = await repack(portable, (zip) => {
      zip.file("manifest.json", new Uint8Array([0xff, 0xfe]), { binary: true });
    });
    await expect(captureError(() => importSpriteBoyPackage(invalidUtf8)))
      .resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_INVALID_ARCHIVE" });

    const invalidJson = await repack(portable, (zip) => {
      zip.file("manifest.json", "{");
    });
    await expect(captureError(() => importSpriteBoyPackage(invalidJson)))
      .resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_MANIFEST_INVALID" });

    const invalidProjectText = "{}";
    const invalidProject = await repackManifest(portable, async (manifest, zip) => {
      const project = manifest.project as Record<string, unknown>;
      project.byteSize = invalidProjectText.length;
      project.sha256 = await sha256(invalidProjectText);
      zip.file("project.json", invalidProjectText);
    });
    await expect(captureError(() => importSpriteBoyPackage(invalidProject)))
      .resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_PROJECT_INVALID" });

    const wrongBlobSize = await repack(portable, (zip) => {
      zip.file(`assets/${ALPHA_HASH}.png`, "alpha!", { createFolders: false });
    });
    await expect(captureError(() => importSpriteBoyPackage(wrongBlobSize)))
      .resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_INTEGRITY_MISMATCH" });

    const excessiveManifestClaim = await repackManifest(portable, (manifest) => {
      (manifest.blobs as Array<Record<string, unknown>>)[0].byteSize = 100_000;
    });
    await expect(captureError(() => importSpriteBoyPackage(excessiveManifestClaim, {
      maxUncompressedBytes: 10_000,
    }))).resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_LIMIT_EXCEEDED" });

    const generate = vi.spyOn(JSZip.prototype, "generateAsync")
      .mockRejectedValueOnce(new Error("fixture generation failed"));
    try {
      await expect(captureError(() => exportSpriteBoyPackage(packageProject(), packageSource())))
        .resolves.toMatchObject({ code: "SPRITEBOY_PACKAGE_INVALID_ARCHIVE" });
    } finally {
      generate.mockRestore();
    }
  });
});
