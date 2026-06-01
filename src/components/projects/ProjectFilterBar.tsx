import UserPicker from '../ui/UserPicker'
import { dotClassFor, pillClassFor } from '../../lib/fieldTokens'
import type { CustomFieldDef } from '../../types/workflow'
import type { DateRangeFilter, FieldFilters, RangeFilter } from './projectFilterUtils'

// Phase 2d: client-side custom-field filters for the projects list. The match
// predicates live in projectFilterUtils.ts; this file only renders the controls
// (so fast-refresh / only-export-components stays happy).

interface Props {
  fields: CustomFieldDef[]
  filters: FieldFilters
  onChange: (next: FieldFilters) => void
}

const numCls =
  'w-20 rounded-md border border-line bg-fill-2 px-2 py-1 text-xs text-fg outline-none focus:border-brand-edge focus:ring-2 focus:ring-brand-ring'
const textCls =
  'w-40 rounded-md border border-line bg-fill-2 px-2 py-1 text-xs text-fg placeholder:text-fg-faint outline-none focus:border-brand-edge focus:ring-2 focus:ring-brand-ring'

export default function ProjectFilterBar({ fields, filters, onChange }: Props) {
  if (fields.length === 0) return null
  const set = (id: string, v: unknown) => onChange({ ...filters, [id]: v })

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-line bg-fill-1 px-4 py-3">
      {fields.map((f) => (
        <div key={f.id} className="flex items-center gap-2">
          <span className="text-xs font-medium text-fg-subtle">{f.label}:</span>
          {(f.type === 'select' || f.type === 'multiSelect') && (
            <div className="flex flex-wrap gap-1">
              {(f.options ?? []).map((o) => {
                const sel = (filters[f.id] as string[]) ?? []
                const on = sel.includes(o.id)
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() =>
                      set(f.id, on ? sel.filter((s) => s !== o.id) : [...sel, o.id])
                    }
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium transition ${
                      on ? pillClassFor(o.color) : 'border-line bg-fill-2 text-fg-muted hover:bg-fill-3'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${dotClassFor(o.color)}`} aria-hidden />
                    {o.label}
                  </button>
                )
              })}
            </div>
          )}
          {(f.type === 'number' || f.type === 'currency') && (
            <div className="flex items-center gap-1">
              <input
                type="number"
                placeholder="min"
                value={(filters[f.id] as RangeFilter)?.min ?? ''}
                onChange={(e) =>
                  set(f.id, {
                    ...(filters[f.id] as RangeFilter),
                    min: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
                className={numCls}
              />
              <span className="text-fg-faint">–</span>
              <input
                type="number"
                placeholder="max"
                value={(filters[f.id] as RangeFilter)?.max ?? ''}
                onChange={(e) =>
                  set(f.id, {
                    ...(filters[f.id] as RangeFilter),
                    max: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
                className={numCls}
              />
            </div>
          )}
          {f.type === 'date' && (
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={(filters[f.id] as DateRangeFilter)?.from ?? ''}
                onChange={(e) =>
                  set(f.id, { ...(filters[f.id] as DateRangeFilter), from: e.target.value || undefined })
                }
                className={`${numCls} w-auto scheme-dark`}
              />
              <span className="text-fg-faint">–</span>
              <input
                type="date"
                value={(filters[f.id] as DateRangeFilter)?.to ?? ''}
                onChange={(e) =>
                  set(f.id, { ...(filters[f.id] as DateRangeFilter), to: e.target.value || undefined })
                }
                className={`${numCls} w-auto scheme-dark`}
              />
            </div>
          )}
          {f.type === 'user' && (
            <div className="w-52">
              <UserPicker
                mode="single"
                value={(filters[f.id] as string | null) ?? null}
                onChange={(uid) => set(f.id, uid)}
                placeholder="Anyone"
              />
            </div>
          )}
          {['text', 'longText', 'email', 'phone', 'url'].includes(f.type) && (
            <input
              type="text"
              placeholder="contains…"
              value={(filters[f.id] as string) ?? ''}
              onChange={(e) => set(f.id, e.target.value)}
              className={textCls}
            />
          )}
        </div>
      ))}
    </div>
  )
}
