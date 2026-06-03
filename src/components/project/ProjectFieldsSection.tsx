import { useState } from 'react'
import FieldInput from '../fields/FieldInput'
import FieldValue from '../fields/FieldValue'
import { setProjectField } from '../../lib/firestore'
import type { Project, User } from '../../types/models'
import type { CustomFieldDef, Workflow } from '../../types/workflow'

interface Props {
  project: Project
  workflow: Workflow | null
  userById: Map<string, User>
  canEdit: boolean
  actorId: string
  actorName: string
}

// Phase 2d: project sidebar "Project details" section. Renders each sidebar-surface
// custom field via FieldValue; inline edit (gated by canEditProjectMeta) uses a
// local draft + Save so text fields don't write on every keystroke. Deprecated
// fields that still hold a value are shown greyed and read-only (back-compat).
export default function ProjectFieldsSection({
  project,
  workflow,
  userById,
  canEdit,
  actorId,
  actorName,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)

  const fields = (workflow?.projectFields?.customFields ?? [])
    .filter(
      (f) =>
        (f.surfaces.includes('sidebar') && !f.deprecated) ||
        (project.fields?.[f.id] !== undefined && project.fields?.[f.id] !== null),
    )
    .sort((a, b) => a.order - b.order)
  if (fields.length === 0) return null

  function startEdit(f: CustomFieldDef) {
    setDraft(project.fields?.[f.id] ?? (f.type === 'multiSelect' ? [] : null))
    setEditing(f.id)
  }

  async function save(f: CustomFieldDef) {
    setSaving(true)
    try {
      await setProjectField({
        projectId: project.id,
        projectTitle: project.title,
        fieldId: f.id,
        value: draft,
        actorId,
        actorName,
      })
      setEditing(null)
    } finally {
      setSaving(false)
    }
  }

  const resolveUser = (uid: string) => userById.get(uid)

  return (
    <div>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-subtle">
        Project details
      </h2>
      <div className="space-y-3 rounded-2xl border border-line bg-card p-5 text-sm">
        {fields.map((f) => {
          const isEditing = editing === f.id
          return (
            <div key={f.id}>
              <div className="flex items-start justify-between gap-2">
                <span className={`text-fg-subtle ${f.deprecated ? 'line-through opacity-60' : ''}`}>
                  {f.label}
                </span>
                {canEdit && !f.deprecated && !isEditing && (
                  <button
                    type="button"
                    onClick={() => startEdit(f)}
                    className="rounded text-xs text-brand outline-none transition hover:underline focus-visible:underline"
                  >
                    Edit
                  </button>
                )}
              </div>
              {isEditing ? (
                <div className="mt-2 space-y-2">
                  <FieldInput field={f} value={draft} onChange={setDraft} disabled={saving} />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void save(f)}
                      className="rounded-md bg-brand-gradient px-2.5 py-1 text-xs font-medium text-white transition hover-brand-gradient disabled:opacity-60"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setEditing(null)}
                      className="rounded-md border border-line bg-fill-2 px-2.5 py-1 text-xs text-fg-muted transition hover:bg-fill-3 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-1">
                  <FieldValue field={f} value={project.fields?.[f.id]} resolveUser={resolveUser} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
