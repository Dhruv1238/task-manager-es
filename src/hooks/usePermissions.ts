import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'
import type { Project, Team } from '../types/models'

export interface Permissions {
  isAdmin: boolean
  isProjectOwner: boolean
  isTeamLead: boolean
  isTeamMember: boolean
  loading: boolean
}

export function usePermissions(projectId?: string, teamId?: string): Permissions {
  const { profile } = useAuth()
  const [project, setProject] = useState<Project | null>(null)
  const [team, setTeam] = useState<Team | null>(null)
  const [projectLoading, setProjectLoading] = useState<boolean>(Boolean(projectId))
  const [teamLoading, setTeamLoading] = useState<boolean>(Boolean(teamId))

  useEffect(() => {
    if (!projectId) {
      setProject(null)
      setProjectLoading(false)
      return
    }
    setProjectLoading(true)
    return onSnapshot(doc(db, 'projects', projectId), (snap) => {
      setProject(snap.exists() ? (snap.data() as Project) : null)
      setProjectLoading(false)
    })
  }, [projectId])

  useEffect(() => {
    if (!teamId) {
      setTeam(null)
      setTeamLoading(false)
      return
    }
    setTeamLoading(true)
    return onSnapshot(doc(db, 'teams', teamId), (snap) => {
      setTeam(snap.exists() ? (snap.data() as Team) : null)
      setTeamLoading(false)
    })
  }, [teamId])

  const uid = profile?.uid ?? null
  const isAdmin = profile?.globalRole === 'admin'
  const isProjectOwner = Boolean(uid && project && project.ownerId === uid)
  const isTeamLead = Boolean(uid && team && team.leadId === uid)
  const isTeamMember = Boolean(uid && team && team.memberIds.includes(uid))

  return {
    isAdmin,
    isProjectOwner,
    isTeamLead,
    isTeamMember,
    loading: projectLoading || teamLoading,
  }
}