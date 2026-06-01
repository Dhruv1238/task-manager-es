import type { ProjectRoleDef, Stage, StageAction } from '../../../types/workflow'
import ActionCard from './ActionCard'

interface Props {
  stage: Stage
  allStages: Stage[]
  leadRoleName: string
  // Phase 2d: the workflow's project roles, surfaced as options in the action's
  // "who can do this" permission pills.
  projectRoles: ProjectRoleDef[]
  onChange: (next: Stage) => void
  disabled?: boolean
}

// Phase 2c: detail panel for editing one stage — name + display fields + the
// list of action cards. Rendered side-by-side with the horizontal stage flow.
export default function StageEditorPanel({
  stage,
  allStages,
  leadRoleName,
  projectRoles,
  onChange,
  disabled,
}: Props) {
  const inputCls =
    'w-full rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring disabled:opacity-60'

  function updateAction(idx: number, next: StageAction) {
    onChange({ ...stage, actions: stage.actions.map((a, j) => (j === idx ? next : a)) })
  }
  function deleteAction(idx: number) {
    onChange({ ...stage, actions: stage.actions.filter((_, j) => j !== idx) })
  }
  function addAction() {
    const id = `action-${Math.random().toString(36).slice(2, 7)}`
    const targetStage = allStages.find((s) => s.id !== stage.id)?.id ?? stage.id
    const blank: StageAction = {
      id,
      label: 'New action',
      actor: { kind: 'pipeline_role', role: 'lead' },
      // Phase 2d: super-admins are the always-on baseline (matches the pills'
      // locked row). Authors then add the roles who actually do the work.
      alsoAllow: [{ kind: 'global_role', role: 'super_admin' }],
      effect: { kind: 'transition', toStage: targetStage },
      inputs: [],
      intent: 'primary',
    }
    onChange({ ...stage, actions: [...stage.actions, blank] })
  }

  return (
    <div className="space-y-5 rounded-2xl border border-line bg-card p-5">
      <header>
        <h3 className="text-lg font-semibold text-fg">Editing: {stage.displayName}</h3>
        <p className="mt-1 text-xs text-fg-subtle">
          Stage {stage.order} · {stage.actions.length} action{stage.actions.length === 1 ? '' : 's'}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Name
          </label>
          <input
            type="text"
            value={stage.displayName}
            onChange={(e) => onChange({ ...stage, displayName: e.target.value })}
            className={inputCls}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Short name (optional)
          </label>
          <input
            type="text"
            value={stage.shortDisplayName ?? ''}
            onChange={(e) =>
              onChange({ ...stage, shortDisplayName: e.target.value || undefined })
            }
            placeholder={stage.displayName}
            className={inputCls}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Headline (optional) — supports {'{leadRoleName}'}
          </label>
          <input
            type="text"
            value={stage.headline ?? ''}
            onChange={(e) => onChange({ ...stage, headline: e.target.value || undefined })}
            placeholder="Awaiting allocation to a {leadRoleName}"
            className={inputCls}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Hint (optional)
          </label>
          <input
            type="text"
            value={stage.hint ?? ''}
            onChange={(e) => onChange({ ...stage, hint: e.target.value || undefined })}
            placeholder="A small line of subtext shown under the headline."
            className={inputCls}
            disabled={disabled}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-fg-muted">
        <input
          type="checkbox"
          checked={stage.isTerminal}
          onChange={(e) => onChange({ ...stage, isTerminal: e.target.checked })}
          disabled={disabled}
        />
        Mark as terminal — projects here are considered finished.
      </label>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium uppercase tracking-wider text-fg-subtle">
            Actions
          </h4>
          {!stage.isTerminal && !disabled && (
            <button
              type="button"
              onClick={addAction}
              className="text-xs font-medium text-brand-link hover:underline"
            >
              + Add action
            </button>
          )}
        </div>

        {stage.isTerminal ? (
          <p className="rounded-lg border border-dashed border-line bg-fill-2 p-3 text-sm text-fg-subtle">
            Terminal stages have no actions — projects here are considered complete.
          </p>
        ) : stage.actions.length === 0 ? (
          <p className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg p-3 text-sm text-tone-danger-fg">
            This stage has no actions. Projects entering this stage can't move forward.
            Add an action, or mark this stage as terminal.
          </p>
        ) : (
          <ul className="space-y-3">
            {stage.actions.map((a, idx) => (
              <li key={a.id}>
                <ActionCard
                  action={a}
                  stage={stage}
                  allStages={allStages}
                  leadRoleName={leadRoleName}
                  projectRoles={projectRoles}
                  onChange={(next) => updateAction(idx, next)}
                  onDelete={() => deleteAction(idx)}
                  disabled={disabled}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
