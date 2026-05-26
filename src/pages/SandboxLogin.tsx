/**
 * Sandbox-only entry screen. Replaces Login.tsx when __IS_SANDBOX__ is true.
 * Mirrors the production Login.tsx layout (gradient orbs + subtle grid +
 * headline column + sign-in column) so the sandbox feels like a first-class
 * surface, not a stripped-down imitation.
 *
 * The auth content is the only deliberate divergence: instead of an
 * email/password form alongside Google, both paths are presented as polished
 * primary actions inside a single card — Continue with Google, then a small
 * inset card with Name (optional) + Email + Continue for the email path.
 */

import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { useAuth } from '../contexts/AuthContext'
import Logo from '../components/Logo'
import { initSandboxBoot } from '../lib/sandboxBoot'
import { captureEntry } from '../lib/leadCapture'

const PENDING_EMAIL_KEY = 'sandbox:pendingEmail'
const PENDING_NAME_KEY = 'sandbox:pendingName'

function isLikelyEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

function friendlyError(err: unknown): string {
  if (err instanceof FirebaseError) {
    if (err.code === 'auth/popup-closed-by-user') return 'Sign-in cancelled.'
    if (err.code === 'auth/popup-blocked')
      return 'Your browser blocked the sign-in popup. Allow popups and try again.'
    if (err.code === 'auth/network-request-failed')
      return 'Network error. Check your connection and try again.'
    return err.message
  }
  return err instanceof Error ? err.message : 'Something went wrong.'
}

export default function SandboxLogin() {
  const { user, signInWithGoogle } = useAuth()
  const location = useLocation()
  const redirectTo =
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/'

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState<null | 'google' | 'email'>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const cachedEmail = localStorage.getItem(PENDING_EMAIL_KEY)
    if (cachedEmail) setEmail(cachedEmail)
    const cachedName = localStorage.getItem(PENDING_NAME_KEY)
    if (cachedName) setName(cachedName)
  }, [])

  if (user) return <Navigate to={redirectTo} replace />

  async function onGoogle() {
    setError(null)
    setSubmitting('google')
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(friendlyError(err))
      setSubmitting(null)
    }
  }

  async function onEmail() {
    setError(null)
    const trimmed = email.trim()
    if (!isLikelyEmail(trimmed)) {
      setError('That email address looks invalid.')
      return
    }
    setSubmitting('email')
    const trimmedName = name.trim() || undefined
    try {
      localStorage.setItem(PENDING_EMAIL_KEY, trimmed)
      if (trimmedName) localStorage.setItem(PENDING_NAME_KEY, trimmedName)
      else localStorage.removeItem(PENDING_NAME_KEY)
      await initSandboxBoot({ pendingEmail: trimmed, pendingName: trimmedName })
      const uid = (await import('../lib/firebase')).auth.currentUser?.uid
      if (uid) await captureEntry({ uid, email: trimmed, name: trimmedName })
    } catch (err) {
      setError(friendlyError(err))
      setSubmitting(null)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas text-fg">
      {/* Ambient gradient orbs — same treatment as the production Login. */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-135 w-135 rounded-full bg-orb-a blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-32 h-130 w-130 rounded-full bg-orb-b blur-3xl" />

      {/* Subtle grid */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(var(--color-fg) 1px, transparent 1px), linear-gradient(90deg, var(--color-fg) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at center, black 35%, transparent 85%)',
        }}
      />

      <div className="relative z-10 grid min-h-screen grid-rows-[auto_1fr_auto] gap-10 p-6 sm:p-8 lg:px-24 lg:py-12 xl:px-40">
        <header className="flex items-center justify-between">
          <Logo height={30} />
          {/* <span className="rounded-full border border-[var(--sandbox-accent,#a78bfa)]/40 bg-[var(--sandbox-accent,#a78bfa)]/10 px-3 py-1 text-xs font-medium tracking-wide text-[var(--sandbox-accent,#a78bfa)]">
            Sandbox
          </span> */}
        </header>

        <main className="grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
          {/* Display headline */}
          <div className="lg:col-span-6">
            <h1 className="text-[clamp(2rem,5vw,3.75rem)] font-bold leading-[1.05] tracking-[-0.02em]">
              Plan less. <span className="text-brand">Ship more.</span>
            </h1>
            <p className="mt-6 max-w-md text-base text-fg-muted sm:text-lg">
              Set up your team in two minutes, run a real tender end-to-end, then build a
              workflow that fits the way you actually work.
            </p>
            <div className="mt-8 flex items-center gap-3">
              <div className="flex -space-x-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-br from-purple-400 to-pink-400 text-xs font-semibold text-white ring-2 ring-canvas">
                  SJ
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-br from-indigo-400 to-purple-500 text-xs font-semibold text-white ring-2 ring-canvas">
                  AK
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-br from-fuchsia-400 to-purple-600 text-xs font-semibold text-white ring-2 ring-canvas">
                  MR
                </div>
              </div>
              <p className="text-sm text-fg-subtle">
                Used by product + creative teams at Eventstrat
              </p>
            </div>
          </div>

          {/* Sign-in column */}
          <div className="lg:col-span-6">
            <div className="w-full max-w-xl lg:ml-auto">
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Try the platform
              </h2>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                No signup. Your sandbox is yours alone.
              </p>

              {/* Google — primary CTA (matches production Login's Google pill) */}
              <button
                type="button"
                onClick={onGoogle}
                disabled={submitting !== null}
                className="group relative mt-7 flex w-full items-center justify-between gap-3 rounded-full border border-line bg-surface px-5 py-4 text-base font-medium text-fg shadow-[0_8px_24px_-12px_rgba(0,0,0,0.4)] transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-edge hover:bg-elevated hover:shadow-[0_18px_40px_-12px_var(--color-brand-ring)] focus:outline-none focus:ring-2 focus:ring-brand-ring focus:ring-offset-2 focus:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                <span className="flex items-center gap-3">
                  {submitting === 'google' ? (
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-fg" />
                  ) : (
                    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.5 12c0-.72.13-1.43.34-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
                    </svg>
                  )}
                  <span>{submitting === 'google' ? 'Signing in…' : 'Continue with Google'}</span>
                </span>
                <svg
                  className="h-4 w-4 text-fg-subtle transition-transform duration-300 group-hover:translate-x-1 group-hover:text-fg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>

              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-line" />
                <span className="text-xs uppercase tracking-wider text-fg-subtle">or continue with email</span>
                <div className="h-px flex-1 bg-line" />
              </div>

              {/* Email path — wrapped in its own card so the inputs read as a
                  cohesive unit equal in weight to the Google button above. */}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void onEmail()
                }}
                noValidate
                className="rounded-2xl border border-line bg-fill-2/60 p-5 backdrop-blur-sm transition focus-within:border-brand-edge"
              >
                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-fg-subtle">
                      Name <span className="font-normal text-fg-faint">(optional)</span>
                    </span>
                    <input
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={submitting !== null}
                      placeholder="Your name"
                      className="h-11 w-full rounded-lg border border-line bg-canvas/60 px-3.5 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-canvas focus:ring-2 focus:ring-brand-ring disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-fg-subtle">Work email</span>
                    <input
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={submitting !== null}
                      placeholder="you@company.com"
                      className="h-11 w-full rounded-lg border border-line bg-canvas/60 px-3.5 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-canvas focus:ring-2 focus:ring-brand-ring disabled:cursor-not-allowed disabled:opacity-60"
                      data-tour-id="sandbox-email"
                    />
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={submitting !== null || !email}
                  className="group relative mt-4 inline-flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-brand-gradient px-4 font-medium text-white shadow-lg shadow-purple-900/40 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="relative z-10 inline-flex items-center justify-center gap-2">
                    {submitting === 'email' ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                        Setting up your sandbox…
                      </>
                    ) : (
                      <>
                        Continue
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="transition-transform duration-300 group-hover:translate-x-0.5"
                          aria-hidden
                        >
                          <line x1="5" y1="12" x2="19" y2="12" />
                          <polyline points="12 5 19 12 12 19" />
                        </svg>
                      </>
                    )}
                  </span>
                </button>
              </form>

              {error ? (
                <div
                  role="alert"
                  className="mt-4 rounded-xl border border-tone-danger-bd bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg"
                >
                  {error}
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-fg-subtle">
                <span className="inline-flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Isolated workspace
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  60-second guided tour
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  No spam
                </span>
              </div>

              <p className="mt-6 text-xs text-fg-subtle">
                By continuing, you agree to our terms. We'll only email you if you ask us to.
              </p>
            </div>
          </div>
        </main>

        <footer className="text-xs text-fg-subtle">
          © {new Date().getFullYear()} Eventstrat Labs. All rights reserved.
        </footer>
      </div>
    </div>
  )
}
