import Dropdown, { type DropdownOption } from '../../../components/ui/Dropdown'
import { reorder } from '../../../lib/reorder'
import { nextLocalId } from '../../../lib/localId'
import { PILL_COLORS, dotClassFor } from '../../../lib/fieldTokens'
import type { CustomFieldDef, CustomFieldType, FieldSurface } from '../../../types/workflow'

interface Props {
  fields: CustomFieldDef[]
  onChange: (next: CustomFieldDef[]) => void
  disabled?: boolean
}

const inputCls =
  'w-full rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring disabled:opacity-60'

const TYPE_OPTIONS: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Short text' },
  { value: 'longText', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Amount (currency)' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Dropdown (single)' },
  { value: 'multiSelect', label: 'Multi-select' },
  { value: 'user', label: 'Person' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'url', label: 'Link' },
]

const SURFACES: { value: FieldSurface; label: string }[] = [
  { value: 'createForm', label: 'Create form' },
  { value: 'sidebar', label: 'Sidebar' },
  { value: 'listColumn', label: 'List column' },
  { value: 'filter', label: 'Filter' },
]

const colorOptions: DropdownOption[] = PILL_COLORS.map((c) => ({
  value: c,
  label: c.charAt(0).toUpperCase() + c.slice(1),
  leading: <span className={`inline-block h-3 w-3 rounded-full ${dotClassFor(c)}`} aria-hidden />,
}))

function Chevrons({ idx, count, onMove, disabled }: { idx: number; count: number; onMove: (d: -1 | 1) => void; disabled?: boolean }) {
  const btn = 'rounded-md border border-line bg-fill-2 px-1.5 py-0.5 text-[10px] text-fg-muted transition hover:bg-fill-3 disabled:opacity-30'
  return (
    <div className="flex shrink-0 flex-col gap-0.5">
      <button type="button" className={btn} disabled={disabled || idx === 0} onClick={() => onMove(-1)} aria-label="Move up">▲</button>
      <button type="button" className={btn} disabled={disabled || idx === count - 1} onClick={() => onMove(1)} aria-label="Move down">▼</button>
    </div>
  )
}

// Phase 2d: "Project Fields" editor. Arbitrary typed fields, each placed on any
// subset of surfaces (create form / sidebar / list column / filter). select /
// multiSelect get a coloured-option sub-editor. Removing soft-deletes
// (deprecated) so existing project values keep rendering.
export default function CustomFieldsEditor({ fields, onChange, disabled }: Props) {
  const sorted = [...fields].sort((a, b) => a.order - b.order)
  const visible = sorted.filter((f) => !f.deprecated)
  const deprecated = sorted.filter((f) => f.deprecated)

  const update = (id: string, patch: Partial<CustomFieldDef>) =>
    onChange(sorted.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  function add() {
    onChange([
      ...sorted,
      {
        id: nextLocalId('field', sorted),
        label: '',
        type: 'text',
        required: false,
        surfaces: ['createForm', 'sidebar'],
        order: sorted.length,
      },
    ])
  }
  const softDelete = (id: string) => update(id, { deprecated: true })
  const restore = (id: string) => update(id, { deprecated: false })
  // Reorder operates over the visible list, then merges deprecated back.
  const move = (idx: number, dir: -1 | 1) => {
    const reordered = reorder(visible, idx, dir)
    onChange([...reordered, ...deprecated.map((f, i) => ({ ...f, order: reordered.length + i }))])
  }

  function toggleSurface(id: string, surface: FieldSurface) {
    const f = sorted.find((x) => x.id === id)
    if (!f) return
    const set = new Set(f.surfaces)
    if (set.has(surface)) set.delete(surface)
    else set.add(surface)
    update(id, { surfaces: [...set] })
  }

  function updateOptions(id: string, options: CustomFieldDef['options']) {
    update(id, { options })
  }

  return (
    <div className="rounded-2xl border border-line bg-card p-5">
      <h3 className="text-base font-semibold text-fg">Project Fields</h3>
      <p className="mt-1 text-sm text-fg-subtle">
        Extra info every project of this type captures — placed on the create form, the sidebar,
        the project list, and/or the filter bar.
      </p>
      <div className="mt-4 space-y-3">
        {visible.length === 0 && (
          <p className="rounded-lg border border-dashed border-line bg-fill-2 px-3 py-4 text-center text-sm text-fg-faint">
            No custom fields yet.
          </p>
        )}
        {visible.map((f, idx) => {
          const hasOptions = f.type === 'select' || f.type === 'multiSelect'
          return (
            <div key={f.id} className="rounded-xl border border-line bg-fill-1 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={f.label}
                      disabled={disabled}
                      onChange={(e) => update(f.id, { label: e.target.value })}
                      placeholder="Field name (e.g. Lead Category)"
                      className={`${inputCls} flex-1`}
                    />
                    <Dropdown
                      value={f.type}
                      onChange={(v) =>
                        update(f.id, {
                          type: v as CustomFieldType,
                          // seed an option when switching to a choice type
                          options:
                            (v === 'select' || v === 'multiSelect') && !(f.options?.length)
                              ? [{ id: 'opt_1', label: 'Option 1', color: 'brandtone' }]
                              : f.options,
                        })
                      }
                      options={TYPE_OPTIONS}
                      disabled={disabled}
                      className="w-44"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-fg-muted">
                      <input
                        type="checkbox"
                        checked={f.required}
                        disabled={disabled}
                        onChange={(e) => update(f.id, { required: e.target.checked })}
                        className="h-3.5 w-3.5 rounded border-line-strong accent-brand"
                      />
                      Required
                    </label>
                    <span className="text-fg-faint">Show on:</span>
                    {SURFACES.map((s) => {
                      const on = f.surfaces.includes(s.value)
                      return (
                        <button
                          key={s.value}
                          type="button"
                          disabled={disabled}
                          onClick={() => toggleSurface(f.id, s.value)}
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
                            on ? 'pill-info border' : 'border-line bg-fill-2 text-fg-muted hover:bg-fill-3'
                          }`}
                        >
                          {s.label}
                        </button>
                      )
                    })}
                  </div>
                  {hasOptions && (
                    <OptionsEditor
                      options={f.options ?? []}
                      onChange={(opts) => updateOptions(f.id, opts)}
                      disabled={disabled}
                    />
                  )}
                  <p className="text-[11px] text-fg-faint">id: {f.id} (locked)</p>
                </div>
                <Chevrons idx={idx} count={visible.length} onMove={(d) => move(idx, d)} disabled={disabled} />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => softDelete(f.id)}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-tone-danger-fg transition hover:bg-tone-danger-bg disabled:opacity-40"
                  aria-label="Remove field"
                >
                  ✕
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {deprecated.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-line-subtle pt-3">
          <p className="text-xs text-fg-subtle">Removed fields (kept on existing projects):</p>
          {deprecated.map((f) => (
            <div key={f.id} className="flex items-center justify-between text-xs">
              <span className="text-fg-faint line-through">{f.label || f.id}</span>
              {!disabled && (
                <button type="button" onClick={() => restore(f.id)} className="text-brand hover:underline">
                  Restore
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!disabled && (
        <button type="button" onClick={add} className="mt-3 text-sm font-medium text-brand transition hover:underline">
          + Add a field
        </button>
      )}
    </div>
  )
}

function OptionsEditor({
  options,
  onChange,
  disabled,
}: {
  options: NonNullable<CustomFieldDef['options']>
  onChange: (next: CustomFieldDef['options']) => void
  disabled?: boolean
}) {
  const update = (id: string, patch: Partial<(typeof options)[number]>) =>
    onChange(options.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  function add() {
    onChange([
      ...options,
      {
        id: nextLocalId('opt', options),
        label: `Option ${options.length + 1}`,
        color: PILL_COLORS[options.length % PILL_COLORS.length],
      },
    ])
  }
  const remove = (id: string) => onChange(options.filter((o) => o.id !== id))

  return (
    <div className="space-y-1.5 rounded-lg border border-line-subtle bg-fill-2 p-2">
      {options.map((o) => (
        <div key={o.id} className="flex items-center gap-2">
          <input
            value={o.label}
            disabled={disabled}
            onChange={(e) => update(o.id, { label: e.target.value })}
            placeholder="Option label"
            className={`${inputCls} flex-1 py-1`}
          />
          <Dropdown
            value={o.color ?? 'neutral'}
            onChange={(v) => update(o.id, { color: v as (typeof options)[number]['color'] })}
            options={colorOptions}
            disabled={disabled}
            className="w-28"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => remove(o.id)}
            className="shrink-0 rounded-md px-1.5 py-1 text-xs text-tone-danger-fg transition hover:bg-tone-danger-bg disabled:opacity-40"
            aria-label="Remove option"
          >
            ✕
          </button>
        </div>
      ))}
      {!disabled && (
        <button type="button" onClick={add} className="text-xs font-medium text-brand transition hover:underline">
          + Add option
        </button>
      )}
    </div>
  )
}
