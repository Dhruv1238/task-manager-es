import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { useAuth } from '../contexts/AuthContext'
import Logo from '../components/Logo'

function friendlyError(err: unknown): string {
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
      default:
        return err.message
    }
  }
  return err instanceof Error ? err.message : 'Something went wrong.'
}

export default function Login() {
  const { user, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const redirectTo = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (user) return <Navigate to={redirectTo} replace />

  async function onSubmit() {
    setError(null)
    setSubmitting(true)
    try {
      await signIn(email.trim(), password)
      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#07070c] text-white">
      {/* Ambient gradient orbs */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-135 w-135 rounded-full bg-purple-600/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-32 h-130 w-130 rounded-full bg-fuchsia-500/20 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-95 w-95 -translate-x-1/2 rounded-full bg-indigo-500/10 blur-3xl" />

      {/* Subtle grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 75%)',
        }}
      />

      <div className="relative z-10 grid min-h-screen lg:grid-cols-2">
        {/* Left: brand panel */}
        <div className="hidden p-6 sm:p-10 lg:flex lg:justify-center">
          <div className="flex w-full max-w-md flex-col justify-between py-2">
            <Logo height={36} className="brightness-0 invert self-start" />
            <div className="space-y-6">
              <h1 className="text-5xl font-semibold leading-tight tracking-tight">
                Plan less. <span className="text-purple-300">Ship more.</span>
              </h1>
              <p className="text-lg text-white/60">
                A focused task workspace for teams that care about momentum. Track work, hand off
                cleanly, and keep everyone on the same page.
              </p>
              <div className="flex items-center gap-3 pt-4">
                <div className="flex -space-x-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-br from-purple-400 to-pink-400 text-xs font-semibold text-white ring-2 ring-[#07070c]">SJ</div>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-br from-indigo-400 to-purple-500 text-xs font-semibold text-white ring-2 ring-[#07070c]">AK</div>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-br from-fuchsia-400 to-purple-600 text-xs font-semibold text-white ring-2 ring-[#07070c]">MR</div>
                </div>
                <p className="text-sm text-white/50">Trusted by product teams at Eventstrat</p>
              </div>
            </div>
            <p className="text-xs text-white/40">© {new Date().getFullYear()} Eventstrat Labs. All rights reserved.</p>
          </div>
        </div>

        {/* Right: form panel */}
        <div className="flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md">
            <div className="mb-8 flex justify-center lg:hidden">
              <Logo height={32} className="brightness-0 invert" />
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/3 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
              <div className="mb-8">
                <h2 className="text-3xl font-semibold tracking-tight">Welcome back</h2>
                <p className="mt-2 text-sm text-white/50">
                  Sign in to your workspace to continue.
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void onSubmit()
                }}
                className="space-y-5"
                noValidate
              >
                <div className="space-y-1.5">
                  <label htmlFor="email" className="text-sm font-medium text-white/80">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full rounded-lg border border-white/10 bg-white/4 px-4 py-3 text-white placeholder-white/30 outline-none transition focus:border-purple-400/60 focus:bg-white/6 focus:ring-2 focus:ring-purple-500/20"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="password" className="text-sm font-medium text-white/80">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="text-xs text-white/50 transition hover:text-white/80"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-white/10 bg-white/4 px-4 py-3 text-white placeholder-white/30 outline-none transition focus:border-purple-400/60 focus:bg-white/6 focus:ring-2 focus:ring-purple-500/20"
                  />
                </div>

                {error && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !email || !password}
                  className="group relative w-full overflow-hidden rounded-lg bg-linear-to-r from-purple-500 to-fuchsia-500 px-4 py-3 font-medium text-white shadow-lg shadow-purple-900/40 transition hover:from-purple-400 hover:to-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="relative z-10 inline-flex items-center justify-center gap-2">
                    {submitting ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Signing in…
                      </>
                    ) : (
                      'Sign in'
                    )}
                  </span>
                </button>
              </form>

              <p className="mt-6 text-center text-xs text-white/40">
                Protected by enterprise-grade authentication.
              </p>
            </div>

            <p className="mt-6 text-center text-xs text-white/40 lg:hidden">
              © {new Date().getFullYear()} Eventstrat. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}