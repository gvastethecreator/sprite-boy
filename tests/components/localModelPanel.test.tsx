import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JobSnapshot } from "../../core/processing";
import type { LocalModelServiceSummary } from "../../core/models";
import { LocalModelPanel } from "../../features/slice/backgroundRemoval/LocalModelPanel";

const bridgeState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../../features/control/StudioControlBridgeProvider", () => ({
  useStudioControlBridge: () => bridgeState.current,
}));

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
    render(<LocalModelPanel />);
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
    render(<LocalModelPanel />);
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
    render(<LocalModelPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Prepare model" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Prepare model" }));
    await waitFor(() => expect(screen.getByText("50%")).toBeInTheDocument());
    expect(setup).toHaveBeenCalledWith("birefnet-lite-512");
    fireEvent.click(screen.getByRole("button", { name: "Cancel setup" }));
    await waitFor(() => expect(cancelJob).toHaveBeenCalledWith("model-job"));
  });
});
