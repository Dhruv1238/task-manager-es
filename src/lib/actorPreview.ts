import { actorRefKey } from './actorRefs'
import type { ActorRef } from '../types/workflow'

// Phase 2d: symbolic actor matching for the editor's live preview rail. The
// preview answers "what would <archetype> see at this stage?" without a real
// Project/Team[]/User — so it reasons about ActorRef shapes, NOT runtime data.
// (Use workflowEvaluator.actorMatches for real gating; this is preview-only.)

// Does a chosen viewer archetype satisfy a single allowed ActorRef?
function archetypeSatisfies(viewer: ActorRef, target: ActorRef): boolean {
  if (actorRefKey(viewer) === actorRefKey(target)) return true
  // A team lead is also a team member, so a "<Team> Lead" viewer satisfies a
  // "any <Team> member" requirement on the same team.
  if (
    viewer.kind === 'team_role' &&
    target.kind === 'team_role' &&
    viewer.role === target.role &&
    viewer.member === 'lead' &&
    target.member === 'any'
  ) {
    return true
  }
  return false
}

// Would the viewer archetype be allowed to perform an action whose full actor
// set is `allowed` (= [actor, ...alsoAllow])? Super-admins always can (baseline).
export function previewMatches(viewer: ActorRef, allowed: ActorRef[]): boolean {
  if (viewer.kind === 'global_role' && viewer.role === 'super_admin') return true
  return allowed.some((a) => archetypeSatisfies(viewer, a))
}
