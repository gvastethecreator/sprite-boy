import { describe, expect, it, vi } from "vitest";

import {
  ModelSetupPortError,
  createModelInstallManifest,
  createModelSetupJobTask,
  getLocalModelDefinition,
} from "../../core/models";

const context = {
  requestId: "request-1",
  signal: new AbortController().signal,
  reportProgress: vi.fn(() => true),
};

describe("model setup job task (M1-02)", () => {
  it("forwards identity, cancellation and monotonic job progress", async () => {
    const model = getLocalModelDefinition("birefnet-lite-512");
    const manifest = createModelInstallManifest(model, {
      installedAt: "2026-07-25T23:00:00.000Z",
      files: model.files.map((file) => ({
        path: file.path,
        byteSize: file.byteSize,
        digest: { ...file.digest },
      })),
    });
    const install = vi.fn(async ({ onProgress }) => {
      onProgress({ ratio: 0.5, phase: "download", message: "Descargando" });
      return manifest;
    });
    const task = createModelSetupJobTask({ modelId: model.id, port: { install } });

    await expect(task(context)).resolves.toEqual(manifest);
    expect(install).toHaveBeenCalledWith(expect.objectContaining({
      modelId: model.id,
      requestId: "request-1",
      signal: context.signal,
    }));
    expect(context.reportProgress).toHaveBeenCalledWith({
      ratio: 0.5,
      phase: "download",
      message: "Descargando",
    });
  });

  it("maps known failures without leaking unknown errors", async () => {
    const expected = createModelSetupJobTask({
      modelId: "birefnet-lite-512",
      port: { install: async () => { throw new ModelSetupPortError("license-required", "Falta licencia.", false); } },
    });
    await expect(expected(context)).rejects.toMatchObject({ code: "invalid-input", retryable: false });

    const unknown = createModelSetupJobTask({
      modelId: "birefnet-lite-512",
      port: { install: async () => { throw new Error("token=secret C:/private"); } },
    });
    await expect(unknown(context)).rejects.toMatchObject({
      code: "runtime-failure",
      message: "No se pudo preparar el modelo local.",
    });
  });
});
