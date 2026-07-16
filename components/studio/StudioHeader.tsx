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
  Pencil,
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
  readonly projectName?: string;
  readonly projectPersistenceState?: "loading" | "saved" | "saving" | "error";
  readonly projectPersistenceMessage?: string | null;
  readonly onRenameProject?: (name: string) => string | null;
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

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
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
  projectName = "Untitled project",
  projectPersistenceState = "saved",
  projectPersistenceMessage = null,
  onRenameProject,
}) => {
  const [openMenu, setOpenMenu] = useState<OpenHeaderMenu>(null);
  const projectTriggerRef = useRef<HTMLButtonElement>(null);
  const workspaceTriggerRef = useRef<HTMLButtonElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(projectName);
  const [renameError, setRenameError] = useState<string | null>(null);
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

  useEffect(() => {
    if (!renaming) {
      setRenameDraft(projectName);
      setRenameError(null);
      return;
    }
    window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [projectName, renaming]);

  useEffect(() => {
    if (openMenu === "project" || !renaming) return;
    setRenaming(false);
    setRenameDraft(projectName);
    setRenameError(null);
  }, [openMenu, projectName, renaming]);

  const cancelRename = () => {
    setRenaming(false);
    setRenameDraft(projectName);
    setRenameError(null);
    window.requestAnimationFrame(() => {
      projectMenuRef.current?.querySelector<HTMLElement>('[data-project-rename-trigger]')?.focus();
    });
  };

  const submitRename = () => {
    const normalized = renameDraft.trim();
    if (!normalized) {
      setRenameError("Project name is required.");
      renameInputRef.current?.focus();
      return;
    }
    if (normalized.length > 120 || hasControlCharacters(normalized)) {
      setRenameError("Use 120 characters or fewer without control characters.");
      renameInputRef.current?.focus();
      return;
    }
    const error = onRenameProject?.(normalized) ?? null;
    if (error) {
      setRenameError(error);
      renameInputRef.current?.focus();
      return;
    }
    setRenaming(false);
    setRenameError(null);
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab") {
      closeMenu(false);
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
            aria-label="Project"
            title={`Current project: ${projectName}`}
            aria-haspopup="menu"
            aria-expanded={openMenu === "project"}
            aria-controls="studio-project-menu"
            onClick={() => setOpenMenu((current) => current === "project" ? null : "project")}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-textMuted transition-colors hover:bg-white/5 hover:text-white sm:px-3"
          >
            <span className="max-w-32 truncate">{projectName}</span>
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
                <div className="border-b border-white/5 px-3 py-2.5">
                  {renaming ? (
                    <form
                      aria-label="Rename project"
                      onSubmit={(event) => {
                        event.preventDefault();
                        submitRename();
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Escape") return;
                        event.preventDefault();
                        event.stopPropagation();
                        cancelRename();
                      }}
                    >
                      <label htmlFor="studio-project-name" className="text-[10px] font-bold uppercase tracking-wider text-textMuted">
                        Project name
                      </label>
                      <div className="mt-1.5 flex gap-1.5">
                        <input
                          ref={renameInputRef}
                          id="studio-project-name"
                          value={renameDraft}
                          maxLength={120}
                          aria-invalid={Boolean(renameError)}
                          aria-describedby={renameError ? "studio-project-name-error" : undefined}
                          onChange={(event) => {
                            setRenameDraft(event.target.value);
                            setRenameError(null);
                          }}
                          onKeyDown={(event) => {
                            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                              event.stopPropagation();
                            }
                          }}
                          className="min-w-0 flex-1 rounded-md border border-white/10 bg-input px-2 py-1.5 text-xs text-textMain outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-accent/40 bg-accent/15 px-2 text-[10px] font-bold text-accent hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          Save
                        </button>
                      </div>
                      {renameError ? (
                        <p id="studio-project-name-error" role="alert" className="mt-1.5 text-[10px] leading-4 text-red-300">
                          {renameError}
                        </p>
                      ) : null}
                    </form>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      data-project-rename-trigger
                      disabled={!onRenameProject}
                      onClick={() => setRenaming(true)}
                      className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs text-textMain hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                    >
                      <Pencil size={13} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{projectName}</span>
                      <span className="sr-only">Rename project</span>
                    </button>
                  )}
                  <p
                    role={projectPersistenceState === "error" ? "alert" : "status"}
                    aria-live="polite"
                    className={`mt-1.5 text-[9px] ${projectPersistenceState === "error" ? "text-red-300" : "text-textMuted"}`}
                  >
                    {projectPersistenceMessage ?? (
                      projectPersistenceState === "loading" ? "Loading project…"
                        : projectPersistenceState === "saving" ? "Saving…"
                          : projectPersistenceState === "error" ? "Not saved"
                            : "Saved locally"
                    )}
                  </p>
                </div>
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
