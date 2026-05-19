import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from './firebase'
import type { Team, TeamRoleId } from '../types/models'

export interface GenericSeedTeam {
  key: string
  name: string
  description: string
  recommendedRoleId: TeamRoleId
  // Strings that align with WORK_TYPE_SUGGESTIONS in models.ts. The wizard
  // filters these against draft.workTypes before applying, so missing matches
  // simply drop out.
  recommendedWorkTypes: string[]
}

export const GENERIC_SEED_TEAMS: readonly GenericSeedTeam[] = [
  {
    key: 'client-servicing',
    name: 'Client Servicing',
    description: 'Handles client communication, briefs, and end-to-end project delivery.',
    recommendedRoleId: 'coordinator',
    recommendedWorkTypes: [],
  },
  {
    key: 'copy-strategy',
    name: 'Copy & Strategy',
    description: 'Develops copy, messaging, and creative strategy for every project.',
    recommendedRoleId: 'validator',
    recommendedWorkTypes: [],
  },
  {
    key: 'graphic-design',
    name: 'Graphic Design',
    description: 'Designs static 2D visuals — social posts, decks, posters, and print collateral.',
    recommendedRoleId: 'specialist',
    recommendedWorkTypes: ['2D Design'],
  },
  {
    key: 'events-design',
    name: 'Events Design',
    description: 'Designs event stages, booth layouts, and 3D visuals for live activations.',
    recommendedRoleId: 'specialist',
    recommendedWorkTypes: ['3D Design', 'Set Design'],
  },
  {
    key: 'video-editing',
    name: 'Video Editing',
    description: 'Produces video edits, motion graphics, and AV content for campaigns.',
    recommendedRoleId: 'specialist',
    recommendedWorkTypes: ['Video Editing', 'Motion Graphics', 'AV'],
  },
]

export interface SeededTeam {
  teamId: string
  key: string
  name: string
  recommendedRoleId: TeamRoleId
  recommendedWorkTypes: string[]
  reused: boolean
}

// Creates the selected sample teams in Firestore with no lead and no members.
// The wizard's empty state expects the operator to assign a lead later from
// the team detail page. Reuses any pre-existing team with the same name so
// the helper is safe to call twice.
export async function seedSelectedGenericTeams(
  adminUid: string,
  selectedKeys: string[],
): Promise<SeededTeam[]> {
  const results: SeededTeam[] = []
  const selectedSpecs = GENERIC_SEED_TEAMS.filter((t) => selectedKeys.includes(t.key))

  for (const spec of selectedSpecs) {
    const existing = await getDocs(query(collection(db, 'teams'), where('name', '==', spec.name)))
    if (!existing.empty) {
      results.push({
        teamId: existing.docs[0].id,
        key: spec.key,
        name: spec.name,
        recommendedRoleId: spec.recommendedRoleId,
        recommendedWorkTypes: spec.recommendedWorkTypes,
        reused: true,
      })
      continue
    }

    const ref = await addDoc(collection(db, 'teams'), {
      name: spec.name,
      description: spec.description,
      leadId: '',
      memberIds: [],
      projectIds: [],
      createdAt: serverTimestamp(),
      createdBy: adminUid,
    } satisfies Omit<Team, 'id' | 'createdAt'> & { createdAt: ReturnType<typeof serverTimestamp> })

    results.push({
      teamId: ref.id,
      key: spec.key,
      name: spec.name,
      recommendedRoleId: spec.recommendedRoleId,
      recommendedWorkTypes: spec.recommendedWorkTypes,
      reused: false,
    })
  }

  return results
}

// Single-team create path for the wizard's manual flow. No lead, no members —
// the operator assigns them later. Returns the new team id so the caller can
// inject it into the wizard draft.
export async function createBareTeam(
  adminUid: string,
  name: string,
  description: string,
): Promise<string> {
  const ref = await addDoc(collection(db, 'teams'), {
    name: name.trim(),
    description: description.trim(),
    leadId: '',
    memberIds: [],
    projectIds: [],
    createdAt: serverTimestamp(),
    createdBy: adminUid,
  } satisfies Omit<Team, 'id' | 'createdAt'> & { createdAt: ReturnType<typeof serverTimestamp> })
  return ref.id
}
