import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Layers,
  X,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  Lock,
  Flag,
  Users,
} from 'lucide-react'
import type { ActorRef, ProjectRoleDef, Stage, StageAction, Workflow } from '../../../types/workflow'
import type { EffectKind, Outcome, RoleDef } from '../../../types/v2'
import type { OrgStructure } from '../../../types/models'
import { readActors, readOutcomes } from '../../../lib/rules/outcomeAdapter'
import { actorRefKey, describeActorShort, parseActorKey } from '../../../lib/actorRefs'
import Dropdown, { type DropdownOption } from '../../ui/Dropdown'
import { CanvasInputsEditor } from './CanvasInputsEditor'
import { AssignPersonEditor } from './AssignPersonEditor'
import { ALL_SHAPES, SHAPE_PILL, SHAPE_LABEL } from './edgeTokens'

const COMING_SOON_EFFECTS: { kind: EffectKind; label: string }[] = [
  { kind: 'notify', label: 'Notify someone' },
  { kind: 'create_subtask', label: 'Create a subtask' },
  { kind: 'allocate', label: 'Auto-allocate' },
  { kind: 'spawn_project', label: 'Spawn execution project' },
  { kind: 'webhook', label: 'Call a webhook' },
]

const inputCls =
  'w-full rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

// New actions default to the project lead (always resolves for any flow) so the
// action is valid the moment it's created; the author refines "who" from there.
const DEFAULT_ACTOR: ActorRef = { kind: 'pipeline_role', role: 'lead' }

// Module-scope so the Date.now() call isn't flagged as an impure read during
// render (mirrors FlowAuthoring's freshTaskId).
function freshActionId(stageId: string): string {
  return `${stageId}-a${Date.now().toString(36)}`
}

export interface NodeInspectorProps {
  workflow: Workflow
  stageId: string | null
  roles: RoleDef[]
  org: OrgStructure
  leadRoleName?: string
  onChangeStage: (stage: Stage) => void
  onDeleteStage: (stageId: string) => void
  // Patch workflow-level fields (e.g. inline-create a project role for Assign).
  onChangeWorkflowMeta?: (patch: Partial<Workflow>) => void
  onClose: () => void
  readOnly?: boolean
}

// Editable "who can perform this action" rule. Writes to action.actors[] (the v2
// Layer-2 mapping the runtime reads via readActors). Options are the admin's
// defined roles + this workflow's project roles + two structural actors (the
// project lead, the creator). The fixed admin/super-admin entries are dropped —
// super-admin always passes implicitly.
function ActorEditor({
  actors,
  roles,
  projectRoles,
  leadRoleName,
  disabled,
  onChange,
}: {
  actors: ActorRef[]
  roles: RoleDef[]
  projectRoles: ProjectRoleDef[]
  leadRoleName?: string
  disabled?: boolean
  onChange: (next: ActorRef[]) => void
}) {
  const present = new Set(actors.map(actorRefKey))
  const unused = (opts: DropdownOption[]) => opts.filter((o) => !present.has(o.value))
  const groups = [
    {
      label: 'Roles',
      options: unused(
        [...roles]
          .sort((a, b) => a.level - b.level || a.order - b.order)
          .map((r) => ({ value: `role:${r.id}`, label: r.label })),
      ),
    },
    {
      label: 'Workflow roles',
      options: unused(
        [...projectRoles]
          .sort((a, b) => a.order - b.order)
          .map((pr) => ({ value: `project_role:${pr.id}`, label: pr.label })),
      ),
    },
    {
      label: 'Special',
      options: unused([
        { value: 'pipeline_role:lead', label: leadRoleName || 'Project lead' },
        { value: 'creator', label: 'Project creator' },
      ]),
    },
  ].filter((g) => g.options.length)

  return (
    <div className="mt-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
        <Users size={11} /> Who can do this
      </div>
      <div className="flex flex-wrap gap-1">
        {actors.map((a) => {
          const key = actorRefKey(a)
          return (
            <span
              key={key}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-fill-2 px-1.5 py-0.5 text-[10px] text-fg-muted"
            >
              {describeActorShort(a, { roles, projectRoles, leadRoleName })}
              {!disabled && actors.length > 1 && (
                <button
                  type="button"
                  title="Remove"
                  onClick={() => onChange(actors.filter((x) => actorRefKey(x) !== key))}
                  className="-mr-0.5 rounded p-0.5 text-fg-subtle transition hover:text-tone-danger-fg"
                >
                  <X size={10} />
                </button>
              )}
            </span>
          )
        })}
        {!actors.length && (
          <span className="inline-flex items-center gap-1 rounded-md border-transparent pill-danger px-1.5 py-0.5 text-[10px]">
            <AlertTriangle size={10} /> No one can do this yet
          </span>
        )}
      </div>
      {!disabled && groups.length > 0 && (
        <Dropdown
          value=""
          onChange={(v) => v && onChange([...actors, parseActorKey(v)])}
          placeholder="+ Add a role or person"
          groups={groups}
          className="w-full text-[11px]"
        />
      )}
    </div>
  )
}

export function NodeInspector({
  workflow,
  stageId,
  roles,
  org,
  leadRoleName,
  onChangeStage,
  onDeleteStage,
  onChangeWorkflowMeta,
  onClose,
  readOnly,
}: NodeInspectorProps) {
  const reduce = useReducedMotion()
  const stage = workflow.stages.find((s) => s.id === stageId) ?? null
  const projectRoles = workflow.projectRoles ?? []

  // Materialize a legacy action's outcomes on first edit so changes persist as v2.
  function patchAction(action: StageAction, patch: Partial<StageAction>) {
    if (!stage) return
    const nextActions = stage.actions.map((a) => (a.id === action.id ? { ...a, ...patch } : a))
    onChangeStage({ ...stage, actions: nextActions })
  }

  // Create a new action on this task — pre-wired with a default actor + a single
  // "advance" outcome so it's immediately editable (and the canvas shows a wire
  // handle to drag to a target).
  function addAction() {
    if (!stage) return
    const aid = freshActionId(stage.id)
    const action: StageAction = {
      id: aid,
      label: 'New action',
      actor: DEFAULT_ACTOR,
      actors: [DEFAULT_ACTOR],
      effect: { kind: 'transition', toStage: '' },
      inputs: [],
      intent: 'primary',
      outcomes: [{ id: `${aid}:o1`, label: 'Continue', shape: 'advance' }],
    }
    onChangeStage({ ...stage, actions: [...stage.actions, action] })
  }

  function removeAction(actionId: string) {
    if (!stage) return
    onChangeStage({ ...stage, actions: stage.actions.filter((a) => a.id !== actionId) })
  }

  // Inline-create a workflow project role (the Assign control's "+ New role").
  // Returns the new id so the caller can target it immediately; rename later in
  // the Workflow-settings drawer.
  function createProjectRole(label: string): string | undefined {
    if (!onChangeWorkflowMeta) return undefined
    const existing = workflow.projectRoles ?? []
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'role'
    const ids = new Set(existing.map((r) => r.id))
    let id = base
    let n = 1
    while (ids.has(id)) id = `${base}_${n++}`
    const order = Math.max(0, ...existing.map((r) => r.order)) + 1
    onChangeWorkflowMeta({
      projectRoles: [...existing, { id, label, multiple: false, required: false, order }],
    })
    return id
  }

  function setOutcome(action: StageAction, outcomeId: string, patch: Partial<Outcome>) {
    const current = readOutcomes(action)
    const next = current.map((o) => (o.id === outcomeId ? { ...o, ...patch } : o))
    patchAction(action, { outcomes: next })
  }

  function addOutcome(action: StageAction) {
    const current = readOutcomes(action)
    const next: Outcome = {
      id: `${action.id}:o${current.length + 1}-${current.length}`,
      label: 'New outcome',
      shape: 'advance',
    }
    patchAction(action, { outcomes: [...current, next] })
  }

  function removeOutcome(action: StageAction, outcomeId: string) {
    const next = readOutcomes(action).filter((o) => o.id !== outcomeId)
    patchAction(action, { outcomes: next })
  }

  // Outcome targets = every task, INCLUDING this one. Self-loops are valid
  // (a "request changes" / "send back" outcome routes a task to itself); the
  // engine supports it, the old UI just hid it.
  const targetStages = stage ? workflow.stages : []
  const statusOptions = workflow.statusOptions ?? []

  return (
    <AnimatePresence>
      {stage && (
        <motion.aside
          key={stage.id}
          initial={reduce ? false : { x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { x: '100%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          className="nopan nodrag scrollbar-themed node-glass absolute right-0 top-0 z-20 flex h-full w-[26rem] max-w-[90vw] flex-col overflow-y-auto overflow-x-hidden border-l border-line shadow-2xl"
        >
          {/* Ambient orbs */}
          <div className="pointer-events-none absolute -right-20 -top-20 h-44 w-44 rounded-full bg-orb-a blur-3xl" />

          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-[var(--color-node-header)] px-4 py-3 backdrop-blur">
            <Layers size={15} className="text-brand" />
            <input
              value={stage.displayName}
              disabled={readOnly}
              onChange={(e) => onChangeStage({ ...stage, displayName: e.target.value })}
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-fg outline-none"
              placeholder="Task name"
            />
            {stage.isTerminal ? (
              <span className="inline-flex items-center gap-1 text-xs text-fg-subtle">
                <Flag size={12} /> Terminal
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-tone-success-fg">
                <CheckCircle2 size={12} /> Editable
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 rounded-md p-1 text-fg-subtle transition hover:bg-fill-2 hover:text-fg-strong"
            >
              <X size={16} />
            </button>
          </div>

          <div className="relative space-y-5 p-4">
            {/* Stage meta */}
            <section className="space-y-2">
              <label className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
                Description
              </label>
              <textarea
                value={stage.description ?? ''}
                disabled={readOnly}
                onChange={(e) => onChangeStage({ ...stage, description: e.target.value })}
                rows={2}
                placeholder="What happens at this task?"
                className={inputCls}
              />
              <label className="flex items-center gap-2 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  checked={stage.isTerminal}
                  disabled={readOnly}
                  onChange={(e) => onChangeStage({ ...stage, isTerminal: e.target.checked })}
                  className="accent-[var(--color-brand)]"
                />
                This is a terminal task (no actions)
              </label>
            </section>

            {/* Actions */}
            {!stage.isTerminal && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
                    Actions &amp; rules
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={addAction}
                      className="inline-flex items-center gap-1 rounded-md border border-line bg-fill-2 px-2 py-1 text-[11px] font-medium text-fg-muted transition hover:border-brand-edge hover:text-fg"
                    >
                      <Plus size={12} /> Add action
                    </button>
                  )}
                </div>

                {stage.actions.length === 0 && (
                  <button
                    type="button"
                    onClick={addAction}
                    disabled={readOnly}
                    className="w-full rounded-lg border border-dashed border-line bg-fill-1 px-3 py-5 text-center text-xs text-fg-subtle transition hover:border-brand-edge hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    No actions yet — <span className="font-medium text-brand">add one</span> to let
                    someone move work forward from here.
                  </button>
                )}

                {stage.actions.map((action) => {
                  const actors = readActors(action).all
                  const outcomes = readOutcomes(action)
                  const assignCfg = outcomes.find((o) => o.assign)?.assign
                  const lockedInputIds = assignCfg ? [assignCfg.fromInputId] : []
                  return (
                    <div key={action.id} className="rounded-xl border border-line bg-fill-1 p-3">
                      <div className="flex items-center gap-2">
                        <input
                          value={action.label}
                          disabled={readOnly}
                          onChange={(e) => patchAction(action, { label: e.target.value })}
                          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-fg outline-none"
                          placeholder="Action label (e.g. Approve)"
                        />
                        {!readOnly && (
                          <button
                            type="button"
                            title="Delete action"
                            onClick={() => removeAction(action.id)}
                            className="shrink-0 rounded p-1 text-fg-subtle transition hover:text-tone-danger-fg"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>

                      {/* Attributes — data collected when someone does this */}
                      <CanvasInputsEditor
                        inputs={action.inputs}
                        roles={roles}
                        projectRoles={projectRoles}
                        org={org}
                        lockedInputIds={lockedInputIds}
                        disabled={readOnly}
                        onChange={(next) => patchAction(action, { inputs: next })}
                      />

                      {/* Who can perform it (Layer-2 rule) — editable */}
                      <ActorEditor
                        actors={actors}
                        roles={roles}
                        projectRoles={projectRoles}
                        leadRoleName={leadRoleName}
                        disabled={readOnly}
                        onChange={(next) => patchAction(action, { actors: next })}
                      />

                      {/* Outcomes */}
                      <div className="mt-3 space-y-2">
                        <div className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
                          What happens
                        </div>
                        {outcomes.map((o) => (
                          <div key={o.id} className="rounded-lg border border-line bg-fill-2 p-2">
                            <div className="flex items-center gap-2">
                              <input
                                value={o.label}
                                disabled={readOnly}
                                onChange={(e) => setOutcome(action, o.id, { label: e.target.value })}
                                className="min-w-0 flex-1 bg-transparent text-xs font-medium text-fg outline-none"
                              />
                              {!readOnly && outcomes.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeOutcome(action, o.id)}
                                  className="rounded p-0.5 text-fg-subtle transition hover:text-tone-danger-fg"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                            {/* Shape segmented control */}
                            <div className="mt-1.5 flex gap-1">
                              {ALL_SHAPES.map((sh) => (
                                <button
                                  key={sh}
                                  type="button"
                                  disabled={readOnly}
                                  onClick={() => setOutcome(action, o.id, { shape: sh })}
                                  className={`flex-1 rounded border px-1 py-0.5 text-[10px] font-medium transition ${
                                    o.shape === sh
                                      ? `${SHAPE_PILL[sh]} border-transparent`
                                      : 'border-line text-fg-subtle hover:text-fg'
                                  }`}
                                >
                                  {SHAPE_LABEL[sh]}
                                </button>
                              ))}
                            </div>
                            {/* Target */}
                            {(o.shape === 'advance' || o.shape === 'branch') && (
                              <div className="mt-1.5">
                                <Dropdown
                                  value={o.toStageId ?? ''}
                                  disabled={readOnly}
                                  onChange={(v) =>
                                    setOutcome(action, o.id, { toStageId: v || undefined })
                                  }
                                  placeholder="→ pick a target task…"
                                  options={targetStages.map((s) => ({
                                    value: s.id,
                                    label:
                                      s.id === stage?.id
                                        ? `${s.displayName} (loops back here)`
                                        : s.displayName,
                                  }))}
                                  className="w-full text-[11px]"
                                />
                              </div>
                            )}
                            {o.shape === 'close' && (
                              <div className="mt-1.5">
                                <Dropdown
                                  value={o.terminalStatusId ?? ''}
                                  disabled={readOnly}
                                  onChange={(v) =>
                                    setOutcome(action, o.id, { terminalStatusId: v || undefined })
                                  }
                                  placeholder="closing status…"
                                  options={statusOptions.map((s) => ({
                                    value: s.id,
                                    label: s.label,
                                  }))}
                                  className="w-full text-[11px]"
                                />
                              </div>
                            )}
                          </div>
                        ))}
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => addOutcome(action)}
                            className="flex items-center gap-1 text-[11px] text-brand transition hover:opacity-80"
                          >
                            <Plus size={12} /> Add outcome
                          </button>
                        )}
                      </div>

                      {/* First-class "assign a person" */}
                      <AssignPersonEditor
                        action={action}
                        workflow={workflow}
                        roles={roles}
                        leadRoleName={leadRoleName}
                        disabled={readOnly}
                        onChangeAction={(patch) => patchAction(action, patch)}
                        onCreateProjectRole={onChangeWorkflowMeta ? createProjectRole : undefined}
                      />

                      {/* Coming-soon effects */}
                      <div className="mt-3 border-t border-line-subtle pt-2">
                        <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-faint">
                          Effects
                        </div>
                        <div className="space-y-1 opacity-60">
                          {COMING_SOON_EFFECTS.slice(0, 3).map((e) => (
                            <div
                              key={e.kind}
                              className="flex items-center gap-1.5 text-[11px] text-fg-subtle"
                              title="Coming soon"
                            >
                              <Lock size={10} /> {e.label}
                              <span className="ml-auto rounded bg-fill-2 px-1 text-[9px]">soon</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </section>
            )}

            {!readOnly && (
              <div className="border-t border-line-subtle pt-4">
                <button
                  type="button"
                  onClick={() => onDeleteStage(stage.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-sm font-medium text-tone-danger-fg transition hover:opacity-90"
                >
                  <Trash2 size={14} /> Delete task
                </button>
                <p className="mt-1.5 text-[11px] text-fg-faint">
                  Or select a task / connection on the canvas and press Delete.
                </p>
              </div>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
