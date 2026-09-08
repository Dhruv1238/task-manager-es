import { useNavigate, useParams } from 'react-router-dom'
import { useAllUsers } from '../hooks/useAllUsers'
import MyTasksView from '../components/me/MyTasksView'
import Avatar from '../components/ui/Avatar'
import UserPicker from '../components/ui/UserPicker'

/**
 * Admin "Member Tasks" — one member's /me page, rendered by the very same
 * MyTasksView the member sees. Nothing is re-implemented here, so the two
 * surfaces can never drift apart.
 *
 * The URL is the single source of truth for the selection: the picker
 * NAVIGATES rather than setting state, which buys back/forward navigation and
 * deep links for free and keeps us clear of the react-hooks v7
 * set-state-in-effect rule that mirroring a param into state would trip.
 *
 * Deliberately no timesheet: admins have /admin/time, and a personal
 * "My time" panel borrowed for someone else would read as the admin's own.
 */
export default function MemberTasks() {
  const { uid } = useParams<{ uid: string }>()
  const navigate = useNavigate()
  const { users, loading } = useAllUsers()

  const viewed = uid ? users.find((u) => u.uid === uid) ?? null : null
  // Must never be empty: myTasksCopy('') means "the reader is the person", so a
  // member with a blank displayName would address the admin as if this were
  // their own plate. Fall back through email to a generic label.
  const firstName =
    viewed?.displayName?.trim().split(/\s+/)[0] ||
    viewed?.email?.split('@')[0] ||
    'this member'

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wider text-fg-faint">Admin</p>
        <h1 className="mt-1 text-2xl font-semibold text-fg-strong">Member Tasks</h1>
        <p className="mt-2 max-w-3xl text-sm text-fg-subtle">
          Exactly what a member sees on their own My Tasks page — their tiles, sections and
          charts — one person at a time.
        </p>
      </header>

      <div className="mb-8 max-w-md">
        <label htmlFor="member-tasks-user" className="mb-1.5 block text-xs font-medium text-fg-subtle">
          Member
        </label>
        <UserPicker
          id="member-tasks-user"
          mode="single"
          clearable
          value={uid ?? null}
          placeholder="Choose a member…"
          onChange={(next) =>
            navigate(next ? `/admin/member-tasks/${next}` : '/admin/member-tasks')
          }
        />
      </div>

      {!uid ? (
        <div className="rounded-2xl border border-dashed border-line bg-card p-12 text-center">
          <h2 className="text-lg font-medium text-fg">Pick a member to begin</h2>
          <p className="mt-2 text-sm text-fg-subtle">
            Choose someone above and their My Tasks page loads here, unchanged.
          </p>
        </div>
      ) : loading ? (
        <div className="flex min-h-[40vh] items-center justify-center text-fg-subtle">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-fg-strong" />
        </div>
      ) : !viewed ? (
        <div className="rounded-2xl border border-dashed border-line bg-card p-12 text-center">
          <h2 className="text-lg font-medium text-fg">That member doesn&apos;t exist</h2>
          <p className="mt-2 text-sm text-fg-subtle">
            No user in this org has the id in the URL. Pick someone from the list above.
          </p>
        </div>
      ) : (
        /* key={uid} REMOUNTS the whole view per member: every Firestore
           listener under it tears down cleanly, and — more importantly — the
           task hooks set `loading` but do NOT clear their task state when the
           uid changes, so without a remount member A's rows flash underneath
           member B's name. */
        <MyTasksView
          key={uid}
          uid={uid}
          profile={viewed}
          // Switches every shared section out of first person: "Assigned to
          // Sneha", not "Assigned to me". See components/me/copy.ts.
          personName={firstName}
          heading={{
            eyebrow: 'Member Tasks',
            title: (
              <span className="inline-flex items-center gap-3">
                <Avatar user={viewed} size={36} />
                Viewing {firstName}&apos;s plate
              </span>
            ),
          }}
        />
      )}
    </main>
  )
}
