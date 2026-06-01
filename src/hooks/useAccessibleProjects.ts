import { useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useAllProjects } from './useAllProjects'
import type { Project } from '../types/models'

// Projects the current user is allowed to view:
// - super_admins / admins: every project
// - project leads: projects they're pinned as lead on, even if their teams
//   aren't attached yet
// - everyone else: projects whose denormalised `accessKeys` contains their uid
//   (role-holders ∪ creator) OR one of their team ids. Phase 2d: this mirrors
//   the server-side `array-contains-any [uid, ...teamIds]` query exactly.
//   Legacy projects whose accessKeys still encode [ownerId, ...teamIds] keep
//   working — uid matches the owner entry, so no backfill is needed.
export function useAccessibleProjects(): { projects: Project[]; loading: boolean } {
  const { profile } = useAuth()
  const { projects, loading } = useAllProjects()

  const scoped = useMemo(() => {
    if (!profile) return [] as Project[]
    if (profile.globalRole === 'admin' || profile.globalRole === 'super_admin') {
      return projects
    }
    const myKeys = new Set<string>([profile.uid, ...(profile.teamIds ?? [])])
    return projects.filter(
      (p) =>
        p.leadUid === profile.uid ||
        (p.accessKeys ?? []).some((k) => myKeys.has(k)) ||
        // Legacy safety: pre-2d docs that may lack accessKeys entirely.
        p.ownerId === profile.uid ||
        (p.teamIds ?? []).some((tid) => myKeys.has(tid)),
    )
  }, [projects, profile])

  return { projects: scoped, loading }
}
