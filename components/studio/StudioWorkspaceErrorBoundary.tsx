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
        className="absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-workspace p-4 sm:p-6"
      >
        <div className="studio-empty-card border-rose-300/25">
          <h1 id="studio-workspace-error-title" className="text-lg font-semibold text-textMain">
            This workspace needs a retry
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-textMuted">
            This tool stopped rendering. Project data is still held.
          </p>
          <button
            type="button"
            aria-label="Retry workspace"
            onClick={this.retry}
            className="mt-5 inline-flex min-h-10 items-center justify-center rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white shadow-glow hover:bg-accentHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Retry workspace
          </button>
        </div>
      </section>
    );
  }
}
