/**
 * One-off: set the live hotel-management workflow to flowType 'basic' so the
 * room detail panel stops showing the unfillable "Front Desk" lead slot (and the
 * tender-only Submission/Presentation rows). Merge-write preserves all other
 * fields; bumps version + updatedAt. Re-run seedRooms.mjs afterwards to re-pin.
 *
 * Run (rules open):  node scripts/patchHotelFlowType.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initializeApp } from 'firebase/app'
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = {}
for (const l of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const t = l.trim(); if (!t || t.startsWith('#')) continue
  const i = t.indexOf('='); if (i === -1) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}
const app = initializeApp({ apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID })
const db = getFirestore(app)

const ref = doc(db, 'workflows', 'hotel-management')
const snap = await getDoc(ref)
if (!snap.exists()) { console.error('workflows/hotel-management missing'); process.exit(1) }
const prev = snap.data()
console.log('before: flowType =', prev.flowType, '| version =', prev.version)
await setDoc(ref, { flowType: 'basic', version: (prev.version || 1) + 1, updatedAt: serverTimestamp(), lastEditedAt: serverTimestamp() }, { merge: true })
const after = (await getDoc(ref)).data()
console.log('after:  flowType =', after.flowType, '| version =', after.version)
console.log('Done. Now re-run: node scripts/seedRooms.mjs  (re-pins basic snapshot onto the 18 rooms)')
process.exit(0)
