import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Custom fallback; receives the error and a function that clears it and renders the children again. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
  /** Called once per caught error, e.g. to report it. */
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render, lifecycle and lazy-chunk errors below it and shows them instead of leaving a blank window.
 * Mounted at the root in main.tsx so every window is covered; wrap a subtree with a `fallback` to contain
 * an error locally. Errors in event handlers and async code are not caught by React boundaries.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Unhandled render error:", error, info.componentStack);
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return <DefaultFallback error={error} reset={this.reset} />;
  }
}

// Plain markup and inline text on purpose: it may render above the i18n provider or when styles failed to load.
const DefaultFallback: React.FC<{ error: Error; reset: () => void }> = ({ error, reset }) => (
  <div className="flex h-screen w-screen flex-col gap-3 overflow-auto bg-slate-950 p-4 text-slate-200">
    <div className="flex items-center gap-2">
      <span className="text-sm font-bold text-rose-300">發生未預期的錯誤 / Unexpected error</span>
      <button
        type="button"
        onClick={reset}
        className="rounded-md border border-white/15 px-2.5 py-1 text-xs hover:bg-white/10"
      >
        重試 / Retry
      </button>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md border border-white/15 px-2.5 py-1 text-xs hover:bg-white/10"
      >
        重新載入 / Reload
      </button>
    </div>
    <pre className="whitespace-pre-wrap break-words font-mono text-xs text-rose-300">
      {`${error.name}: ${error.message}\n\n${error.stack ?? ""}`}
    </pre>
  </div>
);
