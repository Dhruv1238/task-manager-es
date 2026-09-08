/**
 * Pure derivations behind the My Tasks surface (/me and /admin/member-tasks).
 *
 * Everything here works off arrays the hooks already streamed — no Firestore
 * reads, no re-queries. The tiles, charts and their drill-down panels all read
 * from the SAME array produced here, so a number and the list behind it can
 * never disagree (same doctrine as timeReport.ts).
 */

import type { Task } from '../types/models'
import { isTerminal } from './taskStatus'

export type ProjectBucket = {
  projectId: string
  projectTitle: string
  teams: Map<string, TeamBucket>
}
export type TeamBucket = {
  teamId: string
  teamName: string
  tasks: Task[]
}

export function groupByProjectTeam(tasks: Task[]): ProjectBucket[] {
  const projects = new Map<string, ProjectBucket>()
  for (const t of tasks) {
    let p = projects.get(t.projectId)
    if (!p) {
      p = {
        projectId: t.projectId,
        projectTitle: t.projectTitle ?? '(Untitled project)',
        teams: new Map(),
      }
      projects.set(t.projectId, p)
    }
    let tm = p.teams.get(t.teamId)
    if (!tm) {
      tm = {
        teamId: t.teamId,
        teamName: t.teamName ?? '(Untitled team)',
        tasks: [],
      }
      p.teams.set(t.teamId, tm)
    }
    tm.tasks.push(t)
  }
  return Array.from(projects.values())
}

/**
 * Concatenates task lists, keeping the FIRST occurrence of each id.
 *
 * The two /me streams overlap: a task on a team you lead that is also assigned
 * to you arrives from both useMyTasks and useMyLedTeamTasks. Before this, the
 * charts and the overdue number counted it twice.
 */
export function mergeUniqueById(...lists: Task[][]): Task[] {
  const seen = new Set<string>()
  const out: Task[] = []
  for (const list of lists) {
    for (const t of list) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      out.push(t)
    }
  }
  return out
}

/**
 * Past its due date and still live. Terminal (done/cancelled) is never overdue
 * however late it landed — status semantics stay in taskStatus.ts.
 * `nowMs` is injectable so callers can freeze the clock (tests, one shared
 * timestamp across a whole render).
 */
export function isOverdueTask(t: Task, nowMs: number = Date.now()): boolean {
  if (isTerminal(t.status)) return false
  if (!t.dueDate) return false
  return t.dueDate.toDate().getTime() < nowMs
}

export interface ProjectTaskCount {
  projectId: string
  projectTitle: string
  tasks: Task[]
}

export interface TasksByProjectOptions {
  limit?: number
  /**
   * Count finished work too. Off by default: a wrapped-up project would
   * otherwise top the chart forever. The /me surface turns it on with the
   * "Show completed" toggle, so the chart matches the lists beside it.
   */
  includeCompleted?: boolean
}

/**
 * Work per project, biggest pile first — answers "which project is all this
 * on". Open-only unless told otherwise; the result is capped so the bar chart
 * stays readable, and each row carries its own tasks for the drill-down.
 */
export function tasksByProject(
  tasks: Task[],
  { limit = 8, includeCompleted = false }: TasksByProjectOptions = {},
): ProjectTaskCount[] {
  const byProject = new Map<string, ProjectTaskCount>()
  for (const t of tasks) {
    if (!includeCompleted && isTerminal(t.status)) continue
    let row = byProject.get(t.projectId)
    if (!row) {
      row = {
        projectId: t.projectId,
        projectTitle: t.projectTitle ?? '(Untitled project)',
        tasks: [],
      }
      byProject.set(t.projectId, row)
    }
    row.tasks.push(t)
  }
  return Array.from(byProject.values())
    .sort((a, b) => b.tasks.length - a.tasks.length || a.projectTitle.localeCompare(b.projectTitle))
    .slice(0, limit)
}
