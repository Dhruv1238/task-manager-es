/**
 * Hotel Management demo seed — clm-phase-2.
 *
 * Seeds the `hotel-management` workflow with 18 room projects across the full
 * lifecycle (available / assigned / servicing / checked_in / checked_out) plus a
 * room in maintenance and one out-of-service. Each serviced/occupied/turnover
 * room carries Housekeeping / Maintenance / Front Desk tasks for rich swimlane
 * boards; room custom fields (number, type, floor, guest, dates) are populated.
 *
 * Creates hotel teams (Housekeeping, Maintenance, Front Desk) + staff personas.
 * The workflow doc + Front Desk/Housekeeping roles already exist in clm-phase-2.
 * Owner/creator = Rachet (super-admin). Re-runnable: deterministic ids
 * (`room-*`, `team-*`).
 *
 * REQUIRES rules temporarily open. After running, restore:
 *   firebase deploy --only firestore:rules
 *
 * Run:  node scripts/seedRooms.mjs        (live)
 *       node scripts/seedRooms.mjs --dry   (no writes)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initializeApp } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth'
import {
  getFirestore, collection, doc, getDoc, getDocs, query, where,
  writeBatch, setDoc, serverTimestamp, arrayUnion, Timestamp,
} from 'firebase/firestore'

const DRY = process.argv.includes('--dry')
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DEMO_PASSWORD = 'ShowRunner@2026'
const RECORDER_EMAIL = 'rachet.juneja1@eventstrat.ai'

function loadEnv(file) {
  const env = {}
  for (const line of readFileSync(join(ROOT, file), 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const i = t.indexOf('='); if (i === -1) continue
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return env
}
const env = loadEnv('.env')
const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID, storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: env.VITE_FIREBASE_APP_ID,
})
const db = getFirestore(app)
const auth = getAuth(app)
const NOW = Date.now()
const DAY = 86400000
const ago = (d) => Timestamp.fromMillis(NOW - d * DAY)

const NAMES = {
  rachet: 'Rachet Juneja',
  ritu: 'Ritu Malhotra', karan: 'Karan Singh', priya: 'Priya Das',
  lakshmi: 'Lakshmi Nair', ramesh: 'Ramesh Yadav', sunita: 'Sunita Devi',
  joseph: 'Joseph Mathew', imran: 'Imran Qureshi',
}
const EXISTING = { rachet: RECORDER_EMAIL }
const FRESH = {
  ritu: { email: 'ritu.malhotra@eventstrat.ai', roleIds: ['front-desk'] },
  karan: { email: 'karan.singh@eventstrat.ai', roleIds: ['front-desk'] },
  priya: { email: 'priya.das@eventstrat.ai', roleIds: ['front-desk'] },
  lakshmi: { email: 'lakshmi.nair@eventstrat.ai', roleIds: ['housekeeping'] },
  ramesh: { email: 'ramesh.yadav@eventstrat.ai', roleIds: ['housekeeping'] },
  sunita: { email: 'sunita.devi@eventstrat.ai', roleIds: ['housekeeping'] },
  joseph: { email: 'joseph.mathew@eventstrat.ai', roleIds: ['housekeeping'] },
  imran: { email: 'imran.qureshi@eventstrat.ai', roleIds: ['housekeeping'] },
}
const NEW_TEAMS = {
  front_desk: { id: 'team-front-desk', name: 'Front Desk', description: 'Front-desk agents who assign rooms, manage guest requests, and handle check-in / check-out.', leadKey: 'ritu', memberKeys: ['ritu', 'karan', 'priya'] },
  housekeeping: { id: 'team-housekeeping', name: 'Housekeeping', description: 'Housekeeping staff who service, clean, restock, and turn over rooms between guests.', leadKey: 'lakshmi', memberKeys: ['lakshmi', 'ramesh', 'sunita'] },
  maintenance: { id: 'team-maintenance', name: 'Maintenance', description: 'Maintenance and engineering staff handling repairs, fixtures, and room refurbishment.', leadKey: 'joseph', memberKeys: ['joseph', 'imran'] },
}
const HOTEL_TEAM_IDS = Object.values(NEW_TEAMS).map((t) => t.id)
const teamIdOf = (k) => NEW_TEAMS[k].id

const PATH = ['available', 'assigned', 'servicing', 'checked_in', 'checked_out']
const FD = ['ritu', 'karan', 'priya']
const HK = ['lakshmi', 'ramesh', 'sunita']

function buildHistory(room, uid, recorderUid, idx) {
  const stageIdx = PATH.indexOf(room.stage)
  const fd = uid[FD[idx % 3]]
  const hk = uid[HK[idx % 3]]
  const totalSteps = stageIdx + 1 + (room.closeAction ? 1 : 0)
  const gap = Math.max(1, Math.floor(room.daysAgoStart / Math.max(totalSteps, 2)))
  let day = room.daysAgoStart
  const history = []
  const stageEnteredAt = {}
  history.push({ kind: 'workflow_assignment', workflowId: 'hotel-management', assignedAt: ago(day), assignedBy: recorderUid })
  const push = (stageId, actionId, by, payload) => {
    const at = ago(day)
    const ev = { kind: 'stage', stageId, enteredAt: at, enteredBy: by || recorderUid, payload: payload || null }
    if (actionId) ev.actionId = actionId
    history.push(ev); stageEnteredAt[stageId] = at; day = Math.max(1, day - gap)
  }
  push('available', null, recorderUid, null)
  if (stageIdx >= 1) push('assigned', 'assign', fd, {
    guestName: room.current_guest || 'Guest',
    ...(room.check_in ? { checkIn: room.check_in } : {}),
    ...(room.check_out ? { checkOut: room.check_out } : {}),
    bookingRef: `BK-${room.room_number}-26`,
  })
  if (stageIdx >= 2) push('servicing', 'to_servicing', hk, { prepNote: 'Room queued for servicing ahead of the guest.' })
  if (stageIdx >= 3) push('checked_in', 'serviced', hk, { serviceNote: 'Room serviced, inspected, and guest checked in.' })
  if (stageIdx >= 4) push('checked_out', 'check_out', fd, { checkoutNote: 'Guest checked out; room released for turnover.' })
  if (room.closeAction) push(room.stage, room.closeAction.id, fd, room.closeAction.payload)
  return { history, stageEnteredAt }
}

function makeBatcher() {
  let batch = writeBatch(db), n = 0, committed = 0
  return {
    set(ref, data) { if (!DRY) { batch.set(ref, data); n++ } return this.maybe() },
    update(ref, data) { if (!DRY) { batch.update(ref, data); n++ } return this.maybe() },
    delete(ref) { if (!DRY) { batch.delete(ref); n++ } return this.maybe() },
    async maybe() { if (n >= 400) { await batch.commit(); committed += n; batch = writeBatch(db); n = 0 } },
    async flush() { if (n > 0 && !DRY) { await batch.commit(); committed += n; n = 0 } return committed },
  }
}

async function main() {
  const data = JSON.parse(readFileSync(join(__dirname, 'seed-rooms.json'), 'utf8'))
  console.log(`Hotel Management seed → ${env.VITE_FIREBASE_PROJECT_ID}${DRY ? '  (DRY RUN)' : ''}`)
  console.log('─'.repeat(64))

  const usersSnap = await getDocs(collection(db, 'users'))
  const emailToUid = {}
  usersSnap.forEach((d) => { const e = d.data().email; if (e) emailToUid[e.toLowerCase()] = d.id })

  const uid = {}
  for (const [key, email] of Object.entries(EXISTING)) {
    const u = emailToUid[email.toLowerCase()]
    if (!u) throw new Error(`Expected existing user not found: ${key} <${email}>`)
    uid[key] = u
  }
  const memberTeam = {}
  for (const def of Object.values(NEW_TEAMS)) for (const mk of def.memberKeys) memberTeam[mk] = def.id

  const created = []
  for (const [key, def] of Object.entries(FRESH)) {
    const ex = emailToUid[def.email.toLowerCase()]
    if (ex) { uid[key] = ex }
    else if (DRY) { uid[key] = `dry-${key}`; created.push(key); continue }
    else {
      try { const cred = await createUserWithEmailAndPassword(auth, def.email, DEMO_PASSWORD); uid[key] = cred.user.uid; created.push(key) }
      catch (e) { if (e.code === 'auth/email-already-in-use') throw new Error(`${def.email} exists in Auth but has no users/ doc — resolve manually.`); throw e }
    }
    if (!DRY) await setDoc(doc(db, 'users', uid[key]), {
      uid: uid[key], email: def.email, displayName: NAMES[key], displayNameLower: NAMES[key].toLowerCase(),
      globalRole: 'user', roleIds: def.roleIds, teamIds: memberTeam[key] ? [memberTeam[key]] : [],
      createdBy: uid.rachet, createdAt: serverTimestamp(),
    }, { merge: true })
  }
  console.log(`Personas: ${Object.keys(EXISTING).length} reused, ${created.length} fresh hotel staff.`)

  const b = makeBatcher()
  for (const def of Object.values(NEW_TEAMS)) {
    b.set(doc(db, 'teams', def.id), {
      name: def.name, description: def.description,
      leadId: uid[def.leadKey], memberIds: def.memberKeys.map((k) => uid[k]),
      projectIds: [], teamRoleId: null, workTypes: [],
      createdBy: uid.rachet, createdAt: serverTimestamp(),
    })
    await b.maybe()
  }

  const wfSnap = await getDoc(doc(db, 'workflows', 'hotel-management'))
  if (!wfSnap.exists()) throw new Error('workflows/hotel-management missing')
  const pinnedWorkflow = { ...wfSnap.data(), id: 'hotel-management' }

  const summary = []
  let idx = 0
  for (const room of data.rooms) {
    const pid = `room-${room.key}`
    const { history, stageEnteredAt } = buildHistory(room, uid, uid.rachet, idx)
    const teamIds = [...new Set(room.tasks.map((t) => teamIdOf(t.teamKey)))]
    const accessKeys = [...new Set([uid.rachet, ...HOTEL_TEAM_IDS, ...teamIds])]
    const fields = {}
    for (const f of ['room_number', 'room_type', 'floor', 'current_guest', 'check_in', 'check_out']) {
      if (room[f]) fields[f] = room[f]
    }
    const statusNote = room.statusNote || (room.closeAction ? room.closeAction.payload.reason : null)
    const createdMs = NOW - room.daysAgoStart * DAY

    b.set(doc(db, 'projects', pid), {
      title: room.title, titleLower: room.title.trim().toLowerCase(), description: room.description,
      createdBy: uid.rachet, status: room.status,
      teamIds, accessKeys, attachments: [],
      roleAssignments: {}, fields,
      workflowId: 'hotel-management', pinnedWorkflow,
      currentStageId: room.stage,
      leadUid: null, iterationCount: 0, escalationCount: 0,
      projectHistory: history, stageEnteredAt,
      ...(statusNote ? { statusNote } : {}),
      seedTag: 'show-runner-demo-hotel',
      createdAt: Timestamp.fromMillis(createdMs), updatedAt: Timestamp.now(),
    })
    await b.maybe()
    for (const tid of teamIds) { b.update(doc(db, 'teams', tid), { projectIds: arrayUnion(pid) }); await b.maybe() }

    if (!DRY) {
      const prior = await getDocs(query(collection(db, 'tasks'), where('projectId', '==', pid)))
      for (const d of prior.docs) { b.delete(doc(db, 'tasks', d.id)); await b.maybe() }
    }
    let i = 0
    for (const task of room.tasks) {
      const tid = `${pid}-t${i++}`
      const isReview = task.status === 'in_review'
      const isDone = task.status === 'done'
      const due = ago(-task.dueOffsetDays)
      b.set(doc(db, 'tasks', tid), {
        projectId: pid, teamId: teamIdOf(task.teamKey), parentTaskId: null,
        title: task.title, description: task.description || '',
        assigneeId: uid[task.assigneeKey], assigneeName: NAMES[task.assigneeKey],
        status: task.status, priority: task.priority, dueDate: due,
        teamName: NEW_TEAMS[task.teamKey].name, projectTitle: room.title,
        subtaskCount: 0, subtaskDoneCount: 0, attachments: [],
        reviewerId: isReview && task.reviewerKey ? uid[task.reviewerKey] : null,
        ...(isReview && task.reviewerKey ? { reviewerName: NAMES[task.reviewerKey] } : {}),
        createdBy: uid.rachet,
        createdAt: Timestamp.fromMillis(createdMs + Math.floor(DAY / 2)),
        updatedAt: ago(0),
        ...(isDone ? { completedAt: due } : {}),
      })
      await b.maybe()
    }
    summary.push(`  ${pid.padEnd(14)} ${room.stage.padEnd(12)} ${room.status.padEnd(14)} teams:${teamIds.length} tasks:${room.tasks.length}`)
    idx++
  }

  const committed = await b.flush()

  const cred = [
    'Show Runner — Hotel Management demo personas (clm-phase-2)',
    `Shared password: ${DEMO_PASSWORD}   (recorder: ${RECORDER_EMAIL})`,
    '',
    'Hotel staff (created by this seed):',
    ...Object.entries(FRESH).map(([k, d]) => `  ${NAMES[k].padEnd(16)} ${d.email.padEnd(34)} roles:${d.roleIds.join(',')}  uid:${uid[k]}`),
    '',
    'Teams: Front Desk, Housekeeping, Maintenance (new).',
  ].join('\n')
  if (!DRY) writeFileSync(join(__dirname, 'hotel-credentials.txt'), cred + '\n')

  console.log('\nRooms seeded:')
  summary.forEach((s) => console.log(s))
  console.log(`\nFresh hotel staff: ${created.length ? created.join(', ') : '(none — all existed)'}`)
  console.log(`Firestore ops committed: ${committed}${DRY ? ' (DRY — nothing written)' : ''}`)
  if (!DRY) console.log('Credentials → scripts/hotel-credentials.txt')
  console.log('\nDONE. Remember to restore rules:  firebase deploy --only firestore:rules')
  process.exit(0)
}
main().catch((e) => { console.error('SEED FAILED:', e); process.exit(1) })
