import { Component, type ReactNode } from "react";

/** A bug in one view should never leave the learner staring at a blank page. Their topics are untouched. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="boot" style={{ flexDirection: "column", gap: 14, padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 620, color: "var(--text)" }}>Something broke in the interface.</div>
        <div style={{ maxWidth: 520, lineHeight: 1.6 }}>Your topics are safe. Reloading usually fixes it.</div>
        <code style={{ maxWidth: 640, fontFamily: "var(--mono)", fontSize: 12, color: "var(--rose)", overflowWrap: "anywhere" }}>{this.state.error.message}</code>
        <button className="btn primary" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}
