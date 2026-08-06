/**
 * Instrumented facade over 'firebase/firestore' — the target of the Vite
 * alias (vite.config.ts) and the tsconfig `paths` mapping, so every
 * `import ... from 'firebase/firestore'` in the app (107 files, unchanged)
 * resolves here. `export *` re-exports the ENTIRE real SDK; the explicit
 * exports below shadow just the read/write/subscribe verbs with counting
 * wrappers (per ES module semantics, explicit exports win over `export *`).
 *
 * The real implementations come from '@firebase/firestore' — the exact
 * module the 'firebase/firestore' shim itself re-exports (verified: the shim
 * is one line, and firebase@12 pins @firebase/firestore exactly), so there is
 * a single SDK instance. versionLock.test.ts guards that invariant across
 * upgrades.
 *
 * HARD RULES for this file:
 *  - No import-time side effects (vitest loads this via the same alias).
 *  - Never import firebase.ts / firestore.ts (they import US via the alias).
 *  - Fail open: if an op's shape isn't recognized, run the real SDK call
 *    uninstrumented rather than risk breaking a production path.
 *  - Each override is typed `typeof _original` so consumers keep the full
 *    overload/generic surface and tsc checks all 107 importers against it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export * from '@firebase/firestore'

import {
  query as _query,
  collectionGroup as _collectionGroup,
  getDoc as _getDoc,
  getDocFromCache as _getDocFromCache,
  getDocFromServer as _getDocFromServer,
  getDocs as _getDocs,
  getDocsFromCache as _getDocsFromCache,
  getDocsFromServer as _getDocsFromServer,
  getCountFromServer as _getCountFromServer,
  onSnapshot as _onSnapshot,
  setDoc as _setDoc,
  updateDoc as _updateDoc,
  deleteDoc as _deleteDoc,
  addDoc as _addDoc,
  writeBatch as _writeBatch,
  runTransaction as _runTransaction,
  type WriteBatch,
  type Transaction,
  type Unsubscribe,
} from '@firebase/firestore'

import { recordOp, isHot } from './fsUsage/core'
import { getTag, tagQuery } from './fsUsage/normalizePath'
import { captureStack, shouldCaptureReadStack } from './fsUsage/stackSampler'

// Path string for samples: refs expose .path; queries fall back to their tag.
function pathOf(target: unknown): string {
  const p = (target as { path?: unknown } | null)?.path
  return typeof p === 'string' ? p : getTag(target)
}

function readStack(tag: string): string | undefined {
  return shouldCaptureReadStack(isHot(tag)) ? captureStack() : undefined
}

// ── Query construction (tagging only — no counting) ─────────────────────────

export const query: typeof _query = ((source: any, ...rest: any[]) => {
  const q = (_query as any)(source, ...rest)
  tagQuery(q, getTag(source))
  return q
}) as typeof _query

export const collectionGroup: typeof _collectionGroup = ((db: any, id: string) => {
  const q = _collectionGroup(db, id)
  tagQuery(q, `cg:${id}`)
  return q
}) as typeof _collectionGroup

// ── One-shot reads ───────────────────────────────────────────────────────────

function wrapGetDoc(real: typeof _getDoc, cacheHint?: boolean): typeof _getDoc {
  return (async (ref: any) => {
    const tag = getTag(ref)
    const stack = readStack(tag)
    const snap = await (real as any)(ref)
    recordOp('getDoc', tag, 1, cacheHint ?? snap.metadata?.fromCache ?? false, pathOf(ref), stack)
    return snap
  }) as typeof _getDoc
}

export const getDoc: typeof _getDoc = wrapGetDoc(_getDoc)
export const getDocFromCache: typeof _getDocFromCache = wrapGetDoc(_getDocFromCache as any, true)
export const getDocFromServer: typeof _getDocFromServer = wrapGetDoc(_getDocFromServer as any, false)

function wrapGetDocs(real: typeof _getDocs, cacheHint?: boolean): typeof _getDocs {
  return (async (q: any) => {
    const tag = getTag(q)
    const stack = readStack(tag)
    const snap = await (real as any)(q)
    recordOp(
      'getDocs',
      tag,
      Math.max(snap.size, 1), // an empty result still bills one read
      cacheHint ?? snap.metadata?.fromCache ?? false,
      pathOf(q),
      stack,
    )
    return snap
  }) as typeof _getDocs
}

export const getDocs: typeof _getDocs = wrapGetDocs(_getDocs)
export const getDocsFromCache: typeof _getDocsFromCache = wrapGetDocs(_getDocsFromCache as any, true)
export const getDocsFromServer: typeof _getDocsFromServer = wrapGetDocs(_getDocsFromServer as any, false)

export const getCountFromServer: typeof _getCountFromServer = (async (q: any, ...rest: any[]) => {
  const tag = getTag(q)
  const stack = readStack(tag)
  const snap = await (_getCountFromServer as any)(q, ...rest)
  recordOp('getCount', tag, 1, false, pathOf(q), stack)
  return snap
}) as typeof _getCountFromServer

// ── Listeners ────────────────────────────────────────────────────────────────

function isOptionsArg(a: unknown): boolean {
  return (
    !!a &&
    typeof a === 'object' &&
    typeof (a as any).next !== 'function' &&
    ('includeMetadataChanges' in (a as object) || 'source' in (a as object))
  )
}

export const onSnapshot: typeof _onSnapshot = ((...args: any[]) => {
  try {
    const target = args[0]
    const tag = getTag(target)
    // Subscribe-time stack, captured ALWAYS (subscription churn is the spike
    // signature we most need call sites for) and held in the closure so
    // deliveries — whose own stacks bottom out in SDK scheduler frames — can
    // reuse it at zero capture cost.
    const subStack = captureStack()
    recordOp('subscribe', tag, 1, false, pathOf(target), subStack)

    const obsIndex = isOptionsArg(args[1]) ? 2 : 1
    const observer = args[obsIndex]
    let first = true
    const countDelivery = (snap: any) => {
      const isQuery = typeof snap?.docChanges === 'function'
      const count = isQuery
        ? first
          ? Math.max(snap.size, 1)
          : snap.docChanges().length
        : 1
      recordOp(
        first ? 'snapInitial' : 'snapUpdate',
        tag,
        count,
        snap?.metadata?.fromCache ?? false,
        pathOf(target),
        subStack,
      )
      first = false
    }

    let wrappedArgs: any[] | null = null
    if (typeof observer === 'function') {
      wrappedArgs = [...args]
      wrappedArgs[obsIndex] = (snap: any) => {
        countDelivery(snap)
        return observer(snap)
      }
    } else if (observer && typeof observer === 'object' && typeof observer.next === 'function') {
      wrappedArgs = [...args]
      wrappedArgs[obsIndex] = {
        ...observer,
        next: (snap: any) => {
          countDelivery(snap)
          return observer.next(snap)
        },
      }
    }

    // Unrecognized observer shape → fail open (subscribe already counted).
    const unsub: Unsubscribe = (_onSnapshot as any)(...(wrappedArgs ?? args))
    let done = false
    const wrappedUnsub: Unsubscribe = () => {
      if (!done) {
        done = true
        recordOp('unsubscribe', tag, 0)
      }
      unsub()
    }
    return wrappedUnsub
  } catch {
    // Any instrumentation failure → raw SDK behaviour.
    return (_onSnapshot as any)(...args)
  }
}) as typeof _onSnapshot

// ── Writes ───────────────────────────────────────────────────────────────────

export const setDoc: typeof _setDoc = ((ref: any, ...rest: any[]) => {
  recordOp('set', getTag(ref), 1, false, pathOf(ref), captureStack())
  return (_setDoc as any)(ref, ...rest)
}) as typeof _setDoc

export const updateDoc: typeof _updateDoc = ((ref: any, ...rest: any[]) => {
  recordOp('update', getTag(ref), 1, false, pathOf(ref), captureStack())
  return (_updateDoc as any)(ref, ...rest)
}) as typeof _updateDoc

export const deleteDoc: typeof _deleteDoc = ((ref: any) => {
  recordOp('delete', getTag(ref), 1, false, pathOf(ref), captureStack())
  return (_deleteDoc as any)(ref)
}) as typeof _deleteDoc

export const addDoc: typeof _addDoc = ((colRef: any, data: any) => {
  recordOp('add', getTag(colRef), 1, false, pathOf(colRef), captureStack())
  return (_addDoc as any)(colRef, data)
}) as typeof _addDoc

// Facade over WriteBatch: staged ops are attributed only when commit() runs —
// a batch that is built and dropped never billed anything. The facade's
// chainable methods must return the FACADE (the real methods return the raw
// batch, which would escape uninstrumented).
export const writeBatch: typeof _writeBatch = ((db: any) => {
  const real = _writeBatch(db)
  const staged: Array<{ tag: string; path: string; stack?: string }> = []
  const facade = {
    set(ref: any, ...rest: any[]) {
      staged.push({ tag: getTag(ref), path: pathOf(ref), stack: captureStack() })
      ;(real.set as any)(ref, ...rest)
      return facade
    },
    update(ref: any, ...rest: any[]) {
      staged.push({ tag: getTag(ref), path: pathOf(ref), stack: captureStack() })
      ;(real.update as any)(ref, ...rest)
      return facade
    },
    delete(ref: any) {
      staged.push({ tag: getTag(ref), path: pathOf(ref), stack: captureStack() })
      real.delete(ref)
      return facade
    },
    commit() {
      for (const op of staged) recordOp('batchWrite', op.tag, 1, false, op.path, op.stack)
      return real.commit()
    },
  }
  return facade as unknown as WriteBatch
}) as typeof _writeBatch

export const runTransaction: typeof _runTransaction = (async (
  db: any,
  updateFunction: (txn: Transaction) => Promise<unknown>,
  options?: any,
) => {
  // Reads count per call (each retry attempt re-reads server-side — that's
  // billed). Writes are staged per attempt and flushed ONCE after the
  // transaction resolves, so retried attempts don't double-count.
  let lastAttemptWrites: Array<{ tag: string; path: string; stack?: string }> = []
  const wrappedUpdate = (txn: Transaction) => {
    const attempt: Array<{ tag: string; path: string; stack?: string }> = []
    lastAttemptWrites = attempt
    const facade = {
      get(ref: any) {
        recordOp('txnRead', getTag(ref), 1, false, pathOf(ref))
        return (txn.get as any)(ref)
      },
      set(ref: any, ...rest: any[]) {
        attempt.push({ tag: getTag(ref), path: pathOf(ref), stack: captureStack() })
        ;(txn.set as any)(ref, ...rest)
        return facade
      },
      update(ref: any, ...rest: any[]) {
        attempt.push({ tag: getTag(ref), path: pathOf(ref), stack: captureStack() })
        ;(txn.update as any)(ref, ...rest)
        return facade
      },
      delete(ref: any) {
        attempt.push({ tag: getTag(ref), path: pathOf(ref), stack: captureStack() })
        txn.delete(ref)
        return facade
      },
    }
    return updateFunction(facade as unknown as Transaction)
  }
  const result = await (_runTransaction as any)(db, wrappedUpdate, options)
  for (const op of lastAttemptWrites) recordOp('txnWrite', op.tag, 1, false, op.path, op.stack)
  return result
}) as typeof _runTransaction
