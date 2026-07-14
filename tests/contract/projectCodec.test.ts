import { describe, expect, it } from "vitest";
import {
  ProjectCodec,
  ProjectCodecError,
  isProjectCodecError,
  projectCodec,
} from "../../core/persistence";
import {
  createEmptyStudioProject,
  validateStudioProject,
} from "../../core/project";
import type { AssetRecord, StudioProjectV1 } from "../../core/project";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

function cloneFixture(): StudioProjectV1 {
  return structuredClone(studioProjectV1Fixture);
}

async function captureError(work: () => unknown): Promise<ProjectCodecError> {
  try {
    await work();
  } catch (error) {
    expect(isProjectCodecError(error)).toBe(true);
    return error as ProjectCodecError;
  }
  throw new Error("Expected ProjectCodecError.");
}

describe("ProjectCodec V1 (F3-01)", () => {
  it("round-trips representative V1 exactly with stable re-encoding", () => {
    const encoded = projectCodec.encode(cloneFixture());
    const decoded = projectCodec.decode(encoded);

    expect(decoded).toEqual(studioProjectV1Fixture);
    expect(validateStudioProject(decoded)).toMatchObject({ valid: true, diagnostics: [] });
    expect(projectCodec.encode(decoded)).toBe(encoded);
    expect(encoded).not.toContain("blob:");
  });

  it("round-trips an empty project and advertises only the explicit V1 decoder", () => {
    const codec = new ProjectCodec();
    const project = createEmptyStudioProject({
      id: "project-codec-empty",
      name: "Codec empty",
      now: "2026-07-14T00:00:00.000Z",
    });
    expect(codec.supportedVersions).toEqual([1]);
    expect(Object.isFrozen(codec.supportedVersions)).toBe(true);
    expect(codec.decode(codec.encode(project))).toEqual(project);
  });

  it("emits deterministic JSON independent of object insertion order", () => {
    const canonical = cloneFixture();
    const reordered = Object.fromEntries(
      Object.entries(cloneFixture()).reverse(),
    ) as unknown as StudioProjectV1;
    reordered.assets = Object.fromEntries(Object.entries(reordered.assets).reverse());
    reordered.layers = Object.fromEntries(Object.entries(reordered.layers).reverse());
    reordered.cels = Object.fromEntries(Object.entries(reordered.cels).reverse());

    expect(projectCodec.encode(reordered)).toBe(projectCodec.encode(canonical));
  });

  it("dispatches future versions before V1 validation", async () => {
    const future = { ...cloneFixture(), schemaVersion: 99 };
    const error = await captureError(() => projectCodec.decode(JSON.stringify(future)));

    expect(error).toMatchObject({
      code: "PROJECT_CODEC_UNSUPPORTED_VERSION",
      operation: "decode",
      schemaVersion: 99,
    });
    expect(error.projectDiagnostics).toEqual([]);
  });

  it("types malformed JSON and keeps the parser cause out of diagnostics", async () => {
    const error = await captureError(() => projectCodec.decode('{"schemaVersion":1'));

    expect(error).toMatchObject({
      code: "PROJECT_CODEC_INVALID_JSON",
      operation: "decode",
    });
    expect(error.cause).toBeInstanceOf(SyntaxError);
    expect(error.toDiagnostic()).toEqual({
      code: "PROJECT_CODEC_INVALID_JSON",
      operation: "decode",
      message: "Studio project JSON could not be parsed.",
      projectDiagnostics: [],
    });
    expect(JSON.stringify(error.toDiagnostic())).not.toContain("cause");
  });

  it("rejects non-string, missing and malformed version inputs", async () => {
    await expect(captureError(() => projectCodec.decode(null as unknown as string)))
      .resolves.toMatchObject({ code: "PROJECT_CODEC_INVALID_INPUT" });
    await expect(captureError(() => projectCodec.decode("null")))
      .resolves.toMatchObject({ code: "PROJECT_CODEC_INVALID_DOCUMENT" });
    await expect(captureError(() => projectCodec.decode("[]")))
      .resolves.toMatchObject({ code: "PROJECT_CODEC_INVALID_DOCUMENT" });
    await expect(captureError(() => projectCodec.decode('{"schemaVersion":"1"}')))
      .resolves.toMatchObject({ code: "PROJECT_CODEC_INVALID_DOCUMENT" });
    await expect(captureError(() => projectCodec.decode('{"schemaVersion":1.5}')))
      .resolves.toMatchObject({ code: "PROJECT_CODEC_INVALID_DOCUMENT" });
    await expect(captureError(() => projectCodec.decode('{"schemaVersion":0}')))
      .resolves.toMatchObject({ code: "PROJECT_CODEC_INVALID_DOCUMENT" });
  });

  it("returns stable V1 validation diagnostics for malformed documents", async () => {
    const malformed = cloneFixture();
    malformed.regions["region-hero"].assetId = "asset-missing";
    const error = await captureError(() => projectCodec.decode(JSON.stringify(malformed)));

    expect(error.code).toBe("PROJECT_CODEC_INVALID_DOCUMENT");
    expect(error.projectDiagnostics).toContainEqual(expect.objectContaining({
      code: "MISSING_REFERENCE",
      path: "$.regions.region-hero.assetId",
    }));
    expect(Object.isFrozen(error.projectDiagnostics)).toBe(true);
  });

  it("rejects negative zero because JSON cannot round-trip it exactly", async () => {
    const project = cloneFixture();
    project.regions["region-hero"].bounds.x = -0;
    const error = await captureError(() => projectCodec.encode(project));

    expect(error.code).toBe("PROJECT_CODEC_INVALID_DOCUMENT");
    expect(error.projectDiagnostics).toContainEqual(expect.objectContaining({
      code: "INVALID_NUMBER",
      path: "$.regions.region-hero.bounds.x",
    }));
  });

  it("does not invoke accessors or toJSON while rejecting hostile encode input", async () => {
    const project = cloneFixture();
    let nameReads = 0;
    let toJsonReads = 0;
    Object.defineProperty(project, "name", {
      enumerable: true,
      get() {
        nameReads += 1;
        return "hostile";
      },
    });
    Object.defineProperty(project, "toJSON", {
      enumerable: true,
      get() {
        toJsonReads += 1;
        return () => ({ schemaVersion: 1 });
      },
    });
    const error = await captureError(() => projectCodec.encode(project));

    expect(error.code).toBe("PROJECT_CODEC_INVALID_DOCUMENT");
    expect(nameReads).toBe(0);
    expect(toJsonReads).toBe(0);
  });

  it("contains cyclic documents as typed validation errors", async () => {
    const project = cloneFixture() as StudioProjectV1 & { cycle?: unknown };
    project.cycle = project;
    const error = await captureError(() => projectCodec.encode(project));

    expect(error.code).toBe("PROJECT_CODEC_INVALID_DOCUMENT");
    expect(error.projectDiagnostics).toContainEqual(expect.objectContaining({
      code: "NON_JSON_VALUE",
      path: "$.cycle",
    }));
  });

  it("contains revoked Proxies behind the typed codec boundary", async () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const error = await captureError(() => projectCodec.encode(
      revoked.proxy as StudioProjectV1,
    ));

    expect(error).toMatchObject({
      code: "PROJECT_CODEC_INVALID_DOCUMENT",
      operation: "encode",
    });
    expect(error.toDiagnostic()).toEqual({
      code: "PROJECT_CODEC_INVALID_DOCUMENT",
      operation: "encode",
      message: "Studio project document is invalid for encode.",
      projectDiagnostics: [{
        code: "INVALID_DOCUMENT",
        path: "$",
        message: "The input could not be inspected as a StudioProjectV1 document.",
      }],
    });
    expect(JSON.stringify(error.toDiagnostic())).not.toContain("cause");
  });

  it("preserves an own __proto__ entity ID without prototype pollution", () => {
    const project = createEmptyStudioProject({
      id: "project-prototype-key",
      name: "Prototype key",
      now: "2026-07-14T00:00:00.000Z",
    });
    const asset: AssetRecord = {
      id: "__proto__",
      name: "Safe key",
      blobKey: `sha256:${"a".repeat(64)}`,
      contentHash: "a".repeat(64),
      mimeType: "image/png",
      width: 1,
      height: 1,
      byteSize: 1,
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
      provenance: { source: "fixture" },
    };
    Object.defineProperty(project.assets, "__proto__", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: asset,
    });
    project.rootOrder.assetIds.push("__proto__");

    const decoded = projectCodec.decode(projectCodec.encode(project));

    expect(Object.prototype.hasOwnProperty.call(decoded.assets, "__proto__")).toBe(true);
    expect(decoded.assets["__proto__"]).toEqual(asset);
    expect(Object.getPrototypeOf(decoded.assets)).toBe(Object.prototype);
    expect((Object.prototype as { polluted?: unknown }).polluted).toBeUndefined();
  });
});
