import { useEffect, useMemo, useState } from 'react'
import { doc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'
import {
  DEFAULT_APP_CONFIG,
  useAppConfigContext,
  useAppConfigLive,
} from '../contexts/AppConfigContext'
import { STAGE_NAMES, type AppConfig, type Stage } from '../types/models'

const ALL_STAGES: Stage[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
// Stage 1 (Project creation) and Stage 10 (Sent to client) are the pipeline's
// required start and end points. Toggling them off would leave projects with no
// entry/exit — disallowed in UI rather than enforced server-side.
const LOCKED_STAGES: Stage[] = [1, 10]

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
  const aStages = [...a.pipeline.enabledStages].sort((x, y) => x - y).join(',')
  const bStages = [...b.pipeline.enabledStages].sort((x, y) => x - y).join(',')
  return aStages === bStages
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
  }, [baseline.version, baseline.pipeline.enabled, baseline.features.chat, baseline.pipeline.enabledStages.join(',')])

  const dirty = useMemo(() => !configsEqual(draft, baseline), [draft, baseline])

  function toggleStage(stage: Stage) {
    if (LOCKED_STAGES.includes(stage)) return
    setDraft((d) => {
      const has = d.pipeline.enabledStages.includes(stage)
      const next = has
        ? d.pipeline.enabledStages.filter((s) => s !== stage)
        : [...d.pipeline.enabledStages, stage].sort((a, b) => a - b)
      return { ...d, pipeline: { ...d.pipeline, enabledStages: next } }
    })
  }

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

  const stageRows = ALL_STAGES.map((stage) => {
    const checked = draft.pipeline.enabledStages.includes(stage)
    const locked = LOCKED_STAGES.includes(stage)
    return (
      <li
        key={stage}
        className={`flex items-center justify-between rounded-lg border border-line bg-card px-3 py-2 ${
          !draft.pipeline.enabled ? 'opacity-50' : ''
        }`}
      >
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={checked}
            disabled={locked || !draft.pipeline.enabled}
            onChange={() => toggleStage(stage)}
            className="h-4 w-4 cursor-pointer accent-brand-edge disabled:cursor-not-allowed"
            aria-label={`Stage ${stage} ${STAGE_NAMES[stage]}`}
          />
          <span className="text-sm text-fg">
            <span className="text-fg-subtle">Stage {stage}</span>
            <span className="mx-2 text-fg-faint">·</span>
            <span>{STAGE_NAMES[stage]}</span>
          </span>
        </div>
        {locked && (
          <span
            className="text-[10px] uppercase tracking-wider text-fg-subtle"
            title="Required pipeline start/end — cannot be disabled."
          >
            Required
          </span>
        )}
      </li>
    )
  })

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

      <section className="mb-6 rounded-2xl border border-line bg-fill-1 p-5">
        <h2 className="text-lg font-semibold text-fg">Project pipeline</h2>
        <p className="mt-1 text-sm text-fg-subtle">
          When enabled, projects flow through 10 tender stages (allocation, eligibility, review,
          delivery). When disabled, projects use a simple status flow (in progress → completed)
          with an owner only — no VH, no stages.
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
                ? 'Stages, VH allocation, and "+ New Tender" CTA are active.'
                : 'Projects use simple status flow — no VH, no stages, "+ New Project" CTA.'
            }
          />

          <div>
            <div className="mb-2 mt-4 flex items-center justify-between">
              <h3 className="text-sm font-medium text-fg-strong">Enabled stages</h3>
              <span className="text-xs text-fg-subtle">
                {draft.pipeline.enabledStages.length} of {ALL_STAGES.length} enabled
              </span>
            </div>
            <p className="mb-3 text-xs text-fg-subtle">
              Disabling a stage hides its banner and action buttons. Projects already in that
              stage retain the value — advance them manually.
            </p>
            <ul className="space-y-1.5">{stageRows}</ul>
          </div>
        </div>
      </section>

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
