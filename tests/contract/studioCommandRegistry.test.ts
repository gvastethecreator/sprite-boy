import { describe, expect, it, vi } from "vitest";
import {
  STUDIO_COMMAND_IDS,
  STUDIO_COMMANDS,
  auditStudioCommands,
  createStudioCommandRegistry,
  createStudioShortcut,
  studioShortcutSignature,
  type StudioCommandContext,
  type StudioCommandHandlers,
  type StudioCommandId,
} from "../../core/studio";

const readyContext: StudioCommandContext = Object.freeze({
  projectAvailable: true,
  busy: false,
  canUndo: true,
  canRedo: true,
  canvasAvailable: true,
});

type MutableHandlers = {
  -readonly [TKey in keyof StudioCommandHandlers]: StudioCommandHandlers[TKey];
};

function handlers(): MutableHandlers {
  return {
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
}

describe("Studio command metadata", () => {
  it("publishes one deeply immutable command for every canonical ID", () => {
    expect(STUDIO_COMMANDS.map(({ id }) => id)).toEqual(STUDIO_COMMAND_IDS);
    expect(new Set(STUDIO_COMMAND_IDS).size).toBe(STUDIO_COMMAND_IDS.length);
    expect(Object.isFrozen(STUDIO_COMMANDS)).toBe(true);
    expect(auditStudioCommands(STUDIO_COMMANDS)).toEqual([]);

    for (const command of STUDIO_COMMANDS) {
      expect(Object.isFrozen(command)).toBe(true);
      expect(Object.isFrozen(command.keywords)).toBe(true);
      expect(Object.isFrozen(command.shortcuts)).toBe(true);
      for (const shortcut of command.shortcuts) {
        expect(Object.isFrozen(shortcut)).toBe(true);
        expect(Object.isFrozen(shortcut.modifiers)).toBe(true);
      }
    }
  });

  it("keeps all five workspaces directly reachable and omits inert Analyze", () => {
    expect(STUDIO_COMMAND_IDS.filter((id) => id.startsWith("workspace.open."))).toEqual([
      "workspace.open.slice",
      "workspace.open.compose",
      "workspace.open.animate",
      "workspace.open.collision",
      "workspace.open.export",
    ]);
    expect(STUDIO_COMMAND_IDS).not.toContain("ai.analyze" as StudioCommandId);
    expect(STUDIO_COMMANDS.every((command) => !("action" in command))).toBe(true);
  });

  it("canonicalizes shortcuts by code and semantic modifier order", () => {
    const unordered = {
      code: "KeyZ",
      modifiers: ["shift", "primary"] as const,
      editable: "outside-editable" as const,
    };
    expect(studioShortcutSignature(unordered)).toBe("primary+shift+KeyZ");
    expect(() => studioShortcutSignature({
      ...unordered,
      modifiers: ["primary", "primary"],
    })).toThrow(/Duplicate shortcut modifier/);
    expect(() => createStudioShortcut("?"))
      .toThrow(/KeyboardEvent\.code/);
  });

  it("reports duplicate IDs and cross-command shortcut conflicts deterministically", () => {
    const shared = createStudioShortcut("KeyQ", { primary: true });
    const diagnostics = auditStudioCommands([
      { id: "one", shortcuts: [shared] },
      { id: "one", shortcuts: [] },
      { id: "two", shortcuts: [shared] },
    ]);

    expect(diagnostics).toEqual([
      { code: "DUPLICATE_COMMAND_ID", commandId: "one" },
      {
        code: "SHORTCUT_CONFLICT",
        signature: "primary+KeyQ",
        commandIds: ["one", "two"],
      },
    ]);
    expect(Object.isFrozen(diagnostics)).toBe(true);
    expect(Object.isFrozen(diagnostics[1])).toBe(true);
  });
});

describe("executable Studio command registry", () => {
  it("requires every handler as an own data function and captures the port", async () => {
    const port = handlers();
    const registry = createStudioCommandRegistry(port);
    const captured = port.saveProject;
    port.saveProject = vi.fn();

    await registry.execute("project.save", readyContext);
    expect(captured).toHaveBeenCalledOnce();
    expect(port.saveProject).not.toHaveBeenCalled();

    const missing = handlers() as unknown as Record<string, unknown>;
    delete missing.openProject;
    expect(() => createStudioCommandRegistry(missing as unknown as StudioCommandHandlers))
      .toThrow(/openProject.*own data function/);

    const accessor = handlers() as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, "openHelp", { get: () => vi.fn() });
    expect(() => createStudioCommandRegistry(accessor as unknown as StudioCommandHandlers))
      .toThrow(/openHelp.*own data function/);
  });

  it("maps every enabled command to exactly one concrete handler port", async () => {
    const port = handlers();
    const registry = createStudioCommandRegistry(port);

    for (const commandId of STUDIO_COMMAND_IDS) {
      await expect(registry.execute(commandId, readyContext)).resolves.toEqual({
        status: "executed",
        commandId,
      });
    }

    expect(port.newProject).toHaveBeenCalledOnce();
    expect(port.openProject).toHaveBeenCalledOnce();
    expect(port.saveProject).toHaveBeenCalledOnce();
    expect(port.importAsset).toHaveBeenCalledOnce();
    expect(port.undo).toHaveBeenCalledOnce();
    expect(port.redo).toHaveBeenCalledOnce();
    expect(port.openWorkspace).toHaveBeenNthCalledWith(1, "slice");
    expect(port.openWorkspace).toHaveBeenNthCalledWith(2, "compose");
    expect(port.openWorkspace).toHaveBeenNthCalledWith(3, "animate");
    expect(port.openWorkspace).toHaveBeenNthCalledWith(4, "collision");
    expect(port.openWorkspace).toHaveBeenNthCalledWith(5, "export");
    expect(port.resetCanvas).toHaveBeenCalledOnce();
    expect(port.openCommandPalette).toHaveBeenCalledOnce();
    expect(port.openPreferences).toHaveBeenCalledOnce();
    expect(port.openHelp).toHaveBeenCalledOnce();
  });

  it("returns typed disabled states without calling handlers", async () => {
    const port = handlers();
    const registry = createStudioCommandRegistry(port);
    const unavailable: StudioCommandContext = {
      projectAvailable: false,
      busy: false,
      canUndo: false,
      canRedo: false,
      canvasAvailable: false,
    };

    expect(registry.getState("project.save", unavailable)).toMatchObject({
      enabled: false,
      code: "PROJECT_UNAVAILABLE",
    });
    expect(registry.getState("edit.undo", unavailable)).toMatchObject({
      enabled: false,
      code: "NOTHING_TO_UNDO",
    });
    expect(registry.getState("edit.redo", unavailable)).toMatchObject({
      enabled: false,
      code: "NOTHING_TO_REDO",
    });
    expect(registry.getState("view.resetCanvas", unavailable)).toMatchObject({
      enabled: false,
      code: "CANVAS_UNAVAILABLE",
    });
    expect(registry.getState("workspace.open.collision", unavailable)).toEqual({ enabled: true });

    await expect(registry.execute("project.save", unavailable)).resolves.toMatchObject({
      status: "disabled",
      commandId: "project.save",
      state: { code: "PROJECT_UNAVAILABLE" },
    });
    expect(port.saveProject).not.toHaveBeenCalled();
  });

  it("gives busy state precedence and does not hide handler failures", async () => {
    const port = handlers();
    port.saveProject = vi.fn(async () => {
      throw new Error("disk failed");
    });
    const registry = createStudioCommandRegistry(port);
    const busy = { ...readyContext, busy: true };

    expect(registry.getState("project.save", busy)).toMatchObject({ enabled: false, code: "BUSY" });
    await expect(registry.execute("project.save", readyContext)).rejects.toThrow("disk failed");
  });

  it("resolves canonical shortcuts and rejects unknown runtime IDs", () => {
    const registry = createStudioCommandRegistry(handlers());
    expect(registry.findByShortcut(createStudioShortcut("Digit4", { primary: true }))?.id)
      .toBe("workspace.open.collision");
    expect(registry.findByShortcut(createStudioShortcut("KeyQ", { primary: true }))).toBeNull();
    expect(() => registry.getCommand("future.command" as StudioCommandId))
      .toThrow(/Unknown Studio command/);
  });

  it("matches keyboard codes across Ctrl/Cmd with exact modifiers", () => {
    const registry = createStudioCommandRegistry(handlers());
    const input = {
      code: "Digit4",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      editable: false,
    };

    expect(registry.findByKeyboardInput(input)?.id).toBe("workspace.open.collision");
    expect(registry.findByKeyboardInput({ ...input, ctrlKey: false, metaKey: true })?.id)
      .toBe("workspace.open.collision");
    expect(registry.findByKeyboardInput({ ...input, altKey: true })).toBeNull();
    expect(registry.findByKeyboardInput({ ...input, code: "" })).toBeNull();
    expect(registry.findByKeyboardInput({ ...input, code: "KeyZ", shiftKey: true })?.id)
      .toBe("edit.redo");
  });

  it("honors editable shortcut policy without key-label assumptions", () => {
    const registry = createStudioCommandRegistry(handlers());
    const editableInput = {
      code: "KeyS",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      editable: true,
    };

    expect(registry.findByKeyboardInput(editableInput)).toBeNull();
    expect(registry.findByKeyboardInput({ ...editableInput, code: "KeyK" })?.id)
      .toBe("app.openCommandPalette");
  });
});
