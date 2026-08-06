import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from './AuthContext'
import { useChatListener } from '../hooks/useChatListener'
import { editMessage, markChatRead, sendMessage } from '../lib/chat'
import type { ChatAttachment, ChatMessage } from '../types/models'

interface ProjectChatContextValue {
  projectId: string
  currentUserId: string | null
  messages: ChatMessage[]
  loading: boolean
  unreadCount: number
  isPanelOpen: boolean
  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
  send: (text: string, attachments?: ChatAttachment[]) => Promise<void>
  edit: (messageId: string, newText: string) => Promise<void>
}

const ProjectChatContext = createContext<ProjectChatContextValue | undefined>(undefined)

// Debounce window for markChatRead writes. Spec calls for "max once per minute
// per project per device" — see CHAT_FEATURE.md.
const MARK_READ_DEBOUNCE_MS = 60_000

interface ProviderProps {
  projectId: string
  children: ReactNode
}

export function ProjectChatProvider({ projectId, children }: ProviderProps) {
  const { profile } = useAuth()
  const { messages, loading } = useChatListener(projectId)
  const [isPanelOpen, setPanelOpen] = useState(false)

  // Optimistic delta over the persisted user.chatLastReadAt[projectId]. The
  // effective "last read" is the max of the two so the badge clears
  // immediately without waiting for the profile to round-trip back from
  // Firestore.
  const profileLastReadMs = profile?.chatLastReadAt?.[projectId]?.toMillis?.() ?? 0
  const [optimisticReadMs, setOptimisticReadMs] = useState<number>(0)
  const effectiveLastReadMs = Math.max(profileLastReadMs, optimisticReadMs)

  // Throttled background write of users/{uid}.chatLastReadAt[projectId].
  const lastWriteAtRef = useRef<number>(0)
  const pendingWriteRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keyed on profile?.uid (primitive), NOT the profile object. markChatRead
  // writes users/{uid}, which re-delivers the profile snapshot as a NEW object —
  // object-keyed callbacks re-created here re-ran the mark-read effect below,
  // which re-armed the debounce, whose flush wrote users/{uid} again… a
  // perpetual 1 write/min/project/tab treadmill, each write fanned out as a
  // billed read to every client holding a users-collection listener. With uid
  // keys the chain is stable across profile snapshots and quiesces after the
  // panel-open / new-message writes it's meant to do.
  const uid = profile?.uid
  const flushMarkRead = useCallback(() => {
    if (!uid) return
    lastWriteAtRef.current = Date.now()
    void markChatRead(uid, projectId).catch(() => {
      // Best-effort; the optimistic copy already cleared the badge.
    })
  }, [uid, projectId])

  const scheduleMarkRead = useCallback(() => {
    if (!uid) return
    setOptimisticReadMs(Date.now())
    const sinceLast = Date.now() - lastWriteAtRef.current
    if (sinceLast >= MARK_READ_DEBOUNCE_MS) {
      if (pendingWriteRef.current) {
        clearTimeout(pendingWriteRef.current)
        pendingWriteRef.current = null
      }
      flushMarkRead()
    } else if (!pendingWriteRef.current) {
      pendingWriteRef.current = setTimeout(() => {
        pendingWriteRef.current = null
        flushMarkRead()
      }, MARK_READ_DEBOUNCE_MS - sinceLast)
    }
  }, [flushMarkRead, uid])

  // Cleanup any pending debounced write on unmount.
  useEffect(
    () => () => {
      if (pendingWriteRef.current) {
        clearTimeout(pendingWriteRef.current)
        pendingWriteRef.current = null
      }
    },
    [],
  )

  // Latest message timestamp drives "mark as read when a new message arrives
  // while the panel is open." Computed once per messages change.
  const latestMessageMs = useMemo(() => {
    let max = 0
    for (const m of messages) {
      const ms = m.serverUpdatedAt?.toMillis?.() ?? 0
      if (ms > max) max = ms
    }
    return max
  }, [messages])

  useEffect(() => {
    if (!isPanelOpen) return
    scheduleMarkRead()
  }, [isPanelOpen, latestMessageMs, scheduleMarkRead])

  const openPanel = useCallback(() => setPanelOpen(true), [])
  const closePanel = useCallback(() => {
    setPanelOpen(false)
    // Flush any pending mark-read so the persisted timestamp catches up.
    if (pendingWriteRef.current) {
      clearTimeout(pendingWriteRef.current)
      pendingWriteRef.current = null
      flushMarkRead()
    }
  }, [flushMarkRead])
  const togglePanel = useCallback(() => {
    setPanelOpen((o) => !o)
  }, [])

  const send = useCallback(
    async (text: string, attachments?: ChatAttachment[]) => {
      if (!uid) throw new Error('Not signed in.')
      await sendMessage({
        projectId,
        authorId: uid,
        text,
        attachments,
      })
    },
    [projectId, uid],
  )

  const edit = useCallback(
    async (messageId: string, newText: string) => {
      await editMessage({ projectId, messageId, newText })
    },
    [projectId],
  )

  const unreadCount = useMemo(() => {
    if (!profile) return 0
    let count = 0
    for (const m of messages) {
      if (m.authorId === profile.uid) continue
      const ms = m.serverUpdatedAt?.toMillis?.() ?? 0
      if (ms > effectiveLastReadMs) count += 1
    }
    return count
  }, [messages, profile, effectiveLastReadMs])

  const currentUserId = profile?.uid ?? null

  const value = useMemo<ProjectChatContextValue>(
    () => ({
      projectId,
      currentUserId,
      messages,
      loading,
      unreadCount,
      isPanelOpen,
      openPanel,
      closePanel,
      togglePanel,
      send,
      edit,
    }),
    [
      projectId,
      currentUserId,
      messages,
      loading,
      unreadCount,
      isPanelOpen,
      openPanel,
      closePanel,
      togglePanel,
      send,
      edit,
    ],
  )

  return <ProjectChatContext.Provider value={value}>{children}</ProjectChatContext.Provider>
}

export function useProjectChat(): ProjectChatContextValue {
  const ctx = useContext(ProjectChatContext)
  if (!ctx) throw new Error('useProjectChat must be used inside <ProjectChatProvider>')
  return ctx
}
