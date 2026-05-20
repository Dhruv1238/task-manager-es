import type { FlowType, Workflow } from '../../types/workflow'

interface Props {
  workflows: Workflow[]
  pickedId: string | null
  onPick: (id: string) => void
}

// Card-based picker shown as Step 0 of the new-project modal when more than
// one workflow is active. Skipped when only one workflow is active (the form
// auto-pins and the picker isn't rendered). Card visual: title + flowType
// subtitle + stage count for quick scanability.

const FLOW_LABEL: Record<FlowType, string> = {
  collaborative: 'Multi-team collaborative flow',
  individual: 'Individual ownership flow',
  basic: 'Simple status flow',
}

export default function WorkflowPicker({ workflows, pickedId, onPick }: Props) {
  if (workflows.length === 0) {
    return (
      <div className="rounded-lg border border-tone-warn-bd bg-tone-warn-bg px-4 py-3 text-sm text-tone-warn-fg">
        No workflows are active. Ask an admin to activate at least one under
        /admin/config → Workflows.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-fg-muted">Workflow</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {workflows.map((wf) => {
          const active = wf.id === pickedId
          const liveStages = wf.stages.filter((s) => !s.isTerminal).length
          return (
            <button
              key={wf.id}
              type="button"
              onClick={() => onPick(wf.id)}
              className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition ${
                active
                  ? 'border-brand-edge bg-brand-soft ring-2 ring-brand-ring'
                  : 'border-line bg-fill-1 hover:border-line-strong hover:bg-fill-2'
              }`}
            >
              <span className="text-sm font-medium text-fg-strong">{wf.displayName}</span>
              <span className="text-xs text-fg-subtle">{FLOW_LABEL[wf.flowType]}</span>
              <span className="text-[11px] text-fg-faint">
                {liveStages} stage{liveStages === 1 ? '' : 's'}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
