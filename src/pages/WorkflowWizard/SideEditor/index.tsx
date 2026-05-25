import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useAppConfigContext, useOrgStructure } from '../../../contexts/AppConfigContext'
import type { Stage } from '../../../types/workflow'
import {
  saveWorkflowAndMaybeActivate,
  type WorkflowDraft,
} from '../../../lib/workflowAuthoring'
import {
  validateWorkflow,
  type ValidationIssue,
  type ValidationResult,
} from '../../../lib/workflowValidation'
import StageFlow from './StageFlow'
import StageEditorPanel from './StageEditorPanel'
import ValidationPanel from './ValidationPanel'
import WorkflowSettingsDrawer from './WorkflowSettingsDrawer'

interface Props {
  initialDraft: WorkflowDraft
  // When editing an existing workflow, this is the doc id. Create-mode passes
  // undefined so the save helper derives an id from displayName.
  workflowId?: string
  // System-defined workflows are read-only; the host page surfaces a Duplicate
  // button instead.
  readOnly?: boolean
  // Onboarding mode (the wizard's tail end) rewrites the primary button to
  // "Finish setup" and the helper text below it.
  mode?: 'standalone' | 'create' | 'onboarding'
  // Callback fired with the saved workflow id after a successful save. The
  // host page can navigate away or show a toast. May return a Promise — the
  // editor awaits it so post-save state refreshes complete before unmounting.
  onSaved?: (workflowId: string) => void | Promise<void>
}

// Phase 2c: the authoritative editing surface. Used by the workflow wizard's
// tail end and by the standalone editor at /admin/workflows/:id/edit.
export default function SideEditor({
  initialDraft,
  workflowId,
  readOnly = false,
  mode = 'standalone',
  onSaved,
}: Props) {
  const { user } = useAuth()
  const org = useOrgStructure()
  const { setWorkflowOptimistic, setRegistryOptimistic } = useAppConfigContext()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<WorkflowDraft>(initialDraft)
  const [selectedStageId, setSelectedStageId] = useState<string | null>(
    initialDraft.stages[0]?.id ?? null,
  )
  const [showSettings, setShowSettings] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validation, setValidation] = useState<ValidationResult>({
    errors: [],
    warnings: [],
  })

  // Debounced re-validation. Phase 2c spec calls for 500ms after the last edit;
  // the timer also fires on initial mount so the panel shows its truthful state.
  useEffect(() => {
    const timer = setTimeout(() => {
      const stub = { ...draft, id: workflowId ?? '', version: 0, updatedAt: new Date() as never, updatedBy: '' }
      // Type-cast through unknown — the validator only reads structural fields.
      setValidation(
        validateWorkflow(stub as unknown as import('../../../types/workflow').Workflow, org),
      )
    }, 500)
    return () => clearTimeout(timer)
  }, [draft, org, workflowId])

  const selectedStage = useMemo(
    () => draft.stages.find((s) => s.id === selectedStageId) ?? null,
    [draft.stages, selectedStageId],
  )

  const issuesByStage = useMemo<Record<string, 'error' | 'warning' | 'ok'>>(() => {
    const out: Record<string, 'error' | 'warning' | 'ok'> = {}
    for (const stage of draft.stages) out[stage.id] = 'ok'
    for (const issue of validation.errors) {
      if (issue.scope.kind === 'stage' || issue.scope.kind === 'action' || issue.scope.kind === 'input') {
        out[issue.scope.stageId] = 'error'
      }
    }
    for (const issue of validation.warnings) {
      if (
        (issue.scope.kind === 'stage' || issue.scope.kind === 'action' || issue.scope.kind === 'input') &&
        out[issue.scope.stageId] !== 'error'
      ) {
        out[issue.scope.stageId] = 'warning'
      }
    }
    return out
  }, [draft.stages, validation])

  function updateStage(stageId: string, next: Stage) {
    setDraft({
      ...draft,
      stages: draft.stages.map((s) => (s.id === stageId ? next : s)),
    })
  }

  function addStageAfter(afterStageId: string | null) {
    const sorted = [...draft.stages].sort((a, b) => a.order - b.order)
    const insertIdx =
      afterStageId === null
        ? 0
        : sorted.findIndex((s) => s.id === afterStageId) + 1
    const newId = `stage-${Math.random().toString(36).slice(2, 7)}`
    const blank: Stage = {
      id: newId,
      displayName: 'New stage',
      order: insertIdx + 1,
      isTerminal: false,
      actions: [],
    }
    const before = sorted.slice(0, insertIdx)
    const after = sorted.slice(insertIdx)
    const renumbered = [...before, blank, ...after].map((s, i) => ({ ...s, order: i + 1 }))
    setDraft({ ...draft, stages: renumbered })
    setSelectedStageId(newId)
  }

  function removeStage(stageId: string) {
    const next = draft.stages
      .filter((s) => s.id !== stageId)
      .sort((a, b) => a.order - b.order)
      .map((s, i) => ({ ...s, order: i + 1 }))
    setDraft({ ...draft, stages: next })
    if (selectedStageId === stageId) {
      setSelectedStageId(next[0]?.id ?? null)
    }
  }

  function reorderStage(stageId: string, direction: 'left' | 'right') {
    const sorted = [...draft.stages].sort((a, b) => a.order - b.order)
    const idx = sorted.findIndex((s) => s.id === stageId)
    if (idx < 0) return
    const swapIdx = direction === 'left' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sorted.length) return
    const next = [...sorted]
    ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    setDraft({ ...draft, stages: next.map((s, i) => ({ ...s, order: i + 1 })) })
  }

  function handleJump(issue: ValidationIssue) {
    if (
      issue.scope.kind === 'stage' ||
      issue.scope.kind === 'action' ||
      issue.scope.kind === 'input'
    ) {
      setSelectedStageId(issue.scope.stageId)
    }
  }

  async function handleSave(activate: boolean) {
    if (!user) return
    const result = validateWorkflow(
      { ...draft, id: workflowId ?? '', version: 0, updatedAt: new Date() as never, updatedBy: '' } as unknown as import('../../../types/workflow').Workflow,
      org,
    )
    if (result.errors.length > 0) {
      setValidation(result)
      setError('Fix the errors below before saving.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await saveWorkflowAndMaybeActivate({
        draft,
        adminUid: user.uid,
        activate,
        workflowId,
      })
      // Push the just-saved doc + (when activating) the new registry into
      // local context + localStorage so the next render sees the new state
      // immediately. Without this, the destination page (Home redirect logic
      // or /admin/config's WorkflowsSection) reads stale cache and either
      // loops back into the wizard or shows the new workflow as inactive.
      setWorkflowOptimistic(res.workflow)
      if (res.registry) {
        setRegistryOptimistic(res.registry)
      }
      if (onSaved) await onSaved(res.workflowId)
      else navigate(`/admin/config?workflow=${res.workflowId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save the workflow.')
    } finally {
      setSaving(false)
    }
  }

  const primaryLabel =
    mode === 'onboarding' ? 'Finish setup' : 'Save & Activate'

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-fg">{draft.displayName || 'Untitled Workflow'}</h2>
          <p className="mt-1 text-sm text-fg-subtle">
            {flowTypeLabel(draft.flowType)} · {draft.stages.length} stage
            {draft.stages.length === 1 ? '' : 's'}
            {readOnly && ' · system template (read-only)'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettings((p) => !p)}
            className="rounded-lg border border-line bg-fill-2 px-3 py-1.5 text-sm font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg"
          >
            ⚙ Settings
          </button>
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => handleSave(false)}
                disabled={saving}
                className="rounded-lg border border-line bg-fill-2 px-3 py-1.5 text-sm font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg disabled:opacity-60"
              >
                Save as draft
              </button>
              <button
                type="button"
                onClick={() => handleSave(true)}
                disabled={saving}
                className="rounded-lg bg-brand-gradient px-3 py-1.5 text-sm font-medium text-white shadow hover-brand-gradient disabled:opacity-60"
              >
                {saving ? 'Saving…' : primaryLabel}
              </button>
            </>
          )}
        </div>
      </header>

      {showSettings && (
        <WorkflowSettingsDrawer
          draft={draft}
          hasStages={draft.stages.length > 0}
          onChange={(patch) => setDraft({ ...draft, ...patch })}
          disabled={readOnly}
        />
      )}

      <StageFlow
        stages={draft.stages}
        selectedStageId={selectedStageId}
        onSelect={setSelectedStageId}
        onAddAfter={addStageAfter}
        onRemove={removeStage}
        onReorder={reorderStage}
        issuesByStage={issuesByStage}
        disabled={readOnly}
      />

      {selectedStage && (
        <StageEditorPanel
          stage={selectedStage}
          allStages={draft.stages}
          leadRoleName={draft.leadRoleName || org.leadRoleName}
          onChange={(next) => updateStage(selectedStage.id, next)}
          disabled={readOnly}
        />
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg"
        >
          {error}
        </div>
      )}

      <ValidationPanel result={validation} onJump={handleJump} />
    </div>
  )
}

function flowTypeLabel(flowType: import('../../../types/workflow').FlowType): string {
  switch (flowType) {
    case 'collaborative':
      return 'Multi-team collaborative'
    case 'individual':
      return 'Individual pipeline'
    case 'basic':
      return 'Owner-driven'
  }
}
