/**
 * Deterministic synthetic dataset for demoing the KPI Reports page (executive
 * preview). Generated IN MEMORY only — nothing is written to Firestore — and
 * fed through the exact same kpiCompute pipeline as real data, so the charts
 * behave identically. Seeded PRNG ⇒ the same story renders on every load:
 * cycle time falling, on-time and win rates rising, rework declining quarter
 * over quarter, and user adoption climbing.
 */
import type { AuditEvent, Project, Team, User } from '../../types/models'
import type { Timestamp } from 'firebase/firestore'

// Literal of seedCollabWorkflow's COLLAB_DEFAULT_WORKFLOW_ID — inlined so this
// module stays pure (importing the seed would pull the firebase init chain).
const COLLAB_WORKFLOW_ID = 'collab-default'

const DAY = 86_400_000

// Mulberry32 — tiny deterministic PRNG.
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// kpiCompute only reads .toMillis() off timestamps.
const ts = (ms: number) => ({ toMillis: () => ms }) as unknown as Timestamp

const TEAM_NAMES = ['Design Studio', 'AV & Production', 'Client Servicing', 'Fabrication']
// Per-team wait fraction (drives distinct flow-efficiency bars).
const TEAM_WAIT = [0.25, 0.35, 0.45, 0.55]

const FIRST_NAMES = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Sana', 'Vikram', 'Anika', 'Dev', 'Isha', 'Neel', 'Priya', 'Tara']

export interface KpiDemoData {
  projects: Project[]
  users: User[]
  teams: Team[]
  events: AuditEvent[]
}

export function buildKpiDemoData(nowMs: number): KpiDemoData {
  const rand = mulberry32(42)
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)]

  // Quarter starts, oldest → current (6 quarters).
  const now = new Date(nowMs)
  const qStarts: number[] = []
  for (let i = 5; i >= 0; i--) {
    const q = Math.floor(now.getMonth() / 3)
    qStarts.push(new Date(now.getFullYear(), q * 3 - i * 3, 1).getTime())
  }

  // Per-quarter story targets (oldest → newest).
  const CYCLE_DAYS = [38, 34, 31, 28, 26, 24]
  const ON_TIME = [0.55, 0.62, 0.68, 0.74, 0.8, 0.85]
  const WIN_RATE = [0.35, 0.38, 0.44, 0.47, 0.52, 0.55]
  const REWORK = [2.8, 2.4, 2.0, 1.6, 1.3, 1.1]
  const PROJECTS = [8, 9, 10, 11, 12, 10]
  const ACTIVE_HEADS = [6, 7, 8, 9, 10, 9]

  const teams: Team[] = TEAM_NAMES.map((name, i) => ({
    id: `demo-team-${i}`,
    name,
    leadId: `demo-user-${i}`,
    memberIds: [],
    projectIds: [],
    createdAt: ts(qStarts[0]),
    createdBy: 'demo-user-0',
  })) as unknown as Team[]

  const users: User[] = FIRST_NAMES.map((n, i) => ({
    uid: `demo-user-${i}`,
    email: `${n.toLowerCase()}@demo.example`,
    displayName: `${n} Kapoor`,
    globalRole: i === 0 ? 'super_admin' : 'user',
    teamIds: [`demo-team-${i % 4}`],
    createdAt: ts(qStarts[0]),
  })) as unknown as User[]

  const projects: Project[] = []
  const events: AuditEvent[] = []
  let auditSeq = 0
  const audit = (actorId: string, at: number) => {
    events.push({
      id: `demo-ev-${auditSeq++}`,
      actorId,
      actorName: actorId,
      action: 'project.action_performed',
      targetType: 'project',
      targetId: 'demo',
      createdAt: ts(at),
    } as unknown as AuditEvent)
  }

  qStarts.forEach((qStart, qi) => {
    const qLen = 90 * DAY
    // Distinct active actors this quarter (rising adoption).
    for (let h = 0; h < ACTIVE_HEADS[qi]; h++) {
      audit(`demo-user-${h}`, qStart + (0.2 + 0.6 * rand()) * qLen)
    }

    for (let n = 0; n < PROJECTS[qi]; n++) {
      const teamIdx = Math.floor(rand() * 4)
      const createdAt = qStart + rand() * qLen * 0.6
      const cycleDays = CYCLE_DAYS[qi] * (0.7 + 0.6 * rand())
      const wait = TEAM_WAIT[teamIdx] * (0.8 + 0.4 * rand())
      const waitFrontDays = cycleDays * wait * 0.6
      const holdDays = rand() < 0.18 ? 3 + rand() * 5 : 0
      const submitAt = createdAt + (cycleDays + holdDays) * DAY

      const history: unknown[] = [
        { kind: 'stage', stageId: 'created', enteredAt: ts(createdAt), enteredBy: 'demo-user-0', payload: null },
        { kind: 'stage', stageId: 'allocated', enteredAt: ts(createdAt + waitFrontDays * 0.5 * DAY), enteredBy: 'demo-user-0', payload: null },
        { kind: 'stage', stageId: 'eligibility_review', enteredAt: ts(createdAt + waitFrontDays * DAY), enteredBy: 'demo-user-1', payload: null },
        { kind: 'stage', stageId: 'task_setup', enteredAt: ts(createdAt + (waitFrontDays + 1) * DAY), enteredBy: 'demo-user-1', payload: null },
        { kind: 'stage', stageId: 'in_execution', enteredAt: ts(createdAt + (waitFrontDays + 2) * DAY), enteredBy: 'demo-user-2', payload: null },
        { kind: 'stage', stageId: 'lead_review', enteredAt: ts(submitAt - 3 * DAY), enteredBy: 'demo-user-1', payload: null },
        { kind: 'stage', stageId: 'delivered', enteredAt: ts(submitAt - 1 * DAY), enteredBy: 'demo-user-0', payload: null },
      ]
      if (holdDays > 0) {
        const holdStart = createdAt + (waitFrontDays + 4) * DAY
        history.push(
          { kind: 'stage', stageId: 'in_execution', enteredAt: ts(holdStart), enteredBy: 'demo-user-2', payload: { from: 'in_progress', to: 'on_hold', note: 'Awaiting client input' } },
          { kind: 'stage', stageId: 'in_execution', enteredAt: ts(holdStart + holdDays * DAY), enteredBy: 'demo-user-2', payload: { from: 'on_hold', to: 'in_progress', note: '' } },
        )
      }

      const pursued = rand() > 0.1
      let status = 'in_progress'
      if (pursued) {
        history.push({ kind: 'stage', stageId: 'delivered', enteredAt: ts(submitAt), enteredBy: 'demo-user-0', payload: { from: 'in_progress', to: 'submitted', note: '' } })
        status = 'submitted'
        const decidedAt = submitAt + (8 + rand() * 12) * DAY
        if (decidedAt < nowMs) {
          const won = rand() < WIN_RATE[qi]
          history.push({ kind: 'stage', stageId: 'delivered', enteredAt: ts(decidedAt), enteredBy: 'demo-user-0', payload: { from: 'submitted', to: won ? 'awarded' : 'lost', note: '' } })
          status = won ? 'awarded' : 'lost'
          if (won) {
            const completedAt = decidedAt + 30 * DAY
            if (completedAt < nowMs) {
              history.push({ kind: 'stage', stageId: 'delivered', enteredAt: ts(completedAt), enteredBy: 'demo-user-0', payload: { from: 'awarded', to: 'completed', note: '' } })
              status = 'completed'
            }
          }
        }
      } else {
        const droppedAt = createdAt + (waitFrontDays + 2) * DAY
        history.push({ kind: 'stage', stageId: 'eligibility_review', enteredAt: ts(droppedAt), enteredBy: 'demo-user-1', payload: { from: 'in_progress', to: 'not_submitted', note: 'Not eligible' } })
        status = 'not_submitted'
      }

      // Deadline set so ~ON_TIME[qi] of submissions land on time.
      const onTime = rand() < ON_TIME[qi]
      const submissionDate = submitAt + (onTime ? 1 : -1) * (1 + rand() * 3) * DAY

      projects.push({
        id: `demo-p-${qi}-${n}`,
        title: `Demo tender ${qi + 1}.${n + 1}`,
        description: '',
        createdBy: 'demo-user-0',
        status,
        teamIds: rand() < 0.3 ? [`demo-team-${teamIdx}`, `demo-team-${(teamIdx + 1) % 4}`] : [`demo-team-${teamIdx}`],
        workflowId: COLLAB_WORKFLOW_ID,
        currentStageId: 'delivered',
        projectHistory: history,
        iterationCount: Math.max(0, Math.round(REWORK[qi] * (0.4 + 1.2 * rand()))),
        escalationCount: rand() < 0.2 ? 1 : 0,
        submissionDate: pursued ? ts(submissionDate) : undefined,
        createdAt: ts(createdAt),
        updatedAt: ts(nowMs),
        leadUid: pick(users.slice(0, 4)).uid,
      } as unknown as Project)
    }
  })

  // Current-month activity for the users tile + active-users trend.
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const monthSpan = Math.max(DAY, nowMs - monthStart)
  for (let h = 0; h < 9; h++) audit(`demo-user-${h}`, monthStart + rand() * monthSpan)

  return { projects, users, teams, events }
}
