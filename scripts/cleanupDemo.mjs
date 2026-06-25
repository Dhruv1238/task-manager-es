/**
 * Cleanup pre-existing junk so only the Show Runner seed remains — clm-phase-2.
 *
 * Removes:
 *   - every project whose id does NOT start with `seed-` (the old test tenders:
 *     WFI, WFI27, Bharat Tex, IISF, Second Tender, Test 1, Aahar 2027, …)
 *   - every task that does NOT belong to a `seed-` project (orphans / old)
 *   - the junk "Test Team" (and removes it from any member's teamIds)
 * Keeps: the 6 seeded tenders, the 5 populated delivery teams, all members,
 *        workflows, and the role hierarchy.
 * Also: rebuilds each delivery team's `projectIds` to exactly the seed projects
 *        it's attached to (clears stale ids from the deleted projects).
 *
 * REQUIRES rules temporarily open. Run a dry pass first:
 *   node scripts/cleanupDemo.mjs --dry
 *   node scripts/cleanupDemo.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initializeApp } from 'firebase/app'
import {
  getFirestore, collection, doc, getDocs, writeBatch, arrayRemove,
} from 'firebase/firestore'

const DRY = process.argv.includes('--dry')
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
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
  projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID,
})
const db = getFirestore(app)
const KEEP_TEAM_NAMES = new Set(['Client Servicing', 'Copy & Strategy', 'Graphic Design', 'Events Design', 'Video Editing'])

function makeBatcher() {
  let batch = writeBatch(db), n = 0, committed = 0
  return {
    del(ref) { if (!DRY) { batch.delete(ref); n++ } return this.maybe() },
    upd(ref, data) { if (!DRY) { batch.update(ref, data); n++ } return this.maybe() },
    async maybe() { if (n >= 400) { await batch.commit(); committed += n; batch = writeBatch(db); n = 0 } },
    async flush() { if (n > 0 && !DRY) { await batch.commit(); committed += n; n = 0 } return committed },
  }
}

async function main() {
  console.log(`Cleanup → ${env.VITE_FIREBASE_PROJECT_ID}${DRY ? '  (DRY RUN — nothing deleted)' : ''}`)
  console.log('─'.repeat(60))
  const b = makeBatcher()

  // projects
  const projSnap = await getDocs(collection(db, 'projects'))
  const seedProjectIds = new Set()
  const toDeleteProjects = []
  projSnap.forEach((d) => {
    if (d.id.startsWith('seed-')) seedProjectIds.add(d.id)
    else toDeleteProjects.push({ id: d.id, title: d.data().title })
  })
  console.log(`\nProjects: keep ${seedProjectIds.size} seed, delete ${toDeleteProjects.length}:`)
  toDeleteProjects.forEach((p) => console.log(`  ✗ ${p.id}  "${p.title}"`))
  for (const p of toDeleteProjects) { b.del(doc(db, 'projects', p.id)); await b.maybe() }

  // tasks not belonging to a seed project
  const taskSnap = await getDocs(collection(db, 'tasks'))
  let delTasks = 0, keepTasks = 0
  for (const d of taskSnap.docs) {
    if (seedProjectIds.has(d.data().projectId)) { keepTasks++; continue }
    delTasks++; b.del(doc(db, 'tasks', d.id)); await b.maybe()
  }
  console.log(`\nTasks: keep ${keepTasks} (seed), delete ${delTasks} (old/orphan).`)

  // teams: rebuild projectIds for kept teams; delete junk teams
  const teamSnap = await getDocs(collection(db, 'teams'))
  // team id → seed project ids it's attached to
  const teamToProjects = {}
  for (const d of projSnap.docs) {
    if (!d.id.startsWith('seed-')) continue
    for (const tid of d.data().teamIds || []) (teamToProjects[tid] ??= []).push(d.id)
  }
  for (const d of teamSnap.docs) {
    const name = d.data().name
    if (KEEP_TEAM_NAMES.has(name)) {
      const ids = teamToProjects[d.id] || []
      console.log(`  ↻ team "${name}" projectIds → [${ids.length}]`)
      b.upd(doc(db, 'teams', d.id), { projectIds: ids })
      await b.maybe()
    } else {
      // junk team (e.g. "Test Team") — remove from members, then delete
      console.log(`  ✗ team "${name}" (${d.id}) — deleting, unlinking ${(d.data().memberIds || []).length} member(s)`)
      for (const mid of d.data().memberIds || []) {
        b.upd(doc(db, 'users', mid), { teamIds: arrayRemove(d.id) }); await b.maybe()
      }
      b.del(doc(db, 'teams', d.id)); await b.maybe()
    }
  }

  const committed = await b.flush()
  console.log(`\nDONE. Ops: ${committed}${DRY ? ' (DRY — nothing written)' : ''}`)
  console.log('Remember to restore rules:  firebase deploy --only firestore:rules')
  process.exit(0)
}
main().catch((e) => { console.error('CLEANUP FAILED:', e); process.exit(1) })
