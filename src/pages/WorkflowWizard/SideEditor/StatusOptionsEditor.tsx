import Dropdown, { type DropdownOption } from '../../../components/ui/Dropdown'
import ActionActorsPopover from './ActionActorsPopover'
import { reorder } from '../../../lib/reorder'
import { nextLocalId } from '../../../lib/localId'
import { PILL_COLORS, dotClassFor } from '../../../lib/fieldTokens'
import { defaultStatusOptions } from '../../../lib/projectStatus'
import type {
  ActorRef,
  PillColor,
  ProjectRoleDef,
  WorkflowStatusOption,
} from '../../../types/workflow'

interface Props {
  statusOptions: WorkflowStatusOption[]
  canUpdateStatusActors: ActorRef[]
  projectRoles: ProjectRoleDef[]
  leadRoleName: string
  onChangeStatuses: (next: WorkflowStatusOption[]) => void
  onChangeActors: (next: ActorRef[]) => void
  // Wizard mode hides the "who can change the status" picker — it's configured
  // later in the editor (roles may not exist yet during first-time setup).
  hideActorPicker?: boolean
  disabled?: boolean
}

const inputCls =
  'w-full rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring disabled:opacity-60'

const colorOptions: DropdownOption[] = PILL_COLORS.map((c) => ({
  value: c,
  label: c.charAt(0).toUpperCase() + c.slice(1),
  leading: <span className={`inline-block h-3 w-3 rounded-full ${dotClassFor(c)}`} aria-hidden />,
}))

// Phase 2d: author-configurable statuses + who can change them. Status ids are
// frozen at creation. Seeds pre-fill from the canonical STATUS_DISPLAY set.
export default function StatusOptionsEditor({
  statusOptions,
  canUpdateStatusActors,
  projectRoles,
  leadRoleName,
  onChangeStatuses,
  onChangeActors,
  hideActorPicker,
  disabled,
}: Props) {
  const sorted = [...statusOptions].sort((a, b) => a.order - b.order)

  const update = (id: string, patch: Partial<WorkflowStatusOption>) =>
    onChangeStatuses(sorted.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  function add() {
    onChangeStatuses([
      ...sorted,
      {
        id: nextLocalId('status', sorted),
        label: '',
        color: PILL_COLORS[sorted.length % PILL_COLORS.length],
        order: sorted.length,
      },
    ])
  }
  const remove = (id: string) =>
    onChangeStatuses(sorted.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i })))
  const move = (idx: number, dir: -1 | 1) => onChangeStatuses(reorder(sorted, idx, dir))
  const seedDefaults = () => onChangeStatuses(defaultStatusOptions())

  const btn = 'rounded-md border border-line bg-fill-2 px-1.5 py-0.5 text-[10px] text-fg-muted transition hover:bg-fill-3 disabled:opacity-30'

  return (
    <div className="rounded-2xl border border-line bg-card p-5">
      <h3 className="text-base font-semibold text-fg">Statuses</h3>
      <p className="mt-1 text-sm text-fg-subtle">
        The outcomes a project can be set to. These appear on the status pill and the status
        menu.
      </p>
      <div className="mt-4 space-y-2">
        {sorted.length === 0 && (
          <div className="rounded-lg border border-dashed border-line bg-fill-2 px-3 py-4 text-center text-sm text-fg-faint">
            No statuses yet.{' '}
            {!disabled && (
              <button type="button" onClick={seedDefaults} className="text-brand hover:underline">
                Use the standard set
              </button>
            )}
          </div>
        )}
        {sorted.map((s, idx) => (
          <div key={s.id} className="flex items-center gap-2 rounded-xl border border-line bg-fill-1 p-2.5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClassFor(s.color)}`} aria-hidden />
            <input
              value={s.label}
              disabled={disabled}
              onChange={(e) => update(s.id, { label: e.target.value })}
              placeholder="Status name (e.g. In progress)"
              className={`${inputCls} flex-1`}
            />
            <Dropdown
              value={s.color}
              onChange={(v) => update(s.id, { color: v as PillColor })}
              options={colorOptions}
              disabled={disabled}
              className="w-28"
            />
            <label className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-fg-muted" title="Marks the project as closed/locked">
              <input
                type="checkbox"
                checked={Boolean(s.closing)}
                disabled={disabled}
                onChange={(e) => update(s.id, { closing: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-line-strong accent-brand"
              />
              closes
            </label>
            <div className="flex shrink-0 flex-col gap-0.5">
              <button type="button" className={btn} disabled={disabled || idx === 0} onClick={() => move(idx, -1)} aria-label="Move up">▲</button>
              <button type="button" className={btn} disabled={disabled || idx === sorted.length - 1} onClick={() => move(idx, 1)} aria-label="Move down">▼</button>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => remove(s.id)}
              className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-tone-danger-fg transition hover:bg-tone-danger-bg disabled:opacity-40"
              aria-label="Remove status"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      {!disabled && sorted.length > 0 && (
        <button type="button" onClick={add} className="mt-3 text-sm font-medium text-brand transition hover:underline">
          + Add a status
        </button>
      )}

      {!hideActorPicker && (
        <div className="mt-5 border-t border-line-subtle pt-4">
          <p className="text-sm font-medium text-fg-muted">Who can change the status?</p>
          <p className="mb-2 mt-0.5 text-xs text-fg-subtle">
            The creator and global admins always can.
          </p>
          <ActionActorsPopover
            value={canUpdateStatusActors}
            onChange={onChangeActors}
            projectRoles={projectRoles}
            leadRoleName={leadRoleName}
            includeCreator={false}
            actionMode={false}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  )
}
