import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, ArrowRight } from 'lucide-react'
import {  serverTimestamp, setDoc, Timestamp } from 'firebase/firestore'
import { tenantDoc } from '../lib/firestore'
import { useAuth } from '../contexts/AuthContext'
import { isDevConfigUser } from '../components/DevConfigRoute'
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


export default function AppConfigPage() {
  const { user, profile } = useAuth()
  const { config: cachedConfig } = useAppConfigContext()
  const { config: liveConfig } = useAppConfigLive()

  // Kept so any commented-out feature flag UI below can be re-enabled without
  // re-deriving the baseline. The chat-toggle save flow was retired with
  // Phase 2c — workflow management took its place as the main concern of this
  // page. Re-add a draft/setDraft/handleSave trio here if/when a new flag
  // needs editing.
  const baseline: AppConfig = liveConfig ?? cachedConfig ?? DEFAULT_APP_CONFIG
  void baseline

  const [error] = useState<string | null>(null)

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-fg-subtle">Super Admin</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-fg">App Configuration</h1>
          <p className="mt-2 max-w-2xl text-fg-muted">
            Shape how your organization runs — the roles your teams play and the workflows
            your projects move through. Changes apply to new projects going forward; work
            already in flight keeps its current settings.
          </p>
        </div>
        {profile?.globalRole === 'super_admin' && (
        <Link
          to="/admin/setup"
          title="Walk through the setup wizard again — values are pre-filled with what you have now."
          className="group inline-flex shrink-0 items-center gap-2 rounded-full border border-brand-edge/40 bg-brand-soft/60 px-4 py-2 text-sm font-medium text-fg-strong shadow-sm transition hover:border-brand-edge hover:bg-brand-gradient hover:text-white hover:shadow-lg hover:shadow-purple-900/30"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-brand transition group-hover:text-white"
            aria-hidden
          >
            <path d="M12 3 14 9l6 2-6 2-2 6-2-6-6-2 6-2 2-6Z" />
          </svg>
          <span>Re-run setup wizard</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-white/90"
            aria-hidden
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
        )}
      </div>

      <OrgStructureSection />

      {/* Roles, hierarchy & module access live on their own page (/admin/roles).
          super_admin-only — the destination route is guarded by SuperAdminRoute,
          so we only surface the entry point to users who can actually open it. */}
      {profile?.globalRole === 'super_admin' && (
        <section className="mb-6 rounded-2xl border border-line bg-fill-1 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-md shadow-purple-900/30">
                <ShieldCheck size={18} aria-hidden />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-fg">Roles &amp; access</h2>
                <p className="mt-1 text-sm text-fg-subtle">
                  Define your authority levels, what each role can touch, and who sits where.
                  Drives permissions across the app — higher levels inherit lower levels&rsquo;
                  access.
                </p>
              </div>
            </div>
            <Link
              to="/admin/roles"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-gradient px-3 py-1.5 text-sm font-medium text-white shadow hover-brand-gradient"
            >
              Open
              <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
        </section>
      )}

      <WorkflowsSection adminUid={user?.uid ?? null} />

      {/* Dev Tools are scaffolding for the team — sandbox visitors don't need
          (or want) reseed/wipe/migration controls. Build-time gated so the
          whole section tree-shakes out of the sandbox bundle. */}
      {!__IS_SANDBOX__ && isDevConfigUser(profile) && (
        <DevToolsSection adminUid={user?.uid ?? null} />
      )}

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
    refreshWorkflow,
    discoverWorkflows,
    bootLoaded,
  } = useAppConfigContext()
  const { projects } = useAllProjects()
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null)
  const [manageRecommendedFor, setManageRecommendedFor] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [discovered, setDiscovered] = useState<boolean>(false)

  // On mount: scan /workflows/ so the row list shows every seeded workflow,
  // not just the active set the boot eager-load fetched. Without this,
  // workflows seeded after boot would only appear after a hard reload.
  useEffect(() => {
    let cancelled = false
    void discoverWorkflows().finally(() => {
      if (!cancelled) setDiscovered(true)
    })
    return () => {
      cancelled = true
    }
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
    const ref = tenantDoc('workflows', WORKFLOW_REGISTRY_ID)
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

      {/* On a fresh device the boot fetches haven't finished yet AND the
        * /workflows/ collection scan hasn't returned. Showing the "no
        * workflows" empty state during that window misleads the user into
        * thinking nothing's configured — render a spinner instead. */}
      {(!bootLoaded || !discovered) ? (
        <div
          role="status"
          aria-label="Loading workflows"
          className="mt-4 flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-6 text-sm text-fg-subtle"
        >
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-fg-strong" />
          Loading workflows…
        </div>
      ) : (() => {
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
      const ref = tenantDoc('workflows', workflowId)
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

// ─── Dev Tools (REMOVE BEFORE SHIPPING TO PROD) ───────────────────────────
// Wraps Seeds + Migrations + the destructive "Reset to fresh tenant" reset
// behind a single collapsible. Anything inside here is for platform-team use
// during dev/handoff and should not survive into a customer build.

function DevToolsSection({ adminUid }: { adminUid: string | null }) {
  const { refreshRegistry } = useAppConfigContext()
  const [open, setOpen] = useState(false)
  const onRegistryRefresh = () => void refreshRegistry()

  return (
    <section className="mb-6 rounded-2xl border border-tone-warn-bd/40 bg-fill-1 p-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-tone-warn-bd bg-tone-warn-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-tone-warn-fg">
              Dev only
            </span>
            <h2 className="text-lg font-semibold text-fg">Dev Tools</h2>
          </div>
          <p className="mt-1 text-sm text-fg-subtle">
            Platform-team utilities for seeding system workflows, running one-off migrations,
            and resetting the tenant. <strong className="text-fg-muted">Removed in production.</strong>
          </p>
        </div>
        <span className="mt-1 shrink-0 text-fg-subtle" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="mt-5 space-y-6">
          <ResetTenantTool adminUid={adminUid} />
          <ConfigTransferSection adminUid={adminUid} />
          <SeedsSection adminUid={adminUid} onRegistryRefresh={onRegistryRefresh} />
          <MigrationsSection adminUid={adminUid} />
        </div>
      )}
    </section>
  )
}

function ResetTenantTool({ adminUid }: { adminUid: string | null }) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)

  const canConfirm = confirmText.trim().toUpperCase() === 'RESET'

  async function runReset() {
    if (!adminUid || !canConfirm) return
    setRunning(true)
    setError(null)
    setSummary(null)
    try {
      const { wipeTenant } = await import('../lib/wipeTenant')
      const res = await wipeTenant()
      const parts: string[] = []
      for (const [name, count] of Object.entries(res.collectionsCleared)) {
        parts.push(`${name}: ${count}`)
      }
      parts.push(`config: ${res.configsCleared.length}`)
      parts.push(`users reset: ${res.usersReset}`)
      setSummary(`Wiped — ${parts.join(' · ')}. Reloading…`)
      // Hard reload so every in-memory React state + provider resets and
      // Home's redirect logic re-evaluates against the now-empty Firestore.
      setTimeout(() => {
        window.location.assign('/')
      }, 700)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed')
      setRunning(false)
    }
  }

  return (
    <div className="rounded-xl border border-tone-danger-bd/60 bg-tone-danger-bg/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-tone-danger-fg"
              aria-hidden
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <h3 className="text-sm font-semibold text-fg">Reset to fresh tenant</h3>
          </div>
          <p className="mt-1 text-xs text-fg-subtle">
            Deletes every project, task, team, workflow, and config doc from Firestore, clears
            every localStorage cache, and resets each user's team memberships. The next page
            load behaves like a brand-new tenant — org wizard launches, then the workflow
            wizard. User identities stay so you can log right back in.
          </p>
        </div>
        {!confirmOpen && (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={!adminUid}
            className="shrink-0 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-1.5 text-xs font-medium text-tone-danger-fg transition hover:opacity-90 disabled:opacity-50"
          >
            Reset tenant…
          </button>
        )}
      </div>

      {confirmOpen && (
        <div className="mt-4 space-y-2 rounded-lg border border-tone-danger-bd bg-tone-danger-bg/20 p-3">
          <p className="text-xs text-fg-strong">
            This is irreversible. Type <code className="rounded bg-fill-3 px-1.5 py-0.5 text-fg">RESET</code> below to confirm.
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="RESET"
            disabled={running}
            className="w-full rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg outline-none transition focus:border-tone-danger-bd focus:ring-2 focus:ring-tone-danger-bd disabled:opacity-60"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmOpen(false)
                setConfirmText('')
                setError(null)
                setSummary(null)
              }}
              disabled={running}
              className="rounded-lg border border-line bg-fill-2 px-3 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-fill-4 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void runReset()}
              disabled={running || !canConfirm}
              className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-1.5 text-xs font-medium text-tone-danger-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? 'Wiping…' : 'Wipe everything'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-tone-danger-fg" role="alert">
          {error}
        </p>
      )}
      {summary && (
        <p className="mt-2 text-xs text-tone-success-fg" role="status">
          {summary}
        </p>
      )}
    </div>
  )
}

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

// ─── Config transfer (export / import / migrate a legacy tenant) ──────────────
// Move authored config (roles + hierarchy + workflows + registry + chat flag)
// between tenants as portable JSON. Migrating a legacy tenant: 1) Reset keeping
// teams & members → 2) Import config → 3) reload.
function ConfigTransferSection({ adminUid }: { adminUid: string | null }) {
  const { refreshOrg, refreshRegistry, discoverWorkflows } = useAppConfigContext()
  const [exportRow, setExportRow] = useState<OperationRow>({ status: 'idle' })
  const [importRow, setImportRow] = useState<OperationRow>({ status: 'idle' })
  const [resetRow, setResetRow] = useState<OperationRow>({ status: 'idle' })
  const [importText, setImportText] = useState('')
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState('')

  const canConfirmReset = resetConfirmText.trim().toUpperCase() === 'RESET'

  async function runExport() {
    setExportRow({ status: 'running' })
    try {
      const { exportTenantConfig, downloadJson } = await import('../lib/configTransfer')
      const bundle = await exportTenantConfig(Date.now())
      console.log('[configTransfer] exported bundle', bundle)
      downloadJson(`tenant-config-${bundle.exportedAt}.json`, bundle)
      const roleCount = bundle.orgStructure?.roleHierarchy?.length ?? 0
      setExportRow({
        status: 'done',
        message: `Exported ${bundle.workflows.length} workflow(s) · ${roleCount} role(s). Downloaded + logged to console.`,
      })
    } catch (e) {
      setExportRow({ status: 'error', message: e instanceof Error ? e.message : 'Export failed' })
    }
  }

  function onPickFile(file: File | null) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setImportText(typeof reader.result === 'string' ? reader.result : '')
      setImportRow({ status: 'idle' })
    }
    reader.onerror = () => setImportRow({ status: 'error', message: 'Could not read that file.' })
    reader.readAsText(file)
  }

  async function runImport() {
    if (!adminUid) return
    if (!importText.trim()) {
      setImportRow({ status: 'error', message: 'Paste a bundle or choose a .json file first.' })
      return
    }
    setImportRow({ status: 'running' })
    try {
      const { parseConfigBundle, importTenantConfig } = await import('../lib/configTransfer')
      const bundle = parseConfigBundle(importText)
      const sum = await importTenantConfig(bundle, adminUid)
      await Promise.all([refreshOrg(), refreshRegistry(), discoverWorkflows()])
      setImportRow({
        status: 'done',
        message: `Imported ${sum.workflows} workflow(s)${sum.orgStructure ? ' + roles' : ''}${
          sum.registry ? ' + registry' : ''
        }. Live now — assign people to roles in Roles & access.`,
      })
    } catch (e) {
      setImportRow({ status: 'error', message: e instanceof Error ? e.message : 'Import failed' })
    }
  }

  async function runReset() {
    if (!canConfirmReset) return
    setResetRow({ status: 'running' })
    try {
      const { resetTenantPreservingPeople } = await import('../lib/wipeTenant')
      const res = await resetTenantPreservingPeople()
      const parts = Object.entries(res.collectionsCleared).map(([n, c]) => `${n}: ${c}`)
      parts.push(`config: ${res.configsCleared.length}`)
      setResetRow({
        status: 'done',
        message: `Cleared ${parts.join(' · ')} — teams + members kept. Now Import the bundle, then reload.`,
      })
      setResetConfirmOpen(false)
      setResetConfirmText('')
    } catch (e) {
      setResetRow({ status: 'error', message: e instanceof Error ? e.message : 'Reset failed' })
    }
  }

  const inputBase =
    'w-full rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-fg-subtle">Config transfer</h3>
        <p className="mt-1 text-xs text-fg-subtle">
          Copy roles, hierarchy, workflows + the chat flag between tenants. To migrate a legacy
          tenant: <strong className="text-fg-muted">1)</strong> Reset keeping teams &amp; members →{' '}
          <strong className="text-fg-muted">2)</strong> Import config →{' '}
          <strong className="text-fg-muted">3)</strong> reload. People and role assignments are never
          exported — re-assign roles via Roles &amp; access after import.
        </p>
      </div>

      {/* Export */}
      <div className="flex items-start justify-between gap-3 rounded-xl border border-line bg-card p-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-fg">Export config</div>
          <div className="mt-0.5 text-xs text-fg-subtle">
            Downloads a <code className="rounded bg-fill-3 px-1 py-0.5">tenant-config-*.json</code>{' '}
            bundle and logs it to the console. Commit it to the repo or import it elsewhere.
          </div>
          {exportRow.message && (
            <div
              className={`mt-2 text-xs ${
                exportRow.status === 'error' ? 'text-tone-danger-fg' : 'text-tone-success-fg'
              }`}
            >
              {exportRow.message}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void runExport()}
          disabled={exportRow.status === 'running'}
          className="shrink-0 rounded-lg border border-line bg-fill-2 px-3 py-2 text-xs font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exportRow.status === 'running' ? 'Exporting…' : 'Export'}
        </button>
      </div>

      {/* Import */}
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="text-sm font-medium text-fg">Import config</div>
        <div className="mt-0.5 text-xs text-fg-subtle">
          Choose a bundle file or paste its JSON, then Import. Writes config docs only — users and
          teams are untouched.
        </div>
        <div className="mt-3 space-y-2">
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-fg-subtle file:mr-3 file:rounded-md file:border file:border-line file:bg-fill-2 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-fg-muted hover:file:bg-fill-4"
          />
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="…or paste bundle JSON here"
            rows={3}
            className={`${inputBase} resize-none font-mono text-xs`}
          />
          {importRow.message && (
            <div
              className={`text-xs ${
                importRow.status === 'error' ? 'text-tone-danger-fg' : 'text-tone-success-fg'
              }`}
            >
              {importRow.message}
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void runImport()}
              disabled={!adminUid || importRow.status === 'running'}
              className="rounded-lg border border-line bg-fill-2 px-3 py-2 text-xs font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importRow.status === 'running' ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      </div>

      {/* Reset keeping teams & members */}
      <div className="rounded-xl border border-tone-warn-bd/50 bg-tone-warn-bg/10 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-fg">Reset keeping teams &amp; members</div>
            <div className="mt-0.5 text-xs text-fg-subtle">
              Clears projects, tasks, workflows, and config docs — but keeps every team and member
              (including their team memberships). Use before importing onto a legacy tenant. Does not
              reload.
            </div>
            {resetRow.message && (
              <div
                className={`mt-2 text-xs ${
                  resetRow.status === 'error' ? 'text-tone-danger-fg' : 'text-tone-success-fg'
                }`}
              >
                {resetRow.message}
              </div>
            )}
          </div>
          {!resetConfirmOpen && (
            <button
              type="button"
              onClick={() => setResetConfirmOpen(true)}
              disabled={resetRow.status === 'running'}
              className="shrink-0 rounded-lg border border-tone-warn-bd bg-tone-warn-bg px-3 py-2 text-xs font-medium text-tone-warn-fg transition hover:opacity-90 disabled:opacity-50"
            >
              Reset…
            </button>
          )}
        </div>
        {resetConfirmOpen && (
          <div className="mt-3 space-y-2 rounded-lg border border-tone-warn-bd bg-tone-warn-bg/20 p-3">
            <p className="text-xs text-fg-strong">
              Type <code className="rounded bg-fill-3 px-1.5 py-0.5 text-fg">RESET</code> to clear
              everything except teams &amp; members.
            </p>
            <input
              type="text"
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value)}
              placeholder="RESET"
              disabled={resetRow.status === 'running'}
              className={inputBase}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setResetConfirmOpen(false)
                  setResetConfirmText('')
                }}
                disabled={resetRow.status === 'running'}
                className="rounded-lg border border-line bg-fill-2 px-3 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-fill-4 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runReset()}
                disabled={resetRow.status === 'running' || !canConfirmReset}
                className="rounded-lg border border-tone-warn-bd bg-tone-warn-bg px-3 py-1.5 text-xs font-medium text-tone-warn-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {resetRow.status === 'running' ? 'Clearing…' : 'Clear (keep people)'}
              </button>
            </div>
          </div>
        )}
        {resetRow.status === 'done' && (
          <button
            type="button"
            onClick={() => window.location.assign('/')}
            className="mt-3 rounded-lg border border-line bg-fill-2 px-3 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg"
          >
            Reload now
          </button>
        )}
      </div>
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
