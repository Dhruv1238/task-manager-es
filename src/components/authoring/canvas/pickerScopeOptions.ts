import type { DropdownGroup } from '../../ui/Dropdown'
import type { OrgStructure } from '../../../types/models'
import type { ProjectRoleDef } from '../../../types/workflow'
import type { RoleDef } from '../../../types/v2'

// Grouped options for a user_picker input's pickerScope (and the Assign control's
// "eligible" scope). Drives WHO can be chosen at runtime: a hierarchy role's
// holders, a workflow project role's assignees, any global admin, or a team.
// resolvePickerScope (ActionModal) resolves each value string to concrete uids.
export function buildPickerScopeOptions(
  org: OrgStructure,
  roles: RoleDef[],
  projectRoles: ProjectRoleDef[],
): DropdownGroup[] {
  const groups: DropdownGroup[] = []

  if (roles.length) {
    groups.push({
      label: 'Roles',
      options: [...roles]
        .sort((a, b) => a.level - b.level || a.order - b.order)
        .map((r) => ({ value: `role:${r.id}`, label: r.label })),
    })
  }

  if (projectRoles.length) {
    groups.push({
      label: 'Workflow roles',
      options: [...projectRoles]
        .sort((a, b) => a.order - b.order)
        .map((pr) => ({ value: `project_role:${pr.id}`, label: pr.label })),
    })
  }

  const other: DropdownGroup['options'] = [{ value: 'global_role:admin', label: 'Any global admin' }]
  if (org.teamRoles?.hasCoordinator)
    other.push({ value: 'team_role:coordinator/any', label: 'Any Coordinator Team member' })
  if (org.teamRoles?.hasValidator)
    other.push({ value: 'team_role:validator/any', label: 'Any Validator Team member' })
  if (org.teamRoles?.hasSpecialist)
    other.push({ value: 'team_role:specialist/any', label: 'Any Specialist Team member' })
  groups.push({ label: 'Other', options: other })

  return groups
}
