import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
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
  readonly onOpenJobCenter?: () => void;
  readonly isJobCenterOpen?: boolean;
  readonly jobSummary?: { readonly active: number; readonly total: number };
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

type OpenHeaderMenu = "project" | "workspace" | null;

function getEnabledMenuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(
    menu.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])',
    ),
  );
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
      role={menuItem ? "menuitem" : undefined}
      tabIndex={menuItem ? -1 : undefined}
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
  onOpenJobCenter,
  isJobCenterOpen = false,
  jobSummary = { active: 0, total: 0 },
}) => {
  const [openMenu, setOpenMenu] = useState<OpenHeaderMenu>(null);
  const projectTriggerRef = useRef<HTMLButtonElement>(null);
  const workspaceTriggerRef = useRef<HTMLButtonElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const exportCommandId = "workspace.open.export" as const;
  const exportState = commandState(registry, exportCommandId, commandContext);
  const exportDisabled = !exportState.enabled;

  const restoreMenuTrigger = (menu: Exclude<OpenHeaderMenu, null>) => {
    const trigger = menu === "project" ? projectTriggerRef.current : workspaceTriggerRef.current;
    window.requestAnimationFrame(() => trigger?.focus());
  };

  const closeMenu = (restoreFocus = false) => {
    const menu = openMenu;
    setOpenMenu(null);
    if (restoreFocus && menu) restoreMenuTrigger(menu);
  };

  useEffect(() => {
    if (!openMenu) return;
    const menu = openMenu === "project" ? projectMenuRef.current : workspaceMenuRef.current;
    const frame = window.requestAnimationFrame(() => {
      const firstItem = menu ? getEnabledMenuItems(menu)[0] : undefined;
      firstItem?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openMenu]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab") {
      setOpenMenu(null);
      return;
    }

    const items = getEnabledMenuItems(event.currentTarget);
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
    if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  const executeProjectCommand = (commandId: StudioCommandId) => {
    onExecute(commandId);
    closeMenu(true);
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
    <header className="relative z-50 flex h-14 shrink-0 items-center justify-between border-b border-white/5 bg-panel px-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
        <div className="flex shrink-0 items-center gap-2.5 select-none" aria-label="SpriteBoy Studio">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-surface text-accent">
            <LayoutGrid size={18} strokeWidth={1.8} />
          </div>
          <div className="hidden flex-col justify-center sm:flex">
            <span className="text-sm font-bold leading-none tracking-tight text-textMain">SpriteBoy</span>
            <span className="font-mono text-[10px] text-textMuted/70">Studio</span>
          </div>
        </div>

        <div className="mx-1 hidden h-6 w-px bg-white/10 sm:block" />

        <div className="relative">
          <button
            ref={projectTriggerRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === "project"}
            aria-controls="studio-project-menu"
            onClick={() => setOpenMenu((current) => current === "project" ? null : "project")}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-textMuted transition-colors hover:bg-white/5 hover:text-white sm:px-3"
          >
            Project
            <ChevronDown size={12} className={openMenu === "project" ? "rotate-180 opacity-70" : "opacity-60"} />
          </button>
          {openMenu === "project" && (
            <>
              <div
                aria-hidden="true"
                className="fixed inset-0 z-40 cursor-default"
                onPointerDown={() => closeMenu(true)}
              />
              <div
                ref={projectMenuRef}
                id="studio-project-menu"
                role="menu"
                aria-label="Project actions"
                onKeyDown={handleMenuKeyDown}
                className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border border-border bg-panel py-1 shadow-xl"
              >
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

        <div className="hidden items-center gap-0.5 rounded-md border border-white/5 bg-surface p-0.5 sm:flex" aria-label="Edit actions">
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

      <div className="absolute left-1/2 -translate-x-1/2 xl:hidden">
        <button
          ref={workspaceTriggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={openMenu === "workspace"}
          aria-controls="studio-workspace-menu"
          onClick={() => setOpenMenu((current) => current === "workspace" ? null : "workspace")}
          className="inline-flex max-w-[34vw] items-center gap-1.5 rounded-md border border-white/10 bg-surface px-2.5 py-1.5 text-xs font-medium text-textMain hover:bg-white/10"
        >
          <span className="truncate">{getStudioWorkspace(activeWorkspace).label}</span>
          <ChevronDown size={12} className={openMenu === "workspace" ? "rotate-180 opacity-70" : "opacity-60"} />
        </button>
        {openMenu === "workspace" && (
          <>
            <div
              aria-hidden="true"
              className="fixed inset-0 z-40 cursor-default"
              onPointerDown={() => closeMenu(true)}
            />
            <div
              ref={workspaceMenuRef}
              id="studio-workspace-menu"
              role="menu"
              aria-label="Studio workspaces"
              onKeyDown={handleMenuKeyDown}
              className="absolute left-1/2 top-full z-50 mt-2 w-56 -translate-x-1/2 rounded-lg border border-border bg-panel p-1 shadow-xl"
            >
              {STUDIO_WORKSPACES.map((workspace) => {
                const Icon = WORKSPACE_ICONS[workspace.id];
                const state = commandState(registry, workspace.commandId, commandContext);
                const disabled = !state.enabled;
                return (
                  <a
                    key={workspace.id}
                    role="menuitem"
                    tabIndex={-1}
                    href={workspace.href}
                    data-workspace-id={workspace.id}
                    aria-current={activeWorkspace === workspace.id ? "page" : undefined}
                    aria-disabled={disabled || undefined}
                    title={disabled ? state.reason : workspace.description}
                    onClick={(event) => {
                      executeWorkspace(event, workspace.commandId);
                      if (!disabled && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                        closeMenu(true);
                      }
                    }}
                    className={[
                      "flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium",
                      activeWorkspace === workspace.id
                        ? "bg-accent text-white"
                        : "text-textMuted hover:bg-white/5 hover:text-textMain",
                      disabled ? "pointer-events-none opacity-35" : "",
                    ].join(" ")}
                  >
                    <Icon size={14} strokeWidth={1.8} />
                    <span>{workspace.label}</span>
                  </a>
                );
              })}
            </div>
          </>
        )}
      </div>

      <nav aria-label="Studio workspaces" className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-lg border border-white/5 bg-surface/50 p-1 backdrop-blur-sm xl:flex">
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

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {onOpenJobCenter ? (
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={isJobCenterOpen}
            aria-label={`Open Job Center, ${jobSummary.active} active ${jobSummary.active === 1 ? "job" : "jobs"}, ${jobSummary.total} visible ${jobSummary.total === 1 ? "job" : "jobs"}`}
            title={`${jobSummary.active} active · ${jobSummary.total} visible jobs`}
            onClick={() => {
              closeMenu(false);
              onOpenJobCenter();
            }}
            className="relative inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 bg-surface px-2 text-textMuted transition-colors hover:bg-white/10 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Activity size={15} strokeWidth={1.8} aria-hidden="true" />
            <span className="hidden text-[11px] font-semibold md:inline">Jobs</span>
            {jobSummary.total > 0 ? (
              <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[9px] font-bold leading-4 text-white">
                {jobSummary.active > 99 ? "99+" : jobSummary.active}/
                {jobSummary.total > 99 ? "99+" : jobSummary.total}
              </span>
            ) : null}
          </button>
        ) : null}
        <a
          href={getStudioWorkspace("export").href}
          data-command-id={exportCommandId}
          aria-label="Export"
          aria-disabled={exportDisabled || undefined}
          title={exportDisabled ? exportState.reason : registry.getCommand(exportCommandId).description}
          onClick={(event) => executeWorkspace(event, exportCommandId)}
          className={[
            "inline-flex items-center gap-2 rounded-md border border-white/10 bg-surface px-2.5 py-1.5 text-xs font-medium text-textMain transition-colors hover:bg-white/10 sm:px-3",
            exportDisabled ? "pointer-events-none opacity-35" : "",
          ].join(" ")}
        >
          <Download size={14} strokeWidth={1.8} />
          <span className="hidden sm:inline">Export</span>
        </a>
        <div className="hidden items-center gap-1 border-l border-white/10 pl-2 sm:flex">
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
