import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import { clearAllSyncStateForUser } from '../lib/chatSyncState'
import type { User as UserProfile } from '../types/models'

type AuthContextValue = {
  user: FirebaseUser | null
  profile: UserProfile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// Bootstrap email — when this account is the first to sign in to a fresh Firebase
// project, it auto-provisions as super_admin so the workspace is operable. After
// that, super_admins manage roles via /admin/members.
const BOOTSTRAP_SUPER_ADMIN_EMAIL = 'taskmanager@ai.com'

async function upsertUserProfile(u: FirebaseUser): Promise<UserProfile> {
  const ref = doc(db, 'users', u.uid)
  const snap = await getDoc(ref)
  if (snap.exists()) {
    return snap.data() as UserProfile
  }

  const isBootstrap = (u.email ?? '').toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL
  await setDoc(ref, {
    uid: u.uid,
    email: u.email ?? '',
    displayName: u.displayName ?? u.email?.split('@')[0] ?? 'User',
    globalRole: isBootstrap ? 'super_admin' : 'user',
    teamIds: [],
    createdAt: serverTimestamp(),
  })
  const resolved = await getDoc(ref)
  return resolved.data() as UserProfile
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u)
      if (!u) {
        setProfile(null)
        setLoading(false)
        return
      }
      const p = await upsertUserProfile(u)
      setProfile(p)
      setLoading(false)
    })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      signIn: async (email, password) => {
        await signInWithEmailAndPassword(auth, email, password)
      },
      signOut: async () => {
        // Drop this device's chat high-water marks for the outgoing user so a
        // different login on the same device gets a fresh sync state.
        const uid = user?.uid
        if (uid) clearAllSyncStateForUser(uid)
        await signOut(auth)
      },
    }),
    [user, profile, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}