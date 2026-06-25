/**
 * READ-ONLY inspector for the clm-phase-2 Firestore.
 *
 * Connects with the web SDK using the config in `.env` and prints a summary of
 * the current state (users, teams, workflows, config docs, projects, tasks) so
 * we can ground the demo seed against reality — reuse existing members, avoid
 * duplicate teams, and pin the live Tender workflow.
 *
 * Run:  node scripts/inspectPhase2.mjs
 *
 * Requires Firestore read access. If rules are closed you'll see
 * "permission-denied" — that still confirms connectivity; open read access (or
 * the temporary allow-all window) and re-run.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initializeApp } from 'firebase/app'
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
} from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function loadEnv(file) {
  const env = {}
  try {
    const raw = readFileSync(join(ROOT, file), 'utf8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i === -1) continue
      env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
    }
  } catch {
    /* ignore */
  }
  return env
}

const env = loadEnv('.env')
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}

console.log('Project:', firebaseConfig.projectId)
console.log('Auth domain:', firebaseConfig.authDomain)
console.log('—'.repeat(60))

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

async function dumpCollection(name, pick) {
  try {
    const snap = await getDocs(collection(db, name))
    console.log(`\n### ${name}  (${snap.size} docs)`)
    snap.forEach((d) => {
      const data = d.data()
      console.log(`  - ${d.id}: ${JSON.stringify(pick ? pick(data) : data)}`)
    })
    return snap.size
  } catch (e) {
    console.log(`\n### ${name}  — ERROR: ${e.code || e.message}`)
    return -1
  }
}

async function dumpDoc(path) {
  try {
    const parts = path.split('/')
    const ref = doc(db, ...parts)
    const d = await getDoc(ref)
    console.log(`\n### ${path}  — ${d.exists() ? 'EXISTS' : 'MISSING'}`)
    if (d.exists()) console.log('  ', JSON.stringify(d.data()))
  } catch (e) {
    console.log(`\n### ${path}  — ERROR: ${e.code || e.message}`)
  }
}

async function main() {
  await dumpCollection('users', (u) => ({
    email: u.email,
    displayName: u.displayName,
    globalRole: u.globalRole,
    roleIds: u.roleIds,
    teamIds: u.teamIds,
  }))
  await dumpCollection('teams', (t) => ({
    name: t.name,
    teamRoleId: t.teamRoleId,
    workTypes: t.workTypes,
    leadId: t.leadId,
    memberIds: t.memberIds,
    projectIds: (t.projectIds || []).length,
  }))
  await dumpCollection('workflows', (w) => ({
    displayName: w.displayName,
    flowType: w.flowType,
    stages: (w.stages || []).map((s) => s.id),
    version: w.version,
  }))
  await dumpDoc('workflows/_registry')
  await dumpDoc('config/orgStructure')
  await dumpDoc('config/appConfig')
  await dumpDoc('config/taskTemplates')
  await dumpCollection('projects', (p) => ({
    title: p.title,
    status: p.status,
    workflowId: p.workflowId,
    currentStageId: p.currentStageId,
    teamIds: (p.teamIds || []).length,
  }))
  try {
    const tasks = await getDocs(collection(db, 'tasks'))
    console.log(`\n### tasks  (${tasks.size} docs)`)
  } catch (e) {
    console.log(`\n### tasks — ERROR: ${e.code || e.message}`)
  }
  // roles / modules subcollections under /config
  await dumpCollection('config/roles', (r) => ({ label: r.label, level: r.level }))
  await dumpCollection('config/modules', (m) => ({ label: m.label, order: m.order }))
  console.log('\nDone.')
  process.exit(0)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
