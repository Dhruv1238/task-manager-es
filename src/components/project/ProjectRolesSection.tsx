import { useState } from 'react'
import UserPicker from '../ui/UserPicker'
import Avatar from '../ui/Avatar'
import { setProjectRole } from '../../lib/firestore'
import type { Project, User } from '../../types/models'
import type { Workflow } from '../../types/workflow'

interface Props {
  project: Project
  workflow: Workflow | null
  userById: Map<string, User>
  canEdit: boolean
  actorId: string
  actorName: string
}

// Phase 2d: project sidebar "Roles" section. Lists each workflow-defined role
// with its assignee(s); inline edit (gated by canEditProjectMeta) writes via
// setProjectRole, which recomputes accessKeys + appends an audit/timeline event.
export default function ProjectRolesSection({
  project,
  workflow,
  userById,
  canEdit,
  actorId,
  actorName,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const roles = [...(workflow?.projectRoles ?? [])].sort((a, b) => a.order - b.order)
  if (roles.length === 0) return null

  function save(roleId: string, value: string | string[] | null) {
    void setProjectRole({
      projectId: project.id,
      projectTitle: project.title,
      roleId,
      value,
      currentRoleAssignments: project.roleAssignments,
      teamIds: project.teamIds ?? [],
      // Legacy projects have ownerId but no createdBy — fall back so the owner's
      // uid stays in accessKeys (visibility + chat) after a role change.
      createdBy: project.createdBy ?? project.ownerId,
      // Phase 3.6: keep hierarchy-role-actor holders in accessKeys across this write.
      workflow: workflow ?? undefined,
      users: [...userById.values()],
      actorId,
      actorName,
    })
  }

  return (
    <div>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-subtle">Roles</h2>
      <div className="space-y-3 rounded-2xl border border-line bg-card p-5 text-sm">
        {roles.map((role) => {
          const assigned = project.roleAssignments?.[role.id]
          const uids = Array.isArray(assigned) ? assigned : assigned ? [assigned] : []
          const isEditing = editing === role.id
          return (
            <div key={role.id}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-fg-subtle">{role.label}</span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditing(isEditing ? null : role.id)}
                    className="rounded text-xs text-brand outline-none transition hover:underline focus-visible:underline"
                  >
                    {isEditing ? 'Done' : 'Edit'}
                  </button>
                )}
              </div>
              {isEditing ? (
                <div className="mt-2">
                  {role.multiple ? (
                    <UserPicker
                      mode="multi"
                      value={uids}
                      onChange={(v) => save(role.id, v)}
                      placeholder={`Assign ${role.label}`}
                      allowCreate
                    />
                  ) : (
                    <UserPicker
                      mode="single"
                      value={uids[0] ?? null}
                      onChange={(v) => save(role.id, v)}
                      placeholder={`Assign ${role.label}`}
                      allowCreate
                    />
                  )}
                </div>
              ) : (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {uids.length === 0 ? (
                    <span className="text-fg-faint">— not assigned —</span>
                  ) : (
                    uids.map((uid) => {
                      const u = userById.get(uid)
                      return (
                        <span key={uid} className="inline-flex items-center gap-1.5">
                          <Avatar user={u} name={u ? undefined : uid} size={20} />
                          <span className="text-fg-strong">{u?.displayName ?? uid}</span>
                        </span>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
