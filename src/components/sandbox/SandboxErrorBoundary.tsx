/**
 * Top-level error boundary for sandbox builds. Catches anything that escapes
 * downstream components and surfaces a branded recovery screen rather than a
 * white screen of death — first impressions matter.
 *
 * Only mounted when __IS_SANDBOX__ is true.
 */

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class SandboxErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    if (typeof console !== 'undefined') {
      console.error('[sandbox] uncaught error:', error)
    }
  }

  private handleReset = () => {
    // Soft reset: clear local state and reload. Visitor's Firestore data is
    // intact; the reload re-enters the boot flow. If the underlying error was
    // a one-shot, this clears it.
    this.setState({ error: null })
    if (typeof window !== 'undefined') window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-canvas p-6">
          <div className="max-w-md rounded-2xl border border-line bg-card p-8 text-center shadow-lg">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--sandbox-accent,#a78bfa)]/15">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[var(--sandbox-accent,#a78bfa)]"
                aria-hidden
              >
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-fg">Something went sideways</h1>
            <p className="mt-2 text-sm text-fg-muted">
              The sandbox hit a snag. Your data's safe — refreshing usually clears this up.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={this.handleReset}
                className="rounded-lg bg-[var(--sandbox-accent,#a78bfa)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                Refresh
              </button>
            </div>
            {import.meta.env.DEV ? (
              <pre className="mt-6 max-h-32 overflow-auto rounded bg-fill-2 p-3 text-left text-[11px] text-fg-subtle">
                {this.state.error.message}
              </pre>
            ) : null}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
