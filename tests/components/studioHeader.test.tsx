import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createStudioCommandRegistry,
  type StudioCommandContext,
  type StudioCommandHandlers,
} from "../../core/studio/commandRegistry";
import { StudioHeader } from "../../components/studio/StudioHeader";

const commandContext: StudioCommandContext = {
  projectAvailable: true,
  busy: false,
  canUndo: true,
  canRedo: true,
  canvasAvailable: true,
};

function makeRegistry() {
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

function renderHeader(activeWorkspace: "slice" | "compose" | "animate" | "collision" | "export" = "slice") {
  const { registry } = makeRegistry();
  const onExecute = vi.fn();
  render(
    <StudioHeader
      activeWorkspace={activeWorkspace}
      registry={registry}
      commandContext={commandContext}
      onExecute={onExecute}
    />,
  );
  return { onExecute, registry };
}

describe("StudioHeader", () => {
  it("renders the registry order, canonical hrefs and active workspace", () => {
    renderHeader("collision");

    const navigation = screen.getByRole("navigation", { name: "Studio workspaces" });
    const links = within(navigation).getAllByRole("link");
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Slice",
      "Compose",
      "Animate",
      "Collision",
      "Export",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "#/studio/slice",
      "#/studio/compose",
      "#/studio/animate",
      "#/studio/collision",
      "#/studio/export",
    ]);
    expect(links[3]).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("SpriteBoy")).toBeInTheDocument();
    expect(screen.getByText("Studio")).toBeInTheDocument();
  });

  it("routes primary workspace clicks, while modified clicks preserve href navigation", () => {
    const { onExecute } = renderHeader();
    const collision = screen.getByRole("link", { name: "Collision" });

    fireEvent.click(collision);
    expect(onExecute).toHaveBeenCalledWith("workspace.open.collision");

    onExecute.mockClear();
    fireEvent.click(collision, { button: 0, ctrlKey: true });
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("routes the real project menu and utility commands", () => {
    const { onExecute } = renderHeader();

    fireEvent.click(screen.getByRole("button", { name: /Project/ }));
    const menu = screen.getByRole("menu", { name: "Project actions" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "New project" }));
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    fireEvent.click(within(screen.getByRole("menu", { name: "Project actions" })).getByRole("menuitem", { name: "Import image" }));

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    fireEvent.click(screen.getByRole("button", { name: "Help and shortcuts" }));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));

    expect(onExecute.mock.calls.map(([id]) => id)).toEqual([
      "project.new",
      "asset.import",
      "edit.undo",
      "edit.redo",
      "app.openHelp",
      "app.openPreferences",
    ]);
  });

  it("does not dispatch disabled commands and exposes the registry reason", () => {
    const { registry } = makeRegistry();
    const onExecute = vi.fn();
    const unavailable: StudioCommandContext = {
      ...commandContext,
      projectAvailable: false,
      canUndo: false,
      canRedo: false,
    };
    render(
      <StudioHeader
        activeWorkspace="slice"
        registry={registry}
        commandContext={unavailable}
        onExecute={onExecute}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Project/ }));
    const save = within(screen.getByRole("menu", { name: "Project actions" })).getByRole("menuitem", { name: "Save project" });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("title", "Open or create a project first.");
    fireEvent.click(save);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("keeps Export as a dedicated CTA with canonical routing", () => {
    const { onExecute } = renderHeader();
    const exportLinks = screen.getAllByRole("link", { name: "Export" });
    const cta = exportLinks[exportLinks.length - 1];

    expect(cta).toHaveAttribute("href", "#/studio/export");
    fireEvent.click(cta);
    expect(onExecute).toHaveBeenCalledWith("workspace.open.export");
  });

  it("exposes Job Center activity without changing command routing", () => {
    const { registry } = makeRegistry();
    const onOpenJobCenter = vi.fn();
    render(
      <StudioHeader
        activeWorkspace="slice"
        registry={registry}
        commandContext={commandContext}
        onExecute={vi.fn()}
        onOpenJobCenter={onOpenJobCenter}
        jobSummary={{ active: 3, total: 7 }}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Open Job Center, 3 active jobs, 7 visible jobs",
    });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("title", "3 active · 7 visible jobs");
    expect(trigger).toHaveTextContent("3/7");
    fireEvent.click(screen.getByRole("button", { name: /Project/ }));
    expect(screen.getByRole("menu", { name: "Project actions" })).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu", { name: "Project actions" })).not.toBeInTheDocument();
    expect(onOpenJobCenter).toHaveBeenCalledTimes(1);
  });

  it("keeps every workspace reachable from the compact menu and restores focus", async () => {
    const { onExecute } = renderHeader("compose");
    const trigger = screen.getByRole("button", { name: "Compose" });

    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Studio workspaces" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "Slice",
      "Compose",
      "Animate",
      "Collision",
      "Export",
    ]);
    await waitFor(() => expect(items[0]).toHaveFocus());

    fireEvent.keyDown(menu, { key: "End" });
    expect(items[4]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole("menu", { name: "Studio workspaces" })).getByRole("menuitem", { name: "Collision" }));
    expect(onExecute).toHaveBeenLastCalledWith("workspace.open.collision");
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
