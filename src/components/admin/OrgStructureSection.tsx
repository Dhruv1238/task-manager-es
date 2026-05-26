import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  increment,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore'
import { tenantDoc } from '../../lib/firestore'
import { useAuth } from '../../contexts/AuthContext'
import {
  useAppConfigContext,
  useOrgStructure,
  useOrgStructureLive,
} from '../../contexts/AppConfigContext'
import { useAllTeams } from '../../hooks/useAllTeams'
import { findDuplicateRoleTeams } from '../../lib/orgResolver'
import { WORK_TYPE_SUGGESTIONS, type OrgStructure, type TeamRoleId } from '../../types/models'

// "Organization structure" section embedded in /admin/config. The wizard owns
// first-time setup; this surface owns ongoing edits. Every field saves
// immediately (save-on-blur for text, save-on-change for toggles/selects)
// and bumps /config/orgStructure.version.

const MAX_CHIP_LEN = 30
const MAX_LEAD_LEN = 50

export default function OrgStructureSection() {
  const { user, profile } = useAuth()
  const cached = useOrgStructure()
  const { setOrgStructureOptimistic } = useAppConfigContext()
  const { org: liveOrg } = useOrgStructureLive()
  const { teams } = useAllTeams()

  const baseline: OrgStructure = liveOrg ?? cached
  const [savingField, setSavingField] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Local-only text input state for leadRoleName so the user can type without
  // every keystroke hitting Firestore. Commits on blur.
  // We track the baseline value we last seeded from so that when an external
  // edit lands (cross-tab sync) we reset the draft — without a useEffect, per
  // React's "reset state when prop changes" pattern.
  const [leadDraft, setLeadDraft] = useState(baseline.leadRoleName)
  const [seedFromBaseline, setSeedFromBaseline] = useState(baseline.leadRoleName)
  if (seedFromBaseline !== baseline.leadRoleName) {
    setSeedFromBaseline(baseline.leadRoleName)
    setLeadDraft(baseline.leadRoleName)
  }

  // Local-only state for the work-types chip input.
  const [workTypeDraft, setWorkTypeDraft] = useState('')

  const duplicateCoordinators = useMemo(
    () => findDuplicateRoleTeams(teams, 'coordinator'),
    [teams],
  )
  const duplicateValidators = useMemo(
    () => findDuplicateRoleTeams(teams, 'validator'),
    [teams],
  )

  async function patchOrg(patch: Partial<Omit<OrgStructure, 'version' | 'updatedAt' | 'updatedBy'>>, fieldName: string) {
    if (!user) return
    setSavingField(fieldName)
    setError(null)
    try {
      // updateDoc with version increment so concurrent edits surface a
      // monotonic delta — caches detect a change and refresh.
      await updateDoc(tenantDoc('config', 'orgStructure'), {
        ...patch,
        version: increment(1),
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      }).catch(async (err: unknown) => {
        // First-time edit on a missing doc — fall through to setDoc with
        // the full shape.
        const message = err instanceof Error ? err.message : ''
        if (!/no document to update/i.test(message)) throw err
        await setDoc(tenantDoc('config', 'orgStructure'), {
          ...baseline,
          ...patch,
          version: (baseline.version ?? 0) + 1,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        })
      })

      setOrgStructureOptimistic({
        ...baseline,
        ...patch,
        version: (baseline.version ?? 0) + 1,
        updatedAt: Timestamp.now(),
        updatedBy: user.uid,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingField(null)
    }
  }

  function commitLeadRoleName() {
    const trimmed = leadDraft.trim().slice(0, MAX_LEAD_LEN)
    if (!trimmed || trimmed === baseline.leadRoleName) return
    void patchOrg({ leadRoleName: trimmed }, 'leadRoleName')
  }

  function toggleRole(key: keyof OrgStructure['teamRoles']) {
    const next = { ...baseline.teamRoles, [key]: !baseline.teamRoles[key] }
    void patchOrg({ teamRoles: next }, `teamRoles.${key}`)
  }

  function addWorkType(value: string) {
    const v = value.trim()
    if (!v || v.length > MAX_CHIP_LEN) return
    if (baseline.workTypes.some((w) => w.toLowerCase() === v.toLowerCase())) return
    void patchOrg({ workTypes: [...baseline.workTypes, v] }, 'workTypes')
    setWorkTypeDraft('')
  }

  function removeWorkType(value: string) {
    void patchOrg(
      { workTypes: baseline.workTypes.filter((w) => w !== value) },
      'workTypes',
    )
  }

  async function setTeamRole(teamId: string, roleId: TeamRoleId | null) {
    setSavingField(`team:${teamId}`)
    setError(null)
    try {
      await updateDoc(tenantDoc('teams', teamId), {
        teamRoleId: roleId,
        // Clear workTypes when leaving the specialist role.
        ...(roleId === 'specialist' ? {} : { workTypes: [] }),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingField(null)
    }
  }

  async function toggleTeamWorkType(teamId: string, workType: string) {
    const team = teams.find((t) => t.id === teamId)
    if (!team) return
    const existing = team.workTypes ?? []
    const updated = existing.includes(workType)
      ? existing.filter((w) => w !== workType)
      : [...existing, workType]
    setSavingField(`team:${teamId}:workTypes`)
    setError(null)
    try {
      await updateDoc(tenantDoc('teams', teamId), { workTypes: updated })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingField(null)
    }
  }

  // Only super_admin sees the re-run wizard link (DevConfigRoute already
  // gates this page; we double-check on the link in case route guards loosen).
  const canRerunWizard = profile?.globalRole === 'super_admin'

  return (
    <section className="mb-6 rounded-2xl border border-line bg-fill-1 p-5">
      <h2 className="text-lg font-semibold text-fg">Organization structure</h2>
      <p className="mt-1 text-sm text-fg-subtle">
        How your org is shaped. Pipelines and stages use this — change something here and you
        may need to update pipelines that reference it.
      </p>

      {/* ── Leadership role name ─────────────────────────────────────── */}
      <div className="mt-5 space-y-2 rounded-xl border border-line bg-card p-4">
        <label htmlFor="leadRoleName" className="block text-sm font-medium text-fg">
          Leadership role name
        </label>
        <p className="text-xs text-fg-subtle">
          The label your tenant uses for the person who runs each project. Appears across
          modals, banners, and the Members screen.
        </p>
        <div className="flex items-center gap-2">
          <input
            id="leadRoleName"
            type="text"
            value={leadDraft}
            maxLength={MAX_LEAD_LEN}
            onChange={(e) => setLeadDraft(e.target.value)}
            onBlur={commitLeadRoleName}
            onKeyDown={(e) => e.key === 'Enter' && commitLeadRoleName()}
            className="flex-1 rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring"
          />
          {savingField === 'leadRoleName' && (
            <span className="text-xs text-fg-subtle">Saving…</span>
          )}
        </div>
      </div>

      {/* ── Team types ───────────────────────────────────────────────── */}
      <div className="mt-4 space-y-3 rounded-xl border border-line bg-card p-4">
        <div>
          <h3 className="text-sm font-medium text-fg">Team types</h3>
          <p className="mt-0.5 text-xs text-fg-subtle">
            Which kinds of teams your org has. Toggling one off hides downstream surfaces but
            doesn't delete the team's role on existing docs.
          </p>
        </div>
        <RoleToggleRow
          checked={baseline.teamRoles.hasCoordinator}
          onChange={() => toggleRole('hasCoordinator')}
          label="Client coordination"
          hint="A team that handles client communication (Client Servicing, Account Management, etc.)."
          saving={savingField === 'teamRoles.hasCoordinator'}
        />
        <RoleToggleRow
          checked={baseline.teamRoles.hasValidator}
          onChange={() => toggleRole('hasValidator')}
          label="Reviews work"
          hint="A team that validates deliverables before they ship to the client."
          saving={savingField === 'teamRoles.hasValidator'}
        />
        <RoleToggleRow
          checked={baseline.teamRoles.hasSpecialist}
          onChange={() => toggleRole('hasSpecialist')}
          label="Specialist teams"
          hint="Teams that produce the actual deliverables (Design, Copy, Video, etc.)."
          saving={savingField === 'teamRoles.hasSpecialist'}
        />
      </div>

      {/* ── Work types ───────────────────────────────────────────────── */}
      {baseline.teamRoles.hasSpecialist && (
        <div className="mt-4 space-y-3 rounded-xl border border-line bg-card p-4">
          <div>
            <h3 className="text-sm font-medium text-fg">Work types</h3>
            <p className="mt-0.5 text-xs text-fg-subtle">
              Disciplines your specialist teams handle. Each specialist team can cover one or
              more of these.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-fill-2 p-2.5">
            {baseline.workTypes.map((w) => (
              <span
                key={w}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand"
              >
                {w}
                <button
                  type="button"
                  onClick={() => removeWorkType(w)}
                  aria-label={`Remove ${w}`}
                  className="text-brand/70 transition hover:text-brand"
                >
                  ×
                </button>
              </span>
            ))}
            <input
              type="text"
              value={workTypeDraft}
              maxLength={MAX_CHIP_LEN}
              onChange={(e) => setWorkTypeDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addWorkType(workTypeDraft)
                }
              }}
              placeholder="Type and press Enter to add"
              className="min-w-[12ch] flex-1 bg-transparent px-1 py-1 text-sm text-fg placeholder:text-fg-faint outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {WORK_TYPE_SUGGESTIONS.filter(
              (s) => !baseline.workTypes.some((w) => w.toLowerCase() === s.toLowerCase()),
            ).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addWorkType(s)}
                className="rounded-full border border-line bg-fill-2 px-3 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-fill-3"
              >
                + {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Team mapping ─────────────────────────────────────────────── */}
      <div className="mt-4 space-y-3 rounded-xl border border-line bg-card p-4">
        <div>
          <h3 className="text-sm font-medium text-fg">Team mapping</h3>
          <p className="mt-0.5 text-xs text-fg-subtle">
            Categorize each team. Stage-7 sign-off and stage-10 delivery resolve through these
            mappings — leave a team unmapped to skip role-based gating.
          </p>
        </div>

        {teams.length === 0 ? (
          <p className="rounded-lg border border-line bg-fill-2 p-3 text-xs text-fg-subtle">
            No teams yet. Create a team first, then come back to map it.
          </p>
        ) : (
          <ul className="space-y-2">
            {teams.map((team) => {
              const roleId = team.teamRoleId ?? null
              const teamWorkTypes = team.workTypes ?? []
              return (
                <li
                  key={team.id}
                  className="rounded-lg border border-line bg-fill-2 p-3"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-fg">{team.name}</div>
                      {team.description && (
                        <div className="mt-0.5 truncate text-xs text-fg-subtle">
                          {team.description}
                        </div>
                      )}
                    </div>
                    <select
                      value={roleId ?? ''}
                      onChange={(e) =>
                        setTeamRole(team.id, (e.target.value || null) as TeamRoleId | null)
                      }
                      disabled={savingField === `team:${team.id}`}
                      className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-sm text-fg outline-none transition focus:border-brand-edge focus:ring-2 focus:ring-brand-ring disabled:opacity-60"
                    >
                      <option value="">Uncategorized</option>
                      {baseline.teamRoles.hasCoordinator && (
                        <option value="coordinator">Client coordination</option>
                      )}
                      {baseline.teamRoles.hasValidator && (
                        <option value="validator">Reviews work</option>
                      )}
                      {baseline.teamRoles.hasSpecialist && (
                        <option value="specialist">Specialist team</option>
                      )}
                    </select>
                  </div>
                  {roleId === 'specialist' && baseline.workTypes.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                        Work types:
                      </span>
                      {baseline.workTypes.map((w) => {
                        const selected = teamWorkTypes.includes(w)
                        return (
                          <button
                            key={w}
                            type="button"
                            onClick={() => toggleTeamWorkType(team.id, w)}
                            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
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
                </li>
              )
            })}
          </ul>
        )}

        {(duplicateCoordinators.length > 0 || duplicateValidators.length > 0) && (
          <div className="rounded-lg border border-tone-warn-bd bg-tone-warn-bg px-3 py-2 text-xs text-tone-warn-fg">
            {duplicateCoordinators.length > 0 && (
              <p>
                <strong>{duplicateCoordinators.length + 1}</strong> teams set as{' '}
                <strong>Client coordination</strong> — workflows only use the first by created
                date.
              </p>
            )}
            {duplicateValidators.length > 0 && (
              <p>
                <strong>{duplicateValidators.length + 1}</strong> teams set as{' '}
                <strong>Reviews work</strong> — workflows only use the first by created date.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Allotment ────────────────────────────────────────────────── */}
      <div className="mt-4 space-y-3 rounded-xl border border-line bg-card p-4">
        <div>
          <h3 className="text-sm font-medium text-fg">Project assignment (allotment)</h3>
          <p className="mt-0.5 text-xs text-fg-subtle">
            How new projects are assigned to a lead. Pool and Auto are coming in later phases.
          </p>
        </div>
        <AllotmentRow title="Manual" description="Someone picks the lead when creating each project." selected available />
        <AllotmentRow
          title="Pool"
          description="Projects sit in a queue; leads pick what they want."
          selected={false}
          available={false}
        />
        <AllotmentRow
          title="Auto"
          description="Rules decide based on workload, expertise, or territory."
          selected={false}
          available={false}
        />
      </div>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      {error && (
        <div className="mt-4 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg">
          {error}
        </div>
      )}
      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-fg-subtle">
        <div>
          Version <span className="font-medium text-fg-muted">{baseline.version}</span> · last
          saved by{' '}
          <span className="font-medium text-fg-muted">
            {baseline.updatedBy === profile?.uid ? 'you' : baseline.updatedBy || '—'}
          </span>
        </div>
        {canRerunWizard && (
          <Link
            to="/admin/setup"
            className="rounded-lg border border-line bg-fill-2 px-3 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg"
          >
            Re-run setup wizard
          </Link>
        )}
      </div>
    </section>
  )
}

function RoleToggleRow({
  checked,
  onChange,
  label,
  hint,
  saving,
}: {
  checked: boolean
  onChange: () => void
  label: string
  hint: string
  saving: boolean
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line bg-fill-2 p-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        disabled={saving}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
          checked ? 'bg-brand-edge' : 'bg-fill-4'
        } disabled:opacity-50`}
      >
        <span
          aria-hidden
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-fg">{label}</div>
        <div className="mt-0.5 text-xs text-fg-subtle">{hint}</div>
      </div>
      {saving && <span className="text-xs text-fg-subtle">Saving…</span>}
    </div>
  )
}

function AllotmentRow({
  title,
  description,
  selected,
  available,
}: {
  title: string
  description: string
  selected: boolean
  available: boolean
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-3 ${
        selected
          ? 'border-brand-edge bg-brand-soft/40'
          : available
            ? 'border-line bg-fill-2'
            : 'cursor-not-allowed border-line bg-fill-2/60 opacity-60'
      }`}
      aria-disabled={!available}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
          selected ? 'border-brand-edge bg-brand-gradient' : 'border-line-strong bg-canvas'
        }`}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-white" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-fg">{title}</span>
          {!available && (
            <span className="rounded-full bg-fill-3 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
              Coming soon
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-fg-subtle">{description}</div>
      </div>
    </div>
  )
}
