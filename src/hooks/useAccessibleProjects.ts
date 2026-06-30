import { useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useAllProjects } from './useAllProjects'
import type { Project } from '../types/models'

// Projects the current user is allowed to view:
// - super_admins / admins: every project
// - project leads: projects they're pinned as lead on (also folded into
//   accessKeys, but kept as an explicit clause as a safety net)
// - everyone else: projects whose denormalised `accessKeys` contains their uid.
//   accessKeys is a flat set of user uids (creator ∪ lead ∪ project-role holders
//   ∪ hierarchy-role-actor holders ∪ attached-team leads ∪ task assignees).
//   Team membership alone is no longer an access vector. Mirrors the server-side
//   `array-contains <uid>` query.
// `ownerId` is retained as a transitional belt-and-suspenders for any legacy doc
// whose accessKeys predates the createdBy field; drop it once data is migrated.
export function useAccessibleProjects(): { projects: Project[]; loading: boolean } {
  const { profile } = useAuth()
  const { projects, loading } = useAllProjects()

  const scoped = useMemo(() => {
    if (!profile) return [] as Project[]
    if (profile.globalRole === 'admin' || profile.globalRole === 'super_admin') {
      return projects
    }
    return projects.filter(
      (p) =>
        p.leadUid === profile.uid ||
        (p.accessKeys ?? []).includes(profile.uid) ||
        // Legacy safety: pre-2d docs that may lack accessKeys entirely.
        p.ownerId === profile.uid,
    )
  }, [projects, profile])

  return { projects: scoped, loading }
}
