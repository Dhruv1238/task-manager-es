import { useProjectWorkflow, useLeadRoleName } from '../../contexts/AppConfigContext'
import type { Project, User } from '../../types/models'

// Resolves and displays a project's leadership on the project list: the pipeline
// lead ("Vertical Head" by default — project.leadUid, labeled by the workflow's
// leadRoleName) and the "Admin Head" project role (roleAssignments['admin_head']).
// A component (not inline) because it calls hooks per row. Names resolve from the
// already-in-memory userById map — zero extra reads.
export default function ProjectHeadsCell({
  project,
  userById,
  className = '',
}: {
  project: Project
  userById: Map<string, User>
  className?: string
}) {
  const workflow = useProjectWorkflow(project)
  const orgLeadRoleName = useLeadRoleName()

  const nameFor = (uid: string | null | undefined) =>
    (uid && userById.get(uid)?.displayName) || '—'

  const lines: { label: string; value: string }[] = []

  // Vertical Head (pipeline lead) — only once the workflow resolves and isn't
  // basic (basic flow has no lead concept; unknown flow shows nothing yet).
  if (workflow && workflow.flowType !== 'basic') {
    lines.push({
      label: workflow.leadRoleName || orgLeadRoleName,
      value: nameFor(project.leadUid),
    })
  }

  // Admin Head — only when the workflow declares the role.
  const adminRole = workflow?.projectRoles?.find((r) => r.id === 'admin_head')
  if (adminRole) {
    const raw = project.roleAssignments?.['admin_head']
    const uids = Array.isArray(raw) ? raw : raw ? [raw] : []
    lines.push({
      label: adminRole.label,
      value: uids.length ? uids.map((u) => nameFor(u)).join(', ') : '—',
    })
  }

  // Nothing to show (basic flow / unresolved workflow) — render nothing rather
  // than a lone em-dash, so callers don't get an orphan placeholder.
  if (lines.length === 0) return null

  return (
    <div className={`space-y-0.5 text-xs ${className}`}>
      {lines.map((l) => (
        <div key={l.label} className="max-w-48 truncate" title={`${l.label}: ${l.value}`}>
          <span className="text-fg-subtle">{l.label}:</span>{' '}
          <span className="text-fg-muted">{l.value}</span>
        </div>
      ))}
    </div>
  )
}
