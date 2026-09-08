import type { ReactNode } from 'react'
import type { ProjectBucket } from '../../lib/myTasksDerive'
import CollapsibleSection from '../ui/CollapsibleSection'
import GroupedTaskList from './GroupedTaskList'

interface Props {
  title: string
  description?: ReactNode
  count: number
  grouped: ProjectBucket[]
  loading: boolean
  error: string | null
  /**
   * Caller-supplied empty copy: "nothing assigned yet" and "no open team-level
   * tasks" are different sentences, and only the caller knows which of its
   * toggles is hiding the rows.
   */
  emptyState: ReactNode
  showSubtaskProgress?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  tourId?: string
}

/**
 * A collapsible task list with the error / loading / empty / list ladder —
 * shared by "Assigned to me" and "Led by me" so the two can't drift.
 */
export default function TaskListSection({
  title,
  description,
  count,
  grouped,
  loading,
  error,
  emptyState,
  showSubtaskProgress,
  open,
  onOpenChange,
  tourId,
}: Props) {
  return (
    <CollapsibleSection
      title={title}
      description={description}
      count={count}
      open={open}
      onOpenChange={onOpenChange}
      tourId={tourId}
      // The left column owns section spacing (space-y-8), so no margin here.
      className=""
    >
      {error ? (
        <div className="rounded-2xl border border-tone-danger-bd bg-tone-danger-bg p-6 text-sm text-tone-danger-fg">
          Couldn't load these tasks: {error}
          {/* The task queries sort by updatedAt on top of an equality filter,
              which Firestore can only serve from a composite index. Point at
              the console link rather than leaving a raw error string. */}
          {error.includes('index') && (
            <div className="mt-2 text-tone-danger-fg/70">
              Firestore wants a composite index on{' '}
              <code className="rounded bg-fill-2 px-1">assigneeId</code> +{' '}
              <code className="rounded bg-fill-2 px-1">updatedAt</code>. Open the link in your
              browser console to create it.
            </div>
          )}
        </div>
      ) : loading ? (
        <div className="rounded-2xl border border-line bg-card p-10 text-center text-sm text-fg-subtle">
          Loading tasks…
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-card p-10 text-center">
          {emptyState}
        </div>
      ) : (
        <GroupedTaskList grouped={grouped} showSubtaskProgress={showSubtaskProgress} />
      )}
    </CollapsibleSection>
  )
}
