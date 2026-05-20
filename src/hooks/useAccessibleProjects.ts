import { useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useAllProjects } from './useAllProjects'
import type { Project } from '../types/models'

// Projects the current user is allowed to view:
// - super_admins / admins: every project
// - project leads: projects they're pinned as lead on, even if their teams
//   aren't attached yet
// - regular users: projects they own OR where one of their teams is assigned
export function useAccessibleProjects(): { projects: Project[]; loading: boolean } {
  const { profile } = useAuth()
  const { projects, loading } = useAllProjects()

  const scoped = useMemo(() => {
    if (!profile) return [] as Project[]
    if (profile.globalRole === 'admin' || profile.globalRole === 'super_admin') {
      return projects
    }
    const myTeams = new Set(profile.teamIds ?? [])
    return projects.filter(
      (p) =>
        p.ownerId === profile.uid ||
        p.leadUid === profile.uid ||
        (p.teamIds ?? []).some((tid) => myTeams.has(tid)),
    )
  }, [projects, profile])

  return { projects: scoped, loading }
}
