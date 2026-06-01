import { useOrgStructure } from '../../../contexts/AppConfigContext'
import type { OrgStructure, TeamRoleId } from '../../../types/models'
import type { ActorRef } from '../../../types/workflow'
import Dropdown, { type DropdownOption } from '../../../components/ui/Dropdown'

interface Props {
  value: ActorRef
  onChange: (next: ActorRef) => void
  // Workflow-level lead role label used for the pipeline_role:lead option.
  leadRoleName: string
}

// Phase 2c: picker that resolves an ActorRef. Three top-level choices;
// "specific role in your org" expands to a sub-dropdown populated from
// orgStructure.teamRoles (filtered to roles the tenant actually has) plus the
// pipeline-role:lead and creator built-ins.
//
// Filters every option through `humanizeActor` so the dropdown shows
// tenant-friendly labels ("Validator Team Lead") rather than raw enums.
export default function ActorPicker({ value, onChange, leadRoleName }: Props) {
  const org = useOrgStructure()
  const topLevel = topLevelKind(value)

  const handleTopLevel = (next: 'org_role' | 'creator' | 'super_admin') => {
    switch (next) {
      case 'creator':
        onChange({ kind: 'creator' })
        return
      case 'super_admin':
        onChange({ kind: 'global_role', role: 'super_admin' })
        return
      case 'org_role': {
        // Default to pipeline-role:lead when picking "an org role" since that
        // exists for any flow type. The sub-dropdown lets the user refine.
        onChange({ kind: 'pipeline_role', role: 'lead' })
        return
      }
    }
  }

  const subOptions = buildSubOptions(org, leadRoleName)

  const topLevelOptions: DropdownOption[] = [
    { value: 'org_role', label: 'A specific role in your org' },
    { value: 'creator', label: 'The project creator' },
    { value: 'super_admin', label: 'Anyone with super-admin' },
  ]

  const subDropdownOptions: DropdownOption[] = subOptions.map((opt) => ({
    value: opt.value,
    label: opt.label,
  }))

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
        Who can click this button?
      </label>
      <Dropdown
        value={topLevel}
        onChange={(v) => handleTopLevel(v as 'org_role' | 'creator' | 'super_admin')}
        options={topLevelOptions}
      />

      {topLevel === 'org_role' && (
        <Dropdown
          value={serializeOrgRoleActor(value)}
          onChange={(v) => onChange(deserializeOrgRoleActor(v))}
          options={subDropdownOptions}
        />
      )}

      {topLevel === 'org_role' &&
        subOptions.find((o) => o.value === serializeOrgRoleActor(value))?.hint && (
          <p className="text-xs text-fg-subtle">
            {subOptions.find((o) => o.value === serializeOrgRoleActor(value))?.hint}
          </p>
        )}
    </div>
  )
}

function topLevelKind(actor: ActorRef): 'org_role' | 'creator' | 'super_admin' {
  if (actor.kind === 'creator') return 'creator'
  if (actor.kind === 'global_role' && actor.role === 'super_admin') return 'super_admin'
  return 'org_role'
}

interface SubOption {
  value: string
  label: string
  hint?: string
}

function buildSubOptions(org: OrgStructure, leadRoleName: string): SubOption[] {
  const orgLead = (leadRoleName || org.leadRoleName || 'Project Lead').trim()
  const out: SubOption[] = [
    {
      value: 'pipeline_role:lead',
      label: `The project's ${orgLead}`,
    },
  ]
  if (org.teamRoles.hasCoordinator) {
    out.push({ value: 'team_role:coordinator/lead', label: 'Coordinator Team Lead' })
    out.push({ value: 'team_role:coordinator/any', label: 'Any Coordinator Team member' })
  }
  if (org.teamRoles.hasValidator) {
    out.push({ value: 'team_role:validator/lead', label: 'Validator Team Lead' })
    out.push({ value: 'team_role:validator/any', label: 'Any Validator Team member' })
  }
  if (org.teamRoles.hasSpecialist) {
    out.push({ value: 'team_role:specialist/lead', label: 'Specialist Team Lead' })
    out.push({ value: 'team_role:specialist/any', label: 'Any Specialist Team member' })
  }
  out.push({
    value: 'global_role:admin',
    label: 'Any global admin',
    hint: 'Admins are people with elevated permissions across the whole workspace.',
  })
  return out
}

function serializeOrgRoleActor(actor: ActorRef): string {
  switch (actor.kind) {
    case 'pipeline_role':
      return 'pipeline_role:lead'
    case 'team_role':
      return `team_role:${actor.role}/${actor.member}`
    case 'global_role':
      return `global_role:${actor.role}`
    case 'project_role':
      return `project_role:${actor.roleId}`
    case 'creator':
      return 'pipeline_role:lead' // fallback when top-level changes mid-stream
  }
}

function deserializeOrgRoleActor(serialized: string): ActorRef {
  if (serialized === 'pipeline_role:lead') {
    return { kind: 'pipeline_role', role: 'lead' }
  }
  if (serialized.startsWith('team_role:')) {
    const [, rest] = serialized.split(':')
    const [role, member] = rest.split('/')
    return {
      kind: 'team_role',
      role: role as TeamRoleId,
      member: member as 'lead' | 'any',
    }
  }
  if (serialized === 'global_role:admin') {
    return { kind: 'global_role', role: 'admin' }
  }
  return { kind: 'pipeline_role', role: 'lead' }
}
