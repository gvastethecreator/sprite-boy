import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetRepository } from "../../core/assets";
import { createEmptyStudioProject } from "../../core/project";
import type { JobSnapshot } from "../../core/processing";
import type { LocalModelId, LocalModelServiceSummary } from "../../core/models";
import { createProjectStore } from "../../core/stores";
import { LocalModelPanel } from "../../features/slice/backgroundRemoval/LocalModelPanel";

const bridgeState = vi.hoisted(() => ({ current: null as unknown }));
const jobRunnerState = vi.hoisted(() => ({ current: { run: vi.fn() } as unknown }));
const runBackgroundRemovalMock = vi.hoisted(() => vi.fn());
vi.mock("../../features/control/StudioControlBridgeProvider", () => ({
  useStudioControlBridge: () => bridgeState.current,
}));
vi.mock("../../contexts/StudioStoreContext", () => ({
  useStudioJobRunner: () => jobRunnerState.current,
}));
vi.mock("../../features/slice/backgroundRemoval/runBackgroundRemoval", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../features/slice/backgroundRemoval/runBackgroundRemoval")>(),
  runBackgroundRemoval: runBackgroundRemovalMock,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  runBackgroundRemovalMock.mockReset();
});

function renderPanel(options: { source?: boolean; strict?: boolean } = {}) {
  const project = createEmptyStudioProject({
    id: "model-panel-project",
    name: "Model panel project",
    now: "2026-07-26T10:00:00.000Z",
  });
  if (options.source) {
    project.assets["source-image"] = {
      id: "source-image",
      name: "hero.png",
      blobKey: "blob-source-image",
      contentHash: "sha256:source-image",
      mimeType: "image/png",
      width: 8,
      height: 6,
      byteSize: 16,
      createdAt: "2026-07-26T10:00:00.000Z",
      updatedAt: "2026-07-26T10:00:00.000Z",
      provenance: { source: "fixture" },
      media: { type: "image" },
    };
    project.rootOrder.assetIds.push("source-image");
    project.workspace.selectedAssetId = "source-image";
  }
  const store = createProjectStore(project, {
    context: { nextId: () => "unused", now: () => "2026-07-26T10:00:00.000Z" },
  });
  const assets = {
    projectId: project.id,
    put: vi.fn(),
    getMetadata: vi.fn(),
    getBlob: vi.fn(async () => new Blob(["source"], { type: "image/png" })),
    list: vi.fn(),
    verify: vi.fn(),
    scanIntegrity: vi.fn(),
    remove: vi.fn(),
    exportMany: vi.fn(),
    createRuntimeUrl: vi.fn(),
    releaseRuntimeUrl: vi.fn(),
    releaseOwner: vi.fn(),
    dispose: vi.fn(),
  } as unknown as AssetRepository;
  const panel = <LocalModelPanel assets={assets} store={store} />;
  return render(options.strict ? <StrictMode>{panel}</StrictMode> : panel);
}

function summary(
  id: LocalModelId,
  state: LocalModelServiceSummary["status"]["state"],
): LocalModelServiceSummary {
  const ben2 = id === "ben2-base";
  const rmbg = id === "rmbg-2.0";
  return {
    id,
    label: ben2 ? "BEN2 Base" : rmbg ? "RMBG 2.0" : "BiRefNet Lite 512",
    repositoryId: ben2 ? "PramaLLC/BEN2" : rmbg ? "briaai/RMBG-2.0" : "studioludens/birefnet-lite-512",
    revision: "a".repeat(40),
    gated: rmbg,
    license: {
      id: rmbg ? "bria-rmbg-2.0" : "MIT",
      name: rmbg ? "CC BY-NC 4.0 for non-commercial use" : "MIT License",
      use: rmbg ? "non-commercial" : "permissive",
      url: "https://huggingface.co/model",
      acceptanceUrl: rmbg ? "https://huggingface.co/model" : null,
    },
    runtime: {
      inputWidth: ben2 || rmbg ? 1024 : 512,
      inputHeight: ben2 || rmbg ? 1024 : 512,
      dtype: ben2 ? "fp32" : rmbg ? "q4f16" : "fp16",
      preferredBackends: ben2 ? ["webgpu", "wasm"] : rmbg ? ["webgpu"] : ["webgpu", "wasm"],
      minimumMemoryBytes: ben2 ? 4_831_838_208 : 1_073_741_824,
      inputNormalization: ben2 ? "zero-one" : "imagenet",
      outputNormalization: ben2 ? "min-max" : "sigmoid",
      outputType: ben2 ? "float16" : "float32",
      inputName: ben2 ? "input.1" : rmbg ? null : "input_image",
      outputName: ben2 ? "17728" : rmbg ? null : "output_image",
    },
    status: {
      state,
      verifiedBytes: state === "ready" ? 98_484_532 : 0,
      totalBytes: ben2 ? 222_932_053 : rmbg ? 233_816_089 : 98_485_002,
      problems: state === "license-required" ? ["license-required"] : [],
    },
    capacity: {
      state: "warning",
      canInstall: true,
      requiredStorageBytes: 165_593_866,
      requiredMemoryBytes: 1_073_741_824,
      problems: ["capacity-partial"],
    },
    job: null,
  };
}

function runningJob(): JobSnapshot {
  const at = "2026-07-26T10:00:00.000Z";
  return {
    id: "model-job",
    requestId: "model-job-request",
    kind: "model.setup",
    label: "Prepare BiRefNet Lite 512",
    status: "running",
    attempt: 1,
    rootJobId: "model-job",
    previousJobId: null,
    createdAt: at,
    updatedAt: at,
    startedAt: at,
    finishedAt: null,
    timeoutMs: 60_000,
    progress: { ratio: 0.5, phase: "download", message: "Downloading weights" },
    error: null,
  };
}

describe("LocalModelPanel", () => {
  it("shows the bridge preflight without asking for a token in Slice", () => {
    bridgeState.current = {
      snapshot: { status: "idle", message: "Disconnected", clientId: null, activeOperations: 0 },
      models: null,
    };
    renderPanel();
    expect(screen.getByText(/Connect the local bridge/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/token/i)).not.toBeInTheDocument();
  });

  it("shows verified readiness and keeps gated RMBG setup disabled", async () => {
    const list = vi.fn(async () => ({
      version: 1 as const,
      models: [summary("birefnet-lite-512", "ready"), summary("rmbg-2.0", "license-required")],
    }));
    bridgeState.current = {
      snapshot: { status: "connected", message: "Connected", clientId: "client", activeOperations: 0 },
      models: { list },
    };
    renderPanel();
    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Ready" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Local model"), { target: { value: "rmbg-2.0" } });
    await waitFor(() => expect(screen.getByText("license-required", { selector: "[data-model-state]" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Prepare model" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Review exact license" })).toHaveAttribute("href", "https://huggingface.co/model");
  });

  it("starts a setup job and exposes progress and cancellation", async () => {
    const job = runningJob();
    const setup = vi.fn(async () => ({
      version: 1 as const,
      modelId: "birefnet-lite-512" as const,
      outcome: "started" as const,
      job,
    }));
    const cancelJob = vi.fn(async () => ({ ...job, status: "cancelled" as const, finishedAt: job.updatedAt, error: { code: "cancelled" as const, message: "Cancelled", retryable: true } }));
    bridgeState.current = {
      snapshot: { status: "connected", message: "Connected", clientId: "client", activeOperations: 0 },
      models: {
        list: vi.fn(async () => ({ version: 1 as const, models: [summary("birefnet-lite-512", "absent")] })),
        setup,
        cancelJob,
        getJob: vi.fn(() => new Promise(() => undefined)),
      },
    };
    renderPanel();
    await waitFor(() => expect(screen.getByRole("button", { name: "Prepare model" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Prepare model" }));
    await waitFor(() => expect(screen.getByText("50%")).toBeInTheDocument());
    expect(setup).toHaveBeenCalledWith("birefnet-lite-512");
    fireEvent.click(screen.getByRole("button", { name: "Cancel setup" }));
    await waitFor(() => expect(cancelJob).toHaveBeenCalledWith("model-job"));
  });

  it("keeps inference progress live after the StrictMode effect probe", async () => {
    if (typeof globalThis.OffscreenCanvas !== "function") {
      vi.stubGlobal("OffscreenCanvas", class OffscreenCanvas {});
    }
    if (typeof globalThis.createImageBitmap !== "function") {
      vi.stubGlobal("createImageBitmap", vi.fn());
    }
    bridgeState.current = {
      snapshot: { status: "connected", message: "Connected", clientId: "client", activeOperations: 0 },
      models: {
        list: vi.fn(async () => ({ version: 1 as const, models: [summary("birefnet-lite-512", "ready")] })),
        getWeights: vi.fn(async () => new ArrayBuffer(16)),
      },
    };
    runBackgroundRemovalMock.mockImplementation(async (options: { onProgress?: (event: unknown) => void }) => {
      options.onProgress?.({
        type: "progress",
        requestId: "request",
        phase: "decode",
        ratio: 0.05,
        message: "Decoding source image",
      });
      return new Promise(() => undefined);
    });
    jobRunnerState.current = {
      run: vi.fn((job, task) => {
        const controller = new AbortController();
        const result = Promise.resolve(task({
          requestId: job.requestId,
          signal: controller.signal,
          reportProgress: () => true,
        }));
        return {
          jobId: job.id,
          requestId: job.requestId,
          result,
          cancel: () => {
            controller.abort();
            return true;
          },
        };
      }),
    };

    renderPanel({ source: true, strict: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove background" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Remove background" }));
    await waitFor(() => expect(screen.getByText("Decoding source image")).toBeInTheDocument());
    expect(screen.getByRole("progressbar", { name: "Background removal progress" })).toHaveAttribute("aria-valuenow", "19");
  });

  it("offers BEN2 as an optional runner while keeping BiRefNet selected by default", async () => {
    vi.stubGlobal("navigator", { gpu: {} });
    if (typeof globalThis.OffscreenCanvas !== "function") {
      vi.stubGlobal("OffscreenCanvas", class OffscreenCanvas {});
    }
    if (typeof globalThis.createImageBitmap !== "function") {
      vi.stubGlobal("createImageBitmap", vi.fn());
    }
    const getWeights = vi.fn(async () => new ArrayBuffer(16));
    bridgeState.current = {
      snapshot: { status: "connected", message: "Connected", clientId: "client", activeOperations: 0 },
      models: {
        list: vi.fn(async () => ({
          version: 1 as const,
          models: [summary("birefnet-lite-512", "ready"), summary("ben2-base", "ready")],
        })),
        getWeights,
      },
    };
    runBackgroundRemovalMock.mockImplementation(() => new Promise(() => undefined));
    jobRunnerState.current = {
      run: vi.fn((job, task) => {
        const controller = new AbortController();
        return {
          jobId: job.id,
          requestId: job.requestId,
          result: Promise.resolve(task({
            requestId: job.requestId,
            signal: controller.signal,
            reportProgress: () => true,
          })),
          cancel: () => {
            controller.abort();
            return true;
          },
        };
      }),
    };

    renderPanel({ source: true });
    await waitFor(() => expect(screen.getByLabelText("Local model")).toHaveValue("birefnet-lite-512"));
    fireEvent.change(screen.getByLabelText("Local model"), { target: { value: "ben2-base" } });
    await waitFor(() => expect(screen.getByText(/1024 WebGPU model.*BiRefNet Lite remains the default/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Remove background" }));
    await waitFor(() => expect(getWeights).toHaveBeenCalledWith("ben2-base", expect.any(AbortSignal)));
    expect(runBackgroundRemovalMock).toHaveBeenCalledWith(expect.objectContaining({ modelId: "ben2-base" }));
  });

  it("keeps BEN2 inference disabled when WebGPU is unavailable", async () => {
    if (typeof globalThis.OffscreenCanvas !== "function") {
      vi.stubGlobal("OffscreenCanvas", class OffscreenCanvas {});
    }
    if (typeof globalThis.createImageBitmap !== "function") {
      vi.stubGlobal("createImageBitmap", vi.fn());
    }
    bridgeState.current = {
      snapshot: { status: "connected", message: "Connected", clientId: "client", activeOperations: 0 },
      models: {
        list: vi.fn(async () => ({
          version: 1 as const,
          models: [summary("birefnet-lite-512", "ready"), summary("ben2-base", "ready")],
        })),
      },
    };

    renderPanel({ source: true });
    await waitFor(() => expect(screen.getByLabelText("Local model")).toHaveValue("birefnet-lite-512"));
    fireEvent.change(screen.getByLabelText("Local model"), { target: { value: "ben2-base" } });
    await waitFor(() => expect(screen.getByText(/cannot run the verified local model/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Remove background" })).toBeDisabled();
  });

  it("keeps inference disabled when local capacity blocks the runtime", async () => {
    const blocked = {
      ...summary("birefnet-lite-512", "ready"),
      capacity: {
        state: "blocked" as const,
        canInstall: false,
        requiredStorageBytes: 165_593_866,
        requiredMemoryBytes: 1_073_741_824,
        problems: ["memory-insufficient"],
      },
    };
    bridgeState.current = {
      snapshot: { status: "connected", message: "Connected", clientId: "client", activeOperations: 0 },
      models: { list: vi.fn(async () => ({ version: 1 as const, models: [blocked] })) },
    };
    renderPanel({ source: true });
    await waitFor(() => expect(screen.getByText(/cannot run the verified local model/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Remove background" })).toBeDisabled();
  });
});
