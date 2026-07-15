import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createStudioCommandRegistry,
  resolveStudioWorkspaceState,
  type StudioCommandContext,
  type StudioCommandHandlers,
} from "../../core/studio";
import { StudioWorkspaceStateView } from "../../components/studio";

const readyContext: StudioCommandContext = {
  projectAvailable: true,
  busy: false,
  canUndo: false,
  canRedo: false,
  canvasAvailable: false,
};

function createRegistry() {
  const handlers: StudioCommandHandlers = {
    newProject: vi.fn(),
    openProject: vi.fn(),
    saveProject: vi.fn(),
    importAsset: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    openWorkspace: vi.fn(),
    resetCanvas: vi.fn(),
    openCommandPalette: vi.fn(),
    openPreferences: vi.fn(),
    openHelp: vi.fn(),
  };
  return { registry: createStudioCommandRegistry(handlers), handlers };
}

const noInputs = {
  sourceAvailable: false,
  compositionAvailable: false,
  frameCount: 0,
  animationCount: 0,
};

describe("StudioWorkspaceStateView", () => {
  it("renders the Collision resolution path and executes canonical IDs", () => {
    const { registry } = createRegistry();
    const onExecute = vi.fn();
    const state = resolveStudioWorkspaceState({ workspaceId: "collision", availability: noInputs });
    if (state.kind === "ready") throw new Error("Expected an empty state.");

    render(
      <StudioWorkspaceStateView
        state={state}
        registry={registry}
        commandContext={readyContext}
        onExecute={onExecute}
      />,
    );

    expect(screen.getByRole("heading", { name: "Create frames before hitboxes" })).toBeInTheDocument();
    expect(screen.getByText(/attach to sliced frames/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Go to Slice/i }));
    fireEvent.click(screen.getByRole("button", { name: /Import source art/i }));
    expect(onExecute.mock.calls.map(([commandId]) => commandId)).toEqual([
      "workspace.open.slice",
      "asset.import",
    ]);
  });

  it("exposes disabled resolution reasons without dispatching", () => {
    const { registry } = createRegistry();
    const onExecute = vi.fn();
    const state = resolveStudioWorkspaceState({ workspaceId: "slice", availability: noInputs });
    if (state.kind === "ready") throw new Error("Expected an empty state.");
    render(
      <StudioWorkspaceStateView
        state={state}
        registry={registry}
        commandContext={{ ...readyContext, busy: true }}
        onExecute={onExecute}
      />,
    );
    const action = screen.getByRole("button", { name: /Import source art/i });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute("title", "Wait for the current operation to finish.");
    fireEvent.click(action);
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("announces loading without exposing resolution buttons", () => {
    const { registry } = createRegistry();
    const state = resolveStudioWorkspaceState({
      workspaceId: "animate",
      availability: noInputs,
      loading: true,
      loadingMessage: "Preparing frames",
    });
    if (state.kind === "ready") throw new Error("Expected a loading state.");
    render(
      <StudioWorkspaceStateView
        state={state}
        registry={registry}
        commandContext={readyContext}
        onExecute={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Preparing frames")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("announces errors and exposes retry plus dismiss", () => {
    const { registry } = createRegistry();
    const onExecute = vi.fn();
    const onDismissError = vi.fn();
    const state = resolveStudioWorkspaceState({
      workspaceId: "export",
      availability: noInputs,
      failure: { message: "Artifact writer failed", retryCommandId: "project.save" },
    });
    if (state.kind === "ready") throw new Error("Expected an error state.");
    render(
      <StudioWorkspaceStateView
        state={state}
        registry={registry}
        commandContext={readyContext}
        onExecute={onExecute}
        onDismissError={onDismissError}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Artifact writer failed");
    fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onExecute).toHaveBeenCalledWith("project.save");
    expect(onDismissError).toHaveBeenCalledOnce();
  });
});
