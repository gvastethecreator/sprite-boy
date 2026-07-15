import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInteractionStore,
  createJobStore,
  createPlaybackStore,
  createWorkspaceStore,
} from "../../core/stores";
import {
  StudioLocalStoresProvider,
  type StudioLocalStores,
} from "../../contexts/StudioStoreContext";
import TimelinePanel from "../../components/layout/TimelinePanel";

const { timelineRender } = vi.hoisted(() => ({ timelineRender: vi.fn() }));

vi.mock("../../components/common/Timeline", () => ({
  default: () => {
    timelineRender();
    return <div data-testid="timeline-content" />;
  },
}));

function createStores(): StudioLocalStores {
  return Object.freeze({
    workspace: createWorkspaceStore(),
    interaction: createInteractionStore(),
    jobs: createJobStore(),
    playback: createPlaybackStore(),
  });
}

afterEach(() => {
  timelineRender.mockClear();
  document.body.style.cursor = "";
});

describe("TimelinePanel consumer batch", () => {
  it("stays mounted but leaves layout and accessibility when hidden", () => {
    const stores = createStores();
    render(
      <StudioLocalStoresProvider stores={stores}>
        <TimelinePanel hidden />
      </StudioLocalStoresProvider>,
    );
    expect(screen.getByTestId("timeline-panel")).not.toBeVisible();
    expect(screen.queryByRole("separator", { name: "Resize timeline" })).toBeNull();
  });

  it("releases an active pointer resize when the mounted panel becomes hidden", () => {
    const stores = createStores();
    const view = render(
      <StudioLocalStoresProvider stores={stores}>
        <TimelinePanel />
      </StudioLocalStoresProvider>,
    );
    const separator = screen.getByRole("separator", { name: "Resize timeline" });

    fireEvent.mouseDown(separator, { clientY: 400 });
    expect(document.body.style.cursor).toBe("row-resize");
    view.rerender(
      <StudioLocalStoresProvider stores={stores}>
        <TimelinePanel hidden />
      </StudioLocalStoresProvider>,
    );

    expect(document.body.style.cursor).toBe("");
    expect(screen.queryByRole("separator", { name: "Resize timeline" })).toBeNull();
    fireEvent.mouseMove(window, { clientY: 100 });
    expect(stores.workspace.getSnapshot().panelSizes.timeline).toBeUndefined();
  });

  it("rerenders only for its selected panel size and supports keyboard resize", () => {
    const stores = createStores();
    render(
      <StudioLocalStoresProvider stores={stores}>
        <TimelinePanel />
      </StudioLocalStoresProvider>,
    );
    const separator = screen.getByRole("separator", { name: "Resize timeline" });
    expect(screen.getByTestId("timeline-panel")).toHaveStyle({ height: "220px" });
    expect(timelineRender).toHaveBeenCalledTimes(1);

    act(() => {
      stores.workspace.dispatch({ type: "workspace.setPreference", key: "grid", value: true });
      stores.interaction.dispatch({ type: "interaction.setModal", modalId: "settings" });
    });
    expect(timelineRender).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(separator, { key: "ArrowUp" });
    expect(screen.getByTestId("timeline-panel")).toHaveStyle({ height: "230px" });
    expect(separator).toHaveAttribute("aria-valuenow", "230");
    expect(timelineRender).toHaveBeenCalledTimes(2);

    act(() => {
      stores.workspace.dispatch({ type: "workspace.setPanelSize", panelId: "timeline", size: 900 });
    });
    expect(screen.getByTestId("timeline-panel")).toHaveStyle({ height: "500px" });
    expect(separator).toHaveAttribute("aria-valuenow", "500");
    fireEvent.keyDown(separator, { key: "ArrowUp" });
    expect(screen.getByTestId("timeline-panel")).toHaveStyle({ height: "500px" });

    act(() => {
      stores.workspace.dispatch({ type: "workspace.setPanelSize", panelId: "timeline", size: 20 });
    });
    expect(screen.getByTestId("timeline-panel")).toHaveStyle({ height: "120px" });
    expect(separator).toHaveAttribute("aria-valuenow", "120");
  });

  it("resizes by pointer delta and releases global listeners on mouseup/unmount", () => {
    const stores = createStores();
    const view = render(
      <StudioLocalStoresProvider stores={stores}>
        <TimelinePanel />
      </StudioLocalStoresProvider>,
    );
    const separator = screen.getByRole("separator", { name: "Resize timeline" });

    fireEvent.mouseDown(separator, { clientY: 400 });
    expect(document.body.style.cursor).toBe("row-resize");
    fireEvent.mouseMove(window, { clientY: 350 });
    expect(screen.getByTestId("timeline-panel")).toHaveStyle({ height: "270px" });
    fireEvent.mouseUp(window);
    expect(document.body.style.cursor).toBe("");

    fireEvent.mouseMove(window, { clientY: 100 });
    expect(screen.getByTestId("timeline-panel")).toHaveStyle({ height: "270px" });

    fireEvent.mouseDown(separator, { clientY: 300 });
    view.unmount();
    expect(document.body.style.cursor).toBe("");
    fireEvent.mouseMove(window, { clientY: 0 });
    expect(stores.workspace.getSnapshot().panelSizes.timeline).toBe(270);
  });
});
