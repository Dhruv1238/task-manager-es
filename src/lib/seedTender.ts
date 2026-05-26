/**
 * Seeds the tender workspace with the 5 horizontal/department teams plus the
 * `/config/taskTemplates` doc that drives Flow 17's template picker.
 *
 * Idempotent: if a team with the same name already exists, it's reused. The
 * config doc is overwritten with the latest team IDs every run, so adjusting
 * leadership is a re-seed away.
 *
 * Run from the super admin's "+ Seed tender workspace" button (delta §8).
 */
import {
  addDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import { tenantCol, tenantDoc } from './firestore'
import type { Team, TaskTemplate, WorkType } from '../types/models'

interface SeedTeamSpec {
  name: string
  description: string
  kind: 'department' | 'horizontal'
  workType?: WorkType
}

const SEED_TEAMS: SeedTeamSpec[] = [
  {
    name: 'Client Servicing — Marcom',
    description: 'Handles client communication, briefs, and end-to-end project delivery.',
    kind: 'department',
  },
  {
    name: 'Copy & Strategy',
    description: 'Develops copy, messaging, and creative strategy for every project.',
    kind: 'department',
  },
  {
    name: '2D Graphic Design',
    description: 'Designs static 2D visuals — social posts, decks, posters, and print collateral.',
    kind: 'horizontal',
    workType: '2D',
  },
  {
    name: '2D & 3D Events',
    description: 'Designs event stages, booth layouts, and 3D visuals for live activations.',
    kind: 'horizontal',
    workType: '3D',
  },
  {
    name: 'Video Editing',
    description: 'Produces video edits, motion graphics, and AV content for campaigns.',
    kind: 'horizontal',
    workType: 'VE',
  },
]

const TEMPLATE_BY_WORKTYPE: Record<WorkType, { label: string; teamName: string; defaultTitle: string }> = {
  '2D': { label: '2D — Graphic Design', teamName: '2D Graphic Design', defaultTitle: '2D deliverables' },
  '3D': { label: '3D — Events 2D & 3D', teamName: '2D & 3D Events', defaultTitle: '3D deliverables' },
  VE: { label: 'VE — Video Editing', teamName: 'Video Editing', defaultTitle: 'Video edit deliverables' },
  CS: { label: 'CS — Client Servicing', teamName: 'Client Servicing — Marcom', defaultTitle: 'Client servicing deliverables' },
  CT: { label: 'CT — Copy & Strategy', teamName: 'Copy & Strategy', defaultTitle: 'Copy & strategy deliverables' },
}

export interface SeedResult {
  teamsCreated: number
  teamsReused: number
  templatesWritten: number
}

export interface SeedTenderOptions {
  // When true, new teams are created with no lead and no members. Lets the
  // super admin re-seed an empty roster for client hand-off without forcing
  // their own UID onto every team.
  noMembers?: boolean
}

export async function seedTenderWorkspace(
  adminUid: string,
  options: SeedTenderOptions = {},
): Promise<SeedResult> {
  let teamsCreated = 0
  let teamsReused = 0

  const teamIdByName = new Map<string, string>()

  for (const spec of SEED_TEAMS) {
    const existingSnap = await getDocs(
      query(tenantCol('teams'), where('name', '==', spec.name)),
    )
    if (!existingSnap.empty) {
      const teamDoc = existingSnap.docs[0]
      teamIdByName.set(spec.name, teamDoc.id)
      teamsReused += 1
      continue
    }

    const ref = await addDoc(tenantCol('teams'), {
      name: spec.name,
      description: spec.description,
      leadId: options.noMembers ? '' : adminUid,
      memberIds: options.noMembers ? [] : [adminUid],
      projectIds: [],
      kind: spec.kind,
      ...(spec.workType ? { workType: spec.workType } : {}),
      createdAt: serverTimestamp(),
      createdBy: adminUid,
    } satisfies Omit<Team, 'id' | 'createdAt'> & { createdAt: ReturnType<typeof serverTimestamp> })
    teamIdByName.set(spec.name, ref.id)
    teamsCreated += 1
  }

  const templates: TaskTemplate[] = (Object.keys(TEMPLATE_BY_WORKTYPE) as WorkType[]).map((code) => {
    const tpl = TEMPLATE_BY_WORKTYPE[code]
    const teamId = teamIdByName.get(tpl.teamName)
    if (!teamId) {
      throw new Error(`Could not find team "${tpl.teamName}" while seeding template "${code}"`)
    }
    return { code, label: tpl.label, teamId, defaultTitle: tpl.defaultTitle }
  })

  await setDoc(tenantDoc('config', 'taskTemplates'), {
    templates,
    updatedAt: serverTimestamp(),
    updatedBy: adminUid,
  })

  return { teamsCreated, teamsReused, templatesWritten: templates.length }
}
