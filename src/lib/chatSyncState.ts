// Per-device, per-user "last sync high-water mark" for project chats.
//
// Why this exists: Firestore's persistent cache holds the messages themselves;
// the delta listener filters on `serverUpdatedAt > lastSyncedAt` so we only
// re-fetch what changed since this device last synced. We store one tiny entry
// per project in localStorage — survives reloads, tab closes, and multi-day
// gaps, evicted only on explicit user logout.

const STORAGE_PREFIX = 'chatSync:v1:'
const SCHEMA_VERSION = 1

export interface ProjectSyncEntry {
  lastSyncedAt: number
  schemaVersion: number
}

type SyncMap = Record<string, ProjectSyncEntry>

function storageKey(uid: string): string {
  return `${STORAGE_PREFIX}${uid}`
}

function readMap(uid: string): SyncMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(storageKey(uid))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as SyncMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeMap(uid: string, map: SyncMap) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(uid), JSON.stringify(map))
  } catch {
    // Ignore quota / private-mode errors — worst case is one extra refetch.
  }
}

export function readSyncState(uid: string, projectId: string): ProjectSyncEntry {
  const map = readMap(uid)
  const entry = map[projectId]
  if (!entry || entry.schemaVersion !== SCHEMA_VERSION) {
    return { lastSyncedAt: 0, schemaVersion: SCHEMA_VERSION }
  }
  return entry
}

export function writeSyncState(uid: string, projectId: string, lastSyncedAt: number) {
  const map = readMap(uid)
  map[projectId] = { lastSyncedAt, schemaVersion: SCHEMA_VERSION }
  writeMap(uid, map)
}

export function clearProjectSyncState(uid: string, projectId: string) {
  const map = readMap(uid)
  if (projectId in map) {
    delete map[projectId]
    writeMap(uid, map)
  }
}

export function clearAllSyncStateForUser(uid: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(storageKey(uid))
  } catch {
    // Ignore.
  }
}
