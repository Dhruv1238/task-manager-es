import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db, firebaseConfig } from './firebase'

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
): Promise<CreateMemberResult> {
  const secondary = initializeApp(firebaseConfig, `Secondary-${Date.now()}`)
  try {
    const secondaryAuth = getAuth(secondary)
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, tempPassword)

    await setDoc(doc(db, 'users', cred.user.uid), {
      uid: cred.user.uid,
      email,
      displayName,
      globalRole: 'user',
      teamIds: [],
      tempPassword,
      createdBy: adminUid,
      createdAt: serverTimestamp(),
    })

    await secondaryAuth.signOut()
    return { uid: cred.user.uid, email, tempPassword }
  } finally {
    await deleteApp(secondary)
  }
}