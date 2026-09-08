import type { Ref } from 'react'
import { Link } from 'react-router-dom'
import type { Task } from '../../types/models'
import type { ActionableProject } from '../../hooks/useProjectsAwaitingMyAction'
import { stageTone } from '../workflow/stageStyle'
import TaskListRow from '../tasks/TaskListRow'
import CollapsibleSection from '../ui/CollapsibleSection'

interface Props {
  /** Tasks where this person is the named reviewer. */
  reviewQueue: Task[]
  /** Projects whose workflow is blocked on this person. */
  actionable: ActionableProject[]
  /** Wording comes from the page, so /me and the admin view can differ. See copy.ts. */
  description: string
  reviewHeading: string
  projectsHeading: string
  emptyLabel: string
  loading: boolean
  /**
   * Review-queue load failure. Load-bearing: this section is ALWAYS rendered
   * now, so without it a failed query renders "Nothing is waiting on you." —
   * an affirmative claim — to someone with a full review queue. The composite
   * index this query needs is created by hand (see useMyReviewQueue), so a
   * tenant missing it would be told, confidently, that it has nothing to do.
   */
  error?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Target for the "Pending actions" tile's scrollIntoView. */
  ref?: Ref<HTMLElement>
}

// Escalation flavour: literal class pairs, picked whole rather than composed,
// because a Tailwind class is never interpolated (src/lib/taskStatus.ts:21).
type Flavour = 'warn' | 'danger'

const ROW_CLS: Record<Flavour, string> = {
  warn: 'flex items-center gap-2.5 rounded-xl border border-tone-warn-bd bg-tone-warn-bg px-3 py-2 transition hover:opacity-90',
  danger:
    'flex items-center gap-2.5 rounded-xl border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 transition hover:opacity-90',
}
const CTA_CLS: Record<Flavour, string> = {
  warn: 'hidden shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-tone-warn-fg sm:inline-flex',
  danger:
    'hidden shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-tone-danger-fg sm:inline-flex',
}

/**
 * Everything the workflow is waiting on this person for: tasks to review and
 * projects to move forward, as ONE-LINE rows.
 *
 * Compactness is the whole point of this section. The two-column cards it
 * replaced (with a workflow badge and a description paragraph each) pushed the
 * actual task lists below the fold for anyone with a real inbox — which is what
 * motivated the redesign. Everything a row needs to be triaged is on its line:
 * where the project stands, what it is, and what is being asked.
 */
export default function PendingActionsSection({
  reviewQueue,
  actionable,
  description,
  reviewHeading,
  projectsHeading,
  emptyLabel,
  loading,
  error,
  open,
  onOpenChange,
  ref,
}: Props) {
  const total = reviewQueue.length + actionable.length

  return (
    <CollapsibleSection
      ref={ref}
      title="Pending actions"
      description={description}
      count={total}
      tone="warn"
      tourId="review-queue"
      open={open}
      onOpenChange={onOpenChange}
      // No margin: the left column owns section spacing (space-y-8).
      // scroll-mt clears the 4rem sticky navbar when the "Pending actions"
      // tile scrollIntoView()s this section, which would otherwise land the
      // heading and its Hide control behind the bar.
      className="scroll-mt-24"
    >
      <div className="space-y-5">
        {reviewQueue.length > 0 && (
          <div>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-brand">
              {reviewHeading}
            </h3>
            <ul className="space-y-1">
              {reviewQueue.map((t) => (
                <TaskListRow
                  key={t.id}
                  task={t}
                  // Who submitted it is the most useful triage field on this
                  // list, so it stays on the row as it was before.
                  meta={t.assigneeName ? `from ${t.assigneeName}` : undefined}
                  right={
                    <span className="text-xs font-medium text-brand">
                      Review <span aria-hidden>→</span>
                    </span>
                  }
                />
              ))}
            </ul>
          </div>
        )}

        {actionable.length > 0 && (
          <div>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-tone-warn-fg">
              {projectsHeading}
            </h3>
            {/* Tour anchor — lib/tours/sixtySecondTour.ts targets this list. */}
            <ul className="space-y-1" data-tour-id="projects-awaiting-action">
              {actionable.map(({ project, cta, reason, workflow }) => {
                const stage =
                  workflow.stages.find((s) => s.id === project.currentStageId) ??
                  workflow.stages[0]
                const tone = stageTone(stage?.order ?? 1, stage?.isTerminal ?? false)
                // A project that has been escalated AND is back at the starting
                // stage (or waiting on allocation) is not merely pending, it has
                // already slipped — say so in danger rather than warn.
                const isEscalated =
                  (project.escalationCount ?? 0) > 0 &&
                  (stage?.id === workflow.stages[0]?.id || reason === 'allocate')
                const flavour: Flavour = isEscalated ? 'danger' : 'warn'
                return (
                  <li key={project.id}>
                    <Link to={`/projects/${project.id}`} className={ROW_CLS[flavour]}>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone.pill}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
                        {stage?.displayName ?? '—'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                        {project.title}
                      </span>
                      <span className={CTA_CLS[flavour]}>
                        {cta}
                        <span aria-hidden>→</span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-tone-danger-bd bg-tone-danger-bg p-4 text-sm text-tone-danger-fg">
            Couldn't load your review queue: {error}
            {error.includes('index') && (
              <div className="mt-2 text-tone-danger-fg/70">
                Firestore wants a composite index on{' '}
                <code className="rounded bg-fill-2 px-1">reviewerId</code> +{' '}
                <code className="rounded bg-fill-2 px-1">status</code>. Open the link in your
                browser console to create it.
              </div>
            )}
          </div>
        )}

        {total === 0 &&
          !error &&
          (loading ? (
            <p className="rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-fg-subtle">
              Checking what needs attention…
            </p>
          ) : (
            <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-fg-subtle">
              {emptyLabel}
            </p>
          ))}
      </div>
    </CollapsibleSection>
  )
}
