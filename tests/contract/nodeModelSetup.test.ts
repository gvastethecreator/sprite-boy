// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  modelCatalogFingerprint,
  type LocalModelDefinition,
} from "../../core/models/modelCatalog";
import { createNodeModelSetupPort } from "../../core/models/nodeModelSetup";
import {
  MODEL_DOWNLOAD_MARKER,
  MODEL_ERROR_MARKER,
  MODEL_INSTALL_MANIFEST,
} from "../../core/models/nodeModelInventory";

const temporaryDirectories: string[] = [];
const bytes = new TextEncoder().encode("abc");
const digest = createHash("sha256").update(bytes).digest("hex");
const tinyModel: LocalModelDefinition = Object.freeze({
  schemaVersion: 1,
  id: "birefnet-lite-512",
  label: "Tiny test model",
  repositoryId: "local/tiny",
  revision: "a".repeat(40),
  gated: false,
  license: { id: "MIT", name: "MIT", use: "permissive" as const, url: "https://example.test", acceptanceUrl: null },
  runtime: {
    task: "image-segmentation" as const,
    dtype: "fp16" as const,
    inputWidth: 1,
    inputHeight: 1,
    preferredBackends: ["wasm" as const],
    minimumMemoryBytes: 1,
    inputNormalization: "imagenet" as const,
    outputNormalization: "sigmoid" as const,
    outputType: "float32" as const,
    inputName: "input_image" as const,
    outputName: "output_image" as const,
  },
  files: [{
    path: "onnx/model_fp16.onnx",
    byteSize: bytes.byteLength,
    digest: { algorithm: "sha256" as const, value: digest },
    downloadUrl: "https://example.test/model",
  }],
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sprite-boy-model-setup-"));
  temporaryDirectories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function smoke() {
  return {
    run: vi.fn(async () => smokeEvidence()),
  };
}

function smokeEvidence() {
  return {
    status: "passed" as const,
    catalogFingerprint: modelCatalogFingerprint(tinyModel),
    backend: "wasm" as const,
    completedAt: "2026-07-25T23:01:00.000Z",
    outputSha256: `sha256:${"b".repeat(64)}`,
    peakMemoryBytes: 128_000_000,
  };
}

function fixedNow() {
  return new Date("2026-07-25T23:00:00.000Z");
}

describe("node model setup adapter (M1-02)", () => {
  it("resumes a partial file, verifies it and commits the manifest after smoke", async () => {
    const root = await temporaryRoot();
    const modelRoot = join(root, tinyModel.id, "onnx");
    await mkdir(modelRoot, { recursive: true });
    await writeFile(join(modelRoot, "model_fp16.onnx.part"), bytes.subarray(0, 1));
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("range")).toBe("bytes=1-");
      return new Response(bytes.subarray(1), {
        status: 206,
        headers: { "content-range": "bytes 1-2/3" },
      });
    });
    const smokeRunner = smoke();
    const progress: number[] = [];
    const port = createNodeModelSetupPort({
      root,
      fetch: fetchMock as typeof fetch,
      now: fixedNow,
      smoke: smokeRunner,
      resolveModel: () => tinyModel,
    });

    const manifest = await port.install({
      modelId: tinyModel.id,
      requestId: "request-1",
      signal: new AbortController().signal,
      onProgress: ({ ratio }) => progress.push(ratio),
    });

    expect(await readFile(join(modelRoot, "model_fp16.onnx"), "utf8")).toBe("abc");
    await expect(stat(join(root, tinyModel.id, MODEL_DOWNLOAD_MARKER))).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(join(root, tinyModel.id, MODEL_INSTALL_MANIFEST), "utf8"))).toEqual(manifest);
    expect(manifest.smoke?.status).toBe("passed");
    expect(smokeRunner.run).toHaveBeenCalledOnce();
    expect(progress.at(-1)).toBe(1);
  });

  it("restarts from byte zero when a server ignores the requested range", async () => {
    const root = await temporaryRoot();
    const modelRoot = join(root, tinyModel.id, "onnx");
    await mkdir(modelRoot, { recursive: true });
    await writeFile(join(modelRoot, "model_fp16.onnx.part"), bytes.subarray(0, 1));
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("range")).toBe("bytes=1-");
      return new Response(bytes, { status: 200 });
    });
    const port = createNodeModelSetupPort({
      root,
      fetch: fetchMock as typeof fetch,
      now: fixedNow,
      smoke: smoke(),
      resolveModel: () => tinyModel,
    });

    await expect(
      port.install({
        modelId: tinyModel.id,
        requestId: "request-range-reset",
        signal: new AbortController().signal,
        onProgress: () => undefined,
      }),
    ).resolves.toMatchObject({ smoke: { status: "passed" } });
    expect(await readFile(join(modelRoot, "model_fp16.onnx"), "utf8")).toBe("abc");
  });

  it("drops a corrupt partial and records a bounded error", async () => {
    const root = await temporaryRoot();
    const fetchMock = vi.fn(async () => new Response(new TextEncoder().encode("bad")));
    const port = createNodeModelSetupPort({
      root,
      fetch: fetchMock as typeof fetch,
      now: fixedNow,
      smoke: smoke(),
      resolveModel: () => tinyModel,
    });

    await expect(port.install({
      modelId: tinyModel.id,
      requestId: "request-2",
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })).rejects.toMatchObject({ code: "verification-failed" });

    const modelRoot = join(root, tinyModel.id);
    await expect(stat(join(modelRoot, "onnx", "model_fp16.onnx.part"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(modelRoot, MODEL_DOWNLOAD_MARKER))).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(join(modelRoot, MODEL_ERROR_MARKER), "utf8"))).toMatchObject({
      code: "verification-failed",
      modelId: tinyModel.id,
    });
  });

  it("keeps a resumable partial when the response stream fails", async () => {
    const root = await temporaryRoot();
    let readCount = 0;
    const response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => {
            readCount += 1;
            if (readCount === 1) return { done: false as const, value: bytes.subarray(0, 1) };
            throw new Error("socket token=secret");
          },
        }),
      },
    } as unknown as Response;
    const port = createNodeModelSetupPort({
      root,
      fetch: vi.fn(async () => response) as unknown as typeof fetch,
      now: fixedNow,
      smoke: smoke(),
      resolveModel: () => tinyModel,
    });

    await expect(port.install({
      modelId: tinyModel.id,
      requestId: "request-stream",
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })).rejects.toMatchObject({
      code: "download-failed",
      message: "Se cortó la descarga de onnx/model_fp16.onnx.",
    });
    expect((await stat(join(root, tinyModel.id, "onnx", "model_fp16.onnx.part"))).size).toBe(1);
    expect(JSON.parse(await readFile(join(root, tinyModel.id, MODEL_ERROR_MARKER), "utf8"))).toMatchObject({
      code: "download-failed",
    });
  });

  it("rechecks a complete install and runs smoke without network access", async () => {
    const root = await temporaryRoot();
    const onnxRoot = join(root, tinyModel.id, "onnx");
    await mkdir(onnxRoot, { recursive: true });
    await writeFile(join(onnxRoot, "model_fp16.onnx"), bytes);
    const fetchMock = vi.fn(async () => { throw new Error("offline"); });
    const port = createNodeModelSetupPort({
      root,
      fetch: fetchMock as typeof fetch,
      now: fixedNow,
      smoke: smoke(),
      resolveModel: () => tinyModel,
    });

    await expect(port.install({
      modelId: tinyModel.id,
      requestId: "request-offline",
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })).resolves.toMatchObject({ smoke: { status: "passed", backend: "wasm" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks a gated model before download when exact license acceptance is missing", async () => {
    const root = await temporaryRoot();
    const gatedModel: LocalModelDefinition = Object.freeze({
      ...tinyModel,
      gated: true,
      license: {
        id: "restricted-test-license",
        name: "Restricted test license",
        use: "non-commercial" as const,
        url: "https://example.test/license",
        acceptanceUrl: "https://example.test/accept",
      },
    });
    const fetchMock = vi.fn();
    const smokeRunner = smoke();
    const port = createNodeModelSetupPort({
      root,
      fetch: fetchMock as unknown as typeof fetch,
      now: fixedNow,
      smoke: smokeRunner,
      resolveModel: () => gatedModel,
    });

    await expect(
      port.install({
        modelId: gatedModel.id,
        requestId: "request-license",
        signal: new AbortController().signal,
        onProgress: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "license-required", retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(smokeRunner.run).not.toHaveBeenCalled();
  });

  it("keeps the install unverified and records smoke failure for invalid evidence", async () => {
    const root = await temporaryRoot();
    const smokeRunner = {
      run: vi.fn(async () => ({ ...smokeEvidence(), catalogFingerprint: "stale-catalog" })),
    };
    const port = createNodeModelSetupPort({
      root,
      fetch: vi.fn(async () => new Response(bytes)) as unknown as typeof fetch,
      now: fixedNow,
      smoke: smokeRunner,
      resolveModel: () => tinyModel,
    });

    await expect(
      port.install({
        modelId: tinyModel.id,
        requestId: "request-bad-smoke",
        signal: new AbortController().signal,
        onProgress: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "smoke-failed", retryable: true });

    const modelRoot = join(root, tinyModel.id);
    expect(
      JSON.parse(await readFile(join(modelRoot, MODEL_INSTALL_MANIFEST), "utf8")),
    ).toMatchObject({ smoke: null });
    expect(JSON.parse(await readFile(join(modelRoot, MODEL_ERROR_MARKER), "utf8"))).toMatchObject({
      code: "smoke-failed",
    });
  });

  it("maps a thrown smoke error to a bounded retryable failure", async () => {
    const root = await temporaryRoot();
    const smokeRunner = {
      run: vi.fn(async () => {
        throw new Error("private path token=secret");
      }),
    };
    const port = createNodeModelSetupPort({
      root,
      fetch: vi.fn(async () => new Response(bytes)) as unknown as typeof fetch,
      now: fixedNow,
      smoke: smokeRunner,
      resolveModel: () => tinyModel,
    });

    await expect(port.install({
      modelId: tinyModel.id,
      requestId: "request-smoke-throws",
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })).rejects.toMatchObject({
      code: "smoke-failed",
      message: "La prueba local del modelo falló.",
      retryable: true,
    });
    expect(JSON.parse(await readFile(join(root, tinyModel.id, MODEL_ERROR_MARKER), "utf8"))).toMatchObject({
      code: "smoke-failed",
    });
  });

  it("clears the live marker on cancellation and never runs smoke", async () => {
    const root = await temporaryRoot();
    const controller = new AbortController();
    controller.abort(new DOMException("Cancelled", "AbortError"));
    const smokeRunner = smoke();
    const port = createNodeModelSetupPort({
      root,
      fetch: vi.fn() as unknown as typeof fetch,
      now: fixedNow,
      smoke: smokeRunner,
      resolveModel: () => tinyModel,
    });

    await expect(port.install({
      modelId: tinyModel.id,
      requestId: "request-3",
      signal: controller.signal,
      onProgress: () => undefined,
    })).rejects.toMatchObject({ name: "AbortError" });
    await expect(stat(join(root, tinyModel.id, MODEL_DOWNLOAD_MARKER))).rejects.toMatchObject({ code: "ENOENT" });
    expect(smokeRunner.run).not.toHaveBeenCalled();
  });

  it("does not commit a late smoke result after cancellation", async () => {
    const root = await temporaryRoot();
    const onnxRoot = join(root, tinyModel.id, "onnx");
    await mkdir(onnxRoot, { recursive: true });
    await writeFile(join(onnxRoot, "model_fp16.onnx"), bytes);
    let resolveSmoke!: (value: ReturnType<typeof smokeEvidence>) => void;
    const smokePromise = new Promise<ReturnType<typeof smokeEvidence>>((resolvePromise) => {
      resolveSmoke = resolvePromise;
    });
    const smokeRunner = { run: vi.fn(() => smokePromise) };
    const controller = new AbortController();
    const port = createNodeModelSetupPort({
      root,
      fetch: vi.fn() as unknown as typeof fetch,
      now: fixedNow,
      smoke: smokeRunner,
      resolveModel: () => tinyModel,
    });
    const result = port.install({
      modelId: tinyModel.id,
      requestId: "request-late",
      signal: controller.signal,
      onProgress: () => undefined,
    });
    await vi.waitFor(() => expect(smokeRunner.run).toHaveBeenCalledOnce());
    controller.abort(new DOMException("Cancelled", "AbortError"));
    resolveSmoke(smokeEvidence());

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    const manifest = JSON.parse(await readFile(join(root, tinyModel.id, MODEL_INSTALL_MANIFEST), "utf8"));
    expect(manifest.smoke).toBeNull();
  });
});
