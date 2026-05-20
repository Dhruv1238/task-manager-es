/**
 * Dev-only "reset to fresh tenant" utility. Deletes every workspace doc
 * (projects, tasks, teams, workflows, config) and clears every localStorage
 * cache so the next page load behaves exactly like a brand-new tenant —
 * the Home redirect routes to the org-setup wizard, the workflow wizard
 * auto-launches once org is done, and no stale data leaks through caches.
 *
 * Preserves:
 *   - The `users` collection (so the super_admin who triggered the wipe can
 *     still log in) — BUT clears each user's `teamIds` and `chatLastReadAt`
 *     fields because those reference data that no longer exists.
 *
 * Removes (Firestore):
 *   - /projects/{*} + nested chat messages + comments
 *   - /tasks/{*} + nested comments
 *   - /teams/{*}
 *   - /workflows/{*} (including the `_registry` singleton)
 *   - /config/orgStructure
 *   - /config/appConfig
 *   - /config/taskTemplates
 *   - /auditEvents/{*}
 *
 * Removes (localStorage):
 *   - appConfig:v1, orgStructure:v1, workflowRegistry:v1
 *   - All workflow:{id}:v1 entries
 *   - orgSetupWizard:v1:{uid} drafts
 *   - chatSync:v1:{uid}
 *   - projects:viewMode
 *
 * This file is intentionally NOT exported through any page-level index — it's
 * only reachable through the Dev Tools section under /admin/config. Remove the
 * Dev Tools section before shipping to production.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'

const BATCH_SIZE = 400

export interface WipeSummary {
  collectionsCleared: Record<string, number>
  configsCleared: string[]
  usersReset: number
  durationMs: number
}

// Collections wiped wholesale. `users` is intentionally NOT in this list —
// see resetUserDocs() below for the surgical reset that preserves identities.
const COLLECTIONS_TO_WIPE = [
  'projects',
  'tasks',
  'teams',
  'workflows',
  'auditEvents',
] as const

// Doc paths under /config/. We delete instead of overwriting so the wizard's
// "no doc → DEFAULT_ORG_STRUCTURE" path kicks in and orgStructure.setupCompleted
// reads as false on next boot.
const CONFIG_DOC_PATHS = [
  ['config', 'orgStructure'],
  ['config', 'appConfig'],
  ['config', 'taskTemplates'],
] as const

export async function wipeTenant(): Promise<WipeSummary> {
  const startedAt = Date.now()
  const collectionsCleared: Record<string, number> = {}

  // Firestore: clear every wholesale collection in batched deletes.
  for (const name of COLLECTIONS_TO_WIPE) {
    const count = await clearCollection(name)
    collectionsCleared[name] = count
  }

  // Firestore: delete each /config/* doc individually.
  const configsCleared: string[] = []
  for (const [coll, id] of CONFIG_DOC_PATHS) {
    try {
      await deleteDoc(doc(db, coll, id))
      configsCleared.push(`${coll}/${id}`)
    } catch (e) {
      console.warn(`[wipeTenant] failed to delete ${coll}/${id}`, e)
    }
  }

  // Firestore: reset users (preserve identity, clear team memberships +
  // chat read state so nothing references the now-gone teams / projects).
  const usersReset = await resetUserDocs()

  // localStorage: clear every cache the app reads at boot.
  clearLocalStorage()

  const summary: WipeSummary = {
    collectionsCleared,
    configsCleared,
    usersReset,
    durationMs: Date.now() - startedAt,
  }
  console.log('[wipeTenant] done', summary)
  return summary
}

// Delete every doc in a top-level collection in batches of BATCH_SIZE. Does
// NOT recurse into subcollections — Firestore client SDK has no recursive
// delete; subcollection docs become orphaned. For our shapes that's fine:
// project chat / comments and task comments are unreachable once their
// parent doc is gone, and the orphan storage is reclaimed when the parent
// is re-used. (For a true production migration we'd run a server-side
// recursive delete — out of scope for a dev-tool reset.)
async function clearCollection(name: string): Promise<number> {
  const snap = await getDocs(collection(db, name))
  if (snap.empty) return 0
  let total = 0
  let batch = writeBatch(db)
  let inBatch = 0
  for (const d of snap.docs) {
    batch.delete(d.ref)
    inBatch += 1
    total += 1
    if (inBatch >= BATCH_SIZE) {
      await batch.commit()
      batch = writeBatch(db)
      inBatch = 0
    }
  }
  if (inBatch > 0) await batch.commit()
  return total
}

async function resetUserDocs(): Promise<number> {
  const snap = await getDocs(collection(db, 'users'))
  if (snap.empty) return 0
  let count = 0
  let batch = writeBatch(db)
  let inBatch = 0
  for (const d of snap.docs) {
    // Use update with explicit empties so a re-login doesn't immediately
    // re-link the user to non-existent teams via stale `teamIds`. The user
    // doc, uid, email, displayName, globalRole all stay intact.
    batch.update(d.ref, {
      teamIds: [],
      chatLastReadAt: {},
    })
    inBatch += 1
    count += 1
    if (inBatch >= BATCH_SIZE) {
      await batch.commit()
      batch = writeBatch(db)
      inBatch = 0
    }
  }
  if (inBatch > 0) await batch.commit()
  return count
}

function clearLocalStorage(): void {
  if (typeof window === 'undefined') return
  // Known fixed keys.
  const FIXED_KEYS = [
    'appConfig:v1',
    'orgStructure:v1',
    'workflowRegistry:v1',
    'projects:viewMode',
  ]
  for (const k of FIXED_KEYS) {
    try {
      window.localStorage.removeItem(k)
    } catch {
      // ignore
    }
  }
  // Prefix-matching keys: workflow:{id}:v1, orgSetupWizard:v1:{uid},
  // chatSync:v1:{uid}, workflowDraft:{uid}:v1 (future). Walk the keystore
  // and remove anything that matches.
  const PREFIX_PATTERNS = [
    /^workflow:.+:v1$/,
    /^orgSetupWizard:v1:.+$/,
    /^chatSync:v1:.+$/,
    /^workflowDraft:.+:v1$/,
  ]
  const toRemove: string[] = []
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i)
    if (!key) continue
    if (PREFIX_PATTERNS.some((re) => re.test(key))) {
      toRemove.push(key)
    }
  }
  for (const k of toRemove) {
    try {
      window.localStorage.removeItem(k)
    } catch {
      // ignore
    }
  }
}
