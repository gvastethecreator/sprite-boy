import {
  STUDIO_WORKSPACES,
  type StudioWorkspaceCommandId,
  type StudioWorkspaceId,
} from "./workspaceRegistry";

export const STUDIO_BASE_COMMAND_IDS = Object.freeze([
  "project.new",
  "project.open",
  "project.save",
  "asset.import",
  "edit.undo",
  "edit.redo",
  "view.resetCanvas",
  "app.openCommandPalette",
  "app.openPreferences",
  "app.openHelp",
] as const);

export type StudioBaseCommandId = (typeof STUDIO_BASE_COMMAND_IDS)[number];
export type StudioCommandId = StudioBaseCommandId | StudioWorkspaceCommandId;

export const STUDIO_COMMAND_IDS: readonly StudioCommandId[] = Object.freeze([
  ...STUDIO_BASE_COMMAND_IDS.slice(0, 6),
  ...STUDIO_WORKSPACES.map(({ commandId }) => commandId),
  ...STUDIO_BASE_COMMAND_IDS.slice(6),
]);

export type StudioCommandCategory = "project" | "assets" | "edit" | "workspace" | "view" | "app";
export type StudioShortcutModifier = "primary" | "alt" | "shift";
export type StudioShortcutEditablePolicy = "outside-editable" | "always";

const SHORTCUT_MODIFIER_ORDER = Object.freeze([
  "primary",
  "alt",
  "shift",
] as const satisfies readonly StudioShortcutModifier[]);

export interface StudioShortcut {
  /** Locale-independent KeyboardEvent.code, for example KeyZ or Digit1. */
  readonly code: string;
  readonly modifiers: readonly StudioShortcutModifier[];
  readonly editable: StudioShortcutEditablePolicy;
}

export interface StudioKeyboardInput {
  /** Locale-independent event code. `key` is intentionally not part of this contract. */
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly editable: boolean;
}

export interface CreateStudioShortcutOptions {
  readonly primary?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
  readonly editable?: StudioShortcutEditablePolicy;
}

function assertShortcutCode(code: unknown): asserts code is string {
  if (typeof code !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(code)) {
    throw new TypeError("Shortcut code must be a non-empty KeyboardEvent.code token.");
  }
}

export function createStudioShortcut(
  code: string,
  options: CreateStudioShortcutOptions = {},
): StudioShortcut {
  assertShortcutCode(code);
  const modifiers = SHORTCUT_MODIFIER_ORDER.filter((modifier) => options[modifier] === true);
  const editable = options.editable ?? "outside-editable";
  if (editable !== "outside-editable" && editable !== "always") {
    throw new TypeError("Shortcut editable policy is invalid.");
  }
  return Object.freeze({
    code,
    modifiers: Object.freeze(modifiers),
    editable,
  });
}

/** Canonical conflict/matching key. Editable policies still overlap outside editors. */
export function studioShortcutSignature(shortcut: StudioShortcut): string {
  assertShortcutCode(shortcut?.code);
  if (!Array.isArray(shortcut.modifiers)) {
    throw new TypeError("Shortcut modifiers must be an array.");
  }
  const modifierSet = new Set<StudioShortcutModifier>();
  for (const modifier of shortcut.modifiers) {
    if (!SHORTCUT_MODIFIER_ORDER.includes(modifier)) {
      throw new TypeError(`Unknown shortcut modifier: ${String(modifier)}.`);
    }
    if (modifierSet.has(modifier)) {
      throw new TypeError(`Duplicate shortcut modifier: ${modifier}.`);
    }
    modifierSet.add(modifier);
  }
  const ordered = SHORTCUT_MODIFIER_ORDER.filter((modifier) => modifierSet.has(modifier));
  return [...ordered, shortcut.code].join("+");
}

export interface StudioCommand<TId extends string = StudioCommandId> {
  readonly id: TId;
  readonly label: string;
  readonly description: string;
  readonly category: StudioCommandCategory;
  readonly keywords: readonly string[];
  readonly shortcuts: readonly StudioShortcut[];
}

interface DefineStudioCommandInput<TId extends string> extends Omit<StudioCommand<TId>, "keywords" | "shortcuts"> {
  readonly keywords?: readonly string[];
  readonly shortcuts?: readonly StudioShortcut[];
}

function defineCommand<TId extends StudioCommandId>(
  input: DefineStudioCommandInput<TId>,
): StudioCommand<TId> {
  return Object.freeze({
    ...input,
    keywords: Object.freeze([...(input.keywords ?? [])]),
    shortcuts: Object.freeze([...(input.shortcuts ?? [])]),
  });
}

const primary = (code: string, options: Omit<CreateStudioShortcutOptions, "primary"> = {}) =>
  createStudioShortcut(code, { ...options, primary: true });

const FIXED_COMMANDS = Object.freeze([
  defineCommand({
    id: "project.new",
    label: "New project",
    description: "Create a clean Studio project.",
    category: "project",
    keywords: ["create", "file"],
    shortcuts: [primary("KeyN")],
  }),
  defineCommand({
    id: "project.open",
    label: "Open project",
    description: "Choose and open a Studio project.",
    category: "project",
    keywords: ["load", "file"],
    shortcuts: [primary("KeyO")],
  }),
  defineCommand({
    id: "project.save",
    label: "Save project",
    description: "Save the current Studio project.",
    category: "project",
    keywords: ["download", "file"],
    shortcuts: [primary("KeyS")],
  }),
  defineCommand({
    id: "asset.import",
    label: "Import image",
    description: "Add source art to the shared Asset Library.",
    category: "assets",
    keywords: ["upload", "sprite", "image"],
  }),
  defineCommand({
    id: "edit.undo",
    label: "Undo",
    description: "Undo the last project edit.",
    category: "edit",
    shortcuts: [primary("KeyZ")],
  }),
  defineCommand({
    id: "edit.redo",
    label: "Redo",
    description: "Redo the last reverted project edit.",
    category: "edit",
    shortcuts: [primary("KeyZ", { shift: true }), primary("KeyY")],
  }),
  defineCommand({
    id: "view.resetCanvas",
    label: "Reset canvas view",
    description: "Fit the active scene back into the canvas.",
    category: "view",
    keywords: ["zoom", "fit"],
    shortcuts: [primary("Digit0")],
  }),
  defineCommand({
    id: "app.openCommandPalette",
    label: "Open command palette",
    description: "Search every available Studio command.",
    category: "app",
    keywords: ["search", "commands"],
    shortcuts: [primary("KeyK", { editable: "always" })],
  }),
  defineCommand({
    id: "app.openPreferences",
    label: "Preferences",
    description: "Open Studio preferences.",
    category: "app",
    keywords: ["settings"],
    shortcuts: [primary("Comma")],
  }),
  defineCommand({
    id: "app.openHelp",
    label: "Help and shortcuts",
    description: "Open Studio help and keyboard reference.",
    category: "app",
    keywords: ["keyboard", "docs"],
    shortcuts: [createStudioShortcut("Slash", { shift: true })],
  }),
] as const);

const WORKSPACE_COMMANDS = Object.freeze(STUDIO_WORKSPACES.map((workspace, index) =>
  defineCommand({
    id: workspace.commandId,
    label: `Open ${workspace.label}`,
    description: workspace.description,
    category: "workspace",
    keywords: [workspace.id],
    shortcuts: [primary(`Digit${index + 1}`)],
  }),
));

const FIXED_COMMAND_BY_ID = new Map(FIXED_COMMANDS.map((command) => [command.id, command]));

export const STUDIO_COMMANDS: readonly StudioCommand[] = Object.freeze(
  STUDIO_COMMAND_IDS.map((id) => {
    const workspace = WORKSPACE_COMMANDS.find((command) => command.id === id);
    const command = workspace ?? FIXED_COMMAND_BY_ID.get(id as StudioBaseCommandId);
    if (!command) throw new Error(`Missing Studio command metadata: ${id}.`);
    return command;
  }),
);

export type StudioCommandAuditDiagnostic =
  | {
      readonly code: "DUPLICATE_COMMAND_ID";
      readonly commandId: string;
    }
  | {
      readonly code: "SHORTCUT_CONFLICT";
      readonly signature: string;
      readonly commandIds: readonly string[];
    };

export function auditStudioCommands(
  commands: readonly Pick<StudioCommand<string>, "id" | "shortcuts">[],
): readonly StudioCommandAuditDiagnostic[] {
  const diagnostics: StudioCommandAuditDiagnostic[] = [];
  const idCounts = new Map<string, number>();
  const commandIdsByShortcut = new Map<string, Set<string>>();

  for (const command of commands) {
    idCounts.set(command.id, (idCounts.get(command.id) ?? 0) + 1);
    for (const shortcut of command.shortcuts) {
      const signature = studioShortcutSignature(shortcut);
      const commandIds = commandIdsByShortcut.get(signature) ?? new Set<string>();
      commandIds.add(command.id);
      commandIdsByShortcut.set(signature, commandIds);
    }
  }

  for (const [commandId, count] of idCounts) {
    if (count > 1) diagnostics.push(Object.freeze({ code: "DUPLICATE_COMMAND_ID", commandId }));
  }
  for (const [signature, ids] of commandIdsByShortcut) {
    if (ids.size > 1) {
      diagnostics.push(Object.freeze({
        code: "SHORTCUT_CONFLICT",
        signature,
        commandIds: Object.freeze([...ids]),
      }));
    }
  }
  return Object.freeze(diagnostics);
}

const STATIC_AUDIT = auditStudioCommands(STUDIO_COMMANDS);
if (STATIC_AUDIT.length > 0) {
  throw new Error(`Invalid Studio command metadata: ${JSON.stringify(STATIC_AUDIT)}.`);
}

export interface StudioCommandContext {
  readonly projectAvailable: boolean;
  readonly busy: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canvasAvailable: boolean;
}

export type StudioCommandDisabledCode =
  | "BUSY"
  | "PROJECT_UNAVAILABLE"
  | "NOTHING_TO_UNDO"
  | "NOTHING_TO_REDO"
  | "CANVAS_UNAVAILABLE";

export type StudioCommandState =
  | { readonly enabled: true }
  | {
      readonly enabled: false;
      readonly code: StudioCommandDisabledCode;
      readonly reason: string;
    };

const ENABLED: StudioCommandState = Object.freeze({ enabled: true });
const disabled = (code: StudioCommandDisabledCode, reason: string): StudioCommandState =>
  Object.freeze({ enabled: false, code, reason });

function commandState(id: StudioCommandId, context: StudioCommandContext): StudioCommandState {
  switch (id) {
    case "project.new":
    case "project.open":
      return context.busy ? disabled("BUSY", "Wait for the current operation to finish.") : ENABLED;
    case "project.save":
    case "asset.import":
      if (context.busy) return disabled("BUSY", "Wait for the current operation to finish.");
      return context.projectAvailable
        ? ENABLED
        : disabled("PROJECT_UNAVAILABLE", "Open or create a project first.");
    case "edit.undo":
      if (context.busy) return disabled("BUSY", "Wait for the current operation to finish.");
      return context.canUndo ? ENABLED : disabled("NOTHING_TO_UNDO", "There is nothing to undo.");
    case "edit.redo":
      if (context.busy) return disabled("BUSY", "Wait for the current operation to finish.");
      return context.canRedo ? ENABLED : disabled("NOTHING_TO_REDO", "There is nothing to redo.");
    case "view.resetCanvas":
      if (context.busy) return disabled("BUSY", "Wait for the current operation to finish.");
      return context.canvasAvailable
        ? ENABLED
        : disabled("CANVAS_UNAVAILABLE", "The active workspace has no canvas yet.");
    case "workspace.open.slice":
    case "workspace.open.compose":
    case "workspace.open.animate":
    case "workspace.open.collision":
    case "workspace.open.export":
    case "app.openCommandPalette":
    case "app.openPreferences":
    case "app.openHelp":
      return ENABLED;
  }
  return assertNeverCommand(id);
}

export type StudioCommandHandler = () => void | Promise<void>;

export interface StudioCommandHandlers {
  readonly newProject: StudioCommandHandler;
  readonly openProject: StudioCommandHandler;
  readonly saveProject: StudioCommandHandler;
  readonly importAsset: StudioCommandHandler;
  readonly undo: StudioCommandHandler;
  readonly redo: StudioCommandHandler;
  readonly openWorkspace: (workspaceId: StudioWorkspaceId) => void | Promise<void>;
  readonly resetCanvas: StudioCommandHandler;
  readonly openCommandPalette: StudioCommandHandler;
  readonly openPreferences: StudioCommandHandler;
  readonly openHelp: StudioCommandHandler;
}

const REQUIRED_HANDLER_KEYS = Object.freeze([
  "newProject",
  "openProject",
  "saveProject",
  "importAsset",
  "undo",
  "redo",
  "openWorkspace",
  "resetCanvas",
  "openCommandPalette",
  "openPreferences",
  "openHelp",
] as const satisfies readonly (keyof StudioCommandHandlers)[]);

type MissingHandlerKey = Exclude<
  keyof StudioCommandHandlers,
  (typeof REQUIRED_HANDLER_KEYS)[number]
>;
type ExhaustiveHandlerPort = MissingHandlerKey extends never ? true : never;
const HANDLER_PORT_IS_EXHAUSTIVE: ExhaustiveHandlerPort = true;
void HANDLER_PORT_IS_EXHAUSTIVE;

function captureHandlers(value: StudioCommandHandlers): StudioCommandHandlers {
  if (value === null || typeof value !== "object") {
    throw new TypeError("Studio command handlers must be an object.");
  }
  const captured = Object.create(null) as Record<keyof StudioCommandHandlers, Function>;
  for (const key of REQUIRED_HANDLER_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
      throw new TypeError(`Studio command handler ${key} must be an own data function.`);
    }
    captured[key] = descriptor.value;
  }
  return Object.freeze(captured) as unknown as StudioCommandHandlers;
}

export type StudioCommandExecutionResult =
  | { readonly status: "executed"; readonly commandId: StudioCommandId }
  | {
      readonly status: "disabled";
      readonly commandId: StudioCommandId;
      readonly state: Exclude<StudioCommandState, { readonly enabled: true }>;
    };

export interface StudioCommandRegistry {
  readonly commands: readonly StudioCommand[];
  getCommand(commandId: StudioCommandId): StudioCommand;
  getState(commandId: StudioCommandId, context: StudioCommandContext): StudioCommandState;
  findByShortcut(shortcut: StudioShortcut): StudioCommand | null;
  findByKeyboardInput(input: StudioKeyboardInput): StudioCommand | null;
  execute(
    commandId: StudioCommandId,
    context: StudioCommandContext,
  ): Promise<StudioCommandExecutionResult>;
}

const COMMAND_BY_ID = new Map(STUDIO_COMMANDS.map((command) => [command.id, command]));
const COMMAND_BY_SHORTCUT = new Map<string, StudioCommand>();
for (const command of STUDIO_COMMANDS) {
  for (const shortcut of command.shortcuts) {
    COMMAND_BY_SHORTCUT.set(studioShortcutSignature(shortcut), command);
  }
}

function keyboardInputSignature(input: StudioKeyboardInput): string | null {
  if (typeof input.code !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(input.code)) {
    return null;
  }
  const modifiers: StudioShortcutModifier[] = [];
  if (input.ctrlKey || input.metaKey) modifiers.push("primary");
  if (input.altKey) modifiers.push("alt");
  if (input.shiftKey) modifiers.push("shift");
  return [...modifiers, input.code].join("+");
}

function findKeyboardCommand(input: StudioKeyboardInput): StudioCommand | null {
  const signature = keyboardInputSignature(input);
  if (!signature) return null;
  const command = COMMAND_BY_SHORTCUT.get(signature);
  if (!command) return null;
  const matchedShortcut = command.shortcuts.find(
    (shortcut) => studioShortcutSignature(shortcut) === signature,
  );
  if (!matchedShortcut) return null;
  if (input.editable && matchedShortcut.editable !== "always") return null;
  return command;
}

function requireCommand(commandId: StudioCommandId): StudioCommand {
  const command = COMMAND_BY_ID.get(commandId);
  if (!command) throw new RangeError(`Unknown Studio command: ${String(commandId)}.`);
  return command;
}

function assertNeverCommand(commandId: never): never {
  throw new RangeError(`Unmapped Studio command: ${String(commandId)}.`);
}

async function invokeCommand(
  commandId: StudioCommandId,
  handlers: StudioCommandHandlers,
): Promise<void> {
  switch (commandId) {
    case "project.new": return handlers.newProject();
    case "project.open": return handlers.openProject();
    case "project.save": return handlers.saveProject();
    case "asset.import": return handlers.importAsset();
    case "edit.undo": return handlers.undo();
    case "edit.redo": return handlers.redo();
    case "workspace.open.slice": return handlers.openWorkspace("slice");
    case "workspace.open.compose": return handlers.openWorkspace("compose");
    case "workspace.open.animate": return handlers.openWorkspace("animate");
    case "workspace.open.collision": return handlers.openWorkspace("collision");
    case "workspace.open.export": return handlers.openWorkspace("export");
    case "view.resetCanvas": return handlers.resetCanvas();
    case "app.openCommandPalette": return handlers.openCommandPalette();
    case "app.openPreferences": return handlers.openPreferences();
    case "app.openHelp": return handlers.openHelp();
  }
  return assertNeverCommand(commandId);
}

export function createStudioCommandRegistry(
  handlerPort: StudioCommandHandlers,
): StudioCommandRegistry {
  const handlers = captureHandlers(handlerPort);

  return Object.freeze({
    commands: STUDIO_COMMANDS,
    getCommand(commandId: StudioCommandId): StudioCommand {
      return requireCommand(commandId);
    },
    getState(commandId: StudioCommandId, context: StudioCommandContext): StudioCommandState {
      requireCommand(commandId);
      return commandState(commandId, context);
    },
    findByShortcut(shortcut: StudioShortcut): StudioCommand | null {
      return COMMAND_BY_SHORTCUT.get(studioShortcutSignature(shortcut)) ?? null;
    },
    findByKeyboardInput(input: StudioKeyboardInput): StudioCommand | null {
      return findKeyboardCommand(input);
    },
    async execute(
      commandId: StudioCommandId,
      context: StudioCommandContext,
    ): Promise<StudioCommandExecutionResult> {
      requireCommand(commandId);
      const state = commandState(commandId, context);
      if (!state.enabled) {
        return Object.freeze({ status: "disabled", commandId, state });
      }
      await invokeCommand(commandId, handlers);
      return Object.freeze({ status: "executed", commandId });
    },
  });
}
