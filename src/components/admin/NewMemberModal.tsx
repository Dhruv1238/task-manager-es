import { useEffect, useMemo, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import Modal from '../ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { useLeadRoleName } from '../../contexts/AppConfigContext'
import {
  createMember,
  generateTempPassword,
  type CreateMemberResult,
} from '../../lib/createMember'
import type { GlobalRole } from '../../types/models'

function buildRoleOptions(
  leadRoleName: string,
): { value: GlobalRole; label: string; hint: string }[] {
  return [
    { value: 'user', label: 'User', hint: 'Default — team members and individual contributors' },
    { value: 'horizontal_lead', label: 'Horizontal Lead', hint: 'Leads a horizontal team' },
    {
      value: 'admin',
      label: `Admin (${leadRoleName} pool)`,
      hint: `Eligible to be assigned as a ${leadRoleName}`,
    },
    {
      value: 'super_admin',
      label: 'Super Admin',
      hint: `Tender team — creates projects, allocates ${leadRoleName}s`,
    },
  ]
}

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
  const leadRoleName = useLeadRoleName()
  const roleOptions = useMemo(() => buildRoleOptions(leadRoleName), [leadRoleName])
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
        profile?.displayName ?? user.email ?? 'Admin',
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
    'w-full rounded-lg border border-line bg-fill-2 px-4 py-3 text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

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
          <div className="rounded-xl border border-line bg-card p-5">
            <div className="text-xs uppercase tracking-wider text-fg-subtle">Email</div>
            <div className="mt-1 font-mono text-sm text-fg">{result.email}</div>
            <div className="mt-4 text-xs uppercase tracking-wider text-fg-subtle">
              Temporary password
            </div>
            <div className="mt-1 font-mono text-sm text-fg">{result.tempPassword}</div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleCopy}
              className="flex-1 rounded-lg border border-line bg-fill-2 px-4 py-3 text-sm font-medium text-fg-strong transition hover:bg-fill-4"
            >
              {copied ? 'Copied!' : 'Copy credentials'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg bg-brand-gradient px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover-brand-gradient"
            >
              Done
            </button>
          </div>

          <p className="text-center text-xs text-fg-subtle">
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
            <label htmlFor="member-name" className="text-sm font-medium text-fg-muted">
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
            <label htmlFor="member-email" className="text-sm font-medium text-fg-muted">
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
              <label htmlFor="member-role" className="text-sm font-medium text-fg-muted">
                Role
              </label>
              <select
                id="member-role"
                value={globalRole}
                onChange={(e) => setGlobalRole(e.target.value as GlobalRole)}
                className={inputCls}
              >
                {roleOptions.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-overlay">
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-fg-subtle">
                {roleOptions.find((r) => r.value === globalRole)?.hint}
              </p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg"
            >
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 rounded-lg border border-line bg-fill-2 px-4 py-3 text-sm font-medium text-fg-muted transition hover:bg-fill-4 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !email || !displayName}
              className="flex-1 rounded-lg bg-brand-gradient px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-white" />
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