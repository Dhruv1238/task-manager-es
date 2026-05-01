import { useEffect, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import Modal from '../ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import {
  createMember,
  generateTempPassword,
  type CreateMemberResult,
} from '../../lib/createMember'
import type { GlobalRole } from '../../types/models'

const ROLE_OPTIONS: { value: GlobalRole; label: string; hint: string }[] = [
  { value: 'user', label: 'User', hint: 'Default — team members and individual contributors' },
  { value: 'horizontal_lead', label: 'Horizontal Lead', hint: 'Leads a horizontal team (2D, 3D, VE)' },
  { value: 'admin', label: 'Admin (VH pool)', hint: 'Eligible to be assigned as a Vertical Head' },
  { value: 'super_admin', label: 'Super Admin', hint: 'Tender team — creates projects, allocates VHs' },
]

interface Props {
  open: boolean
  onClose: () => void
  onCreated?: (result: CreateMemberResult) => void
}

function friendlyError(err: unknown): string {
  if (err instanceof FirebaseError) {
    switch (err.code) {
      case 'auth/email-already-in-use':
        return 'A user with that email already exists.'
      case 'auth/invalid-email':
        return 'That email address looks invalid.'
      case 'auth/weak-password':
        return 'The generated password was too weak. Try again.'
      case 'auth/network-request-failed':
        return 'Network error. Check your connection and try again.'
      default:
        return err.message
    }
  }
  return err instanceof Error ? err.message : 'Something went wrong.'
}

export default function NewMemberModal({ open, onClose, onCreated }: Props) {
  const { user, profile } = useAuth()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [globalRole, setGlobalRole] = useState<GlobalRole>('user')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CreateMemberResult | null>(null)
  const [copied, setCopied] = useState(false)

  // Only super admins can pick a role at creation time. Admins can still create
  // 'user'-level members for team rosters (back-compat with v1 flow).
  const canPickRole = profile?.globalRole === 'super_admin'

  useEffect(() => {
    if (!open) {
      setEmail('')
      setDisplayName('')
      setGlobalRole('user')
      setError(null)
      setSubmitting(false)
      setResult(null)
      setCopied(false)
    }
  }, [open])

  async function handleSubmit() {
    if (!user) return
    setError(null)
    setSubmitting(true)
    try {
      const tempPassword = generateTempPassword()
      const res = await createMember(
        email.trim(),
        displayName.trim(),
        tempPassword,
        user.uid,
        canPickRole ? globalRole : 'user',
      )
      setResult(res)
      onCreated?.(res)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCopy() {
    if (!result) return
    await navigator.clipboard.writeText(`ID: ${result.email} \nPassword: ${result.tempPassword}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const inputCls =
    'w-full rounded-lg border border-white/10 bg-white/4 px-4 py-3 text-white placeholder-white/30 outline-none transition focus:border-purple-400/60 focus:bg-white/6 focus:ring-2 focus:ring-purple-500/20'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={result ? 'Member created' : 'New member'}
      description={
        result
          ? 'Share these credentials with the user out-of-band.'
          : 'Provision a new workspace account. A temporary password is generated automatically.'
      }
      closeOnBackdrop={!submitting}
    >
      {result ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-white/10 bg-white/3 p-5">
            <div className="text-xs uppercase tracking-wider text-white/40">Email</div>
            <div className="mt-1 font-mono text-sm text-white">{result.email}</div>
            <div className="mt-4 text-xs uppercase tracking-wider text-white/40">
              Temporary password
            </div>
            <div className="mt-1 font-mono text-sm text-white">{result.tempPassword}</div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleCopy}
              className="flex-1 rounded-lg border border-white/10 bg-white/4 px-4 py-3 text-sm font-medium text-white/90 transition hover:bg-white/8"
            >
              {copied ? 'Copied!' : 'Copy credentials'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg bg-linear-to-r from-purple-500 to-fuchsia-500 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover:from-purple-400 hover:to-fuchsia-400"
            >
              Done
            </button>
          </div>

          <p className="text-center text-xs text-white/40">
            You can always look up this password from the Members page.
          </p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void handleSubmit()
          }}
          className="space-y-5"
          noValidate
        >
          <div className="space-y-1.5">
            <label htmlFor="member-name" className="text-sm font-medium text-white/80">
              Display name
            </label>
            <input
              id="member-name"
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Alex Morgan"
              autoComplete="off"
              className={inputCls}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="member-email" className="text-sm font-medium text-white/80">
              Email
            </label>
            <input
              id="member-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@company.com"
              autoComplete="off"
              className={inputCls}
            />
          </div>

          {canPickRole && (
            <div className="space-y-1.5">
              <label htmlFor="member-role" className="text-sm font-medium text-white/80">
                Role
              </label>
              <select
                id="member-role"
                value={globalRole}
                onChange={(e) => setGlobalRole(e.target.value as GlobalRole)}
                className={inputCls}
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-[#11111a]">
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-white/40">
                {ROLE_OPTIONS.find((r) => r.value === globalRole)?.hint}
              </p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
            >
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 rounded-lg border border-white/10 bg-white/4 px-4 py-3 text-sm font-medium text-white/80 transition hover:bg-white/8 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !email || !displayName}
              className="flex-1 rounded-lg bg-linear-to-r from-purple-500 to-fuchsia-500 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover:from-purple-400 hover:to-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Creating…
                </span>
              ) : (
                'Create member'
              )}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}