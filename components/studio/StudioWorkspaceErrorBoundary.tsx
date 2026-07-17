import React from "react";

interface StudioWorkspaceErrorBoundaryProps {
  readonly children: React.ReactNode;
  readonly resetKey: string;
}

interface StudioWorkspaceErrorBoundaryState {
  readonly error: Error | null;
}

/**
 * Keeps a render failure local to the active workspace and gives the user a
 * deterministic recovery action. The shell/header remain mounted so a
 * broken feature cannot strand the whole Studio.
 */
export default class StudioWorkspaceErrorBoundary extends React.Component<
  StudioWorkspaceErrorBoundaryProps,
  StudioWorkspaceErrorBoundaryState
> {
  state: StudioWorkspaceErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): StudioWorkspaceErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(previousProps: StudioWorkspaceErrorBoundaryProps): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <section
        role="alert"
        aria-labelledby="studio-workspace-error-title"
        className="absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-workspace p-5 sm:p-8"
      >
        <div className="w-full max-w-xl rounded-2xl border border-rose-300/20 bg-panel/90 p-6 text-center shadow-modal backdrop-blur-md sm:p-8">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-rose-200/80">Workspace recovery</p>
          <h1 id="studio-workspace-error-title" className="mt-2 text-xl font-bold text-textMain">This workspace needs a retry</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-textMuted">
            The current tool stopped rendering safely. Your project data is still held by the Studio; retry the workspace or switch to another one.
          </p>
          <button
            type="button"
            aria-label="Retry workspace"
            onClick={this.retry}
            className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white shadow-glow hover:bg-accentHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Retry workspace
          </button>
        </div>
      </section>
    );
  }
}
