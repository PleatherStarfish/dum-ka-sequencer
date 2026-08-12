/**
 * Root error boundary. Without it, any render/lifecycle exception anywhere in
 * the tree unmounts the entire app with no recovery path. This catches the
 * error, names it, and offers a reload. Deliberately inline-styled so the
 * fallback renders even when the stylesheet or theme state is part of the
 * failure.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message =
      this.state.error.message || String(this.state.error) || "Unknown error";
    return (
      <div
        role="alert"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          minHeight: "100vh",
          padding: "24px",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "18px", margin: 0 }}>
          Dum-Ka hit an unexpected error
        </h1>
        <pre
          style={{
            maxWidth: "640px",
            overflow: "auto",
            padding: "12px",
            border: "1px solid currentColor",
            borderRadius: "6px",
            fontSize: "12px",
            textAlign: "left",
            whiteSpace: "pre-wrap",
          }}
        >
          {message}
        </pre>
        <p style={{ margin: 0, fontSize: "13px" }}>
          Your last saved patch is untouched. Reload to continue.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ padding: "6px 16px", fontSize: "13px", cursor: "pointer" }}
        >
          Reload
        </button>
      </div>
    );
  }
}
