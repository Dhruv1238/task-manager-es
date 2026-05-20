import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useWorkflow } from '../contexts/AppConfigContext'
import { duplicateSystemWorkflow } from '../lib/workflowAuthoring'
import type { WorkflowDraft } from '../lib/workflowAuthoring'
import SideEditor from './WorkflowWizard/SideEditor'

// Phase 2c: standalone workflow editor. Loaded from /admin/workflows/:id/edit,
// reached via the pencil icon in /admin/config or by direct URL. System
// workflows open read-only with a Duplicate button; tenant-authored
// workflows are fully editable.
export default function WorkflowEdit() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const workflow = useWorkflow(id)
  const [duplicating, setDuplicating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!id) {
    return <NotFoundShell />
  }
  if (!workflow) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-fg-subtle">
        Loading workflow…
      </div>
    )
  }

  const isSystem = workflow.isSystemDefined === true

  async function handleDuplicate() {
    if (!user || !workflow) return
    setDuplicating(true)
    setError(null)
    try {
      const res = await duplicateSystemWorkflow(workflow, user.uid)
      navigate(`/admin/workflows/${res.workflowId}/edit`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to duplicate workflow.')
    } finally {
      setDuplicating(false)
    }
  }

  const draft: WorkflowDraft = {
    id: workflow.id,
    displayName: workflow.displayName,
    flowType: workflow.flowType,
    leadRoleName: workflow.leadRoleName ?? '',
    isSystemDefined: workflow.isSystemDefined,
    description: workflow.description,
    creationModalCardSubtitle: workflow.creationModalCardSubtitle,
    creationModalDescription: workflow.creationModalDescription,
    recommendedLeads: workflow.recommendedLeads ?? [],
    stages: workflow.stages.map((s) => ({ ...s, actions: s.actions.map((a) => ({ ...a })) })),
  }

  return (
    <>
      <div className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6 lg:px-8">
        <Link
          to="/admin/config"
          className="inline-flex items-center gap-1 text-sm text-fg-subtle transition hover:text-fg-muted"
        >
          ← Back to /admin/config
        </Link>

        {isSystem && (
          <div className="mt-4 rounded-2xl border border-tone-warn-bd bg-tone-warn-bg/30 px-4 py-3 text-sm text-fg-muted">
            <p>
              <strong className="text-fg-strong">System template.</strong> The stages and
              actions are read-only. Use <em>Duplicate</em> to make an editable copy.
            </p>
            <div className="mt-2">
              <button
                type="button"
                onClick={handleDuplicate}
                disabled={duplicating}
                className="rounded-lg bg-brand-gradient px-3 py-1.5 text-sm font-medium text-white shadow hover-brand-gradient disabled:opacity-60"
              >
                {duplicating ? 'Duplicating…' : 'Duplicate workflow'}
              </button>
            </div>
            {error && (
              <p className="mt-2 text-xs text-tone-danger-fg" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </div>

      <SideEditor
        initialDraft={draft}
        workflowId={workflow.id}
        readOnly={isSystem}
        mode="standalone"
        onSaved={(savedId) => navigate(`/admin/config?workflow=${savedId}`)}
      />
    </>
  )
}

function NotFoundShell() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-fg">Workflow not found</h1>
      <p className="mt-2 text-fg-subtle">The url is missing a workflow id.</p>
      <Link
        to="/admin/config"
        className="mt-6 inline-block rounded-lg border border-line bg-fill-2 px-4 py-2 text-sm text-fg-muted transition hover:bg-fill-4"
      >
        Back to /admin/config
      </Link>
    </div>
  )
}
