"use client";

import * as React from "react";

interface State { error: Error | null }

// Last line of defence: an unexpected error shows a calm recovery screen
// instead of a blank page. Nothing about the error's internals is shown.
export class ErrorBoundary extends React.Component<{ children: React.ReactNode; resetKey?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Screen error:", error);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    // Navigating to another screen clears the error
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">Something went wrong on this screen</h1>
        <p className="text-sm text-muted-foreground">Your saved data is safe. Go back to the home screen and try again. If it keeps happening, reset the demo data.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => { this.setState({ error: null }); window.location.hash = "/"; }}>
            Go to home
          </button>
          <button type="button" className="rounded-md border px-4 py-2 text-sm font-medium" onClick={() => {
            try { localStorage.removeItem("anmol-gas-demo:db"); } catch { /* storage blocked */ }
            window.location.hash = "/";
            window.location.reload();
          }}>
            Reset demo data
          </button>
        </div>
      </div>
    );
  }
}
