import { useEffect, useState } from 'react'
import {
  getDocsFromCache,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { tenantCol } from '../lib/firestore'
import { useAuth } from '../contexts/AuthContext'
import {
  clearProjectSyncState,
  readSyncState,
  writeSyncState,
} from '../lib/chatSyncState'
import type { ChatMessage } from '../types/models'

const HISTORY_PAGE_SIZE = 50

function toMessage(d: QueryDocumentSnapshot): ChatMessage {
  return { id: d.id, ...(d.data() as Omit<ChatMessage, 'id'>) }
}

function safeMillis(ts: Timestamp | null | undefined): number {
  // serverTimestamp() is null on a pending local write; treat as 0 so we don't
  // advance the high-water mark past a value the server hasn't acknowledged yet.
  if (!ts) return 0
  try {
    return ts.toMillis()
  } catch {
    return 0
  }
}

export interface ChatListenerState {
  messages: ChatMessage[]
  loading: boolean
  hadCacheHit: boolean
}

// Cache-first + delta-only listener. See CHAT_FEATURE.md for the design.
//
// 1) On mount, render whatever the persistent cache has (zero reads).
// 2) Look up this device's high-water mark for this project.
// 3) Subscribe to documents with `serverUpdatedAt > cutoff`, upsert into the
//    in-memory map by id, push the new high-water mark back to localStorage.
export function useChatListener(projectId: string | undefined): ChatListenerState {
  const { profile } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState<boolean>(Boolean(projectId))
  const [hadCacheHit, setHadCacheHit] = useState<boolean>(false)

  useEffect(() => {
    if (!projectId || !profile?.uid) {
      setMessages([])
      setLoading(false)
      setHadCacheHit(false)
      return
    }

    let cancelled = false
    const uid = profile.uid
    const msgsCol = tenantCol('projects', projectId, 'chat')
    const byId = new Map<string, ChatMessage>()

    const commit = () => {
      if (cancelled) return
      const arr = Array.from(byId.values()).sort(
        (a, b) => safeMillis(a.createdAt) - safeMillis(b.createdAt),
      )
      setMessages(arr)
    }

    // (1) Cache-first read — zero server reads on returning visits.
    void getDocsFromCache(
      query(msgsCol, orderBy('createdAt', 'desc'), limit(HISTORY_PAGE_SIZE)),
    )
      .then((snap) => {
        if (cancelled) return
        if (!snap.empty) {
          snap.docs.forEach((d) => byId.set(d.id, toMessage(d)))
          commit()
          setHadCacheHit(true)
        }
      })
      .catch(() => {
        // Cache miss is fine — the delta listener below will fill the gap.
      })

    // (2) Per-device high-water mark.
    let lastSynced = readSyncState(uid, projectId).lastSyncedAt
    const cutoff = Timestamp.fromMillis(lastSynced)

    // (3) Delta listener. On the first mount of a new device this returns the
    // full recent history; on every subsequent mount it returns only what's
    // changed since `lastSynced`.
    const unsub = onSnapshot(
      query(
        msgsCol,
        where('serverUpdatedAt', '>', cutoff),
        orderBy('serverUpdatedAt', 'asc'),
      ),
      (snap) => {
        if (cancelled) return
        let maxSeen = lastSynced
        snap.docChanges().forEach((change) => {
          if (change.type === 'removed') {
            byId.delete(change.doc.id)
            return
          }
          const msg = toMessage(change.doc)
          byId.set(msg.id, msg)
          const ms = safeMillis(msg.serverUpdatedAt)
          if (ms > maxSeen) maxSeen = ms
        })
        commit()
        if (maxSeen > lastSynced) {
          writeSyncState(uid, projectId, maxSeen)
          lastSynced = maxSeen
        }
        setLoading(false)
      },
      (err) => {
        if (cancelled) return
        if (err.code === 'permission-denied') {
          byId.clear()
          setMessages([])
          clearProjectSyncState(uid, projectId)
        }
        setLoading(false)
      },
    )

    return () => {
      cancelled = true
      unsub()
    }
  }, [projectId, profile?.uid])

  return { messages, loading, hadCacheHit }
}
