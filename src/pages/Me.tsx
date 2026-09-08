import { useAuth } from '../contexts/AuthContext'
import MyTasksView from '../components/me/MyTasksView'

export default function Me() {
  const { user, profile, effectiveUid, effectiveProfile } = useAuth()
  // Sandbox: when a persona is being acted as, all "my tasks / my review
  // queue / my led teams" surfaces should reflect *that* persona's lens, not
  // the real visitor's. Production: effectiveUid === user.uid, no-op branch.
  const lensUid = __IS_SANDBOX__ ? (effectiveUid ?? user?.uid) : user?.uid
  const lensProfile = __IS_SANDBOX__ ? (effectiveProfile ?? profile) : profile

  const firstName = lensProfile?.displayName?.split(/\s+/)[0] ?? ''

  return (
    // max-w-7xl, not the 5xl this page used to be: the lists and the chart
    // column are two halves at lg and up and both need the room.
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8" data-tour-id="my-tasks">
      <MyTasksView
        uid={lensUid}
        profile={lensProfile}
        // Real auth uid, not the sandbox persona lens — time entries are always
        // authored as the actual signed-in visitor (the security rules pin an
        // entry's uid to request.auth.uid), so "my time" can only ever mean
        // that visitor's own logged time, persona or not.
        timeUid={user?.uid}
        heading={{
          eyebrow: 'My workspace',
          title: `Hi${firstName ? `, ${firstName}` : ''}. Here's what's on your plate.`,
        }}
      />
    </main>
  )
}
