/**
 * Dump a single Firestore doc (or collection) to a JSON file for inspection.
 * Usage: node scripts/dumpDoc.mjs workflows/tender   [outfile.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initializeApp } from 'firebase/app'
import { getFirestore, doc, getDoc } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
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
  appId: env.VITE_FIREBASE_APP_ID,
})
const db = getFirestore(app)
const path = process.argv[2] || 'workflows/tender'
const out = process.argv[3] || join(__dirname, '_dump.json')
const ref = doc(db, ...path.split('/'))
const snap = await getDoc(ref)
if (!snap.exists()) {
  console.log('MISSING', path)
  process.exit(1)
}
function replacer(_k, v) {
  if (v && typeof v === 'object' && typeof v.toDate === 'function') {
    return { __ts: v.toDate().toISOString() }
  }
  return v
}
writeFileSync(out, JSON.stringify(snap.data(), replacer, 2))
console.log('Wrote', out, '(', JSON.stringify(snap.data()).length, 'bytes )')
process.exit(0)
