import type { OrgStructure, Project, Team, TeamRoleId, User } from '../types/models'

// Pure functions that resolve "which team plays this role" and "who leads it"
// against the tenant-configured org structure. Replaces every hardcoded
// `find(t => /copy|strategy/i.test(t.name))` lookup in the codebase.
//
// All functions are pure: no React, no Firestore, no globals. Callers fetch
// teams + users + orgStructure however they like and pass them in.

// Stable tie-break for multiple teams sharing a role: earliest createdAt wins.
// This is deterministic across reloads even if the source array isn't sorted.
function byCreatedAtAsc(a: Team, b: Team): number {
  const aT = a.createdAt?.toMillis?.() ?? 0
  const bT = b.createdAt?.toMillis?.() ?? 0
  return aT - bT
}

function teamsWithRole(teams: Team[], roleId: TeamRoleId): Team[] {
  return teams.filter((t) => t.teamRoleId === roleId).slice().sort(byCreatedAtAsc)
}

export function resolveCoordinatorTeam(teams: Team[], org: OrgStructure): Team | null {
  if (!org?.teamRoles?.hasCoordinator) return null
  const matches = teamsWithRole(teams, 'coordinator')
  return matches[0] ?? null
}

export function resolveValidatorTeam(teams: Team[], org: OrgStructure): Team | null {
  if (!org?.teamRoles?.hasValidator) return null
  const matches = teamsWithRole(teams, 'validator')
  return matches[0] ?? null
}

export function resolveSpecialistTeams(
  teams: Team[],
  org: OrgStructure,
  workType?: string,
): Team[] {
  if (!org?.teamRoles?.hasSpecialist) return []
  const all = teamsWithRole(teams, 'specialist')
  if (!workType) return all
  return all.filter((t) => (t.workTypes ?? []).includes(workType))
}

export function resolveLeadOf(team: Team | null, users: User[]): User | null {
  if (!team) return null
  return users.find((u) => u.uid === team.leadId) ?? null
}

export function resolveValidatorLead(
  teams: Team[],
  users: User[],
  org: OrgStructure,
): User | null {
  return resolveLeadOf(resolveValidatorTeam(teams, org), users)
}

export function resolveCoordinatorLead(
  teams: Team[],
  users: User[],
  org: OrgStructure,
): User | null {
  return resolveLeadOf(resolveCoordinatorTeam(teams, org), users)
}

// Diagnostic helper for the /admin/config team-mapping table: returns the
// teams that share a role with the resolved primary (i.e. the 2nd+ entries).
// The admin UI surfaces these as a warning — workflows silently ignore them
// today; tenants should consolidate or merge them.
export function findDuplicateRoleTeams(teams: Team[], roleId: TeamRoleId): Team[] {
  const matches = teamsWithRole(teams, roleId)
  return matches.slice(1)
}

// Project-scoped role lookup. Phase 2a's workflow engine resolves
// `team_role` actors against the teams attached to *this* project, not the
// tenant-wide pool — same logic StageBanner does today via
// `teams.filter(t => t.projectIds?.includes(project.id))`. Generic over the
// configured TeamRoleId so the evaluator can dispatch on actor.role.
export function resolveTeamOfRoleOn(
  role: TeamRoleId,
  project: Project,
  teams: Team[],
  org: OrgStructure,
): Team | null {
  const projectTeams = teams.filter((t) => t.projectIds?.includes(project.id))
  switch (role) {
    case 'coordinator':
      return resolveCoordinatorTeam(projectTeams, org)
    case 'validator':
      return resolveValidatorTeam(projectTeams, org)
    case 'specialist': {
      const matches = resolveSpecialistTeams(projectTeams, org)
      return matches[0] ?? null
    }
  }
}

export function resolveLeadOfRoleOn(
  role: TeamRoleId,
  project: Project,
  teams: Team[],
  org: OrgStructure,
): string | null {
  return resolveTeamOfRoleOn(role, project, teams, org)?.leadId ?? null
}
