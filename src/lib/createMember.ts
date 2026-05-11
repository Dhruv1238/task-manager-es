import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth'
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db, firebaseConfig } from './firebase'
import type { GlobalRole } from '../types/models'
import { recordAuditEvent } from './firestore'

export interface CreateMemberResult {
  uid: string
  email: string
  tempPassword: string
}

export function generateTempPassword(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6).toUpperCase()
  )
}

// Creates an Auth account via a secondary Firebase app so the admin's own session isn't hijacked.
// See TASK_MANAGEMENT_MVP.md §13.2.
export async function createMember(
  email: string,
  displayName: string,
  tempPassword: string,
  adminUid: string,
  adminName: string,
  globalRole: GlobalRole = 'user',
): Promise<CreateMemberResult> {
  const secondary = initializeApp(firebaseConfig, `Secondary-${Date.now()}`)
  try {
    const secondaryAuth = getAuth(secondary)
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, tempPassword)

    const batch = writeBatch(db)
    batch.set(doc(db, 'users', cred.user.uid), {
      uid: cred.user.uid,
      email,
      displayName,
      displayNameLower: displayName.trim().toLowerCase(),
      globalRole,
      teamIds: [],
      tempPassword,
      createdBy: adminUid,
      createdAt: serverTimestamp(),
    })
    recordAuditEvent({
      actorId: adminUid,
      actorName: adminName,
      action: 'user.created',
      targetType: 'user',
      targetId: cred.user.uid,
      targetTitle: displayName,
      payload: { email, globalRole },
      batch,
    })
    await batch.commit()

    await secondaryAuth.signOut()
    return { uid: cred.user.uid, email, tempPassword }
  } finally {
    await deleteApp(secondary)
  }
}