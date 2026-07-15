import React, { useState } from "react";
import {
  ChevronDown,
  CircleHelp,
  Download,
  FilePlus2,
  FolderOpen,
  Layers3,
  LayoutGrid,
  Redo2,
  Save,
  Scissors,
  Settings,
  Target,
  Undo2,
  Upload,
} from "lucide-react";
import {
  STUDIO_WORKSPACES,
  getStudioWorkspace,
  type StudioWorkspaceId,
} from "../../core/studio/workspaceRegistry";
import type {
  StudioCommandContext,
  StudioCommandId,
  StudioCommandRegistry,
  StudioCommandState,
} from "../../core/studio/commandRegistry";

export interface StudioHeaderProps {
  readonly activeWorkspace: StudioWorkspaceId;
  readonly registry: StudioCommandRegistry;
  readonly commandContext: StudioCommandContext;
  readonly onExecute: (commandId: StudioCommandId) => void;
}

const WORKSPACE_ICONS = {
  slice: Scissors,
  compose: Layers3,
  animate: Layers3,
  collision: Target,
  export: Download,
} as const satisfies Record<StudioWorkspaceId, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>>;

function commandState(
  registry: StudioCommandRegistry,
  commandId: StudioCommandId,
  context: StudioCommandContext,
): StudioCommandState {
  return registry.getState(commandId, context);
}

interface CommandButtonProps {
  readonly commandId: StudioCommandId;
  readonly registry: StudioCommandRegistry;
  readonly commandContext: StudioCommandContext;
  readonly onExecute: (commandId: StudioCommandId) => void;
  readonly icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  readonly className?: string;
  readonly menuItem?: boolean;
}

function CommandButton({
  commandId,
  registry,
  commandContext,
  onExecute,
  icon: Icon,
  className = "",
  menuItem = false,
}: CommandButtonProps) {
  const command = registry.getCommand(commandId);
  const state = commandState(registry, commandId, commandContext);
  const disabled = !state.enabled;
  const reason = state.enabled ? command.description : state.reason;

  return (
    <button
      type="button"
      data-command-id={commandId}
      disabled={disabled}
      aria-disabled={disabled}
      title={reason}
      onClick={() => {
        if (!disabled) onExecute(commandId);
      }}
      className={[
        menuItem
          ? "flex w-full items-center gap-3 px-3 py-2 text-left text-xs text-textMain hover:bg-accent/10 hover:text-accent"
          : "inline-flex items-center justify-center rounded-md text-textMuted hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35",
        "transition-colors",
        className,
      ].join(" ")}
    >
      <Icon size={menuItem ? 14 : 15} strokeWidth={1.8} />
      <span className={menuItem ? undefined : "sr-only"}>{command.label}</span>
    </button>
  );
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  activeWorkspace,
  registry,
  commandContext,
  onExecute,
}) => {
  const [isProjectMenuOpen, setProjectMenuOpen] = useState(false);
  const exportCommandId = "workspace.open.export" as const;
  const exportState = commandState(registry, exportCommandId, commandContext);
  const exportDisabled = !exportState.enabled;

  const executeProjectCommand = (commandId: StudioCommandId) => {
    onExecute(commandId);
    setProjectMenuOpen(false);
  };

  const executeWorkspace = (
    event: React.MouseEvent<HTMLAnchorElement>,
    commandId: StudioCommandId,
  ) => {
    const state = commandState(registry, commandId, commandContext);
    if (!state.enabled) {
      event.preventDefault();
      return;
    }
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onExecute(commandId);
  };

  return (
    <header className="relative z-50 flex h-14 shrink-0 items-center justify-between border-b border-white/5 bg-panel px-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex shrink-0 items-center gap-2.5 select-none" aria-label="SpriteBoy Studio">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-surface text-accent">
            <LayoutGrid size={18} strokeWidth={1.8} />
          </div>
          <div className="flex flex-col justify-center">
            <span className="text-sm font-bold leading-none tracking-tight text-textMain">SpriteBoy</span>
            <span className="font-mono text-[10px] text-textMuted/70">Studio</span>
          </div>
        </div>

        <div className="mx-1 h-6 w-px bg-white/10" />

        <div className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={isProjectMenuOpen}
            onClick={() => setProjectMenuOpen((open) => !open)}
            className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium text-textMuted transition-colors hover:bg-white/5 hover:text-white"
          >
            Project
            <ChevronDown size={12} className={isProjectMenuOpen ? "rotate-180 opacity-70" : "opacity-60"} />
          </button>
          {isProjectMenuOpen && (
            <>
              <button
                type="button"
                aria-label="Close project menu"
                className="fixed inset-0 z-40 h-full w-full cursor-default"
                onClick={() => setProjectMenuOpen(false)}
              />
              <div role="menu" aria-label="Project actions" className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border border-border bg-panel py-1 shadow-xl">
                <CommandButton
                  commandId="project.new"
                  registry={registry}
                  commandContext={commandContext}
                  onExecute={executeProjectCommand}
                  icon={FilePlus2}
                  menuItem
                />
                <CommandButton
                  commandId="project.open"
                  registry={registry}
                  commandContext={commandContext}
                  onExecute={executeProjectCommand}
                  icon={FolderOpen}
                  menuItem
                />
                <CommandButton
                  commandId="project.save"
                  registry={registry}
                  commandContext={commandContext}
                  onExecute={executeProjectCommand}
                  icon={Save}
                  menuItem
                />
                <div className="my-1 h-px bg-white/5" />
                <CommandButton
                  commandId="asset.import"
                  registry={registry}
                  commandContext={commandContext}
                  onExecute={executeProjectCommand}
                  icon={Upload}
                  menuItem
                />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-0.5 rounded-md border border-white/5 bg-surface p-0.5" aria-label="Edit actions">
          <CommandButton
            commandId="edit.undo"
            registry={registry}
            commandContext={commandContext}
            onExecute={onExecute}
            icon={Undo2}
            className="h-7 w-7"
          />
          <div className="h-3 w-px bg-white/10" />
          <CommandButton
            commandId="edit.redo"
            registry={registry}
            commandContext={commandContext}
            onExecute={onExecute}
            icon={Redo2}
            className="h-7 w-7"
          />
        </div>
      </div>

      <nav aria-label="Studio workspaces" className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-lg border border-white/5 bg-surface/50 p-1 backdrop-blur-sm lg:flex">
        {STUDIO_WORKSPACES.map((workspace) => {
          const Icon = WORKSPACE_ICONS[workspace.id];
          const commandId = workspace.commandId;
          const state = commandState(registry, commandId, commandContext);
          const disabled = !state.enabled;
          return (
            <a
              key={workspace.id}
              href={workspace.href}
              data-workspace-id={workspace.id}
              aria-current={activeWorkspace === workspace.id ? "page" : undefined}
              aria-disabled={disabled || undefined}
              title={disabled ? state.reason : workspace.description}
              onClick={(event) => executeWorkspace(event, commandId)}
              className={[
                "relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                activeWorkspace === workspace.id
                  ? "bg-accent text-white shadow-sm"
                  : "text-textMuted hover:bg-white/5 hover:text-textMain",
                disabled ? "pointer-events-none opacity-35" : "",
              ].join(" ")}
            >
              <Icon size={14} strokeWidth={1.8} />
              {workspace.label}
            </a>
          );
        })}
      </nav>

      <div className="flex shrink-0 items-center gap-2">
        <a
          href={getStudioWorkspace("export").href}
          data-command-id={exportCommandId}
          aria-label="Export"
          aria-disabled={exportDisabled || undefined}
          title={exportDisabled ? exportState.reason : registry.getCommand(exportCommandId).description}
          onClick={(event) => executeWorkspace(event, exportCommandId)}
          className={[
            "inline-flex items-center gap-2 rounded-md border border-white/10 bg-surface px-3 py-1.5 text-xs font-medium text-textMain transition-colors hover:bg-white/10",
            exportDisabled ? "pointer-events-none opacity-35" : "",
          ].join(" ")}
        >
          <Download size={14} strokeWidth={1.8} />
          Export
        </a>
        <div className="flex items-center gap-1 border-l border-white/10 pl-2">
          <CommandButton
            commandId="app.openHelp"
            registry={registry}
            commandContext={commandContext}
            onExecute={onExecute}
            icon={CircleHelp}
            className="h-8 w-8"
          />
          <CommandButton
            commandId="app.openPreferences"
            registry={registry}
            commandContext={commandContext}
            onExecute={onExecute}
            icon={Settings}
            className="h-8 w-8"
          />
        </div>
      </div>
    </header>
  );
};

export default StudioHeader;
