import type { CustomFieldDef } from '../../types/workflow'

// Phase 2d: type-level validation for custom-field VALUES (distinct from
// workflowValidation.ts which validates field DEFINITIONS). Day-one rules only:
// required-on-create-form, numeric, email/url/phone shape, known option ids.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[+\d][\d\s()/-]{4,}$/

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

// Returns an error string, or null when the value is acceptable.
export function validateFieldValue(field: CustomFieldDef, value: unknown): string | null {
  if (isEmpty(value)) {
    return field.required && field.surfaces.includes('createForm')
      ? `${field.label} is required.`
      : null
  }
  switch (field.type) {
    case 'number':
    case 'currency': {
      const n = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(n) ? null : `${field.label} must be a number.`
    }
    case 'email':
      return EMAIL_RE.test(String(value)) ? null : `${field.label} must be a valid email.`
    case 'url':
      try {
        // Accept bare domains by prefixing a scheme when missing.
        new URL(/^https?:\/\//i.test(String(value)) ? String(value) : `https://${value}`)
        return null
      } catch {
        return `${field.label} must be a valid link.`
      }
    case 'phone':
      return PHONE_RE.test(String(value)) ? null : `${field.label} must be a valid phone number.`
    case 'select':
      return field.options?.some((o) => o.id === value)
        ? null
        : `${field.label}: choose a valid option.`
    case 'multiSelect': {
      const ids = new Set((field.options ?? []).map((o) => o.id))
      return Array.isArray(value) && value.every((v) => ids.has(String(v)))
        ? null
        : `${field.label}: one or more options are invalid.`
    }
    default:
      return null
  }
}

// Validate a whole value map against a set of field defs. Pure — safe to call
// during render. Returns per-field errors keyed by field id + an overall flag.
export function useFieldValidation(
  fields: CustomFieldDef[],
  values: Record<string, unknown>,
): { errors: Record<string, string | null>; isValid: boolean } {
  const errors: Record<string, string | null> = {}
  let isValid = true
  for (const f of fields) {
    const err = validateFieldValue(f, values[f.id])
    errors[f.id] = err
    if (err) isValid = false
  }
  return { errors, isValid }
}
