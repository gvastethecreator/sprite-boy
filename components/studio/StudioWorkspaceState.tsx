import type { ComponentType } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Clapperboard,
  Layers3,
  LoaderCircle,
  PackageCheck,
  Scissors,
  Target,
} from "lucide-react";
import type {
  StudioCommandContext,
  StudioCommandId,
  StudioCommandRegistry,
  StudioWorkspaceResolutionAction,
  StudioWorkspaceState,
} from "../../core/studio";

export interface StudioWorkspaceStateProps {
  readonly state: Exclude<StudioWorkspaceState, { readonly kind: "ready" }>;
  readonly registry: StudioCommandRegistry;
  readonly commandContext: StudioCommandContext;
  readonly onExecute: (commandId: StudioCommandId) => void;
  readonly onDismissError?: () => void;
}

const WORKSPACE_ICONS = {
  slice: Scissors,
  compose: Layers3,
  animate: Clapperboard,
  collision: Target,
  export: PackageCheck,
} as const satisfies Record<
  StudioWorkspaceState["workspaceId"],
  ComponentType<{ size?: number; strokeWidth?: number; className?: string; "aria-hidden"?: boolean }>
>;

interface ResolutionButtonProps {
  readonly action: StudioWorkspaceResolutionAction;
  readonly registry: StudioCommandRegistry;
  readonly commandContext: StudioCommandContext;
  readonly onExecute: (commandId: StudioCommandId) => void;
  readonly primary?: boolean;
}

function ResolutionButton({
  action,
  registry,
  commandContext,
  onExecute,
  primary = false,
}: ResolutionButtonProps) {
  const commandState = registry.getState(action.commandId, commandContext);
  const disabled = !commandState.enabled;
  return (
    <button
      type="button"
      data-command-id={action.commandId}
      disabled={disabled}
      title={disabled ? commandState.reason : registry.getCommand(action.commandId).description}
      onClick={() => {
        if (!disabled) onExecute(action.commandId);
      }}
      className={[
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-bold",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40",
        primary
          ? "bg-accent text-white shadow-glow hover:bg-accentHover"
          : "border border-white/10 bg-surface text-textMain hover:bg-white/10",
      ].join(" ")}
    >
      {action.label}
      {primary ? <ArrowRight size={14} aria-hidden="true" /> : null}
    </button>
  );
}

export function StudioWorkspaceStateView({
  state,
  registry,
  commandContext,
  onExecute,
  onDismissError,
}: StudioWorkspaceStateProps) {
  const WorkspaceIcon = WORKSPACE_ICONS[state.workspaceId];
  const titleId = `studio-${state.workspaceId}-${state.kind}-title`;
  const isLoading = state.kind === "loading";
  const isError = state.kind === "error";

  return (
    <section
      data-workspace-state={state.kind}
      data-workspace-state-id={state.workspaceId}
      aria-labelledby={titleId}
      aria-busy={isLoading || undefined}
      role={isError ? "alert" : isLoading ? "status" : undefined}
      aria-live={isError ? "assertive" : isLoading ? "polite" : undefined}
      className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-workspace p-5 sm:p-8"
    >
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-panel/85 p-6 text-center shadow-modal backdrop-blur-md sm:p-8">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-surface text-accent">
          {isLoading ? (
            <LoaderCircle className="motion-safe:animate-spin" size={28} aria-hidden="true" />
          ) : isError ? (
            <AlertTriangle className="text-amber-400" size={28} aria-hidden="true" />
          ) : (
            <WorkspaceIcon size={28} strokeWidth={1.6} aria-hidden="true" />
          )}
        </div>

        <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-textMuted">
          {state.workspaceLabel} workspace
        </p>
        <h1 id={titleId} className="text-xl font-bold tracking-tight text-textMain sm:text-2xl">
          {state.title}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-textMuted">
          {state.description}
        </p>

        {state.kind === "empty" ? (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <ResolutionButton
              action={state.primaryAction}
              registry={registry}
              commandContext={commandContext}
              onExecute={onExecute}
              primary
            />
            {state.secondaryAction ? (
              <ResolutionButton
                action={state.secondaryAction}
                registry={registry}
                commandContext={commandContext}
                onExecute={onExecute}
              />
            ) : null}
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {state.retryCommandId ? (
              <ResolutionButton
                action={{ commandId: state.retryCommandId, label: "Try again" }}
                registry={registry}
                commandContext={commandContext}
                onExecute={onExecute}
                primary
              />
            ) : null}
            {onDismissError ? (
              <button
                type="button"
                onClick={onDismissError}
                className="min-h-10 rounded-lg border border-white/10 bg-surface px-4 py-2 text-xs font-bold text-textMain hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Dismiss
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default StudioWorkspaceStateView;
