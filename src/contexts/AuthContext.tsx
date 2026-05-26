import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { onSnapshot } from 'firebase/firestore'
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth'
import {
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import { auth } from '../lib/firebase'
import { tenantCol, tenantDoc } from '../lib/firestore'
import { clearAllSyncStateForUser } from '../lib/chatSyncState'
import type { User as UserProfile } from '../types/models'

// Thrown during sign-in when the authenticated email has no matching record in
// the workspace. Signals the auth listener to bounce the session and surface a
// targeted message on the login screen.
class UnregisteredEmailError extends Error {
  email: string
  constructor(email: string) {
    super(`The email ${email} is not registered in this workspace.`)
    this.name = 'UnregisteredEmailError'
    this.email = email
  }
}

type AuthContextValue = {
  user: FirebaseUser | null
  profile: UserProfile | null
  loading: boolean
  signInError: string | null
  signIn: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  clearSignInError: () => void
  // Sandbox-only persona switching. In production these are always null/no-op.
  // `effectiveUid` is what permission code should read instead of authUser.uid
  // — it equals actAsUid when set, else the real auth uid.
  actAsUid: string | null
  effectiveUid: string | null
  // The profile permissions should resolve against. Equals `profile` when no
  // persona is being acted as; equals the persona's user doc when actAsUid is
  // set. usePermissions reads role + teamIds from this. Production: always
  // equals `profile`.
  effectiveProfile: UserProfile | null
  setActAs: (uid: string | null) => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// Bootstrap emails — any account in this list that's the first to sign in to a
// fresh Firebase project auto-provisions as super_admin so the workspace is
// operable. After that, super_admins manage roles via /admin/members.
const BOOTSTRAP_SUPER_ADMIN_EMAILS = new Set([
  'taskmanager@ai.com',
  'dhruv.sharma1@eventstrat.ai',
])

async function upsertUserProfile(u: FirebaseUser): Promise<UserProfile> {
  const ref = tenantDoc('users', u.uid)
  const snap = await getDoc(ref)
  if (snap.exists()) {
    return snap.data() as UserProfile
  }

  const email = u.email ?? ''
  const isBootstrap = BOOTSTRAP_SUPER_ADMIN_EMAILS.has(email.toLowerCase())

  // Sandbox: every visitor is the implicit super_admin of their own /sandbox/
  // subtree, so unknown emails should never bounce. sandboxBoot.runPhaseA also
  // writes this doc, but the two listeners race — we may land here first.
  // Both writes are byte-equivalent for the role/teamIds fields, so the
  // last-write-wins outcome is consistent either way.
  if (__IS_SANDBOX__) {
    const displayName = u.displayName ?? email.split('@')[0] ?? 'You'
    await setDoc(ref, {
      uid: u.uid,
      email,
      displayName,
      displayNameLower: displayName.toLowerCase(),
      ...(u.photoURL ? { photoURL: u.photoURL } : {}),
      globalRole: 'super_admin',
      teamIds: [],
      createdAt: serverTimestamp(),
    })
    const resolved = await getDoc(ref)
    return resolved.data() as UserProfile
  }

  // Bridge for Google sign-in: an admin-provisioned user has a Firestore doc
  // keyed by their email/password uid. Their Google identity gets a different
  // uid, so look up by email and copy role/team data into a doc keyed by the
  // new uid. The legacy doc is left in place — its uid may still be referenced
  // by createdBy/teamId fields elsewhere.
  if (email) {
    const matches = await getDocs(
      query(tenantCol('users'), where('email', '==', email)),
    )
    const existing = matches.docs[0]?.data() as UserProfile | undefined
    if (existing) {
      await setDoc(ref, {
        uid: u.uid,
        email,
        displayName: existing.displayName ?? u.displayName ?? email.split('@')[0] ?? 'User',
        photoURL: u.photoURL ?? existing.photoURL,
        globalRole: existing.globalRole,
        teamIds: existing.teamIds ?? [],
        createdAt: serverTimestamp(),
      })
      const resolved = await getDoc(ref)
      return resolved.data() as UserProfile
    }
  }

  if (!isBootstrap) {
    throw new UnregisteredEmailError(email)
  }

  await setDoc(ref, {
    uid: u.uid,
    email,
    displayName: u.displayName ?? email.split('@')[0] ?? 'User',
    globalRole: 'super_admin',
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
  const [signInError, setSignInError] = useState<string | null>(null)
  const [actAsUid, setActAsState] = useState<string | null>(null)
  const [personaProfile, setPersonaProfile] = useState<UserProfile | null>(null)

  // Sandbox persona-doc subscription. When actAsUid is set, stream the
  // persona's user doc so `effectiveProfile` reflects their role + team
  // membership. usePermissions reads from effectiveProfile, so this is how
  // switching personas actually flips what the UI shows.
  useEffect(() => {
    if (!__IS_SANDBOX__) return
    if (!actAsUid) {
      setPersonaProfile(null)
      return
    }
    const ref = tenantDoc('users', actAsUid)
    return onSnapshot(ref, (snap) => {
      setPersonaProfile(snap.exists() ? (snap.data() as UserProfile) : null)
    })
  }, [actAsUid])

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setUser(null)
        setProfile(null)
        setLoading(false)
        return
      }
      try {
        const p = await upsertUserProfile(u)
        setSignInError(null)
        setUser(u)
        setProfile(p)
      } catch (err) {
        if (err instanceof UnregisteredEmailError) {
          setSignInError(err.message)
        } else {
          setSignInError(err instanceof Error ? err.message : 'Sign-in failed.')
        }
        setUser(null)
        setProfile(null)
        await signOut(auth)
      } finally {
        setLoading(false)
      }
    })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      signInError,
      signIn: async (email, password) => {
        setSignInError(null)
        await signInWithEmailAndPassword(auth, email, password)
      },
      signInWithGoogle: async () => {
        setSignInError(null)
        const provider = new GoogleAuthProvider()
        provider.setCustomParameters({ prompt: 'select_account' })
        await signInWithPopup(auth, provider)
      },
      signOut: async () => {
        // Drop this device's chat high-water marks for the outgoing user so a
        // different login on the same device gets a fresh sync state.
        const uid = user?.uid
        if (uid) clearAllSyncStateForUser(uid)
        await signOut(auth)
      },
      clearSignInError: () => setSignInError(null),
      actAsUid,
      effectiveUid: __IS_SANDBOX__ ? (actAsUid ?? user?.uid ?? null) : (user?.uid ?? null),
      effectiveProfile: __IS_SANDBOX__ && actAsUid ? (personaProfile ?? profile) : profile,
      setActAs: (uid: string | null) => {
        // Hard-gated on the build flag so production bundles tree-shake the
        // state setter call entirely.
        if (!__IS_SANDBOX__) return
        setActAsState(uid)
      },
    }),
    [user, profile, loading, signInError, actAsUid, personaProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}