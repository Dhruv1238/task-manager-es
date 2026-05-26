import { useEffect, useMemo, useState } from 'react'
import {  onSnapshot } from 'firebase/firestore'
import { tenantDoc } from '../lib/firestore'
import { useAuth } from '../contexts/AuthContext'
import type { Task, Team } from '../types/models'

export interface TaskPermissions {
  isAssignee: boolean
  isReviewer: boolean
  isTeamLead: boolean
  canSubmitForReview: boolean
  canDecideReview: boolean
  loading: boolean
}

// Permissions for task-level review actions (delta §6.6).
// canSubmitForReview — assignee or team lead, on a non-done task.
// canDecideReview    — I am task.reviewerId, OR a team lead override.
export function useTaskPermissions(task: Task | null | undefined): TaskPermissions {
  const { profile } = useAuth()
  const [team, setTeam] = useState<Team | null>(null)
  const [loading, setLoading] = useState<boolean>(Boolean(task?.teamId))

  useEffect(() => {
    if (!task?.teamId) {
      setTeam(null)
      setLoading(false)
      return
    }
    setLoading(true)
    return onSnapshot(tenantDoc('teams', task.teamId), (snap) => {
      setTeam(snap.exists() ? ({ id: snap.id, ...snap.data() } as Team) : null)
      setLoading(false)
    })
  }, [task?.teamId])

  return useMemo<TaskPermissions>(() => {
    const uid = profile?.uid ?? null
    const isAssignee = Boolean(uid && task && task.assigneeId === uid)
    const isReviewer = Boolean(uid && task && task.reviewerId === uid)
    const isTeamLead = Boolean(uid && team && team.leadId === uid)

    const canSubmitForReview = Boolean(
      task && task.status !== 'done' && (isAssignee || isTeamLead),
    )
    const canDecideReview = Boolean(
      task && task.status === 'in_review' && (isReviewer || isTeamLead),
    )

    return {
      isAssignee,
      isReviewer,
      isTeamLead,
      canSubmitForReview,
      canDecideReview,
      loading,
    }
  }, [profile, task, team, loading])
}
