import {
  collection,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import type { ChatAttachment } from '../types/models'

export interface SendMessageInput {
  projectId: string
  authorId: string
  text: string
  attachments?: ChatAttachment[]
}

// Create a new chat message. Bumps `projects/{id}.chatLastMessageAt` in the
// same writeBatch so the projects-list unread dot updates without a second
// round trip. The Firestore SDK echoes the local write back through the
// onSnapshot listener immediately — that's our optimistic UI.
export async function sendMessage(input: SendMessageInput): Promise<string> {
  const text = input.text.trim()
  const attachments = input.attachments ?? []
  if (!text && attachments.length === 0) {
    throw new Error('Cannot send an empty message.')
  }

  const msgRef = doc(collection(db, 'projects', input.projectId, 'chat'))
  const projectRef = doc(db, 'projects', input.projectId)

  const batch = writeBatch(db)
  const payload: Record<string, unknown> = {
    authorId: input.authorId,
    text,
    createdAt: serverTimestamp(),
    serverUpdatedAt: serverTimestamp(),
  }
  if (attachments.length > 0) payload.attachments = attachments
  batch.set(msgRef, payload)
  batch.update(projectRef, { chatLastMessageAt: serverTimestamp() })

  await batch.commit()
  return msgRef.id
}

export interface EditMessageInput {
  projectId: string
  messageId: string
  newText: string
}

export async function editMessage(input: EditMessageInput): Promise<void> {
  const text = input.newText.trim()
  if (!text) throw new Error('Edited message cannot be empty.')

  const msgRef = doc(db, 'projects', input.projectId, 'chat', input.messageId)
  const projectRef = doc(db, 'projects', input.projectId)

  const batch = writeBatch(db)
  batch.update(msgRef, {
    text,
    editedAt: serverTimestamp(),
    serverUpdatedAt: serverTimestamp(),
  })
  batch.update(projectRef, { chatLastMessageAt: serverTimestamp() })
  await batch.commit()
}

// Update the user's last-read timestamp for a project. Uses dot-notation so
// only the single map key is touched — other entries in `chatLastReadAt` are
// preserved. The unread badge re-renders off the optimistic in-memory copy in
// ProjectChatContext; the Firestore write merely persists the high-water mark
// so the badge stays cleared after a reload.
export async function markChatRead(uid: string, projectId: string): Promise<void> {
  const ref = doc(db, 'users', uid)
  await updateDoc(ref, {
    [`chatLastReadAt.${projectId}`]: serverTimestamp(),
  })
}
