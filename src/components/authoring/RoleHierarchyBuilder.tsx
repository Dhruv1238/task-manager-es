import { Plus, Trash2, ChevronUp, ChevronDown, Layers } from 'lucide-react'
import type { HierarchyLevel, RoleDef } from '../../types/v2'

interface Props {
  levels: HierarchyLevel[]
  roles: RoleDef[]
  onChangeLevels: (levels: HierarchyLevel[]) => void
  onChangeRoles: (roles: RoleDef[]) => void
  readOnly?: boolean
}

const inputCls =
  'rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

function slug(label: string, taken: Set<string>): string {
  const base = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'role'
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

// N-level hierarchy editor: define levels (1 = highest authority) and the roles
// that sit at each. Higher levels inherit the union of lower levels' grants
// (shown in the access grid). Bridge tags are preserved on edit so seeded flows
// keep resolving.
export default function RoleHierarchyBuilder({
  levels,
  roles,
  onChangeLevels,
  onChangeRoles,
  readOnly,
}: Props) {
  const maxLevel = Math.max(1, ...levels.map((l) => l.level))

  function addLevel() {
    onChangeLevels([...levels, { level: maxLevel + 1, label: `Level ${maxLevel + 1}` }])
  }
  function setLevelLabel(level: number, label: string) {
    onChangeLevels(levels.map((l) => (l.level === level ? { ...l, label } : l)))
  }
  function removeLevel(level: number) {
    if (roles.some((r) => r.level === level)) return // don't orphan roles
    onChangeLevels(levels.filter((l) => l.level !== level))
  }

  function addRole(level: number) {
    const taken = new Set(roles.map((r) => r.id))
    const id = slug('new-role', taken)
    onChangeRoles([
      ...roles,
      { id, label: 'New role', level, order: roles.length, moduleGrants: {} },
    ])
  }
  function setRole(id: string, patch: Partial<RoleDef>) {
    onChangeRoles(roles.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function removeRole(id: string) {
    onChangeRoles(roles.filter((r) => r.id !== id))
  }
  function moveRole(id: string, dir: -1 | 1) {
    const r = roles.find((x) => x.id === id)
    if (!r) return
    const target = r.level + dir
    if (target < 1 || target > maxLevel) return
    setRole(id, { level: target })
  }

  const sortedLevels = [...levels].sort((a, b) => a.level - b.level)

  return (
    <div className="space-y-3">
      {sortedLevels.map((lvl) => {
        const levelRoles = roles
          .filter((r) => r.level === lvl.level)
          .sort((a, b) => a.order - b.order)
        return (
          <div key={lvl.level} className="rounded-2xl border border-line bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md pill-brandtone border-transparent text-xs font-semibold">
                {lvl.level}
              </span>
              <input
                value={lvl.label}
                disabled={readOnly}
                onChange={(e) => setLevelLabel(lvl.level, e.target.value)}
                className={`${inputCls} flex-1`}
                placeholder="Level name (e.g. Vertical Head)"
              />
              {!readOnly && levelRoles.length === 0 && lvl.level === maxLevel && (
                <button
                  type="button"
                  onClick={() => removeLevel(lvl.level)}
                  className="rounded-md p-1.5 text-fg-subtle transition hover:text-tone-danger-fg"
                  title="Remove empty level"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>

            <div className="space-y-2">
              {levelRoles.map((role) => (
                <div
                  key={role.id}
                  className="flex items-center gap-2 rounded-lg border border-line bg-fill-1 px-3 py-2"
                >
                  <Layers size={13} className="shrink-0 text-brand" />
                  <input
                    value={role.label}
                    disabled={readOnly}
                    onChange={(e) => setRole(role.id, { label: e.target.value })}
                    className="min-w-0 flex-1 bg-transparent text-sm font-medium text-fg outline-none"
                  />
                  {(role.legacyGlobalRole || role.legacyTeamRoleId || role.legacyPipelineRole) && (
                    <span
                      className="rounded bg-fill-3 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-fg-faint"
                      title="Bridges a legacy actor so seeded flows keep working"
                    >
                      bridge
                    </span>
                  )}
                  {!readOnly && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveRole(role.id, -1)}
                        className="rounded p-1 text-fg-subtle transition hover:text-fg"
                        title="Promote (higher authority)"
                      >
                        <ChevronUp size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveRole(role.id, 1)}
                        className="rounded p-1 text-fg-subtle transition hover:text-fg"
                        title="Demote (lower authority)"
                      >
                        <ChevronDown size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRole(role.id)}
                        className="rounded p-1 text-fg-subtle transition hover:text-tone-danger-fg"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => addRole(lvl.level)}
                  className="flex items-center gap-1 text-xs text-brand transition hover:opacity-80"
                >
                  <Plus size={12} /> Add role at this level
                </button>
              )}
            </div>
          </div>
        )
      })}

      {!readOnly && (
        <button
          type="button"
          onClick={addLevel}
          className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line bg-fill-1 py-3 text-sm text-fg-muted transition hover:bg-fill-2 hover:text-fg"
        >
          <Plus size={15} /> Add a level
        </button>
      )}
    </div>
  )
}
