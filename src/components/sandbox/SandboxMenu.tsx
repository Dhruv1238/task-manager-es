/**
 * Sandbox-only navbar menu. Carries the Mode pill, Reset sandbox, Talk to us,
 * Restart tour. Mounted into the existing Navbar via a slot — no parallel
 * header.
 */

import { useEffect, useRef, useState } from 'react'
import { getDocs, onSnapshot, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { tenantCol, tenantDoc } from '../../lib/firestore'
import { useAuth } from '../../contexts/AuthContext'
import type { SandboxMeta } from '../../types/sandbox'

// Collections to wipe under /sandbox/{uid}/... on reset. Note: _meta is a
// singleton doc (not a collection) so it survives by design — we preserve
// visitor identity and lead-capture history across resets.
const TENANT_COLLECTIONS = [
  'projects',
  'tasks',
  'teams',
  'auditEvents',
  'users',
  'workflows',
  'config',
]

export default function SandboxMenu() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [richSeedCompleted, setRichSeedCompleted] = useState(false)

  // Watch _meta to gate the "Restart tour" affordance — it only makes sense
  // after Phase B has populated the tenant with seeded projects + personas.
  useEffect(() => {
    if (!user) return
    return onSnapshot(tenantDoc('_meta', 'main'), (snap) => {
      if (!snap.exists()) return
      const meta = snap.data() as SandboxMeta
      setRichSeedCompleted(Boolean(meta.richSeedCompleted))
    })
  }, [user])
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  if (!user) return null

  async function resetSandbox() {
    if (!user) return
    setResetting(true)
    try {
      // Wipe everything under /sandbox/{uid}/... — but preserve the visitor's
      // own user doc (so they stay super_admin) and the _meta singleton (so
      // their lead history + visitor profile survive).
      const preserveUid = user.uid
      for (const coll of TENANT_COLLECTIONS) {
        const snap = await getDocs(tenantCol(coll))
        const filtered = snap.docs.filter(
          (d) => !(coll === 'users' && d.id === preserveUid),
        )
        for (let i = 0; i < filtered.length; i += 400) {
          const batch = writeBatch(db)
          for (const doc of filtered.slice(i, i + 400)) batch.delete(doc.ref)
          await batch.commit()
        }
      }
      // Re-prime the Phase A placeholders so the wizards trip cleanly on the
      // reload. setupCompleted=false → org wizard fires; empty registry →
      // workflow wizard fires next.
      const batch = writeBatch(db)
      batch.set(tenantDoc('config', 'orgStructure'), {
        version: 0,
        updatedAt: serverTimestamp(),
        updatedBy: preserveUid,
        leadRoleName: 'Vertical Head',
        teamRoles: { hasCoordinator: false, hasValidator: false, hasSpecialist: false },
        workTypes: [],
        allotment: { mode: 'manual' },
        setupCompleted: false,
      })
      batch.set(tenantDoc('workflows', '_registry'), {
        version: 0,
        updatedAt: serverTimestamp(),
        updatedBy: preserveUid,
        activeWorkflowIds: [],
        defaultWorkflowId: null,
      })
      await batch.commit()

      // Flip _meta gates so Phase B re-runs and the tour re-mounts.
      await updateDoc(tenantDoc('_meta', 'main'), {
        richSeedCompleted: false,
        tourProgress: null,
        entryMode: null,
        lastSeenAt: serverTimestamp(),
      })

      window.location.assign('/')
    } finally {
      setResetting(false)
    }
  }

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Sandbox menu"
          title="Sandbox menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--sandbox-accent,#a78bfa)]/30 bg-[var(--sandbox-accent,#a78bfa)]/10 text-[var(--sandbox-accent,#a78bfa)] transition hover:bg-[var(--sandbox-accent,#a78bfa)]/20"
          data-tour-id="sandbox-menu"
        >
          {/* Sparkles glyph — signals "playful / try" without screaming "settings" */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3v3" />
            <path d="M12 18v3" />
            <path d="M3 12h3" />
            <path d="M18 12h3" />
            <path d="M5.6 5.6l2.1 2.1" />
            <path d="M16.3 16.3l2.1 2.1" />
            <path d="M5.6 18.4l2.1-2.1" />
            <path d="M16.3 7.7l2.1-2.1" />
          </svg>
        </button>

        {open ? (
          <div
            role="menu"
            className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-card/95 py-1 shadow-xl backdrop-blur-md"
          >
            <MenuItem
              label="Restart tour"
              onClick={() => {
                setOpen(false)
                window.dispatchEvent(new CustomEvent('sandbox:startTour'))
              }}
              disabled={!richSeedCompleted}
              disabledHint="Finish setup first"
            />
            <MenuItem
              label="Talk to us"
              onClick={() => {
                setOpen(false)
                window.dispatchEvent(new CustomEvent('sandbox:openDeepIntent'))
              }}
            />
            <div className="my-1 h-px bg-line" />
            <MenuItem
              label="Reset sandbox"
              danger
              onClick={() => {
                setOpen(false)
                setResetOpen(true)
              }}
            />
          </div>
        ) : null}
      </div>

      {resetOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Reset sandbox"
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-fg">Reset your sandbox?</h2>
            <p className="mt-2 text-sm text-fg-muted">
              This wipes every project, team, and workflow you've created and re-runs the wizards. Your lead record stays so we can still follow up.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetOpen(false)}
                disabled={resetting}
                className="rounded-lg px-4 py-2 text-sm text-fg-muted transition hover:bg-fill-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={resetSandbox}
                disabled={resetting}
                className="rounded-lg bg-tone-danger-fg px-4 py-2 text-sm font-medium text-white transition hover:opacity-95 disabled:opacity-50"
              >
                {resetting ? 'Resetting…' : 'Reset sandbox'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function MenuItem({
  label,
  onClick,
  danger,
  disabled,
  disabledHint,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  disabledHint?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      className={`block w-full px-3 py-2 text-left text-sm transition ${
        disabled
          ? 'cursor-not-allowed text-fg-subtle/60'
          : `hover:bg-fill-2 ${danger ? 'text-tone-danger-fg' : 'text-fg'}`
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        {disabled && disabledHint ? (
          <span className="text-[10px] uppercase tracking-wider text-fg-subtle/60">{disabledHint}</span>
        ) : null}
      </span>
    </button>
  )
}
