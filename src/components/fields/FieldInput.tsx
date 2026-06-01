import UserPicker from '../ui/UserPicker'
import Dropdown from '../ui/Dropdown'
import { dotClassFor, pillClassFor } from '../../lib/fieldTokens'
import type { CustomFieldDef } from '../../types/workflow'

interface Props {
  field: CustomFieldDef
  value: unknown
  onChange: (next: unknown) => void
  error?: string | null
  disabled?: boolean
  id?: string
}

const inputCls =
  'w-full rounded-lg border border-line bg-fill-2 px-3 py-2.5 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring disabled:cursor-not-allowed disabled:opacity-60'

// Phase 2d: type-driven input for a custom field. Used by the create form and
// the sidebar inline editor. select stores the option id, multiSelect a string[]
// of option ids, user a uid. Numbers/currency store a Number, dates an ISO
// 'YYYY-MM-DD' string, everything else a string.
export default function FieldInput({ field, value, onChange, error, disabled, id }: Props) {
  const errorCls = error ? 'border-tone-danger-bd' : ''

  function renderControl() {
    switch (field.type) {
      case 'longText':
        return (
          <textarea
            id={id}
            rows={3}
            disabled={disabled}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            className={`${inputCls} resize-none ${errorCls}`}
          />
        )
      case 'number':
      case 'currency':
        return (
          <div className="relative">
            {field.type === 'currency' && (
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-subtle">
                ₹
              </span>
            )}
            <input
              id={id}
              type="number"
              inputMode="decimal"
              disabled={disabled}
              value={value === undefined || value === null ? '' : String(value)}
              onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
              placeholder={field.placeholder}
              className={`${inputCls} ${field.type === 'currency' ? 'pl-7' : ''} ${errorCls}`}
            />
          </div>
        )
      case 'date':
        return (
          <input
            id={id}
            type="date"
            disabled={disabled}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value || null)}
            className={`${inputCls} scheme-dark ${errorCls}`}
          />
        )
      case 'select': {
        const options = (field.options ?? []).map((o) => ({
          value: o.id,
          label: o.label,
          leading: <span className={`inline-block h-2 w-2 rounded-full ${dotClassFor(o.color)}`} />,
        }))
        return (
          <Dropdown
            value={typeof value === 'string' ? value : ''}
            onChange={(v) => onChange(v || null)}
            options={options}
            placeholder={field.placeholder ?? 'Select…'}
            disabled={disabled}
          />
        )
      }
      case 'multiSelect': {
        const selected = new Set(Array.isArray(value) ? (value as string[]) : [])
        return (
          <div className="flex flex-wrap gap-1.5">
            {(field.options ?? []).map((o) => {
              const on = selected.has(o.id)
              return (
                <button
                  key={o.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const next = new Set(selected)
                    if (next.has(o.id)) next.delete(o.id)
                    else next.add(o.id)
                    onChange([...next])
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
                    on ? pillClassFor(o.color) : 'border-line bg-fill-2 text-fg-muted hover:bg-fill-3'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${dotClassFor(o.color)}`} aria-hidden />
                  {o.label}
                </button>
              )
            })}
            {!(field.options ?? []).length && (
              <span className="text-xs text-fg-faint">No options configured.</span>
            )}
          </div>
        )
      }
      case 'user':
        return (
          <UserPicker
            id={id}
            mode="single"
            value={typeof value === 'string' ? value : null}
            onChange={(uid) => onChange(uid)}
            placeholder={field.placeholder ?? 'Pick a person'}
          />
        )
      case 'email':
      case 'phone':
      case 'url':
      case 'text':
      default:
        return (
          <input
            id={id}
            type={field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : field.type === 'phone' ? 'tel' : 'text'}
            inputMode={field.type === 'phone' ? 'tel' : field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : undefined}
            disabled={disabled}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            className={`${inputCls} ${errorCls}`}
          />
        )
    }
  }

  return (
    <div>
      {renderControl()}
      {error && <p className="mt-1 text-xs text-tone-danger-fg">{error}</p>}
    </div>
  )
}
