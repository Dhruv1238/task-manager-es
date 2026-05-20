import { useEffect, useMemo, useState } from 'react'
import { doc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'
import {
  DEFAULT_APP_CONFIG,
  useAppConfigContext,
  useAppConfigLive,
} from '../contexts/AppConfigContext'
import { type AppConfig } from '../types/models'
import OrgStructureSection from '../components/admin/OrgStructureSection'
import { seedCollabWorkflow } from '../lib/seedCollabWorkflow'
import { seedBasicWorkflow } from '../lib/seedBasicWorkflow'
import { migrateClientAProjects } from '../lib/migrateClientAProjects'

function formatDate(ts: Timestamp | undefined): string {
  if (!ts || ts.seconds === 0) return '—'
  return ts.toDate().toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function configsEqual(a: AppConfig, b: AppConfig): boolean {
  if (a.pipeline.enabled !== b.pipeline.enabled) return false
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

  // Seed the editor with whatever we've got — live takes precedence once it
  // resolves, otherwise the cached snapshot, otherwise defaults.
  const baseline: AppConfig = liveConfig ?? cachedConfig ?? DEFAULT_APP_CONFIG

  const [draft, setDraft] = useState<AppConfig>(baseline)
  const [saving, setSaving] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Re-seed the editor whenever the live config arrives or is updated by
  // another editor. We only reseed when the draft equals the previous baseline
  // (i.e. user hasn't started editing yet) to avoid clobbering in-flight edits.
  const [lastSeenBaseline, setLastSeenBaseline] = useState<AppConfig>(baseline)
  useEffect(() => {
    if (configsEqual(draft, lastSeenBaseline)) {
      setDraft(baseline)
    }
    setLastSeenBaseline(baseline)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline.version, baseline.pipeline.enabled, baseline.features.chat])

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
        // serverTimestamp() is authoritative for updatedAt; the optimistic value
        // is replaced on the next listener tick.
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
          Per-deployment feature flags. Reads cache for 24 hours after each refresh — bump
          the config here when you ship a behavior change to either client.
        </p>
      </div>

      <OrgStructureSection />

      <section className="mb-6 rounded-2xl border border-line bg-fill-1 p-5">
        <h2 className="text-lg font-semibold text-fg">Project pipeline</h2>
        <p className="mt-1 text-sm text-fg-subtle">
          When enabled, new projects pin the <code>collab-default</code> workflow (the 10-stage
          tender flow). When disabled, new projects pin the <code>basic</code> workflow (simple
          status flow). The per-stage toggles were retired in Phase 2a — a stage is now
          &ldquo;disabled&rdquo; by having no actions for any actor in the workflow doc.
        </p>

        <div className="mt-4 space-y-3">
          <Toggle
            checked={draft.pipeline.enabled}
            onChange={(next) =>
              setDraft((d) => ({ ...d, pipeline: { ...d.pipeline, enabled: next } }))
            }
            label="Enable tender pipeline"
            hint={
              draft.pipeline.enabled
                ? 'New projects pin collab-default; banner + lead allocation active.'
                : 'New projects pin basic; simple status flow only.'
            }
          />
        </div>
      </section>

      <WorkflowSeedSection adminUid={user?.uid ?? null} />

      <section className="mb-6 rounded-2xl border border-line bg-fill-1 p-5">
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
      </section>

      {error && (
        <div className="mb-4 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-fg-subtle">
          <div>
            Version <span className="font-medium text-fg-muted">{baseline.version}</span> · last
            saved {formatDate(baseline.updatedAt)}
            {baseline.updatedBy && (
              <>
                {' '}
                by <span className="font-medium text-fg-muted">{baseline.updatedBy === profile?.uid ? 'you' : baseline.updatedBy}</span>
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
      </div>
    </main>
  )
}

// ─── Workflow seeds (Phase 2a, Sprint 1) ──────────────────────────────────
// Super-admin buttons to (re)seed the workflow docs. Idempotent — each run
// bumps the doc's `version` and overwrites the rest. The third button is a
// placeholder until Sprint 5 ships the migrateClientAProjects helper.

interface SeedRow {
  status: 'idle' | 'running' | 'done' | 'error'
  message?: string
}

function WorkflowSeedSection({ adminUid }: { adminUid: string | null }) {
  const [collab, setCollab] = useState<SeedRow>({ status: 'idle' })
  const [basic, setBasic] = useState<SeedRow>({ status: 'idle' })
  const [migrate, setMigrate] = useState<SeedRow>({ status: 'idle' })

  async function runCollab() {
    if (!adminUid) return
    setCollab({ status: 'running' })
    try {
      const res = await seedCollabWorkflow(adminUid)
      setCollab({
        status: 'done',
        message: `Seeded v${res.newVersion} with ${res.stages} stages (was v${res.previousVersion}).`,
      })
    } catch (e) {
      setCollab({
        status: 'error',
        message: e instanceof Error ? e.message : 'Seed failed',
      })
    }
  }

  async function runBasic() {
    if (!adminUid) return
    setBasic({ status: 'running' })
    try {
      const res = await seedBasicWorkflow(adminUid)
      setBasic({
        status: 'done',
        message: `Seeded v${res.newVersion} with ${res.stages} stages (was v${res.previousVersion}).`,
      })
    } catch (e) {
      setBasic({
        status: 'error',
        message: e instanceof Error ? e.message : 'Seed failed',
      })
    }
  }

  async function runMigrate() {
    if (!adminUid) return
    if (!confirm('Migrate all existing projects to the new workflow schema?')) return
    setMigrate({ status: 'running' })
    try {
      const res = await migrateClientAProjects(adminUid)
      const errSuffix = res.errors.length ? ` · ${res.errors.length} errors` : ''
      setMigrate({
        status: res.errors.length ? 'error' : 'done',
        message: `Scanned ${res.scanned} · migrated ${res.migrated} · skipped ${res.skipped}${errSuffix}.`,
      })
    } catch (e) {
      setMigrate({
        status: 'error',
        message: e instanceof Error ? e.message : 'Migration failed',
      })
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-line bg-fill-1 p-5">
      <h2 className="text-lg font-semibold text-fg">Workflows</h2>
      <p className="mt-1 text-sm text-fg-subtle">
        Seed the workflow definitions at <code>/workflows/&lt;id&gt;</code>. Idempotent —
        each run bumps the doc&apos;s version. Run once per environment after deploy.
      </p>

      <div className="mt-4 space-y-3">
        <SeedButton
          label="Seed collab-default workflow"
          hint="8-stage tender flow with eligibility review. Used when pipeline is enabled."
          row={collab}
          onRun={runCollab}
          disabled={!adminUid}
        />
        <SeedButton
          label="Seed basic workflow"
          hint="2-stage simple flow. Used when pipeline is disabled."
          row={basic}
          onRun={runBasic}
          disabled={!adminUid}
        />
        <SeedButton
          label="Migrate existing projects"
          hint="Translates legacy numeric stage / vhId / vhIterationCount onto the new schema. Idempotent — safe to re-run."
          row={migrate}
          onRun={runMigrate}
          disabled={!adminUid}
        />
      </div>
    </section>
  )
}

function SeedButton({
  label,
  hint,
  row,
  onRun,
  disabled,
}: {
  label: string
  hint: string
  row: SeedRow
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
