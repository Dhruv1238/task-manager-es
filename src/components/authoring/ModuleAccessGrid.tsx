import { DEFAULT_MODULE_IDS, MODULE_LABELS } from '../../types/v2'
import type { ModuleGrant, ModuleOp, RoleDef } from '../../types/v2'

const OPS: ModuleOp[] = ['view', 'create', 'update', 'delete']
const OP_LABEL: Record<ModuleOp, string> = { view: 'V', create: 'C', update: 'U', delete: 'D' }
const OP_TITLE: Record<ModuleOp, string> = {
  view: 'View',
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
}

interface Props {
  roles: RoleDef[]
  onChange: (roles: RoleDef[]) => void
  readOnly?: boolean
}

// Layer-1 access matrix: rows = roles, columns grouped by module with four CRUD
// toggles. A grant inherited from a lower-authority level renders checked-but-
// muted and locked (can't drop below the inherited floor) — additive override
// only, matching the "higher level inherits lower levels' permissions" rule.
export default function ModuleAccessGrid({ roles, onChange, readOnly }: Props) {
  const sorted = [...roles].sort((a, b) => a.level - b.level || a.order - b.order)

  // Inherited floor: any role at a STRICTLY lower authority (higher level number)
  // that grants this op gives it to roles above for free.
  function inherited(role: RoleDef, moduleId: string, op: ModuleOp): boolean {
    return roles.some((r) => r.level > role.level && r.moduleGrants?.[moduleId]?.[op])
  }

  function toggle(roleId: string, moduleId: string, op: ModuleOp, next: boolean) {
    onChange(
      roles.map((r) => {
        if (r.id !== roleId) return r
        const grant: ModuleGrant = { ...noGrant(), ...(r.moduleGrants?.[moduleId] ?? {}) }
        grant[op] = next
        return { ...r, moduleGrants: { ...r.moduleGrants, [moduleId]: grant } }
      }),
    )
  }

  return (
    <div className="scrollbar-themed overflow-x-auto rounded-2xl border border-line bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-fg-subtle">
              Role
            </th>
            {DEFAULT_MODULE_IDS.map((m) => (
              <th
                key={m}
                className="whitespace-nowrap border-l border-line px-2 py-2 text-center text-xs font-medium text-fg-muted"
              >
                {MODULE_LABELS[m] ?? m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((role) => (
            <tr key={role.id} className="border-b border-line-subtle last:border-0">
              <td className="sticky left-0 z-10 bg-card px-3 py-2 align-middle">
                <div className="text-sm font-medium text-fg">{role.label}</div>
                <div className="text-[10px] text-fg-faint">Level {role.level}</div>
              </td>
              {DEFAULT_MODULE_IDS.map((m) => (
                <td key={m} className="border-l border-line px-1 py-2">
                  <div className="flex items-center justify-center gap-0.5">
                    {OPS.map((op) => {
                      const own = role.moduleGrants?.[m]?.[op] ?? false
                      const inh = inherited(role, m, op)
                      const checked = own || inh
                      return (
                        <label
                          key={op}
                          title={`${OP_TITLE[op]}${inh ? ' (inherited)' : ''}`}
                          className="flex w-5 cursor-pointer flex-col items-center"
                        >
                          <span className="text-[8px] text-fg-faint">{OP_LABEL[op]}</span>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={readOnly || inh}
                            onChange={(e) => toggle(role.id, m, op, e.target.checked)}
                            className={`h-3.5 w-3.5 accent-[var(--color-brand)] ${
                              inh ? 'opacity-40' : ''
                            }`}
                          />
                        </label>
                      )
                    })}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function noGrant(): ModuleGrant {
  return { view: false, create: false, update: false, delete: false }
}
