import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
  onReload?: () => void;
};

type AppErrorBoundaryState = {
  failed: boolean;
};

export default class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[LiftLog] Unexpected render failure", {
      error,
      componentStack: info.componentStack,
    });
  }

  private reload = () => {
    if (this.props.onReload) {
      this.props.onReload();
      return;
    }
    window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="auth-shell">
        <div
          className="auth-card"
          role="alert"
          aria-labelledby="unexpected-error-title"
        >
          <span className="auth-logo" aria-hidden="true">
            LL
          </span>
          <h2 id="unexpected-error-title">
            Lift Log hit an unexpected problem
          </h2>
          <p>Reload the app to safely try opening your training space again.</p>
          <div className="auth-loading-actions">
            <button
              className="button primary"
              type="button"
              onClick={this.reload}
            >
              Reload Lift Log
            </button>
          </div>
        </div>
      </main>
    );
  }
}
