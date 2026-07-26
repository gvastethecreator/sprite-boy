import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetRepository } from "../../core/assets";
import { createEmptyStudioProject } from "../../core/project";
import type { JobSnapshot } from "../../core/processing";
import type { LocalModelServiceSummary } from "../../core/models";
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
  id: "birefnet-lite-512" | "rmbg-2.0",
  state: LocalModelServiceSummary["status"]["state"],
): LocalModelServiceSummary {
  return {
    id,
    label: id === "birefnet-lite-512" ? "BiRefNet Lite 512" : "RMBG 2.0",
    repositoryId: id === "birefnet-lite-512" ? "studioludens/birefnet-lite-512" : "briaai/RMBG-2.0",
    revision: "a".repeat(40),
    gated: id === "rmbg-2.0",
    license: {
      id: id === "rmbg-2.0" ? "bria-rmbg-2.0" : "MIT",
      name: id === "rmbg-2.0" ? "CC BY-NC 4.0 for non-commercial use" : "MIT License",
      use: id === "rmbg-2.0" ? "non-commercial" : "permissive",
      url: "https://huggingface.co/model",
      acceptanceUrl: id === "rmbg-2.0" ? "https://huggingface.co/model" : null,
    },
    runtime: {
      inputWidth: id === "rmbg-2.0" ? 1024 : 512,
      inputHeight: id === "rmbg-2.0" ? 1024 : 512,
      dtype: id === "rmbg-2.0" ? "q4f16" : "fp16",
      preferredBackends: id === "rmbg-2.0" ? ["webgpu"] : ["webgpu", "wasm"],
      minimumMemoryBytes: 1_073_741_824,
    },
    status: {
      state,
      verifiedBytes: state === "ready" ? 98_484_532 : 0,
      totalBytes: id === "rmbg-2.0" ? 233_816_089 : 98_485_002,
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
