import type { Stage } from '../../../types/workflow'

interface Props {
  stages: Stage[]
  selectedStageId: string | null
  onSelect: (id: string) => void
  onAddAfter: (afterStageId: string | null) => void
  onRemove: (id: string) => void
  onReorder: (id: string, direction: 'left' | 'right') => void
  // Map of stage id → issue severity for visual indicators in the flow.
  issuesByStage?: Record<string, 'error' | 'warning' | 'ok'>
  disabled?: boolean
}

// Phase 2c: horizontal scrollable stage flow. Each card is a clickable lane
// that selects its stage in the editor panel. Insert-between buttons sit in
// the gaps and add a blank stage at that position. Reorder is left/right
// nudge (no drag-and-drop dep introduced for the MVP).
export default function StageFlow({
  stages,
  selectedStageId,
  onSelect,
  onAddAfter,
  onRemove,
  onReorder,
  issuesByStage = {},
  disabled,
}: Props) {
  const sorted = [...stages].sort((a, b) => a.order - b.order)

  return (
    <div className="overflow-x-auto">
      <div className="flex items-center gap-2 py-2">
        {!disabled && (
          <InsertButton onClick={() => onAddAfter(null)} ariaLabel="Add stage at start" />
        )}
        {sorted.map((stage, idx) => {
          const isSelected = selectedStageId === stage.id
          const issue = issuesByStage[stage.id] ?? 'ok'
          const canDelete = !disabled && sorted.length > 1
          return (
            <div key={stage.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSelect(stage.id)}
                className={`min-w-[10rem] rounded-xl border px-3 py-3 text-left transition ${
                  isSelected
                    ? 'border-brand-edge bg-brand-soft ring-2 ring-brand-ring'
                    : issue === 'error'
                      ? 'border-tone-danger-bd bg-tone-danger-bg/40 hover:bg-tone-danger-bg/60'
                      : issue === 'warning'
                        ? 'border-tone-warn-bd bg-tone-warn-bg/40 hover:bg-tone-warn-bg/60'
                        : 'border-line bg-fill-1 hover:bg-fill-2'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
                    Stage {stage.order}
                  </span>
                  {stage.isTerminal && (
                    <span className="rounded-full bg-fill-3 px-2 py-0.5 text-[10px] uppercase tracking-wider text-fg-subtle">
                      Final
                    </span>
                  )}
                </div>
                <div className="mt-1 truncate text-sm font-semibold text-fg">
                  {stage.displayName || '(unnamed)'}
                </div>
                <div className="mt-1 text-[11px] text-fg-subtle">
                  {stage.isTerminal
                    ? 'No actions'
                    : `${stage.actions.length} action${stage.actions.length === 1 ? '' : 's'}`}
                </div>
                {!disabled && (
                  <div className="mt-2 flex gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onReorder(stage.id, 'left')
                      }}
                      disabled={idx === 0}
                      aria-label="Move left"
                      className="rounded-md border border-line bg-fill-2 px-1.5 py-0.5 text-[10px] text-fg-muted hover:bg-fill-4 disabled:opacity-40"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onReorder(stage.id, 'right')
                      }}
                      disabled={idx === sorted.length - 1}
                      aria-label="Move right"
                      className="rounded-md border border-line bg-fill-2 px-1.5 py-0.5 text-[10px] text-fg-muted hover:bg-fill-4 disabled:opacity-40"
                    >
                      →
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemove(stage.id)
                        }}
                        aria-label="Remove stage"
                        className="rounded-md px-1.5 py-0.5 text-[10px] text-tone-danger-fg hover:bg-tone-danger-bg"
                      >
                        ×
                      </button>
                    )}
                  </div>
                )}
              </button>
              {!disabled && (
                <InsertButton
                  onClick={() => onAddAfter(stage.id)}
                  ariaLabel={`Add stage after ${stage.displayName}`}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function InsertButton({ onClick, ariaLabel }: { onClick: () => void; ariaLabel: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="h-7 w-7 shrink-0 rounded-full border border-dashed border-line bg-fill-2 text-sm text-fg-subtle transition hover:border-line-strong hover:bg-fill-4 hover:text-fg"
    >
      +
    </button>
  )
}
