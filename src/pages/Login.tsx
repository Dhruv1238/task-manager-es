import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { useAuth } from '../contexts/AuthContext'
import Logo from '../components/Logo'

function friendlyError(err: unknown): string | null {
  if (err instanceof FirebaseError) {
    switch (err.code) {
      case 'auth/invalid-email':
        return 'That email address looks invalid.'
      case 'auth/user-disabled':
        return 'This account has been disabled.'
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Incorrect email or password.'
      case 'auth/too-many-requests':
        return 'Too many attempts. Please try again in a moment.'
      case 'auth/network-request-failed':
        return 'Network error. Check your connection and try again.'
      case 'auth/popup-closed-by-user':
        return 'Sign-in cancelled.'
      case 'auth/popup-blocked':
        return 'Your browser blocked the sign-in popup. Allow popups and try again.'
      case 'auth/cancelled-popup-request':
        return null
      case 'auth/account-exists-with-different-credential':
        return 'An account with this email uses a different sign-in method. Use email/password instead.'
      default:
        return err.message
    }
  }
  return err instanceof Error ? err.message : 'Something went wrong.'
}

// Flip to `true` to re-enable email/password sign-in alongside Google.
const SHOW_EMAIL_PASSWORD_LOGIN = false

export default function Login() {
  const { user, signIn, signInWithGoogle, signInError, clearSignInError } = useAuth()
  const location = useLocation()
  const redirectTo = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [googleSubmitting, setGoogleSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // If sign-in succeeds with Firebase auth but AuthContext rejects the profile
  // (e.g. UnregisteredEmailError), the user gets signed back out and signInError
  // is set. Without this, the form would stay locked behind the spinner forever.
  useEffect(() => {
    if (signInError) {
      setSubmitting(false)
      setGoogleSubmitting(false)
    }
  }, [signInError])

  if (user) return <Navigate to={redirectTo} replace />

  const displayedError = error ?? signInError

  async function onSubmit() {
    setError(null)
    clearSignInError()
    setSubmitting(true)
    try {
      await signIn(email.trim(), password)
      // Don't navigate or reset submitting. The <Navigate /> guard above
      // handles the redirect once AuthContext's user state propagates.
      // Resetting submitting here would race with the auth-state update and
      // briefly re-enable the form — including the Google button — leaving
      // it interactive while the profile fetch is still in flight.
    } catch (err) {
      setError(friendlyError(err))
      setSubmitting(false)
    }
  }

  async function onGoogleSignIn() {
    setError(null)
    clearSignInError()
    setGoogleSubmitting(true)
    try {
      await signInWithGoogle()
      // Same as above — let the <Navigate /> guard redirect on auth-state update.
    } catch (err) {
      setError(friendlyError(err))
      setGoogleSubmitting(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas text-fg">
      {/* Ambient gradient orbs (matches other shell screens) */}
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
        </header>

          <main className="grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
            {/* Display headline */}
            <div className="lg:col-span-6">
              <h1 className="text-[clamp(2rem,5vw,3.75rem)] font-bold leading-[1.05] tracking-[-0.02em]">
                Plan less. <span className="text-brand">Ship more.</span>
              </h1>
              <p className="mt-6 max-w-md text-base text-fg-muted sm:text-lg">
                A focused task workspace for teams that care about momentum. Track work, hand off
                cleanly, and keep everyone on the same page.
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
                <p className="text-sm text-fg-subtle">Trusted by product teams at Eventstrat</p>
              </div>
            </div>

            {/* Sign-in column — vertically centered alongside headline */}
            <div className="lg:col-span-6">
              <div className="w-full max-w-xl lg:ml-auto">
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  Welcome back
                </h2>
                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                  Sign in to your workspace
                </p>
                {SHOW_EMAIL_PASSWORD_LOGIN && (
                  <>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        void onSubmit()
                      }}
                      className="space-y-5"
                      noValidate
                    >
                      <div className="space-y-1.5">
                        <label htmlFor="email" className="text-sm font-medium text-fg-muted">
                          Email
                        </label>
                        <input
                          id="email"
                          type="email"
                          autoComplete="email"
                          required
                          disabled={submitting || googleSubmitting}
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@company.com"
                          className="w-full rounded-lg border border-line bg-fill-2 px-4 py-3 text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label htmlFor="password" className="text-sm font-medium text-fg-muted">
                            Password
                          </label>
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className="text-xs text-fg-subtle transition hover:text-fg-muted"
                          >
                            {showPassword ? 'Hide' : 'Show'}
                          </button>
                        </div>
                        <input
                          id="password"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="current-password"
                          required
                          disabled={submitting || googleSubmitting}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full rounded-lg border border-line bg-fill-2 px-4 py-3 text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={submitting || googleSubmitting || !email || !password}
                        className="group relative w-full overflow-hidden rounded-lg bg-brand-gradient px-4 py-3 font-medium text-white shadow-lg shadow-purple-900/40 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="relative z-10 inline-flex items-center justify-center gap-2">
                          {submitting ? (
                            <>
                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-white" />
                              Signing in…
                            </>
                          ) : (
                            'Sign in'
                          )}
                        </span>
                      </button>
                    </form>

                    <div className="my-6 flex items-center gap-3">
                      <div className="h-px flex-1 bg-line" />
                      <span className="text-xs uppercase tracking-wider text-fg-subtle">or</span>
                      <div className="h-px flex-1 bg-line" />
                    </div>
                  </>
                )}

                {displayedError && (
                  <div
                    role="alert"
                    className="mt-6 rounded-xl border border-tone-danger-bd bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg"
                  >
                    {displayedError}
                  </div>
                )}

                <button
                  type="button"
                  onClick={onGoogleSignIn}
                  disabled={submitting || googleSubmitting}
                  className="group relative mt-7 flex w-full items-center justify-between gap-3 rounded-full border border-line bg-surface px-5 py-4 text-base font-medium text-fg shadow-[0_8px_24px_-12px_rgba(0,0,0,0.4)] transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-edge hover:bg-elevated hover:shadow-[0_18px_40px_-12px_var(--color-brand-ring)] focus:outline-none focus:ring-2 focus:ring-brand-ring focus:ring-offset-2 focus:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  <span className="flex items-center gap-3">
                    {googleSubmitting ? (
                      <span className="h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-fg" />
                    ) : (
                      <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.5 12c0-.72.13-1.43.34-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
                      </svg>
                    )}
                    <span>{googleSubmitting ? 'Signing in…' : 'Continue with Google'}</span>
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

                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-fg-subtle">
                  <span className="inline-flex items-center gap-1.5">
                    <svg className="h-3.5 w-3.5 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    Secured by Google
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <svg className="h-3.5 w-3.5 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    SSO ready
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <svg className="h-3.5 w-3.5 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    No password required
                  </span>
                </div>
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