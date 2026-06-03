import type { TeamRoleId } from '../types/models'
import type { ActorRef, ProjectRoleDef } from '../types/workflow'
import type { RoleDef } from '../types/v2'

// Phase 2d: one source of truth for serialising, parsing, comparing, and
// describing ActorRefs. Shared by the permission-pill popover, the live preview
// rail, and the status-permission picker. Consolidates the serialise/describe
// logic that previously lived inline in ActorPicker.tsx and ActionCard.tsx, and
// extends it with the new `project_role` kind.

// Stable string key for an ActorRef. Round-trips through parseActorKey. Used as
// React keys and as tick identity in the actors popover / preview rail.
export function actorRefKey(actor: ActorRef): string {
  switch (actor.kind) {
    case 'global_role':
      return `global_role:${actor.role}`
    case 'pipeline_role':
      return `pipeline_role:${actor.role}`
    case 'team_role':
      return `team_role:${actor.role}/${actor.member}`
    case 'project_role':
      return `project_role:${actor.roleId}`
    case 'role':
      return `role:${actor.roleId}`
    case 'creator':
      return 'creator'
  }
}

export function parseActorKey(key: string): ActorRef {
  if (key === 'creator') return { kind: 'creator' }
  const idx = key.indexOf(':')
  const kind = idx === -1 ? key : key.slice(0, idx)
  const rest = idx === -1 ? '' : key.slice(idx + 1)
  switch (kind) {
    case 'global_role':
      return { kind: 'global_role', role: rest === 'super_admin' ? 'super_admin' : 'admin' }
    case 'pipeline_role':
      return { kind: 'pipeline_role', role: 'lead' }
    case 'team_role': {
      const [role, member] = rest.split('/')
      return {
        kind: 'team_role',
        role: role as TeamRoleId,
        member: member === 'lead' ? 'lead' : 'any',
      }
    }
    case 'project_role':
      return { kind: 'project_role', roleId: rest }
    case 'role':
      return { kind: 'role', roleId: rest }
    default:
      return { kind: 'pipeline_role', role: 'lead' }
  }
}

export function actorRefsEqual(a: ActorRef, b: ActorRef): boolean {
  return actorRefKey(a) === actorRefKey(b)
}

// The full allowed set of an action = canonical actor first, then alsoAllow.
export function actorSetOf(action: { actor: ActorRef; alsoAllow?: ActorRef[] }): ActorRef[] {
  return [action.actor, ...(action.alsoAllow ?? [])]
}

interface DescribeCtx {
  leadRoleName?: string
  projectRoles?: ProjectRoleDef[]
  // Phase 3: the tenant's hierarchy roles, for labelling `role`-kind actors.
  roles?: RoleDef[]
}

// Human-friendly noun phrase for an actor (used in the action sentence body and
// the preview rail). Never says "permission".
export function describeActor(actor: ActorRef, ctx: DescribeCtx = {}): string {
  switch (actor.kind) {
    case 'creator':
      return 'the person who created the project'
    case 'global_role':
      return actor.role === 'super_admin' ? 'a super-admin' : 'any global admin'
    case 'pipeline_role':
      return `the ${ctx.leadRoleName || 'project lead'}`
    case 'team_role': {
      const team =
        actor.role === 'validator'
          ? 'Validator Team'
          : actor.role === 'coordinator'
            ? 'Coordinator Team'
            : 'Specialist Team'
      return actor.member === 'lead' ? `the ${team} Lead` : `any ${team} member`
    }
    case 'project_role': {
      const role = ctx.projectRoles?.find((r) => r.id === actor.roleId)
      return role?.label ?? 'a project role'
    }
    case 'role': {
      const role = ctx.roles?.find((r) => r.id === actor.roleId)
      return role ? `anyone at the ${role.label} level (or higher)` : 'a hierarchy role'
    }
  }
}

// Short label (no leading article) for the action-sentence pills + checklists.
export function describeActorShort(actor: ActorRef, ctx: DescribeCtx = {}): string {
  switch (actor.kind) {
    case 'creator':
      return 'Project creator'
    case 'global_role':
      return actor.role === 'super_admin' ? 'Super-admin' : 'Global admin'
    case 'pipeline_role':
      return ctx.leadRoleName || 'Project lead'
    case 'team_role': {
      const team =
        actor.role === 'validator'
          ? 'Validator Team'
          : actor.role === 'coordinator'
            ? 'Coordinator Team'
            : 'Specialist Team'
      return actor.member === 'lead' ? `${team} Lead` : `${team} member`
    }
    case 'project_role': {
      const role = ctx.projectRoles?.find((r) => r.id === actor.roleId)
      return role?.label ?? 'Project role'
    }
    case 'role': {
      const role = ctx.roles?.find((r) => r.id === actor.roleId)
      return role?.label ?? 'Hierarchy role'
    }
  }
}
