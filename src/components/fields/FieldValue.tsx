import Avatar from '../ui/Avatar'
import { dotClassFor, pillClassFor } from '../../lib/fieldTokens'
import type { User } from '../../types/models'
import type { CustomFieldDef } from '../../types/workflow'

interface Props {
  field: CustomFieldDef
  value: unknown
  // 'sidebar' = roomy; 'cell' = compact for list table cells.
  density?: 'sidebar' | 'cell'
  // Resolves a uid → User for the `user` field type. Pass userById.get from a
  // caller that already loads the tenant user list (useAllUsers).
  resolveUser?: (uid: string) => User | undefined
}

const INR = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

function OptionPill({ field, id }: { field: CustomFieldDef; id: string }) {
  const opt = field.options?.find((o) => o.id === id)
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${pillClassFor(opt?.color)}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClassFor(opt?.color)}`} aria-hidden />
      {opt?.label ?? id}
    </span>
  )
}

// Phase 2d: read-only render of a stored custom-field value. Used in the project
// sidebar and the projects-list cells. Resolves option id → label/colour and
// uid → profile at render time. Renders an em dash for empty values.
export default function FieldValue({ field, value, density = 'sidebar', resolveUser }: Props) {
  if (isEmpty(value)) return <span className="text-fg-faint">—</span>

  switch (field.type) {
    case 'select':
      return <OptionPill field={field} id={String(value)} />
    case 'multiSelect': {
      // Defensive: a value stored before the field was a multiSelect (or legacy
      // data) may be a bare string — coerce so .map never throws.
      const ids = Array.isArray(value) ? (value as string[]) : [String(value)]
      return (
        <span className="inline-flex flex-wrap gap-1">
          {ids.map((id) => (
            <OptionPill key={id} field={field} id={id} />
          ))}
        </span>
      )
    }
    case 'currency': {
      const n = Number(value)
      return (
        <span className="tabular-nums text-fg-strong">
          {Number.isFinite(n) ? INR.format(n) : String(value)}
        </span>
      )
    }
    case 'number':
      return <span className="tabular-nums text-fg-strong">{String(value)}</span>
    case 'date': {
      const d = new Date(String(value))
      return (
        <span className="text-fg-strong">
          {Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString()}
        </span>
      )
    }
    case 'user': {
      const u = resolveUser?.(String(value))
      return (
        <span className="inline-flex items-center gap-1.5">
          <Avatar user={u} name={u ? undefined : String(value)} size={density === 'cell' ? 18 : 22} />
          <span className="truncate text-fg-strong">{u?.displayName ?? String(value)}</span>
        </span>
      )
    }
    case 'url': {
      const raw = String(value)
      const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
      let label = raw
      try {
        label = new URL(href).hostname
      } catch {
        /* keep raw */
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="truncate text-brand transition hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {label}
        </a>
      )
    }
    case 'email':
      return (
        <a
          href={`mailto:${value}`}
          className="truncate text-brand transition hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {String(value)}
        </a>
      )
    case 'phone':
      return (
        <a
          href={`tel:${value}`}
          className="truncate text-brand transition hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {String(value)}
        </a>
      )
    case 'longText':
    case 'text':
    default:
      return (
        <span className={density === 'cell' ? 'truncate text-fg-strong' : 'text-fg-strong'}>
          {String(value)}
        </span>
      )
  }
}
