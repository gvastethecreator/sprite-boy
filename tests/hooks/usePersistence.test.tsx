import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usePersistence } from "../../hooks/domains/usePersistence";
import type { AppMode, GridConfig, ProjectState, TemplateConfig } from "../../types";

const project = {
  imageMeta: null,
  frames: [],
  builderSlots: {},
  builderFreeObjects: [],
  animations: [],
  selectedIndex: null,
} as unknown as ProjectState;

function dependencies() {
  return {
    project,
    slicerGrid: {} as GridConfig,
    builderGrid: {} as GridConfig,
    templateConfig: {} as TemplateConfig,
    onionSkin: { enabled: false } as never,
    currentMode: "slice" as AppMode,
    setProject: vi.fn(),
    setSlicerGrid: vi.fn(),
    setBuilderGrid: vi.fn(),
    setTemplateConfig: vi.fn(),
    setCurrentMode: vi.fn(),
    notify: vi.fn(),
  };
}

describe("usePersistence project load boundary", () => {
  it("resolves true only after a project payload is committed", async () => {
    const deps = dependencies();
    const { result } = renderHook(() => usePersistence(deps));
    const file = new File([JSON.stringify({ project })], "project.json", {
      type: "application/json",
    });
    let loaded = false;

    await act(async () => {
      loaded = await result.current.handleLoadProject(file);
    });

    expect(loaded).toBe(true);
    expect(deps.setProject).toHaveBeenCalledWith(project);
    expect(deps.notify).toHaveBeenCalledWith("Project loaded", "success");
  });

  it("resolves false for JSON without a project and leaves project state untouched", async () => {
    const deps = dependencies();
    const { result } = renderHook(() => usePersistence(deps));
    const file = new File([JSON.stringify({ ui: { currentMode: "build" } })], "not-project.json", {
      type: "application/json",
    });
    let loaded = true;

    await act(async () => {
      loaded = await result.current.handleLoadProject(file);
    });

    expect(loaded).toBe(false);
    expect(deps.setProject).not.toHaveBeenCalled();
    expect(deps.setCurrentMode).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith("Invalid file", "error");
  });
});
