import type { Task, Team, User } from '../types/models'

// Team-level tasks (assigneeId === null) have the team lead as their implicit
// owner — they're the one who delegates and is accountable. Subtasks have an
// explicit assignee. This helper resolves both cases.
export interface EffectiveAssignee {
  user: User
  implicit: boolean
}

export function getEffectiveAssignee(
  task: Task,
  users: Map<string, User>,
  teams: Map<string, Team>,
): EffectiveAssignee | null {
  if (task.assigneeId) {
    const u = users.get(task.assigneeId)
    return u ? { user: u, implicit: false } : null
  }
  const team = teams.get(task.teamId)
  if (!team) return null
  const lead = users.get(team.leadId)
  return lead ? { user: lead, implicit: true } : null
}