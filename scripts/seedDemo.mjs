/**
 * Show Runner demo seed — clm-phase-2.
 *
 * Populates the existing (empty) teams with members, creates the fresh demo
 * personas, and seeds a rich set of Tender projects across every workflow stage
 * with realistic, assigned tasks — so kanban / analytics / history look full.
 *
 * Reconciliation ("Mix"): existing users are reused by email; existing teams are
 * reused by name; the live `workflows/tender` doc is pinned onto every project so
 * they render identically to app-created ones. Re-runnable: projects/tasks use
 * deterministic ids (`seed-*`) and member/team writes use arrayUnion.
 *
 * REQUIRES the Firestore rules to be temporarily open (allow all). After running,
 * restore secure rules:  firebase deploy --only firestore:rules
 *
 * Run:   node scripts/seedDemo.mjs           (live write)
 *        node scripts/seedDemo.mjs --dry      (no writes; prints plan)
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
const RECORDER_EMAIL = 'rachet.juneja1@eventstrat.ai' // super-admin account for the video recorder

function loadEnv(file) {
  const env = {}
  const raw = readFileSync(join(ROOT, file), 'utf8')
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return env
}
const env = loadEnv('.env')
const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
})
const db = getFirestore(app)
const auth = getAuth(app)

const NOW = Date.now()
const DAY = 86400000
const ago = (d) => Timestamp.fromMillis(NOW - d * DAY)
const ahead = (d) => Timestamp.fromMillis(NOW + d * DAY)

// ── People ───────────────────────────────────────────────────────────────────
// existing: matched by email against the live `users` collection (never recreated,
// roleIds left untouched). fresh: created in Auth + `users` if absent.
const NAMES = {
  rachet: 'Rachet Juneja',
  dhruv: 'Dhruv Sharma', anirudha: 'Anirudha Sisodia', sarvesh: 'Sarvesh Kumar',
  harsh: 'Harsh Pandey', alex: 'Alex Morgan', manan: 'Manan Kabra',
  videsh: 'Videsh Malik', devin: 'Devin Gulati',
  meera: 'Meera Iyer', arjun: 'Arjun Shah', kavya: 'Kavya Reddy',
  ananya: 'Ananya Bose', rhea: 'Rhea Kulkarni', rohan: 'Rohan Verma',
  sneha: 'Sneha Pillai', karthik: 'Karthik Menon', ishaan: 'Ishaan Khanna',
  tara: 'Tara Singh', aditya: 'Aditya Joshi',
}
const EXISTING = {
  dhruv: 'dhruv.sharma1@eventstrat.ai',
  anirudha: 'anirudha.sisodia@eventstrat.ai',
  sarvesh: 'sarvesh@eventstrat.ai',
  harsh: 'harsh.pandey1@eventstrat.ai',
  alex: 'alex@company.com',
  manan: 'manan.kabra1@eventstrat.ai',
  videsh: 'videsh.malik1@eventstrat.ai',
  devin: 'devin.gulati1@eventstrat.ai',
}
// fresh personas → { email, roleIds }
const FRESH = {
  meera: { email: 'meera.iyer@eventstrat.ai', roleIds: ['coordinator'] },
  arjun: { email: 'arjun.shah@eventstrat.ai', roleIds: ['coordinator'] },
  kavya: { email: 'kavya.reddy@eventstrat.ai', roleIds: ['coordinator'] },
  ananya: { email: 'ananya.bose@eventstrat.ai', roleIds: ['validator'] },
  rhea: { email: 'rhea.kulkarni@eventstrat.ai', roleIds: ['validator'] },
  rohan: { email: 'rohan.verma@eventstrat.ai', roleIds: ['specialist'] },
  sneha: { email: 'sneha.pillai@eventstrat.ai', roleIds: ['specialist'] },
  karthik: { email: 'karthik.menon@eventstrat.ai', roleIds: ['specialist'] },
  ishaan: { email: 'ishaan.khanna@eventstrat.ai', roleIds: ['specialist'] },
  tara: { email: 'tara.singh@eventstrat.ai', roleIds: ['specialist'] },
  aditya: { email: 'aditya.joshi@eventstrat.ai', roleIds: ['specialist'] },
}

// ── Teams (matched by name to the existing empty team docs) ───────────────────
const TEAM_DEFS = {
  client_servicing: { name: 'Client Servicing', teamRoleId: 'coordinator', workTypes: [], leadKey: 'meera', memberKeys: ['meera', 'arjun', 'kavya'] },
  copy_strategy: { name: 'Copy & Strategy', teamRoleId: 'validator', workTypes: [], leadKey: 'ananya', memberKeys: ['ananya', 'rhea'] },
  graphic_design: { name: 'Graphic Design', teamRoleId: 'specialist', workTypes: ['2D Design'], leadKey: 'rohan', memberKeys: ['rohan', 'sneha', 'manan'] },
  events_design: { name: 'Events Design', teamRoleId: 'specialist', workTypes: ['3D Design'], leadKey: 'karthik', memberKeys: ['karthik', 'ishaan', 'videsh'] },
  video_editing: { name: 'Video Editing', teamRoleId: 'specialist', workTypes: ['Video Editing'], leadKey: 'tara', memberKeys: ['tara', 'aditya', 'devin'] },
}

// ── Tenders (structure; content/tasks come from scripts/seed-content.json) ─────
const TENDER_NAMES = {
  gulfood: 'Gulfood 2026 — India Pavilion Design & Build, Dubai',
  g20: 'Bharat Mandapam — G20 Legacy Exhibition, New Delhi',
  autoexpo: 'Auto Expo 2026 — OEM Pavilion Fabrication, Greater Noida',
  repday: 'Republic Day 2026 — Ministry of Culture Tableau',
  mahakumbh: 'Startup Mahakumbh 2026 — Stage & Experience Design',
  smartcity: 'Smart City Mission — 8-City Citizen Engagement Roadshow',
}
// journey step: [stageId, actionId|null, byKey, daysAgo, payload?]
const TENDERS = {
  gulfood: {
    stage: 'in_execution', status: 'in_progress', leadKey: 'anirudha', adminHeadKey: 'harsh', functionalKey: 'alex',
    dates: { submissionDate: ahead(5), presentationDate: ahead(12), deadline: ahead(20) },
    journey: [
      ['created', null, 'rachet', 25, null],
      ['allocated', 'allocate', 'rachet', 24, { leadUid: 'anirudha' }],
      ['task_setup', 'allocated-ampydc2o5', 'anirudha', 22, { 'input-wbh4t': 'Eligibility cleared — moving to task setup.' }],
      ['in_execution', 'confirm_setup', 'anirudha', 20, null],
    ],
  },
  g20: {
    stage: 'lead_review', status: 'in_progress', leadKey: 'sarvesh', adminHeadKey: 'harsh', functionalKey: 'alex', iterationCount: 1,
    dates: { submissionDate: ago(10), presentationDate: ago(5), deadline: ahead(3) },
    journey: [
      ['created', null, 'rachet', 44, null],
      ['allocated', 'allocate', 'rachet', 43, { leadUid: 'sarvesh' }],
      ['task_setup', 'allocated-ampydc2o5', 'sarvesh', 41, null],
      ['in_execution', 'confirm_setup', 'sarvesh', 39, null],
      ['lead_review', 'sign_off', 'ananya', 32, null],
      ['in_execution', 'request_rework', 'sarvesh', 30, { feedback: 'Projection-mapping keystone distortion on the curved dome — re-survey & re-render.', priority: 'high' }],
      ['lead_review', 'sign_off', 'ananya', 24, null],
    ],
  },
  autoexpo: {
    stage: 'delivered', status: 'awarded', leadKey: 'anirudha', adminHeadKey: 'harsh', functionalKey: 'alex',
    statusNote: 'Tender awarded — LOI received from the OEM.',
    dates: { submissionDate: ago(50), presentationDate: ago(45), deadline: ago(40) },
    journey: [
      ['created', null, 'rachet', 66, null],
      ['allocated', 'allocate', 'rachet', 65, { leadUid: 'anirudha' }],
      ['task-mpyemjc2', 'accept', 'anirudha', 63, { eligibilityNote: 'Sent for eligibility assessment against OEM empanelment criteria.' }],
      ['allocated', 'task-mpyemjc2-ampyen45e', 'anirudha', 61, { 'input-hatzs': 'Eligible: OEM empanelment, turnover & past-experience criteria all met.' }],
      ['task_setup', 'allocated-ampydc2o5', 'anirudha', 59, null],
      ['in_execution', 'confirm_setup', 'anirudha', 57, null],
      ['lead_review', 'sign_off', 'anirudha', 52, null],
      ['delivered', 'approve', 'anirudha', 49, null],
      ['delivered', 'record_outcome', 'meera', 47, { status: 'awarded', note: 'Tender awarded — LOI received from the OEM.' }],
    ],
  },
  repday: {
    stage: 'delivered', status: 'submitted', leadKey: 'sarvesh', adminHeadKey: 'harsh', functionalKey: 'alex',
    statusNote: 'Final dossier submitted to the Ministry of Culture; awaiting selection.',
    dates: { submissionDate: ago(8), presentationDate: ago(20), deadline: ago(6) },
    journey: [
      ['created', null, 'rachet', 60, null],
      ['allocated', 'allocate', 'rachet', 59, { leadUid: 'sarvesh' }],
      ['task_setup', 'allocated-ampydc2o5', 'sarvesh', 57, null],
      ['in_execution', 'confirm_setup', 'sarvesh', 55, null],
      ['lead_review', 'sign_off', 'ananya', 48, null],
      ['delivered', 'approve', 'sarvesh', 44, null],
      ['delivered', 'record_outcome', 'sarvesh', 42, { status: 'submitted', note: 'Final dossier submitted to the Ministry of Culture; awaiting selection.' }],
    ],
  },
  mahakumbh: {
    stage: 'allocated', status: 'in_progress', leadKey: 'sarvesh', adminHeadKey: 'rachet', functionalKey: 'alex',
    dates: { submissionDate: ahead(15), presentationDate: ahead(25), deadline: ahead(30) },
    journey: [
      ['created', null, 'rachet', 6, null],
      ['allocated', 'allocate', 'rachet', 5, { leadUid: 'sarvesh' }],
    ],
  },
  smartcity: {
    stage: 'task_setup', status: 'in_progress', leadKey: 'anirudha', adminHeadKey: 'rachet', functionalKey: 'alex',
    dates: { submissionDate: ahead(10), presentationDate: ahead(18), deadline: ahead(24) },
    journey: [
      ['created', null, 'rachet', 9, null],
      ['allocated', 'allocate', 'rachet', 8, { leadUid: 'anirudha' }],
      ['task_setup', 'allocated-ampydc2o5', 'anirudha', 7, null],
    ],
  },
}

// WorkType enum codes → team key, for /config/taskTemplates.
const TEMPLATE_MAP = {
  CS: { teamKey: 'client_servicing', label: 'CS — Client Servicing', defaultTitle: 'Client servicing deliverables' },
  CT: { teamKey: 'copy_strategy', label: 'CT — Copy & Strategy', defaultTitle: 'Copy & strategy deliverables' },
  '2D': { teamKey: 'graphic_design', label: '2D — Graphic Design', defaultTitle: '2D deliverables' },
  '3D': { teamKey: 'events_design', label: '3D — Events Design', defaultTitle: '3D deliverables' },
  VE: { teamKey: 'video_editing', label: 'VE — Video Editing', defaultTitle: 'Video edit deliverables' },
}

// ── Batch runner (auto-flush at 400 ops) ──────────────────────────────────────
function makeBatcher() {
  let batch = writeBatch(db)
  let n = 0
  let committed = 0
  return {
    set(ref, data) { if (!DRY) { batch.set(ref, data); n++; } return this.maybe() },
    update(ref, data) { if (!DRY) { batch.update(ref, data); n++; } return this.maybe() },
    delete(ref) { if (!DRY) { batch.delete(ref); n++; } return this.maybe() },
    async maybe() { if (n >= 400) { await batch.commit(); committed += n; batch = writeBatch(db); n = 0 } },
    async flush() { if (n > 0 && !DRY) { await batch.commit(); committed += n; n = 0 } return committed },
  }
}

async function main() {
  const content = JSON.parse(readFileSync(join(__dirname, 'seed-content.json'), 'utf8'))
  const contentByKey = Object.fromEntries(content.map((t) => [t.key, t]))
  console.log(`Show Runner seed → ${env.VITE_FIREBASE_PROJECT_ID}${DRY ? '  (DRY RUN)' : ''}`)
  console.log('─'.repeat(64))

  // 1. Existing users by email
  const usersSnap = await getDocs(collection(db, 'users'))
  const emailToUid = {}
  usersSnap.forEach((d) => { const e = d.data().email; if (e) emailToUid[e.toLowerCase()] = d.id })
  console.log(`Found ${usersSnap.size} existing users.`)

  // 2. Teams (matched by name) + member→team map
  const teamsSnap = await getDocs(collection(db, 'teams'))
  const nameToTeamId = {}
  teamsSnap.forEach((d) => { nameToTeamId[d.data().name] = d.id })
  for (const def of Object.values(TEAM_DEFS)) {
    if (!nameToTeamId[def.name]) throw new Error(`Expected team not found by name: "${def.name}"`)
  }
  const teamIdOf = (teamKey) => nameToTeamId[TEAM_DEFS[teamKey].name]
  const memberTeam = {}
  for (const [tk, def] of Object.entries(TEAM_DEFS)) for (const mk of def.memberKeys) memberTeam[mk] = teamIdOf(tk)

  // 3. Resolve persona uids — existing reused; fresh created in Auth and their
  //    users/ doc written IMMEDIATELY (durable) so a later failure never orphans
  //    an Auth account or wedges a re-run.
  const uid = {}
  for (const [key, email] of Object.entries(EXISTING)) {
    const u = emailToUid[email.toLowerCase()]
    if (!u) throw new Error(`Expected existing user not found: ${key} <${email}>`)
    uid[key] = u
  }

  // Recorder super-admin — email+password account for the person recording the video
  // (the Dhruv account is Google-only and can't be shared). globalRole super_admin
  // + roleIds ['super-admin'] so the app treats Rachet as a full super admin.
  // Resolved BEFORE the persona loop because fresh user docs use uid.rachet as createdBy.
  {
    const ex = emailToUid[RECORDER_EMAIL.toLowerCase()]
    if (ex) uid.rachet = ex
    else if (DRY) uid.rachet = 'dry-rachet'
    else {
      try {
        const cred = await createUserWithEmailAndPassword(auth, RECORDER_EMAIL, DEMO_PASSWORD)
        uid.rachet = cred.user.uid
      } catch (e) {
        if (e.code === 'auth/email-already-in-use') throw new Error(`${RECORDER_EMAIL} exists in Auth but has no users/ doc — resolve manually.`)
        throw e
      }
    }
    if (!DRY) await setDoc(doc(db, 'users', uid.rachet), {
      uid: uid.rachet, email: RECORDER_EMAIL, displayName: NAMES.rachet, displayNameLower: NAMES.rachet.toLowerCase(),
      globalRole: 'super_admin', roleIds: ['super-admin'], teamIds: [],
      createdBy: uid.rachet, createdAt: serverTimestamp(),
    }, { merge: true })
    console.log(`Recorder super-admin: ${NAMES.rachet} <${RECORDER_EMAIL}> (${uid.rachet})`)
  }

  const created = []
  for (const [key, def] of Object.entries(FRESH)) {
    const existing = emailToUid[def.email.toLowerCase()]
    if (existing) { uid[key] = existing }
    else if (DRY) { uid[key] = `dry-${key}`; created.push(key); continue }
    else {
      try {
        const cred = await createUserWithEmailAndPassword(auth, def.email, DEMO_PASSWORD)
        uid[key] = cred.user.uid
        created.push(key)
      } catch (e) {
        if (e.code === 'auth/email-already-in-use') {
          throw new Error(`${def.email} exists in Auth but has no users/ doc — sign-in needed to recover its uid. Resolve manually.`)
        }
        throw e
      }
    }
    if (!DRY) {
      await setDoc(doc(db, 'users', uid[key]), {
        uid: uid[key], email: def.email, displayName: NAMES[key], displayNameLower: NAMES[key].toLowerCase(),
        globalRole: 'user', roleIds: def.roleIds, teamIds: memberTeam[key] ? [memberTeam[key]] : [],
        createdBy: uid.rachet, createdAt: serverTimestamp(),
      }, { merge: true })
    }
  }
  console.log(`Personas: ${Object.keys(EXISTING).length} reused, ${created.length} fresh.`)

  const b = makeBatcher()

  // existing members that join specialist teams → arrayUnion their teamId
  for (const mk of ['manan', 'videsh', 'devin']) {
    b.update(doc(db, 'users', uid[mk]), { teamIds: arrayUnion(memberTeam[mk]) })
    await b.maybe()
  }

  // 4. Populate teams (lead + members + role/workTypes)
  for (const [tk, def] of Object.entries(TEAM_DEFS)) {
    b.update(doc(db, 'teams', teamIdOf(tk)), {
      leadId: uid[def.leadKey],
      memberIds: arrayUnion(...def.memberKeys.map((k) => uid[k])),
      teamRoleId: def.teamRoleId,
      workTypes: def.workTypes,
    })
    await b.maybe()
  }

  // 5. Pin the live tender workflow
  const wfSnap = await getDoc(doc(db, 'workflows', 'tender'))
  if (!wfSnap.exists()) throw new Error('workflows/tender missing')
  const pinnedWorkflow = { ...wfSnap.data(), id: 'tender' }

  // 6. Projects + tasks
  const summary = []
  for (const [key, cfg] of Object.entries(TENDERS)) {
    const c = contentByKey[key]
    if (!c) throw new Error(`No content for tender ${key}`)
    const name = TENDER_NAMES[key]
    if (!name) throw new Error(`No display name for tender ${key}`)
    const pid = `seed-${key}`
    const leadUid = uid[cfg.leadKey]

    // history + stageEnteredAt
    const history = []
    const stageEnteredAt = {}
    const t0 = cfg.journey[0]
    history.push({ kind: 'workflow_assignment', workflowId: 'tender', assignedAt: ago(t0[3]), assignedBy: uid[t0[2]] })
    for (const [stageId, actionId, byKey, daysAgo, payload] of cfg.journey) {
      const at = ago(daysAgo)
      const ev = { kind: 'stage', stageId, enteredAt: at, enteredBy: uid[byKey], payload: payload ? mapPayload(payload, uid) : null }
      if (actionId) ev.actionId = actionId
      history.push(ev)
      stageEnteredAt[stageId] = at
    }

    // teams attached = distinct teams that have tasks
    const teamKeys = [...new Set(c.tasks.map((t) => t.teamKey))]
    const teamIds = teamKeys.map(teamIdOf)

    const roleAssignments = {}
    if (cfg.adminHeadKey) roleAssignments.admin_head = uid[cfg.adminHeadKey]
    if (cfg.functionalKey) roleAssignments.role_1 = uid[cfg.functionalKey]

    const accessKeys = [...new Set([
      uid.rachet, leadUid,
      ...Object.values(roleAssignments),
      ...teamIds,
    ].filter(Boolean))]

    const fields = {}
    if (c.leadCategory) fields.lead_category = c.leadCategory
    if (c.region) fields.field_1 = c.region === 'EAST' ? 'opt_1' : 'opt_2'

    const createdMs = NOW - cfg.journey[0][3] * DAY
    b.set(doc(db, 'projects', pid), {
      title: name, titleLower: name.trim().toLowerCase(), description: c.description,
      createdBy: uid.rachet, status: cfg.status,
      teamIds, accessKeys,
      attachments: [],
      roleAssignments, fields,
      workflowId: 'tender', pinnedWorkflow,
      currentStageId: cfg.stage,
      leadUid,
      iterationCount: cfg.iterationCount ?? 0, escalationCount: 0,
      projectHistory: history, stageEnteredAt,
      ...(cfg.statusNote ? { statusNote: cfg.statusNote } : {}),
      ...cfg.dates,
      seedTag: 'show-runner-demo',
      createdAt: Timestamp.fromMillis(createdMs), updatedAt: Timestamp.now(),
    })
    await b.maybe()

    // attach project to each team
    for (const tid of teamIds) { b.update(doc(db, 'teams', tid), { projectIds: arrayUnion(pid) }); await b.maybe() }

    // delete any prior seed tasks for this project, then write fresh
    if (!DRY) {
      const prior = await getDocs(query(collection(db, 'tasks'), where('projectId', '==', pid)))
      for (const d of prior.docs) { b.delete(doc(db, 'tasks', d.id)); await b.maybe() }
    }

    let i = 0
    for (const task of c.tasks) {
      const tid = `${pid}-t${i++}`
      const teamId = teamIdOf(task.teamKey)
      const assignee = uid[task.assigneeKey]
      const due = ago(-task.dueOffsetDays) // dueOffsetDays negative = past
      const isReview = task.status === 'in_review'
      const isDone = task.status === 'done'
      b.set(doc(db, 'tasks', tid), {
        projectId: pid, teamId, parentTaskId: null,
        title: task.title, description: task.description,
        assigneeId: assignee, assigneeName: NAMES[task.assigneeKey],
        status: task.status, priority: task.priority,
        dueDate: due,
        teamName: TEAM_DEFS[task.teamKey].name, projectTitle: name,
        subtaskCount: 0, subtaskDoneCount: 0, attachments: [],
        reviewerId: isReview && task.reviewerKey ? uid[task.reviewerKey] : null,
        ...(isReview && task.reviewerKey ? { reviewerName: NAMES[task.reviewerKey] } : {}),
        createdBy: leadUid,
        createdAt: Timestamp.fromMillis(createdMs + DAY),
        updatedAt: ago(2),
        ...(isDone ? { completedAt: due } : {}),
      })
      await b.maybe()
    }
    summary.push(`  ${pid.padEnd(16)} ${cfg.stage.padEnd(13)} ${cfg.status.padEnd(12)} teams:${teamIds.length} tasks:${c.tasks.length}`)
  }

  // 7. task templates (enables the add-task template picker)
  const templates = Object.entries(TEMPLATE_MAP).map(([code, m]) => ({
    code, label: m.label, teamId: teamIdOf(m.teamKey), defaultTitle: m.defaultTitle,
  }))
  b.set(doc(db, 'config', 'taskTemplates'), { templates, updatedAt: serverTimestamp(), updatedBy: uid.rachet })
  await b.maybe()

  const committed = await b.flush()

  // 8. credentials file
  const credLines = [
    'Show Runner demo — login credentials',
    `Generated for clm-phase-2. Shared password (recorder + FRESH personas): ${DEMO_PASSWORD}`,
    '',
    '★ RECORDER — log in here to record the video (SUPER ADMIN, email+password):',
    `  ${NAMES.rachet.padEnd(18)} ${RECORDER_EMAIL.padEnd(34)} password:${DEMO_PASSWORD}  uid:${uid.rachet}`,
    '',
    'FRESH personas (created by this seed):',
    ...Object.entries(FRESH).map(([k, d]) => `  ${NAMES[k].padEnd(18)} ${d.email.padEnd(34)} roles:${d.roleIds.join(',')}  uid:${uid[k]}`),
    '',
    'EXISTING people (reuse their own passwords; uids for reference):',
    ...Object.entries(EXISTING).map(([k, e]) => `  ${NAMES[k].padEnd(18)} ${e.padEnd(34)} uid:${uid[k]}`),
  ].join('\n')
  if (!DRY) writeFileSync(join(__dirname, 'demo-credentials.txt'), credLines + '\n')

  console.log('\nProjects seeded:')
  summary.forEach((s) => console.log(s))
  console.log(`\nFresh personas: ${created.length ? created.join(', ') : '(none — all already existed)'}`)
  console.log(`Firestore ops committed: ${committed}${DRY ? ' (DRY — nothing written)' : ''}`)
  if (!DRY) console.log('Credentials → scripts/demo-credentials.txt')
  console.log('\nDONE. Remember to restore rules:  firebase deploy --only firestore:rules')
  process.exit(0)
}

// map any payload value that is a persona key (leadUid) to its uid
function mapPayload(payload, uid) {
  const out = {}
  for (const [k, v] of Object.entries(payload)) {
    out[k] = k === 'leadUid' && uid[v] ? uid[v] : v
  }
  return out
}

main().catch((e) => { console.error('SEED FAILED:', e); process.exit(1) })
