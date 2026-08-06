/**
 * Smoke-checks the fsIntercept facade's export surface. With the vite alias
 * active (vitest inherits vite.config.ts), 'firebase/firestore' resolves to
 * the facade — these assertions prove (a) pass-through exports are the SAME
 * BINDINGS as the real SDK (identity, not copies), and (b) the overridden
 * verbs are actually overridden.
 */
import { describe, expect, it } from 'vitest'
import * as wrapped from 'firebase/firestore'
import * as real from '@firebase/firestore'

const OVERRIDDEN = [
  'query',
  'collectionGroup',
  'getDoc',
  'getDocFromCache',
  'getDocFromServer',
  'getDocs',
  'getDocsFromCache',
  'getDocsFromServer',
  'getCountFromServer',
  'onSnapshot',
  'setDoc',
  'updateDoc',
  'deleteDoc',
  'addDoc',
  'writeBatch',
  'runTransaction',
] as const

// The APIs the app actually uses (recon count across src/) that must pass
// through untouched.
const PASS_THROUGH = [
  'Timestamp',
  'serverTimestamp',
  'where',
  'orderBy',
  'limit',
  'startAfter',
  'arrayUnion',
  'arrayRemove',
  'increment',
  'deleteField',
  'documentId',
  'collection',
  'doc',
  'initializeFirestore',
  'getFirestore',
  'persistentLocalCache',
  'persistentMultipleTabManager',
  'waitForPendingWrites',
] as const

describe('fsIntercept export surface', () => {
  it('resolves firebase/firestore to the facade (aliased)', () => {
    // If the alias is not active, the overridden verbs would be identical.
    expect(wrapped.getDocs).not.toBe(real.getDocs)
  })

  it('passes untouched APIs through as the original bindings', () => {
    for (const name of PASS_THROUGH) {
      expect(wrapped[name as keyof typeof wrapped], name).toBe(real[name as keyof typeof real])
    }
  })

  it('overrides every instrumented verb with a distinct function', () => {
    for (const name of OVERRIDDEN) {
      const w = wrapped[name as keyof typeof wrapped]
      expect(typeof w, name).toBe('function')
      expect(w, name).not.toBe(real[name as keyof typeof real])
    }
  })

  it('facade has no import-time side effects (no window global before first op)', () => {
    // In the node test env there is no window at all; the import above not
    // throwing IS the assertion that nothing touched window/localStorage.
    expect(typeof globalThis.window).toBe('undefined')
  })
})
