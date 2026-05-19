import { useCallback, useEffect, useRef, useState } from 'react'
import type { TeamRoleId } from '../../types/models'

// In-progress wizard draft. Persisted to localStorage (keyed by uid) so a
// super_admin who leaves mid-flow can resume from the same place. Cleared
// on successful finish and on the explicit "Start over" path.
export interface WizardDraft {
  step: number
  leadRoleName: string
  teamRoles: { hasCoordinator: boolean; hasValidator: boolean; hasSpecialist: boolean }
  workTypes: string[]
  // Per-team mapping captured in step 4. Keyed by team id.
  teamMappings: Record<string, { roleId: TeamRoleId | null; workTypes: string[] }>
  // Recommended mappings populated when the operator seeded sample teams in
  // step 4. Keyed by team id. Used to render the "Suggested" badge and the
  // "Restore suggestion" affordance — never persisted to Firestore directly.
  recommendedMappings: Record<string, { roleId: TeamRoleId; workTypes: string[] }>
  allotmentMode: 'manual'
  savedAt: number
}

export const DEFAULT_DRAFT: WizardDraft = {
  step: 1,
  leadRoleName: 'Project Lead',
  teamRoles: { hasCoordinator: false, hasValidator: false, hasSpecialist: false },
  workTypes: [],
  teamMappings: {},
  recommendedMappings: {},
  allotmentMode: 'manual',
  savedAt: 0,
}

function storageKey(uid: string | null | undefined): string {
  // Namespace by uid so two users on the same machine can't read each
  // other's in-progress wizard answers.
  return `orgSetupWizard:v1:${uid ?? 'anon'}`
}

function readDraft(uid: string | null | undefined): WizardDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(uid))
    if (!raw) return null
    const parsed = JSON.parse(raw) as WizardDraft
    if (!parsed || typeof parsed.step !== 'number') return null
    // Backfill new fields onto drafts written by older builds.
    if (!parsed.recommendedMappings) parsed.recommendedMappings = {}
    return parsed
  } catch {
    return null
  }
}

function writeDraft(uid: string | null | undefined, draft: WizardDraft) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(uid), JSON.stringify(draft))
  } catch {
    // ignore quota / private-mode errors
  }
}

export function clearWizardDraft(uid: string | null | undefined) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(storageKey(uid))
  } catch {
    // ignore
  }
}

// Hook that owns the in-progress wizard answers. Synchronously reads any
// persisted draft on mount; writes back on every change (debounced).
export function useWizardState(uid: string | null | undefined, seed?: Partial<WizardDraft>) {
  const [draft, setDraft] = useState<WizardDraft>(() => {
    const existing = readDraft(uid)
    if (existing) return existing
    return { ...DEFAULT_DRAFT, ...seed, savedAt: Date.now() }
  })

  // Debounced writeback. We don't need every keystroke in localStorage —
  // a 250ms idle window is fine for resilience across reloads/crashes.
  const writeTimer = useRef<number | null>(null)
  useEffect(() => {
    if (writeTimer.current) window.clearTimeout(writeTimer.current)
    writeTimer.current = window.setTimeout(() => {
      writeDraft(uid, { ...draft, savedAt: Date.now() })
    }, 250)
    return () => {
      if (writeTimer.current) window.clearTimeout(writeTimer.current)
    }
  }, [draft, uid])

  const update = useCallback(
    (patch: Partial<WizardDraft> | ((d: WizardDraft) => Partial<WizardDraft>)) => {
      setDraft((prev) => {
        const next = typeof patch === 'function' ? patch(prev) : patch
        return { ...prev, ...next }
      })
    },
    [],
  )

  const reset = useCallback(() => {
    clearWizardDraft(uid)
    setDraft({ ...DEFAULT_DRAFT, savedAt: Date.now() })
  }, [uid])

  return { draft, update, reset }
}
