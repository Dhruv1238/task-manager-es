/**
 * Exhibitor Sales demo seed — clm-phase-2.
 *
 * Seeds the `exhibitor-sales` workflow with a full funnel of 14 exhibitor
 * projects across all 8 stages (incl. closed: won/lost/churned/disqualified),
 * each with realistic custom fields and stage-appropriate tasks for rich
 * per-project swimlane boards.
 *
 * Creates a sales org (Sales, Finance, Exhibitor Servicing teams + personas) and
 * reuses the existing Events Design / Graphic Design teams for booth build/branding.
 * Owner/creator = Rachet (the super-admin recorder). Re-runnable: deterministic
 * ids (`exh-*`, `team-*`); member/team writes use arrayUnion / merge.
 *
 * REQUIRES rules temporarily open. After running, restore:
 *   firebase deploy --only firestore:rules
 *
 * Run:  node scripts/seedExhibitors.mjs        (live)
 *       node scripts/seedExhibitors.mjs --dry   (no writes)
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
  nikhil: 'Nikhil Anand', rohit: 'Rohit Malhotra', sana: 'Sana Sheikh', vikram: 'Vikram Sethi',
  deepa: 'Deepa Rao', amit: 'Amit Bansal',
  neha: 'Neha Gupta', sahil: 'Sahil Kapoor', pooja: 'Pooja Hegde',
  karthik: 'Karthik Menon', ishaan: 'Ishaan Khanna', rohan: 'Rohan Verma', sneha: 'Sneha Pillai',
}
// existing users reused by email (the recorder + design-team members for booth tasks)
const EXISTING = {
  rachet: RECORDER_EMAIL,
  karthik: 'karthik.menon@eventstrat.ai', ishaan: 'ishaan.khanna@eventstrat.ai',
  rohan: 'rohan.verma@eventstrat.ai', sneha: 'sneha.pillai@eventstrat.ai',
}
// fresh sales-org personas → { email, roleIds }
const FRESH = {
  nikhil: { email: 'nikhil.anand@eventstrat.ai', roleIds: ['sales-manager'] },
  rohit: { email: 'rohit.malhotra@eventstrat.ai', roleIds: ['lead'] },
  sana: { email: 'sana.sheikh@eventstrat.ai', roleIds: ['lead'] },
  vikram: { email: 'vikram.sethi@eventstrat.ai', roleIds: ['lead'] },
  deepa: { email: 'deepa.rao@eventstrat.ai', roleIds: ['finance'] },
  amit: { email: 'amit.bansal@eventstrat.ai', roleIds: ['finance'] },
  neha: { email: 'neha.gupta@eventstrat.ai', roleIds: ['account-manager'] },
  sahil: { email: 'sahil.kapoor@eventstrat.ai', roleIds: ['operations'] },
  pooja: { email: 'pooja.hegde@eventstrat.ai', roleIds: ['account-manager'] },
}

// New sales-org teams (deterministic ids). teamRoleId left null — these aren't
// coordinator/validator/specialist; the workflow's finance/servicing team_role
// actions still resolve for the recorder via alsoAllow(super_admin).
const NEW_TEAMS = {
  sales: { id: 'team-sales', name: 'Sales', description: 'Account Executives and sales managers who work exhibitor leads from capture through booking.', leadKey: 'nikhil', memberKeys: ['nikhil', 'rohit', 'sana', 'vikram'] },
  finance: { id: 'team-finance', name: 'Finance', description: 'Verifies exhibitor payments, raises invoices, and clears bookings for fulfilment.', leadKey: 'deepa', memberKeys: ['deepa', 'amit'] },
  servicing: { id: 'team-exhibitor-servicing', name: 'Exhibitor Servicing', description: 'Onboards booked exhibitors, runs on-site servicing and upsell, and drives renewals.', leadKey: 'neha', memberKeys: ['neha', 'sahil', 'pooja'] },
}
// teamKey → existing team name (resolved at runtime to its id)
const REUSE_TEAMS = { events_design: 'Events Design', graphic_design: 'Graphic Design' }

const PATH = ['created', 'outreach', 'proposal', 'negotiation', 'booking', 'onboarding', 'servicing', 'post_event']

function buildHistory(exh, uid, recorderUid) {
  const stageIdx = PATH.indexOf(exh.stage)
  const ae = exh.aeKey ? uid[exh.aeKey] : null
  const am = exh.accountManagerKey ? uid[exh.accountManagerKey] : null
  const totalSteps = stageIdx + 1 + (exh.closeAction ? 1 : 0)
  const gap = Math.max(1, Math.floor(exh.daysAgoStart / Math.max(totalSteps, 2)))
  let day = exh.daysAgoStart
  const history = []
  const stageEnteredAt = {}
  history.push({ kind: 'workflow_assignment', workflowId: 'exhibitor-sales', assignedAt: ago(day), assignedBy: recorderUid })
  const push = (stageId, actionId, by, payload) => {
    const at = ago(day)
    const ev = { kind: 'stage', stageId, enteredAt: at, enteredBy: by || recorderUid, payload: payload || null }
    if (actionId) ev.actionId = actionId
    history.push(ev)
    stageEnteredAt[stageId] = at
    day = Math.max(1, day - gap)
  }
  push('created', null, recorderUid, null)
  if (stageIdx >= 1) push('outreach', 'assign', recorderUid, { leadUid: ae })
  if (stageIdx >= 2) push('proposal', 'interested', ae, { channel: 'Call', responseNote: 'Exhibitor interested — requested a proposal.' })
  if (stageIdx >= 3) push('negotiation', 'send_proposal', ae, { package: 'Premium / corner', proposedPrice: exh.expected_value })
  if (stageIdx >= 4) push('booking', 'accept', ae, { agreedPrice: exh.expected_value })
  if (stageIdx >= 5) push('onboarding', 'confirm_payment', uid.deepa || ae, { amountReceived: exh.expected_value })
  if (stageIdx >= 6) push('servicing', 'onboarding_complete', am || ae, { onboardingNote: 'Onboarding complete — handed to servicing.' })
  if (stageIdx >= 7) push('post_event', 'event_complete', am || ae, { servicingNote: 'Event completed — moving to wrap-up.' })
  if (exh.closeAction) push(exh.stage, exh.closeAction.id, ae || recorderUid, exh.closeAction.payload)
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
  const data = JSON.parse(readFileSync(join(__dirname, 'seed-exhibitors.json'), 'utf8'))
  console.log(`Exhibitor Sales seed → ${env.VITE_FIREBASE_PROJECT_ID}${DRY ? '  (DRY RUN)' : ''}`)
  console.log(`Show: ${data.show}`)
  console.log('─'.repeat(64))

  // 1. users
  const usersSnap = await getDocs(collection(db, 'users'))
  const emailToUid = {}
  usersSnap.forEach((d) => { const e = d.data().email; if (e) emailToUid[e.toLowerCase()] = d.id })

  const uid = {}
  for (const [key, email] of Object.entries(EXISTING)) {
    const u = emailToUid[email.toLowerCase()]
    if (!u) throw new Error(`Expected existing user not found: ${key} <${email}> — run seedDemo first (creates the design team + Rachet).`)
    uid[key] = u
  }

  // 2. teams (resolve reused; we create new ones below)
  const teamsSnap = await getDocs(collection(db, 'teams'))
  const nameToTeamId = {}
  teamsSnap.forEach((d) => { nameToTeamId[d.data().name] = d.id })
  const reuseTeamId = {}
  for (const [k, name] of Object.entries(REUSE_TEAMS)) {
    if (!nameToTeamId[name]) throw new Error(`Expected team "${name}" not found — run seedDemo first.`)
    reuseTeamId[k] = nameToTeamId[name]
  }
  // member key → team id (new sales teams) for teamIds backfill
  const memberTeam = {}
  for (const def of Object.values(NEW_TEAMS)) for (const mk of def.memberKeys) memberTeam[mk] = def.id

  // 3. fresh sales personas — create Auth + users/ doc immediately (durable)
  const created = []
  for (const [key, def] of Object.entries(FRESH)) {
    const ex = emailToUid[def.email.toLowerCase()]
    if (ex) { uid[key] = ex }
    else if (DRY) { uid[key] = `dry-${key}`; created.push(key); continue }
    else {
      try {
        const cred = await createUserWithEmailAndPassword(auth, def.email, DEMO_PASSWORD)
        uid[key] = cred.user.uid; created.push(key)
      } catch (e) {
        if (e.code === 'auth/email-already-in-use') throw new Error(`${def.email} exists in Auth but has no users/ doc — resolve manually.`)
        throw e
      }
    }
    if (!DRY) await setDoc(doc(db, 'users', uid[key]), {
      uid: uid[key], email: def.email, displayName: NAMES[key], displayNameLower: NAMES[key].toLowerCase(),
      globalRole: 'user', roleIds: def.roleIds, teamIds: memberTeam[key] ? [memberTeam[key]] : [],
      createdBy: uid.rachet, createdAt: serverTimestamp(),
    }, { merge: true })
  }
  console.log(`Personas: ${Object.keys(EXISTING).length} reused, ${created.length} fresh sales-org.`)

  const b = makeBatcher()

  // 4. create the new sales-org teams
  const teamIdOf = (teamKey) => NEW_TEAMS[teamKey]?.id ?? reuseTeamId[teamKey]
  for (const def of Object.values(NEW_TEAMS)) {
    b.set(doc(db, 'teams', def.id), {
      name: def.name, description: def.description,
      leadId: uid[def.leadKey], memberIds: def.memberKeys.map((k) => uid[k]),
      projectIds: [], teamRoleId: null, workTypes: [],
      createdBy: uid.rachet, createdAt: serverTimestamp(),
    })
    await b.maybe()
  }

  // 5. pin live exhibitor-sales workflow
  const wfSnap = await getDoc(doc(db, 'workflows', 'exhibitor-sales'))
  if (!wfSnap.exists()) throw new Error('workflows/exhibitor-sales missing')
  const pinnedWorkflow = { ...wfSnap.data(), id: 'exhibitor-sales' }

  // 6. projects + tasks
  const summary = []
  for (const exh of data.exhibitors) {
    const pid = `exh-${exh.key}`
    const leadUid = exh.aeKey ? uid[exh.aeKey] : null
    const { history, stageEnteredAt } = buildHistory(exh, uid, uid.rachet)

    const teamKeys = [...new Set(exh.tasks.map((t) => t.teamKey))]
    const teamIds = teamKeys.map(teamIdOf)

    const roleAssignments = {}
    if (exh.salesManagerKey) roleAssignments.sales_manager = uid[exh.salesManagerKey]
    if (exh.accountManagerKey) roleAssignments.account_manager = uid[exh.accountManagerKey]

    const accessKeys = [...new Set([uid.rachet, leadUid, ...Object.values(roleAssignments), ...teamIds].filter(Boolean))]

    const fields = {}
    for (const f of ['contact_person', 'contact_email', 'contact_phone', 'lead_source', 'expected_value']) {
      if (exh[f]) fields[f] = exh[f]
    }

    let statusNote
    if (exh.closeAction) {
      const p = exh.closeAction.payload || {}
      statusNote = p.lostReason || p.churnReason || p.renewalNote || p.outcomeNote || null
    }

    const createdMs = NOW - exh.daysAgoStart * DAY
    b.set(doc(db, 'projects', pid), {
      title: exh.company, titleLower: exh.company.trim().toLowerCase(), description: exh.description,
      createdBy: uid.rachet, status: exh.status,
      teamIds, accessKeys, attachments: [],
      roleAssignments, fields,
      workflowId: 'exhibitor-sales', pinnedWorkflow,
      currentStageId: exh.stage,
      leadUid,
      iterationCount: 0, escalationCount: 0,
      projectHistory: history, stageEnteredAt,
      ...(statusNote ? { statusNote } : {}),
      seedTag: 'show-runner-demo-exhibitors',
      createdAt: Timestamp.fromMillis(createdMs), updatedAt: Timestamp.now(),
    })
    await b.maybe()

    for (const tid of teamIds) { b.update(doc(db, 'teams', tid), { projectIds: arrayUnion(pid) }); await b.maybe() }

    if (!DRY) {
      const prior = await getDocs(query(collection(db, 'tasks'), where('projectId', '==', pid)))
      for (const d of prior.docs) { b.delete(doc(db, 'tasks', d.id)); await b.maybe() }
    }

    let i = 0
    for (const task of exh.tasks) {
      const tid = `${pid}-t${i++}`
      const isReview = task.status === 'in_review'
      const isDone = task.status === 'done'
      const due = ago(-task.dueOffsetDays)
      b.set(doc(db, 'tasks', tid), {
        projectId: pid, teamId: teamIdOf(task.teamKey), parentTaskId: null,
        title: task.title, description: task.description || '',
        assigneeId: uid[task.assigneeKey], assigneeName: NAMES[task.assigneeKey],
        status: task.status, priority: task.priority,
        dueDate: due,
        teamName: NEW_TEAMS[task.teamKey]?.name ?? REUSE_TEAMS[task.teamKey], projectTitle: exh.company,
        subtaskCount: 0, subtaskDoneCount: 0, attachments: [],
        reviewerId: isReview && task.reviewerKey ? uid[task.reviewerKey] : null,
        ...(isReview && task.reviewerKey ? { reviewerName: NAMES[task.reviewerKey] } : {}),
        createdBy: leadUid || uid.rachet,
        createdAt: Timestamp.fromMillis(createdMs + DAY),
        updatedAt: ago(1),
        ...(isDone ? { completedAt: due } : {}),
      })
      await b.maybe()
    }
    summary.push(`  ${pid.padEnd(16)} ${exh.stage.padEnd(12)} ${exh.status.padEnd(12)} teams:${teamIds.length} tasks:${exh.tasks.length}`)
  }

  const committed = await b.flush()

  // 7. credentials for the sales personas
  const cred = [
    'Show Runner — Exhibitor Sales demo personas (clm-phase-2)',
    `Shared password: ${DEMO_PASSWORD}   (recorder: ${RECORDER_EMAIL})`,
    '',
    'Sales org (created by this seed):',
    ...Object.entries(FRESH).map(([k, d]) => `  ${NAMES[k].padEnd(16)} ${d.email.padEnd(34)} roles:${d.roleIds.join(',')}  uid:${uid[k]}`),
    '',
    'Teams: Sales, Finance, Exhibitor Servicing (new) + Events Design, Graphic Design (reused for booth build).',
  ].join('\n')
  if (!DRY) writeFileSync(join(__dirname, 'exhibitor-credentials.txt'), cred + '\n')

  console.log('\nExhibitors seeded:')
  summary.forEach((s) => console.log(s))
  console.log(`\nFresh sales personas: ${created.length ? created.join(', ') : '(none — all existed)'}`)
  console.log(`Firestore ops committed: ${committed}${DRY ? ' (DRY — nothing written)' : ''}`)
  if (!DRY) console.log('Credentials → scripts/exhibitor-credentials.txt')
  console.log('\nDONE. Remember to restore rules:  firebase deploy --only firestore:rules')
  process.exit(0)
}
main().catch((e) => { console.error('SEED FAILED:', e); process.exit(1) })
