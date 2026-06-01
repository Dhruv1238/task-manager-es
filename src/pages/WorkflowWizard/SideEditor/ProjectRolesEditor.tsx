import { reorder } from '../../../lib/reorder'
import { nextLocalId } from '../../../lib/localId'
import type { ProjectRoleDef } from '../../../types/workflow'

interface Props {
  roles: ProjectRoleDef[]
  onChange: (next: ProjectRoleDef[]) => void
  disabled?: boolean
}

const inputCls =
  'w-full rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring disabled:opacity-60'

function Chevrons({
  idx,
  count,
  onMove,
  disabled,
}: {
  idx: number
  count: number
  onMove: (dir: -1 | 1) => void
  disabled?: boolean
}) {
  const btn =
    'rounded-md border border-line bg-fill-2 px-1.5 py-0.5 text-[10px] text-fg-muted transition hover:bg-fill-3 disabled:opacity-30'
  return (
    <div className="flex shrink-0 flex-col gap-0.5">
      <button type="button" className={btn} disabled={disabled || idx === 0} onClick={() => onMove(-1)} aria-label="Move up">
        ▲
      </button>
      <button type="button" className={btn} disabled={disabled || idx === count - 1} onClick={() => onMove(1)} aria-label="Move down">
        ▼
      </button>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-line-strong accent-brand"
      />
      {label}
    </label>
  )
}

// Phase 2d: "People & Roles" editor — add / rename / reorder / remove the named
// role slots a project of this workflow fills. id is frozen at creation so
// relabelling never orphans assignments.
export default function ProjectRolesEditor({ roles, onChange, disabled }: Props) {
  const sorted = [...roles].sort((a, b) => a.order - b.order)

  const update = (id: string, patch: Partial<ProjectRoleDef>) =>
    onChange(sorted.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  function add() {
    onChange([
      ...sorted,
      {
        id: nextLocalId('role', sorted),
        label: '',
        multiple: false,
        required: false,
        order: sorted.length,
      },
    ])
  }
  const remove = (id: string) =>
    onChange(sorted.filter((r) => r.id !== id).map((r, i) => ({ ...r, order: i })))
  const move = (idx: number, dir: -1 | 1) => onChange(reorder(sorted, idx, dir))

  return (
    <div className="rounded-2xl border border-line bg-card p-5">
      <h3 className="text-base font-semibold text-fg">People &amp; Roles</h3>
      <p className="mt-1 text-sm text-fg-subtle">
        Define the roles people play on a project of this type — assigned per project to any
        user. The platform never hardcodes these; call them whatever fits.
      </p>
      <div className="mt-4 space-y-3">
        {sorted.length === 0 && (
          <p className="rounded-lg border border-dashed border-line bg-fill-2 px-3 py-4 text-center text-sm text-fg-faint">
            No roles yet — projects on this workflow won't ask for any.
          </p>
        )}
        {sorted.map((role, idx) => (
          <div key={role.id} className="rounded-xl border border-line bg-fill-1 p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <input
                  value={role.label}
                  disabled={disabled}
                  onChange={(e) => update(role.id, { label: e.target.value })}
                  placeholder="Role name (e.g. Vertical Head)"
                  className={inputCls}
                />
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-muted">
                  <Toggle checked={role.multiple} disabled={disabled} onChange={(v) => update(role.id, { multiple: v })} label="More than one person can hold this" />
                  <Toggle checked={role.required} disabled={disabled} onChange={(v) => update(role.id, { required: v })} label="Required when creating a project" />
                  <Toggle checked={Boolean(role.assignedToCreatorOnNew)} disabled={disabled} onChange={(v) => update(role.id, { assignedToCreatorOnNew: v })} label="Auto-assign the creator" />
                </div>
                <p className="mt-1 text-[11px] text-fg-faint">id: {role.id} (locked)</p>
              </div>
              <Chevrons idx={idx} count={sorted.length} onMove={(d) => move(idx, d)} disabled={disabled} />
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(role.id)}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-tone-danger-fg transition hover:bg-tone-danger-bg disabled:opacity-40"
                aria-label="Remove role"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
      {!disabled && (
        <button
          type="button"
          onClick={add}
          className="mt-3 text-sm font-medium text-brand transition hover:underline"
        >
          + Add a role
        </button>
      )}
    </div>
  )
}
