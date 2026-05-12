import { Link, useLocation } from 'react-router-dom'

export default function NotFound() {
  const location = useLocation()

  return (
    <main className="relative isolate flex min-h-[calc(100vh-4rem)] items-center justify-center overflow-hidden px-4 py-16 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-orb-a blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-orb-b blur-3xl" />

      <div className="relative z-10 max-w-lg text-center">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand/80">
          Error 404
        </p>
        <h1 className="mt-4 text-7xl font-semibold tracking-tight text-fg sm:text-8xl">
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage:
                'linear-gradient(to bottom right, var(--color-fg), var(--color-brand-from), var(--color-brand-to))',
            }}
          >
            Page not found
          </span>
        </h1>
        <p className="mt-5 text-base text-fg-muted">
          We couldn't find anything at{' '}
          <code className="rounded bg-fill-2 px-1.5 py-0.5 text-sm text-fg-muted">
            {location.pathname}
          </code>
          . The link may be stale, or the resource was removed.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12 12 3l9 9" />
              <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
            </svg>
            Back to Home
          </Link>
          <Link
            to="/me"
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-fill-2 px-4 py-2.5 text-sm font-medium text-fg-strong transition hover:bg-fill-4 hover:text-fg"
          >
            Open My Tasks
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </div>
      </div>
    </main>
  )
}