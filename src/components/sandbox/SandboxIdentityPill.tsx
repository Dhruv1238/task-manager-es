/**
 * Navbar-embedded sandbox identity + persona switcher. Replaces the email-pill
 * slot in the Navbar (sandbox builds only). Shows the currently-acting persona
 * (or the visitor themselves) and opens a popover to switch.
 *
 * Replaces the floating bottom-right `PersonaSwitcher` from S3 — having the
 * pill in the navbar collides less with capture toasts and keeps identity
 * + role context grouped with the rest of the user surface.
 */

import { useEffect, useRef, useState } from 'react'
import { getDocs } from 'firebase/firestore'
import { useAuth } from '../../contexts/AuthContext'
import { tenantCol } from '../../lib/firestore'
import { sandboxAvatar } from '../../lib/sandboxAvatar'
import type { User } from '../../types/models'

export default function SandboxIdentityPill() {
  const { user, profile, actAsUid, effectiveProfile, setActAs } = useAuth()
  const [open, setOpen] = useState(false)
  const [personas, setPersonas] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  // Load personas (other user docs in this sandbox tenant) lazily on first open.
  useEffect(() => {
    if (!open || personas.length > 0) return
    let cancelled = false
    setLoading(true)
    getDocs(tenantCol('users'))
      .then((snap) => {
        if (cancelled) return
        setPersonas(snap.docs.map((d) => d.data() as User))
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, personas.length])

  // Open via the "sandbox:openPersonaSwitcher" event (TryThisStrip uses this).
  useEffect(() => {
    const onEvt = () => setOpen(true)
    window.addEventListener('sandbox:openPersonaSwitcher', onEvt)
    return () => window.removeEventListener('sandbox:openPersonaSwitcher', onEvt)
  }, [])

  // Click-outside + Escape to close
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user || !profile) return null

  // Prefer the streamed `effectiveProfile` from AuthContext over the locally-
  // loaded personas list — the AuthContext subscription updates the instant
  // `actAsUid` flips (including when the tour switches persona programmatically),
  // whereas the personas list only loads when the popover is opened.
  const isActing = Boolean(actAsUid && effectiveProfile && effectiveProfile.uid !== profile.uid)
  const display = isActing && effectiveProfile ? effectiveProfile : profile
  const avatar = sandboxAvatar(display.uid, display.displayName)
  const subline = isActing ? 'Acting as' : 'Signed in'

  return (
    <div ref={ref} data-tour-id="persona-switcher" className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`hidden items-center gap-2.5 rounded-full border py-1.5 pl-1.5 pr-3 transition sm:flex ${
          isActing
            ? 'border-[var(--sandbox-accent,#a78bfa)]/40 bg-[var(--sandbox-accent,#a78bfa)]/10'
            : 'border-line bg-fill-2 hover:bg-fill-3'
        }`}
      >
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold"
          style={{ background: avatar.bg, color: avatar.fg }}
          aria-hidden
        >
          {avatar.initials}
        </span>
        <span className="text-left">
          <span className="block text-[10px] font-medium uppercase leading-tight tracking-wider text-fg-subtle">
            {subline}
          </span>
          <span className="block max-w-[160px] truncate text-xs font-medium leading-tight text-fg">
            {display.displayName ?? user.email ?? 'You'}
          </span>
        </span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="ml-0.5 text-fg-subtle" aria-hidden>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Mobile compact: avatar only, opens same popover */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={display.displayName ?? user.email ?? undefined}
        className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white sm:hidden"
        style={{ background: avatar.bg, color: avatar.fg }}
      >
        {avatar.initials}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Switch persona"
          className="absolute right-0 z-[65] mt-2 max-h-[60vh] w-[min(92vw,320px)] overflow-y-auto rounded-2xl border border-line bg-card/95 p-2 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.35)] backdrop-blur-md"
        >
          <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
            Acting as
          </div>
          {loading ? (
            <div className="px-3 py-4 text-center text-sm text-fg-subtle">Loading personas…</div>
          ) : (
            <ul className="space-y-0.5">
              <li>
                <PersonaRow
                  name={profile.displayName ?? user.email ?? 'You'}
                  role="You (super_admin)"
                  uid={profile.uid}
                  active={!actAsUid}
                  onSelect={() => {
                    setActAs(null)
                    setOpen(false)
                  }}
                />
              </li>
              {personas
                .filter((p) => p.uid !== profile.uid)
                .map((p) => (
                  <li key={p.uid}>
                    <PersonaRow
                      name={p.displayName}
                      role={roleLabel(p.globalRole)}
                      uid={p.uid}
                      active={actAsUid === p.uid}
                      onSelect={() => {
                        setActAs(p.uid)
                        setOpen(false)
                      }}
                    />
                  </li>
                ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

function PersonaRow({
  name,
  role,
  uid,
  active,
  onSelect,
}: {
  name: string
  role: string
  uid: string
  active: boolean
  onSelect: () => void
}) {
  const avatar = sandboxAvatar(uid, name)
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${
        active ? 'bg-[var(--sandbox-accent,#a78bfa)]/12' : 'hover:bg-fill-2'
      }`}
    >
      <span
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
        style={{ background: avatar.bg, color: avatar.fg }}
        aria-hidden
      >
        {avatar.initials}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block truncate text-sm font-medium text-fg">{name}</span>
        <span className="block truncate text-[11px] text-fg-subtle">{role}</span>
      </span>
      {active ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[var(--sandbox-accent,#a78bfa)]" aria-hidden>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : null}
    </button>
  )
}

function roleLabel(role: string): string {
  switch (role) {
    case 'super_admin':
      return 'Super Admin'
    case 'admin':
      return 'Vertical Head'
    case 'horizontal_lead':
      return 'Horizontal Lead'
    default:
      return 'Team Member'
  }
}
