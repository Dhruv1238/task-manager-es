import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'
import {
  DEFAULT_APP_CONFIG,
  useAppConfigContext,
  useAppConfigLive,
  useWorkflow,
} from '../contexts/AppConfigContext'
import { type AppConfig } from '../types/models'
import type { Workflow, WorkflowRegistry } from '../types/workflow'
import { WORKFLOW_REGISTRY_ID } from '../types/workflow'
import OrgStructureSection from '../components/admin/OrgStructureSection'
import { seedCollabWorkflow } from '../lib/seedCollabWorkflow'
import { seedBasicWorkflow } from '../lib/seedBasicWorkflow'
import { seedSalesWorkflow } from '../lib/seedSalesWorkflow'
import { seedWorkflowRegistry } from '../lib/seedWorkflowRegistry'
import { retirePipelineToggle } from '../lib/retirePipelineToggle'
import { migrateProjectHistory } from '../lib/migrateProjectHistory'
import { useAllUsers } from '../hooks/useAllUsers'
import { useAllProjects } from '../hooks/useAllProjects'
import { isProjectClosed } from '../lib/projectStatus'
import Modal from '../components/ui/Modal'
import UserPicker from '../components/ui/UserPicker'

// Defensive against plain {seconds, nanoseconds} objects coming back from the
// localStorage cache when a Timestamp field wasn't explicitly rehydrated to a
// Firestore Timestamp instance. Falls back to Date.now()-style parsing so a
// freshly-saved workflow whose lastEditedAt is still a serverTimestamp sentinel
// (null until the round-trip) doesn't crash the row.
function formatDate(ts: Timestamp | { seconds?: number; nanoseconds?: number } | undefined | null): string {
  if (!ts) return '—'
  const seconds = (ts as { seconds?: number }).seconds
  if (typeof seconds !== 'number' || seconds === 0) return '—'
  const date = typeof (ts as Timestamp).toDate === 'function'
    ? (ts as Timestamp).toDate()
    : new Date(seconds * 1000)
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function configsEqual(a: AppConfig, b: AppConfig): boolean {
  if (a.features.chat !== b.features.chat) return false
  return true
}

interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
  hint?: string
}

function Toggle({ checked, onChange, disabled, label, hint }: ToggleProps) {
  return (
    <label
      className={`flex items-start gap-3 rounded-xl border border-line bg-card p-4 transition ${
        disabled ? 'opacity-60' : 'hover:bg-fill-2'
      }`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
          checked ? 'bg-brand-edge' : 'bg-fill-4'
        } disabled:cursor-not-allowed`}
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
        {hint && <div className="mt-0.5 text-xs text-fg-subtle">{hint}</div>}
      </div>
    </label>
  )
}

export default function AppConfigPage() {
  const { user, profile } = useAuth()
  const { config: cachedConfig, refresh, refreshing, setConfigOptimistic } = useAppConfigContext()
  const { config: liveConfig } = useAppConfigLive()

  const baseline: AppConfig = liveConfig ?? cachedConfig ?? DEFAULT_APP_CONFIG

  const [draft, setDraft] = useState<AppConfig>(baseline)
  const [saving, setSaving] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const [lastSeenBaseline, setLastSeenBaseline] = useState<AppConfig>(baseline)
  useEffect(() => {
    if (configsEqual(draft, lastSeenBaseline)) {
      setDraft(baseline)
    }
    setLastSeenBaseline(baseline)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline.version, baseline.features.chat])

  const dirty = useMemo(() => !configsEqual(draft, baseline), [draft, baseline])

  async function handleSave() {
    if (!user) return
    setSaving(true)
    setError(null)
    try {
      const next: AppConfig = {
        ...draft,
        version: baseline.version + 1,
        updatedAt: Timestamp.now(),
        updatedBy: user.uid,
      }
      await setDoc(doc(db, 'config', 'appConfig'), {
        ...next,
        updatedAt: serverTimestamp(),
      })
      setConfigOptimistic(next)
      setSavedAt(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <p className="text-sm text-fg-subtle">Super Admin</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-fg">App Configuration</h1>
        <p className="mt-2 max-w-2xl text-fg-muted">
          Per-deployment feature flags and workflow setup. Reads cache for 24 hours after each
          refresh — bump the config here when you ship a behavior change.
        </p>
      </div>

      <OrgStructureSection />

      <WorkflowsSection adminUid={user?.uid ?? null} />

      {/* <section className="mb-6 rounded-2xl border border-line bg-fill-1 p-5">
        <h2 className="text-lg font-semibold text-fg">Features</h2>
        <div className="mt-4 space-y-3">
          <Toggle
            checked={draft.features.chat}
            onChange={(next) =>
              setDraft((d) => ({ ...d, features: { ...d.features, chat: next } }))
            }
            label="Chat"
            hint="Placeholder — chat is not yet built. Toggling on adds a disabled 'Chat' nav item."
          />
        </div>
      </section> */}

      {error && (
        <div className="mb-4 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg">
          {error}
        </div>
      )}

      {/* <div className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-fg-subtle">
          <div>
            Version <span className="font-medium text-fg-muted">{baseline.version}</span> · last
            saved {formatDate(baseline.updatedAt)}
            {baseline.updatedBy && (
              <>
                {' '}
                by{' '}
                <span className="font-medium text-fg-muted">
                  {baseline.updatedBy === profile?.uid ? 'you' : baseline.updatedBy}
                </span>
              </>
            )}
          </div>
          {savedAt && (
            <div className="mt-1 text-tone-success-fg">Saved · cache updated for this tab.</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="rounded-lg border border-line bg-fill-2 px-3 py-2 text-xs font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh from server'}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!dirty || saving}
            className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div> */}
    </main>
  )
}

// ─── Workflows section ────────────────────────────────────────────────────
// Phase 2b consolidation: replaces the Phase 2a pipeline toggle + seed buttons
// with a single section that surfaces (a) the activation state of every
// seeded workflow, (b) the seed buttons that create them, and (c) the
// one-shot migration / cleanup tools. Edits write to /workflows/_registry
// (activation) and /workflows/{id} (recommended leads); the appConfig save bar
// at the bottom of the page covers only the chat feature flag.

interface OperationRow {
  status: 'idle' | 'running' | 'done' | 'error'
  message?: string
}

function WorkflowsSection({ adminUid }: { adminUid: string | null }) {
  const {
    workflowRegistry,
    workflowsById,
    setRegistryOptimistic,
    refreshRegistry,
    refreshWorkflow,
    discoverWorkflows,
  } = useAppConfigContext()
  const { projects } = useAllProjects()
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null)
  const [manageRecommendedFor, setManageRecommendedFor] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // On mount: scan /workflows/ so the row list shows every seeded workflow,
  // not just the active set the boot eager-load fetched. Without this,
  // workflows seeded after boot would only appear after a hard reload.
  useEffect(() => {
    void discoverWorkflows()
  }, [discoverWorkflows])

  // Project count per workflow, scoped to non-terminal projects. Drives the
  // "N active projects" badge in each row + the deactivate confirmation.
  const liveCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const p of projects) {
      if (!p.workflowId) continue
      if (isProjectClosed(p.status)) continue
      out[p.workflowId] = (out[p.workflowId] ?? 0) + 1
    }
    return out
  }, [projects])

  // Workflows the operator can see in this section — union of registry-listed
  // ids and any others loaded into the context (e.g. seeded but not yet
  // activated). Each row remains togglable independent of its activation state.
  const rowWorkflows: Workflow[] = useMemo(() => {
    const known = new Map<string, Workflow>()
    for (const id of workflowRegistry.activeWorkflowIds) {
      const wf = workflowsById[id]
      if (wf) known.set(id, wf)
    }
    for (const id of Object.keys(workflowsById)) {
      if (id === WORKFLOW_REGISTRY_ID) continue
      const wf = workflowsById[id]
      if (wf && !known.has(id)) known.set(id, wf)
    }
    return [...known.values()]
  }, [workflowRegistry, workflowsById])

  async function commitRegistry(next: WorkflowRegistry) {
    if (!adminUid) return
    setActionError(null)
    const ref = doc(db, 'workflows', WORKFLOW_REGISTRY_ID)
    const payload: WorkflowRegistry = {
      ...next,
      version: workflowRegistry.version + 1,
      updatedAt: Timestamp.now(),
      updatedBy: adminUid,
    }
    try {
      await setDoc(ref, {
        ...payload,
        updatedAt: serverTimestamp(),
      })
      setRegistryOptimistic(payload)
      // Pull any newly-active workflow that wasn't already in the in-memory
      // map (e.g. activated for the first time after boot) so the rest of
      // the app — banner, /me, dashboard — can render it immediately.
      await Promise.all(
        payload.activeWorkflowIds
          .filter((id) => !workflowsById[id])
          .map((id) => refreshWorkflow(id).catch(() => null)),
      )
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Registry update failed')
    }
  }

  function isActive(id: string): boolean {
    return workflowRegistry.activeWorkflowIds.includes(id)
  }

  async function handleToggleActive(id: string, nextActive: boolean) {
    if (!nextActive) {
      // Guardrail: never deactivate the last active workflow.
      if (workflowRegistry.activeWorkflowIds.length === 1 && isActive(id)) {
        setActionError('At least one workflow must remain active.')
        return
      }
      if ((liveCounts[id] ?? 0) > 0) {
        setConfirmDeactivateId(id)
        return
      }
    }
    await applyActiveToggle(id, nextActive)
  }

  async function applyActiveToggle(id: string, nextActive: boolean) {
    const nextActiveIds = nextActive
      ? Array.from(new Set([...workflowRegistry.activeWorkflowIds, id]))
      : workflowRegistry.activeWorkflowIds.filter((wid) => wid !== id)
    let nextDefault = workflowRegistry.defaultWorkflowId
    if (!nextActive && nextDefault === id) {
      nextDefault = null
    }
    if (nextActive && !nextDefault) {
      nextDefault = id
    }
    await commitRegistry({
      ...workflowRegistry,
      activeWorkflowIds: nextActiveIds,
      defaultWorkflowId: nextDefault,
    })
  }

  async function handleSetDefault(id: string) {
    await commitRegistry({
      ...workflowRegistry,
      defaultWorkflowId: id,
    })
  }

  return (
    <section className="mb-6 rounded-2xl border border-line bg-fill-1 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-fg">Workflows</h2>
          <p className="mt-1 text-sm text-fg-subtle">
            Activate the workflows project creators can pick from, edit them, and manage
            recommended leads. Workflow edits never affect projects already in flight — every
            project carries its own snapshot.
          </p>
        </div>
        <Link
          to="/admin/workflows/new"
          className="shrink-0 rounded-lg bg-brand-gradient px-3 py-1.5 text-sm font-medium text-white shadow hover-brand-gradient"
        >
          + Create new workflow
        </Link>
      </div>

      {workflowRegistry.defaultWorkflowId === null &&
        workflowRegistry.activeWorkflowIds.length > 0 && (
          <div className="mt-4 rounded-lg border border-tone-warn-bd bg-tone-warn-bg px-3 py-2 text-xs text-tone-warn-fg">
            No default workflow set — project creators will pick manually each time.
          </div>
        )}

      {actionError && (
        <div className="mt-4 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg">
          {actionError}
        </div>
      )}

      {(() => {
        const activeRows = rowWorkflows.filter((wf) => isActive(wf.id))
        const inactiveRows = rowWorkflows.filter((wf) => !isActive(wf.id))
        return (
          <>
            <div className="mt-4 space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
                Active workflows
              </h3>
              {activeRows.length === 0 ? (
                <p className="text-xs text-fg-subtle">
                  No workflows active yet. Create one with the button above, or activate one
                  from the Inactive section.
                </p>
              ) : (
                activeRows.map((wf) => (
                  <WorkflowRow
                    key={wf.id}
                    workflow={wf}
                    isActive
                    isDefault={workflowRegistry.defaultWorkflowId === wf.id}
                    activeProjectCount={liveCounts[wf.id] ?? 0}
                    onToggleActive={(next) => void handleToggleActive(wf.id, next)}
                    onSetDefault={() => void handleSetDefault(wf.id)}
                    onManageRecommended={() => setManageRecommendedFor(wf.id)}
                    disabled={!adminUid}
                  />
                ))
              )}
            </div>

            {inactiveRows.length > 0 && (
              <details className="mt-6">
                <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-fg-subtle">
                  Inactive workflows ({inactiveRows.length})
                </summary>
                <div className="mt-2 space-y-2">
                  {inactiveRows.map((wf) => (
                    <WorkflowRow
                      key={wf.id}
                      workflow={wf}
                      isActive={false}
                      isDefault={false}
                      activeProjectCount={liveCounts[wf.id] ?? 0}
                      onToggleActive={(next) => void handleToggleActive(wf.id, next)}
                      onSetDefault={() => void handleSetDefault(wf.id)}
                      onManageRecommended={() => setManageRecommendedFor(wf.id)}
                      disabled={!adminUid}
                    />
                  ))}
                </div>
              </details>
            )}
          </>
        )
      })()}

      <SeedsSection
        adminUid={adminUid}
        onRegistryRefresh={() => void refreshRegistry()}
      />
      <MigrationsSection adminUid={adminUid} />

      {confirmDeactivateId && (
        <DeactivateConfirmModal
          workflow={rowWorkflows.find((w) => w.id === confirmDeactivateId)}
          activeProjectCount={liveCounts[confirmDeactivateId] ?? 0}
          onCancel={() => setConfirmDeactivateId(null)}
          onConfirm={() => {
            const id = confirmDeactivateId
            setConfirmDeactivateId(null)
            void applyActiveToggle(id, false)
          }}
        />
      )}

      {manageRecommendedFor && (
        <ManageRecommendedLeadsModal
          workflowId={manageRecommendedFor}
          adminUid={adminUid}
          onClose={() => setManageRecommendedFor(null)}
        />
      )}
    </section>
  )
}

// ─── Workflow row ─────────────────────────────────────────────────────────

interface WorkflowRowProps {
  workflow: Workflow
  isActive: boolean
  isDefault: boolean
  activeProjectCount: number
  onToggleActive: (next: boolean) => void
  onSetDefault: () => void
  onManageRecommended: () => void
  disabled?: boolean
}

function WorkflowRow({
  workflow,
  isActive,
  isDefault,
  activeProjectCount,
  onToggleActive,
  onSetDefault,
  onManageRecommended,
  disabled,
}: WorkflowRowProps) {
  const lastEdited =
    workflow.lastEditedAt && workflow.lastEditedAt.seconds > 0
      ? formatDate(workflow.lastEditedAt)
      : formatDate(workflow.updatedAt)

  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-line bg-card p-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={isActive}
          disabled={disabled}
          onClick={() => onToggleActive(!isActive)}
          className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
            isActive ? 'bg-brand-edge' : 'bg-fill-4'
          } disabled:cursor-not-allowed`}
        >
          <span
            aria-hidden
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
              isActive ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-fg">{workflow.displayName}</span>
            <code className="rounded bg-fill-2 px-1.5 py-0.5 text-[10px] text-fg-subtle">
              {workflow.id}
            </code>
            {workflow.isSystemDefined && (
              <span className="rounded-full border border-line bg-fill-3 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-fg-subtle">
                System
              </span>
            )}
            {isDefault && (
              <span className="rounded-full border border-brand-edge bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand">
                Default
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-fg-subtle">
            {activeProjectCount} active project{activeProjectCount === 1 ? '' : 's'} · v
            {workflow.version} · {workflow.stages.length} stages · last edited {lastEdited}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Link
          to={`/admin/workflows/${workflow.id}/edit`}
          aria-label={`Edit ${workflow.displayName}`}
          title={workflow.isSystemDefined ? 'View (system templates are read-only)' : 'Edit'}
          className="inline-flex items-center justify-center rounded-md border border-line bg-fill-2 px-2 py-1 text-[11px] font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </Link>
        {!isDefault && isActive && (
          <button
            type="button"
            onClick={onSetDefault}
            disabled={disabled}
            className="rounded-md border border-line bg-fill-2 px-2 py-1 text-[11px] font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg disabled:opacity-50"
          >
            Set default
          </button>
        )}
        <button
          type="button"
          onClick={onManageRecommended}
          disabled={disabled}
          className="rounded-md border border-line bg-fill-2 px-2 py-1 text-[11px] font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg disabled:opacity-50"
        >
          Recommended leads
        </button>
      </div>
    </div>
  )
}

// ─── Deactivate confirmation modal ────────────────────────────────────────

function DeactivateConfirmModal({
  workflow,
  activeProjectCount,
  onCancel,
  onConfirm,
}: {
  workflow: Workflow | undefined
  activeProjectCount: number
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!workflow) return null
  return (
    <Modal
      open
      onClose={onCancel}
      title={`Deactivate ${workflow.displayName}?`}
      description={`${activeProjectCount} project${activeProjectCount === 1 ? '' : 's'} ${activeProjectCount === 1 ? 'is' : 'are'} currently on this workflow. They'll continue to function — but creators won't be able to start new projects on this workflow.`}
    >
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-line bg-fill-2 px-4 py-2 text-sm font-medium text-fg-muted transition hover:bg-fill-4"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-2 text-sm font-medium text-tone-danger-fg transition hover:opacity-90"
        >
          Deactivate
        </button>
      </div>
    </Modal>
  )
}

// ─── Recommended leads editor ─────────────────────────────────────────────

function ManageRecommendedLeadsModal({
  workflowId,
  adminUid,
  onClose,
}: {
  workflowId: string
  adminUid: string | null
  onClose: () => void
}) {
  const workflow = useWorkflow(workflowId)
  const { users } = useAllUsers()
  const { setWorkflowOptimistic } = useAppConfigContext()
  const [picked, setPicked] = useState<string | null>(null)
  const [recommended, setRecommended] = useState<string[]>(
    () => workflow?.recommendedLeads ?? [],
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seed when the workflow doc resolves (lazy fetch).
  useEffect(() => {
    if (workflow?.recommendedLeads) setRecommended(workflow.recommendedLeads)
  }, [workflow?.recommendedLeads])

  const usersById = useMemo(() => new Map(users.map((u) => [u.uid, u])), [users])

  function addCurrent() {
    if (!picked) return
    setRecommended((prev) => (prev.includes(picked) ? prev : [...prev, picked]))
    setPicked(null)
  }

  function remove(uid: string) {
    setRecommended((prev) => prev.filter((u) => u !== uid))
  }

  async function save() {
    if (!adminUid || !workflow) return
    setSaving(true)
    setError(null)
    try {
      const ref = doc(db, 'workflows', workflowId)
      const next: Workflow = {
        ...workflow,
        recommendedLeads: recommended,
        version: workflow.version + 1,
        updatedBy: adminUid,
        updatedAt: Timestamp.now(),
      }
      await setDoc(ref, {
        ...next,
        updatedAt: serverTimestamp(),
      })
      setWorkflowOptimistic(next)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Recommended leads · ${workflow?.displayName ?? workflowId}`}
      description="Surfaced under a 'Recommended' group at the top of the new-project lead picker. Soft hint — any pickerScope-valid user is still selectable."
      size="lg"
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium text-fg-muted">Add a recommended lead</p>
          <div className="flex gap-2">
            <div className="flex-1">
              <UserPicker mode="single" value={picked} onChange={setPicked} placeholder="Choose someone…" />
            </div>
            <button
              type="button"
              onClick={addCurrent}
              disabled={!picked}
              className="rounded-lg border border-line bg-fill-2 px-3 py-2 text-xs font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-fg-muted">Recommended ({recommended.length})</p>
          {recommended.length === 0 ? (
            <p className="text-xs text-fg-subtle">None yet. Add a few to surface them at the top of the lead picker.</p>
          ) : (
            <ul className="space-y-1.5">
              {recommended.map((uid) => {
                const u = usersById.get(uid)
                return (
                  <li
                    key={uid}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line bg-card px-3 py-2 text-sm"
                  >
                    <span className="text-fg">{u?.displayName ?? u?.email ?? uid}</span>
                    <button
                      type="button"
                      onClick={() => remove(uid)}
                      className="text-xs text-fg-subtle hover:text-tone-danger-fg"
                    >
                      Remove
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-line bg-fill-2 px-4 py-2 text-sm font-medium text-fg-muted transition hover:bg-fill-4 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !workflow}
            className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Seeds + migrations rows ──────────────────────────────────────────────

function SeedsSection({
  adminUid,
  onRegistryRefresh,
}: {
  adminUid: string | null
  onRegistryRefresh: () => void
}) {
  // refreshWorkflow pulls the freshly-seeded doc into the in-memory map so
  // the WorkflowsSection rows + the new-project picker + everywhere else
  // see it without waiting for a page reload.
  const { refreshWorkflow } = useAppConfigContext()
  const [collab, setCollab] = useState<OperationRow>({ status: 'idle' })
  const [basic, setBasic] = useState<OperationRow>({ status: 'idle' })
  const [sales, setSales] = useState<OperationRow>({ status: 'idle' })
  const [registry, setRegistry] = useState<OperationRow>({ status: 'idle' })

  async function runCollab() {
    if (!adminUid) return
    setCollab({ status: 'running' })
    try {
      const res = await seedCollabWorkflow(adminUid)
      await refreshWorkflow(res.workflowId)
      setCollab({
        status: 'done',
        message: `Seeded v${res.newVersion} with ${res.stages} stages (was v${res.previousVersion}).`,
      })
    } catch (e) {
      setCollab({ status: 'error', message: e instanceof Error ? e.message : 'Seed failed' })
    }
  }
  async function runBasic() {
    if (!adminUid) return
    setBasic({ status: 'running' })
    try {
      const res = await seedBasicWorkflow(adminUid)
      await refreshWorkflow(res.workflowId)
      setBasic({
        status: 'done',
        message: `Seeded v${res.newVersion} with ${res.stages} stages (was v${res.previousVersion}).`,
      })
    } catch (e) {
      setBasic({ status: 'error', message: e instanceof Error ? e.message : 'Seed failed' })
    }
  }
  async function runSales() {
    if (!adminUid) return
    setSales({ status: 'running' })
    try {
      const res = await seedSalesWorkflow(adminUid)
      await refreshWorkflow(res.workflowId)
      setSales({
        status: 'done',
        message: `Seeded v${res.newVersion} with ${res.stages} stages (was v${res.previousVersion}).`,
      })
    } catch (e) {
      setSales({ status: 'error', message: e instanceof Error ? e.message : 'Seed failed' })
    }
  }
  async function runRegistry() {
    if (!adminUid) return
    setRegistry({ status: 'running' })
    try {
      const res = await seedWorkflowRegistry(adminUid)
      onRegistryRefresh()
      setRegistry({
        status: 'done',
        message: res.preserved
          ? `Registry preserved (v${res.newVersion}, ${res.activeWorkflowIds.length} active).`
          : `Registry created at v${res.newVersion} (basic-only default).`,
      })
    } catch (e) {
      setRegistry({ status: 'error', message: e instanceof Error ? e.message : 'Seed failed' })
    }
  }

  return (
    <div className="mt-6 space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-fg-subtle">Seeds</h3>
      <p className="text-xs text-fg-subtle">
        Idempotent — each run bumps the doc&apos;s version. Run once per environment after deploy.
      </p>
      <RunButton
        label="Seed collab-default workflow"
        hint="Multi-stage collaborative tender flow."
        row={collab}
        onRun={runCollab}
        disabled={!adminUid}
      />
      <RunButton
        label="Seed basic workflow"
        hint="2-stage simple status flow."
        row={basic}
        onRun={runBasic}
        disabled={!adminUid}
      />
      <RunButton
        label="Seed sales-default workflow"
        hint="7-stage individual sales pipeline (new in Phase 2b)."
        row={sales}
        onRun={runSales}
        disabled={!adminUid}
      />
      <RunButton
        label="Seed workflow registry"
        hint="Creates /workflows/_registry with the basic-only default when missing. Preserves existing activation when the doc already exists."
        row={registry}
        onRun={runRegistry}
        disabled={!adminUid}
      />
    </div>
  )
}

function MigrationsSection({ adminUid }: { adminUid: string | null }) {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<OperationRow>({ status: 'idle' })
  const [retire, setRetire] = useState<OperationRow>({ status: 'idle' })

  async function runHistory() {
    if (!adminUid) return
    if (
      !confirm(
        'Rewrite every project\'s stageHistory → projectHistory? Idempotent — already-migrated projects are skipped.',
      )
    )
      return
    setHistory({ status: 'running' })
    try {
      const res = await migrateProjectHistory(adminUid)
      setHistory({
        status: 'done',
        message: `Scanned ${res.totalScanned} · migrated ${res.migrated} · already done ${res.alreadyMigrated} (${res.batches} batches).`,
      })
    } catch (e) {
      setHistory({ status: 'error', message: e instanceof Error ? e.message : 'Migration failed' })
    }
  }
  async function runRetire() {
    if (!adminUid) return
    if (!confirm('Strip the legacy pipeline.enabled field from appConfig?')) return
    setRetire({ status: 'running' })
    try {
      const res = await retirePipelineToggle(adminUid)
      setRetire({
        status: 'done',
        message: res.hadPipeline ? 'Removed legacy pipeline.enabled.' : 'No legacy field present.',
      })
    } catch (e) {
      setRetire({ status: 'error', message: e instanceof Error ? e.message : 'Retire failed' })
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-line bg-fill-2 px-3 py-2 text-xs font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg"
      >
        <span>Migration tools</span>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <RunButton
            label="Migrate stageHistory → projectHistory"
            hint="Rewrites every project's history array to the Phase 2b discriminated-union shape, prepends a workflow_assignment event, and drops legacy fields. Idempotent."
            row={history}
            onRun={runHistory}
            disabled={!adminUid}
          />
          <RunButton
            label="Retire pipeline.enabled"
            hint="Removes the legacy pipeline.enabled field from /config/appConfig via deleteField()."
            row={retire}
            onRun={runRetire}
            disabled={!adminUid}
          />
        </div>
      )}
    </div>
  )
}

function RunButton({
  label,
  hint,
  row,
  onRun,
  disabled,
}: {
  label: string
  hint: string
  row: OperationRow
  onRun: () => Promise<void>
  disabled?: boolean
}) {
  const busy = row.status === 'running'
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-line bg-card p-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-fg">{label}</div>
        <div className="mt-0.5 text-xs text-fg-subtle">{hint}</div>
        {row.message && (
          <div
            className={`mt-2 text-xs ${
              row.status === 'error' ? 'text-tone-danger-fg' : 'text-tone-success-fg'
            }`}
          >
            {row.message}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => void onRun()}
        disabled={disabled || busy}
        className="shrink-0 rounded-lg border border-line bg-fill-2 px-3 py-2 text-xs font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Running…' : 'Run'}
      </button>
    </div>
  )
}
