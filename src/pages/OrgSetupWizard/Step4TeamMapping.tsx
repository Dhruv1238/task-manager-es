import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useAllTeams } from '../../hooks/useAllTeams'
import {
  GENERIC_SEED_TEAMS,
  createBareTeam,
  seedSelectedGenericTeams,
  type SeededTeam,
} from '../../lib/seedTeamsGeneric'
import type { TeamRoleId } from '../../types/models'
import AssistantBubble from './components/AssistantBubble'
import UserBubble from './components/UserBubble'
import WizardFooter from './components/WizardFooter'

export interface TeamMapping {
  roleId: TeamRoleId | null
  workTypes: string[]
}

type EmptyMode = 'idle' | 'seeding' | 'manual'

interface StagedManualTeam {
  tempKey: string
  name: string
  description: string
}

interface Props {
  hasCoordinator: boolean
  hasValidator: boolean
  hasSpecialist: boolean
  workTypes: string[]
  mappings: Record<string, TeamMapping>
  // Called on every per-row change so the parent can persist the draft.
  onMappingsChange: (mappings: Record<string, TeamMapping>) => void
  // Recommended mappings (keyed by teamId) injected when the operator seeds
  // sample teams. Drives the "Suggested" badge and the restore affordance.
  recommendedMappings: Record<string, { roleId: TeamRoleId; workTypes: string[] }>
  onRecommendedMappingsChange: (
    next: Record<string, { roleId: TeamRoleId; workTypes: string[] }>,
  ) => void
  summary: string
  onContinue: () => void
  onBack: () => void
  onSkip: () => void
}

// Step 4 — Team mapping. Pulls live /teams list, lets the operator assign
// each team a role and (for specialists) the work-type subset they cover.
// When the tenant has no teams yet, offers two conversational paths: seed a
// generic sample set (with recommended role mappings) or add teams one at a
// time. Both paths stage teams locally and commit to Firestore only after
// the operator confirms — the chat-style bubbles stack as choices are made
// rather than swapping out, so the conversation reads top-to-bottom.
export default function Step4TeamMapping({
  hasCoordinator,
  hasValidator,
  hasSpecialist,
  workTypes,
  mappings,
  onMappingsChange,
  recommendedMappings,
  onRecommendedMappingsChange,
  summary,
  onContinue,
  onBack,
  onSkip,
}: Props) {
  const { profile } = useAuth()
  const { teams, loading } = useAllTeams()
  const empty = !loading && teams.length === 0

  const [emptyMode, setEmptyMode] = useState<EmptyMode>('idle')

  const [seedSelected, setSeedSelected] = useState<Set<string>>(
    () => new Set(GENERIC_SEED_TEAMS.map((t) => t.key)),
  )
  const [seedSubmitting, setSeedSubmitting] = useState(false)
  const [seedError, setSeedError] = useState<string | null>(null)

  const [manualName, setManualName] = useState('')
  const [manualDescription, setManualDescription] = useState('')
  const [manualError, setManualError] = useState<string | null>(null)
  const [stagedManualTeams, setStagedManualTeams] = useState<StagedManualTeam[]>([])
  const [manualCommitSubmitting, setManualCommitSubmitting] = useState(false)

  const [showInlineAdd, setShowInlineAdd] = useState(false)
  const [inlineAddName, setInlineAddName] = useState('')
  const [inlineAddDescription, setInlineAddDescription] = useState('')
  const [inlineAddSubmitting, setInlineAddSubmitting] = useState(false)
  const [inlineAddError, setInlineAddError] = useState<string | null>(null)

  // Auto-scroll the newest bubble into view as the conversation grows. Fires
  // when the operator picks a path, switches paths, or stages/unstages a
  // team — anything that visibly grows the chat.
  const bottomRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = bottomRef.current
    if (!node) return
    node.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [emptyMode, stagedManualTeams.length])

  // Switching paths discards in-flight inputs from the previous path so the
  // operator doesn't accidentally leave staged teams behind.
  function switchEmptyMode(next: EmptyMode) {
    if (next === emptyMode) return
    setEmptyMode(next)
    setManualName('')
    setManualDescription('')
    setManualError(null)
    setStagedManualTeams([])
    setSeedError(null)
  }

  function updateRole(teamId: string, roleId: TeamRoleId | null) {
    const next: Record<string, TeamMapping> = {
      ...mappings,
      [teamId]: {
        roleId,
        workTypes: roleId === 'specialist' ? mappings[teamId]?.workTypes ?? [] : [],
      },
    }
    onMappingsChange(next)
  }

  function toggleWorkType(teamId: string, workType: string) {
    const existing = mappings[teamId]?.workTypes ?? []
    const updated = existing.includes(workType)
      ? existing.filter((w) => w !== workType)
      : [...existing, workType]
    onMappingsChange({
      ...mappings,
      [teamId]: {
        roleId: mappings[teamId]?.roleId ?? 'specialist',
        workTypes: updated,
      },
    })
  }

  function applyRecommendation(teamId: string) {
    const rec = recommendedMappings[teamId]
    if (!rec) return
    onMappingsChange({
      ...mappings,
      [teamId]: { roleId: rec.roleId, workTypes: [...rec.workTypes] },
    })
  }

  function resetAllMappings() {
    onMappingsChange({})
  }

  function toggleSeedKey(key: string) {
    setSeedSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleSeed() {
    if (!profile?.uid) {
      setSeedError('You must be signed in to seed teams.')
      return
    }
    if (seedSelected.size === 0) {
      setSeedError('Pick at least one team to seed, or cancel.')
      return
    }
    setSeedSubmitting(true)
    setSeedError(null)
    try {
      const seeded = await seedSelectedGenericTeams(
        profile.uid,
        Array.from(seedSelected),
      )
      applySeededMappings(seeded)
      setEmptyMode('idle')
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : 'Could not seed teams.')
    } finally {
      setSeedSubmitting(false)
    }
  }

  function applySeededMappings(seeded: SeededTeam[]) {
    const nextMappings = { ...mappings }
    const nextRecs = { ...recommendedMappings }
    for (const s of seeded) {
      // Filter recommended workTypes against what the tenant configured in
      // step 3 — there's no point recommending "3D Design" if the tenant
      // never set it up.
      const filteredWorkTypes = s.recommendedWorkTypes.filter((w) =>
        workTypes.includes(w),
      )
      const recRoleAllowed =
        (s.recommendedRoleId === 'coordinator' && hasCoordinator) ||
        (s.recommendedRoleId === 'validator' && hasValidator) ||
        (s.recommendedRoleId === 'specialist' && hasSpecialist)
      if (!recRoleAllowed) continue
      nextRecs[s.teamId] = {
        roleId: s.recommendedRoleId,
        workTypes: filteredWorkTypes,
      }
      // Only auto-apply when the row hasn't already been mapped by hand.
      if (!nextMappings[s.teamId] || nextMappings[s.teamId].roleId === null) {
        nextMappings[s.teamId] = {
          roleId: s.recommendedRoleId,
          workTypes: filteredWorkTypes,
        }
      }
    }
    onMappingsChange(nextMappings)
    onRecommendedMappingsChange(nextRecs)
  }

  function handleStageManualTeam() {
    const trimmedName = manualName.trim()
    if (!trimmedName) {
      setManualError('Team name is required.')
      return
    }
    const duplicate = stagedManualTeams.some(
      (t) => t.name.toLowerCase() === trimmedName.toLowerCase(),
    )
    if (duplicate) {
      setManualError('A team with that name is already in your list.')
      return
    }
    setStagedManualTeams((prev) => [
      ...prev,
      {
        tempKey:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `staged-${Date.now()}-${Math.random()}`,
        name: trimmedName,
        description: manualDescription.trim(),
      },
    ])
    setManualName('')
    setManualDescription('')
    setManualError(null)
  }

  function removeStagedTeam(tempKey: string) {
    setStagedManualTeams((prev) => prev.filter((t) => t.tempKey !== tempKey))
  }

  async function handleCommitManualTeams() {
    if (!profile?.uid) {
      setManualError('You must be signed in to add teams.')
      return
    }
    if (stagedManualTeams.length === 0) {
      setManualError('Add at least one team, or cancel.')
      return
    }
    setManualCommitSubmitting(true)
    setManualError(null)
    try {
      for (const team of stagedManualTeams) {
        await createBareTeam(profile.uid, team.name, team.description)
      }
      setStagedManualTeams([])
      setEmptyMode('idle')
    } catch (err) {
      setManualError(err instanceof Error ? err.message : 'Could not create teams.')
    } finally {
      setManualCommitSubmitting(false)
    }
  }

  async function handleInlineAdd() {
    if (!profile?.uid) {
      setInlineAddError('You must be signed in to add teams.')
      return
    }
    const trimmedName = inlineAddName.trim()
    if (!trimmedName) {
      setInlineAddError('Team name is required.')
      return
    }
    setInlineAddSubmitting(true)
    setInlineAddError(null)
    try {
      await createBareTeam(profile.uid, trimmedName, inlineAddDescription)
      setInlineAddName('')
      setInlineAddDescription('')
      setShowInlineAdd(false)
    } catch (err) {
      setInlineAddError(err instanceof Error ? err.message : 'Could not create team.')
    } finally {
      setInlineAddSubmitting(false)
    }
  }

  const recommendedCount = Object.keys(recommendedMappings).length
  const teamsWithRoleSelected = useMemo(
    () => Object.values(mappings).filter((m) => m.roleId !== null).length,
    [mappings],
  )

  if (loading) {
    return (
      <>
        <UserBubble text={summary} />
        <AssistantBubble text={<>Loading your teams…</>} />
        <WizardFooter
          onBack={onBack}
          onSkip={onSkip}
          onPrimary={onContinue}
          primaryLabel="Continue"
        />
      </>
    )
  }

  if (empty) {
    const pickedQuickStart = emptyMode === 'seeding'
    const pickedManual = emptyMode === 'manual'
    const pathPicked = emptyMode !== 'idle'

    return (
      <>
        <UserBubble text={summary} />

        {/* Initial assistant prompt — stays visible across all empty-mode states. */}
        <AssistantBubble
          text={
            <>
              Oh, you don't have any teams set up yet — let's get you started. Pick a path
              below, or skip this step and come back to it later from the{' '}
              <span
                className="inline-flex h-5 w-5 -translate-y-px items-center justify-center rounded-md border border-line bg-fill-2 text-fg-strong align-middle"
                aria-label="settings"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06A2 2 0 1 1 4.2 16.96l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.2l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </span>{' '}
              settings.
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => switchEmptyMode('seeding')}
              aria-pressed={pickedQuickStart}
              className={`group flex h-full flex-col items-start gap-2 rounded-xl border p-4 text-left transition ${
                pickedQuickStart
                  ? 'border-brand-edge bg-brand-soft/40 ring-2 ring-brand-ring/40'
                  : pathPicked
                    ? 'border-line bg-fill-2 opacity-60 hover:opacity-100 hover:border-brand-edge'
                    : 'border-line bg-fill-2 hover:border-brand-edge hover:bg-fill-3'
              }`}
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9z" />
                </svg>
              </span>
              <span className="text-sm font-medium text-fg">
                Quick start with AI recommended teams
              </span>
              <span className="text-xs leading-relaxed text-fg-subtle">
                Pick from five common event/agency teams. You'll review before they're created.
              </span>
            </button>
            <button
              type="button"
              onClick={() => switchEmptyMode('manual')}
              aria-pressed={pickedManual}
              className={`group flex h-full flex-col items-start gap-2 rounded-xl border p-4 text-left transition ${
                pickedManual
                  ? 'border-brand-edge bg-brand-soft/40 ring-2 ring-brand-ring/40'
                  : pathPicked
                    ? 'border-line bg-fill-2 opacity-60 hover:opacity-100 hover:border-brand-edge'
                    : 'border-line bg-fill-2 hover:border-brand-edge hover:bg-fill-3'
              }`}
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </span>
              <span className="text-sm font-medium text-fg">Add my own teams</span>
              <span className="text-xs leading-relaxed text-fg-subtle">
                Stage teams one at a time and create them all together. Leads added later.
              </span>
            </button>
          </div>
        </AssistantBubble>

        {/* Conversation continues below as the operator picks a path. */}
        {emptyMode === 'seeding' && (
          <>
            <UserBubble text="Quick start with AI recommended teams" />
            <AssistantBubble
              text={
                <>
                  Here are five teams that work well for event and agency workflows. Uncheck any
                  you don't need, then I'll create the rest.
                </>
              }
            >
              <div className="space-y-2.5">
                {GENERIC_SEED_TEAMS.map((spec) => {
                  const checked = seedSelected.has(spec.key)
                  return (
                    <label
                      key={spec.key}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
                        checked
                          ? 'border-brand-edge bg-brand-soft/40'
                          : 'border-line bg-fill-2 hover:bg-fill-3'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSeedKey(spec.key)}
                        className="mt-0.5 h-4 w-4 cursor-pointer accent-brand"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-fg">{spec.name}</div>
                        <div className="mt-0.5 text-xs text-fg-subtle">{spec.description}</div>
                      </div>
                    </label>
                  )
                })}
              </div>
              {seedError && (
                <div
                  role="alert"
                  className="mt-3 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg"
                >
                  {seedError}
                </div>
              )}
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => switchEmptyMode('idle')}
                  disabled={seedSubmitting}
                  className="rounded-full border border-line bg-fill-2 px-4 py-2 text-xs font-medium text-fg-muted transition hover:bg-fill-4 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleSeed}
                  disabled={seedSubmitting || seedSelected.size === 0}
                  className="rounded-full bg-brand-gradient px-5 py-2 text-xs font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {seedSubmitting ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Creating…
                    </span>
                  ) : (
                    `Create ${seedSelected.size} team${seedSelected.size === 1 ? '' : 's'}`
                  )}
                </button>
              </div>
            </AssistantBubble>
          </>
        )}

        {emptyMode === 'manual' && (
          <>
            <UserBubble text="Let me add my own teams" />
            <AssistantBubble
              text={
                <>
                  Add your teams to the list below — name and a short description. Nothing gets
                  created until you hit{' '}
                  <span className="font-medium text-fg-strong">Create teams</span>, so feel free
                  to review and remove any you've changed your mind about.
                </>
              }
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleStageManualTeam()
                }}
                className="space-y-3"
              >
                <input
                  type="text"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="Team name (e.g. Design)"
                  className="w-full rounded-lg border border-line bg-fill-2 px-4 py-2.5 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring"
                  autoFocus
                  disabled={manualCommitSubmitting}
                />
                <textarea
                  value={manualDescription}
                  onChange={(e) => setManualDescription(e.target.value)}
                  placeholder="What does this team own? (optional)"
                  rows={2}
                  className="w-full resize-none rounded-lg border border-line bg-fill-2 px-4 py-2.5 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring"
                  disabled={manualCommitSubmitting}
                />
                {manualError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg"
                  >
                    {manualError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={manualCommitSubmitting || !manualName.trim()}
                  className="rounded-full border border-brand-edge bg-canvas px-4 py-1.5 text-xs font-medium text-brand transition hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
                >
                  + Add to list
                </button>
              </form>

              {stagedManualTeams.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
                    Will be created ({stagedManualTeams.length})
                  </div>
                  <ul className="space-y-2">
                    {stagedManualTeams.map((t) => (
                      <li
                        key={t.tempKey}
                        className="flex items-start gap-3 rounded-xl border border-line bg-fill-2 p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-fg">{t.name}</div>
                          {t.description && (
                            <div className="mt-0.5 truncate text-xs text-fg-subtle">
                              {t.description}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeStagedTeam(t.tempKey)}
                          disabled={manualCommitSubmitting}
                          aria-label={`Remove ${t.name}`}
                          className="rounded-md p-1 text-fg-faint transition hover:bg-fill-3 hover:text-tone-danger-fg disabled:opacity-50"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => switchEmptyMode('idle')}
                  disabled={manualCommitSubmitting}
                  className="rounded-full border border-line bg-fill-2 px-4 py-2 text-xs font-medium text-fg-muted transition hover:bg-fill-4 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleCommitManualTeams}
                  disabled={manualCommitSubmitting || stagedManualTeams.length === 0}
                  className="rounded-full bg-brand-gradient px-5 py-2 text-xs font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {manualCommitSubmitting ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Creating…
                    </span>
                  ) : (
                    `Create ${stagedManualTeams.length} team${stagedManualTeams.length === 1 ? '' : 's'}`
                  )}
                </button>
              </div>
            </AssistantBubble>
          </>
        )}

        {/* Anchor for auto-scroll. */}
        <div ref={bottomRef} aria-hidden />

        {emptyMode === 'idle' && (
          <WizardFooter
            onBack={onBack}
            onSkip={onSkip}
            onPrimary={onContinue}
            primaryLabel="Continue without teams"
          />
        )}
      </>
    )
  }

  return (
    <>
      <UserBubble text={summary} />

      <AssistantBubble
        text={
          <>
            {recommendedCount > 0 ? (
              <>
                I've pre-filled the suggested roles below. Adjust anything that doesn't fit, or
                hit Continue.
              </>
            ) : (
              <>
                Here are your existing teams. Tell me what each one does — or skip any you're not
                sure about. You can map them later from the config screen.
              </>
            )}
          </>
        }
      >
        <div className="space-y-2.5">
          {teams.map((team) => {
            const mapping = mappings[team.id]
            const roleId = mapping?.roleId ?? null
            const teamWorkTypesSelected = mapping?.workTypes ?? []
            const rec = recommendedMappings[team.id]
            const matchesRec =
              rec &&
              roleId === rec.roleId &&
              rec.workTypes.length === teamWorkTypesSelected.length &&
              rec.workTypes.every((w) => teamWorkTypesSelected.includes(w))
            const noLead = !team.leadId
            return (
              <div key={team.id} className="rounded-xl border border-line bg-fill-2 p-3.5">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-fg">{team.name}</span>
                      {rec && matchesRec && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-brand-edge bg-brand-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-brand">
                          Suggested
                        </span>
                      )}
                      {rec && !matchesRec && (
                        <button
                          type="button"
                          onClick={() => applyRecommendation(team.id)}
                          className="text-[11px] font-medium text-brand underline-offset-2 hover:underline"
                        >
                          Restore suggestion
                        </button>
                      )}
                      {noLead && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-tone-warn-bd bg-tone-warn-bg px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-tone-warn-fg">
                          No lead
                        </span>
                      )}
                    </div>
                    {team.description && (
                      <div className="mt-0.5 truncate text-xs text-fg-subtle">
                        {team.description}
                      </div>
                    )}
                  </div>
                  <select
                    value={roleId ?? ''}
                    onChange={(e) =>
                      updateRole(team.id, (e.target.value || null) as TeamRoleId | null)
                    }
                    className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-fg outline-none transition focus:border-brand-edge focus:ring-2 focus:ring-brand-ring"
                  >
                    <option value="">Skip for now</option>
                    {hasCoordinator && <option value="coordinator">Client coordination</option>}
                    {hasValidator && <option value="validator">Reviews work</option>}
                    {hasSpecialist && <option value="specialist">Specialist team</option>}
                  </select>
                </div>

                {roleId === 'specialist' && workTypes.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
                    <span className="self-center text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
                      Work types:
                    </span>
                    {workTypes.map((w) => {
                      const selected = teamWorkTypesSelected.includes(w)
                      return (
                        <button
                          key={w}
                          type="button"
                          onClick={() => toggleWorkType(team.id, w)}
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                            selected
                              ? 'border-brand-edge bg-brand-soft text-brand'
                              : 'border-line bg-fill-2 text-fg-muted hover:bg-fill-3'
                          }`}
                        >
                          {w}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setShowInlineAdd((v) => !v)}
            className="text-xs font-medium text-brand underline-offset-2 hover:underline"
          >
            {showInlineAdd ? '− Cancel add' : '+ Add another team'}
          </button>
          {teamsWithRoleSelected > 0 && (
            <button
              type="button"
              onClick={resetAllMappings}
              className="text-xs font-medium text-fg-subtle underline-offset-2 hover:text-fg-muted hover:underline"
            >
              Reset all mappings
            </button>
          )}
        </div>

        {showInlineAdd && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void handleInlineAdd()
            }}
            className="mt-3 space-y-2.5 rounded-xl border border-line bg-fill-2 p-3.5"
          >
            <input
              type="text"
              value={inlineAddName}
              onChange={(e) => setInlineAddName(e.target.value)}
              placeholder="Team name"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:ring-2 focus:ring-brand-ring"
              autoFocus
              disabled={inlineAddSubmitting}
            />
            <input
              type="text"
              value={inlineAddDescription}
              onChange={(e) => setInlineAddDescription(e.target.value)}
              placeholder="Short description (optional)"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:ring-2 focus:ring-brand-ring"
              disabled={inlineAddSubmitting}
            />
            {inlineAddError && (
              <div
                role="alert"
                className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg"
              >
                {inlineAddError}
              </div>
            )}
            <button
              type="submit"
              disabled={inlineAddSubmitting || !inlineAddName.trim()}
              className="rounded-full bg-brand-gradient px-4 py-1.5 text-xs font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-50"
            >
              {inlineAddSubmitting ? 'Adding…' : 'Add team'}
            </button>
          </form>
        )}
      </AssistantBubble>

      <WizardFooter
        onBack={onBack}
        onSkip={onSkip}
        onPrimary={onContinue}
        primaryLabel="Continue"
      />
    </>
  )
}
