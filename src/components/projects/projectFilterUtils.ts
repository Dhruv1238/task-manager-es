import type { Project } from '../../types/models'
import type { CustomFieldDef } from '../../types/workflow'

// Phase 2d: client-side custom-field filter predicates for the projects list.
// Kept in their own module (not the component file) so ProjectFilterBar.tsx only
// exports a component — satisfies react-refresh/only-export-components.

export type FieldFilters = Record<string, unknown>

export interface RangeFilter {
  min?: number
  max?: number
}
export interface DateRangeFilter {
  from?: string
  to?: string
}

function passesOne(field: CustomFieldDef, value: unknown, filter: unknown): boolean {
  switch (field.type) {
    case 'select': {
      const sel = (filter as string[]) ?? []
      return sel.length === 0 || (typeof value === 'string' && sel.includes(value))
    }
    case 'multiSelect': {
      const sel = (filter as string[]) ?? []
      if (sel.length === 0) return true
      const vals = Array.isArray(value) ? (value as string[]) : []
      return sel.some((s) => vals.includes(s))
    }
    case 'number':
    case 'currency': {
      const { min, max } = (filter as RangeFilter) ?? {}
      if (min == null && max == null) return true
      const n = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(n)) return false
      if (min != null && n < min) return false
      if (max != null && n > max) return false
      return true
    }
    case 'date': {
      const { from, to } = (filter as DateRangeFilter) ?? {}
      const s = typeof value === 'string' ? value : ''
      if (from && (!s || s < from)) return false
      if (to && (!s || s > to)) return false
      return true
    }
    case 'user': {
      const uid = filter as string | null
      return !uid || value === uid
    }
    default: {
      const q = String(filter ?? '').trim().toLowerCase()
      return !q || String(value ?? '').toLowerCase().includes(q)
    }
  }
}

// True when a filter for this field is actually narrowing anything.
export function isActiveFilter(field: CustomFieldDef, filter: unknown): boolean {
  if (filter == null) return false
  switch (field.type) {
    case 'select':
    case 'multiSelect':
      return ((filter as string[]) ?? []).length > 0
    case 'number':
    case 'currency': {
      const { min, max } = (filter as RangeFilter) ?? {}
      return min != null || max != null
    }
    case 'date': {
      const { from, to } = (filter as DateRangeFilter) ?? {}
      return Boolean(from || to)
    }
    case 'user':
      return Boolean(filter)
    default:
      return Boolean(String(filter ?? '').trim())
  }
}

export function hasActiveFilters(fields: CustomFieldDef[], filters: FieldFilters): boolean {
  return fields.some((f) => isActiveFilter(f, filters[f.id]))
}

export function matchesCustomFilters(
  project: Project,
  fields: CustomFieldDef[],
  filters: FieldFilters,
): boolean {
  return fields.every(
    (f) => !isActiveFilter(f, filters[f.id]) || passesOne(f, project.fields?.[f.id], filters[f.id]),
  )
}
