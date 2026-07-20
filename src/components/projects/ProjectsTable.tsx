import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { Project, User } from '../../types/models'
import type { CustomFieldDef } from '../../types/workflow'
import ProjectStatusPill from '../workflow/ProjectStatusPill'
import UnreadChatBadge from './UnreadChatBadge'
import CorrigendumBadge from './CorrigendumBadge'
import FieldValue from '../fields/FieldValue'
import StagePill from './StagePill'
import ProjectHeadsCell from './ProjectHeadsCell'
import WorkflowBadge from './WorkflowBadge'
import { useProjectWorkflow } from '../../contexts/AppConfigContext'
import { formatDeadline, submissionDeadline, deadlineHasTime, isOverdue } from './projectListUtils'

// Server-sortable columns (stored fields with a Firestore orderBy). Deadline is
// derived (submissionDate ?? deadline) and sorts client-side over loaded rows.
export type ProjectSortField = 'createdAt' | 'titleLower' | 'status'
export type ProjectTableSort = { field: ProjectSortField | 'deadline'; dir: 'asc' | 'desc' }

interface Props {
  projects: Project[]
  userById: Map<string, User>
  chatEnabled: boolean
  chatLastReadAt: User['chatLastReadAt']
  // The extra "corrigendum" section feature — its unread badge + the user's seen marks.
  corrigendumEnabled: boolean
  corrigendumSectionName: string
  corrigendumSeenAt: User['corrigendumSeenAt']
  // Phase 2b: parent computes whether the workflow column adds signal. When a
  // single workflow is active (e.g. basic-only tenant), the column is
  // redundant and the table omits it.
  showWorkflowColumn: boolean
  // Phase 2d: dynamic columns, one per custom field with 'listColumn' in its
  // surfaces, unioned across the visible projects' pinned workflows by the
  // parent. Rendered blank where a project's workflow lacks the field.
  listColumnFields: CustomFieldDef[]
  sort?: ProjectTableSort
  onSort?: (field: ProjectSortField | 'deadline') => void
  // Firestore forbids orderBy on an equality-filtered field, so the Status
  // header goes inert while a status filter is active.
  statusSortDisabled?: boolean
  // Search owns the orderBy (titleLower prefix scan) — all header sorts inert.
  searching?: boolean
}

function SortableHeader({
  label,
  field,
  sort,
  onSort,
  disabled,
  disabledTitle,
  title,
  className = 'px-4 py-3',
}: {
  label: string
  field: ProjectSortField | 'deadline'
  sort?: ProjectTableSort
  onSort?: (field: ProjectSortField | 'deadline') => void
  disabled?: boolean
  disabledTitle?: string
  title?: string
  className?: string
}) {
  const active = sort?.field === field
  const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined
  if (!onSort) {
    return (
      <th scope="col" className={className}>
        {label}
      </th>
    )
  }
  return (
    <th scope="col" className={className} aria-sort={ariaSort}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSort(field)}
        title={disabled ? disabledTitle : title}
        className={`inline-flex items-center gap-1 uppercase tracking-wider transition ${
          disabled
            ? 'cursor-not-allowed text-fg-faint'
            : active
              ? 'text-fg'
              : 'text-fg-subtle hover:text-fg'
        }`}
      >
        {label}
        {active &&
          (sort!.dir === 'asc' ? (
            <ChevronUp size={12} aria-hidden />
          ) : (
            <ChevronDown size={12} aria-hidden />
          ))}
      </button>
    </th>
  )
}

// Narrow short-date for the Created column — gives the createdAt sort a
// visible home in the table.
function formatCreated(p: Project): string {
  const seconds = p.createdAt?.seconds
  if (typeof seconds !== 'number' || seconds === 0) return '—'
  return new Date(seconds * 1000).toLocaleDateString(undefined, {
    year: '2-digit',
    month: 'short',
    day: 'numeric',
  })
}

export default function ProjectsTable({
  projects,
  userById,
  chatEnabled,
  chatLastReadAt,
  corrigendumEnabled,
  corrigendumSectionName,
  corrigendumSeenAt,
  showWorkflowColumn,
  listColumnFields,
  sort,
  onSort,
  statusSortDisabled,
  searching,
}: Props) {
  const navigate = useNavigate()
  const sortHandler = searching ? undefined : onSort
  const sortState = searching ? undefined : sort

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-fill-2 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
            <tr>
              <SortableHeader
                label="Project"
                field="titleLower"
                sort={sortState}
                onSort={sortHandler}
                className="px-5 py-3"
              />
              <SortableHeader
                label="Status"
                field="status"
                sort={sortState}
                onSort={sortHandler}
                disabled={statusSortDisabled}
                disabledTitle="Clear the status filter to sort by status"
              />
              {showWorkflowColumn && (
                <th scope="col" className="px-4 py-3">
                  Workflow
                </th>
              )}
              <th scope="col" className="px-4 py-3">
                Stage
              </th>
              <th scope="col" className="px-4 py-3">
                Heads
              </th>
              {listColumnFields.map((f) => (
                <th key={f.id} scope="col" className="px-4 py-3 whitespace-nowrap">
                  {f.label}
                </th>
              ))}
              <SortableHeader
                label="Created"
                field="createdAt"
                sort={sortState}
                onSort={sortHandler}
                className="px-4 py-3 whitespace-nowrap"
              />
              <SortableHeader
                label="Deadline"
                field="deadline"
                sort={sortState}
                onSort={sortHandler}
                title="Sorts the loaded projects only"
                className="px-4 py-3 whitespace-nowrap"
              />
              <th scope="col" className="px-4 py-3 text-right">
                Teams
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Files
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                <span className="sr-only">Open project</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {projects.map((p) => {
              const overdue = isOverdue(p)
              const teamCount = p.teamIds?.length ?? 0
              const fileCount = p.attachments?.length ?? 0
              const href = `/projects/${p.id}`

              // Row navigation handled here so the whole row reads as a single
              // clickable target. The title cell still wraps a real <a> so
              // cmd/ctrl+click, middle-click, and keyboard focus all work.
              const goto = (
                e: React.MouseEvent | React.KeyboardEvent,
                mode: 'same' | 'maybe-new' = 'same',
              ) => {
                if (mode === 'maybe-new') {
                  const me = e as React.MouseEvent
                  if (me.metaKey || me.ctrlKey || me.shiftKey || me.button === 1) return
                }
                e.preventDefault()
                navigate(href)
              }

              return (
                <tr
                  key={p.id}
                  onClick={(e) => {
                    // Don't hijack clicks on nested interactive elements (the
                    // title link / open button handle their own navigation).
                    const target = e.target as HTMLElement
                    if (target.closest('a,button')) return
                    navigate(href)
                  }}
                  className="cursor-pointer transition hover:bg-fill-2"
                >
                  <td className="max-w-[18rem] px-5 py-3 align-middle">
                    <div className="flex items-center gap-2">
                      {chatEnabled && (
                        <UnreadChatBadge
                          chatLastMessageAt={p.chatLastMessageAt}
                          lastReadAt={chatLastReadAt?.[p.id]}
                        />
                      )}
                      {corrigendumEnabled && (
                        <CorrigendumBadge
                          corrigendumLastUploadAt={p.corrigendumLastUploadAt}
                          seenAt={corrigendumSeenAt?.[p.id]}
                          label={corrigendumSectionName}
                        />
                      )}
                      <div className="min-w-0">
                        <a
                          href={href}
                          onClick={(e) => goto(e, 'maybe-new')}
                          className="block truncate font-semibold text-fg hover:underline"
                          title={p.title}
                        >
                          {p.title}
                        </a>
                        {p.description && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-fg-subtle">
                            {p.description}
                          </p>
                        )}
                      </div>
                      {(p.iterationCount ?? 0) > 0 && (
                        <span
                          className="ml-1 inline-flex shrink-0 items-center rounded-full border border-tone-accent-bd bg-tone-accent-bg px-2 py-0.5 text-[10px] font-medium text-tone-accent-fg"
                          title={`Iteration ${(p.iterationCount ?? 0) + 1}`}
                        >
                          Iter {(p.iterationCount ?? 0) + 1}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-4 py-3 align-middle">
                    <ProjectStatusPill status={p.status} workflow={p.pinnedWorkflow} size="sm" />
                  </td>

                  {showWorkflowColumn && (
                    <td className="px-4 py-3 align-middle">
                      <ProjectWorkflowCell project={p} />
                    </td>
                  )}
                  <td className="px-4 py-3 align-middle">
                    <StagePill project={p} />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <ProjectHeadsCell project={p} userById={userById} />
                  </td>

                  {listColumnFields.map((f) => (
                    <td key={f.id} className="px-4 py-3 align-middle text-xs">
                      <FieldValue
                        field={f}
                        value={p.fields?.[f.id]}
                        density="cell"
                        resolveUser={(uid) => userById.get(uid)}
                      />
                    </td>
                  ))}

                  <td className="px-4 py-3 align-middle whitespace-nowrap">
                    <span className="text-xs text-fg-muted">{formatCreated(p)}</span>
                  </td>

                  <td className="px-4 py-3 align-middle whitespace-nowrap">
                    <span
                      className={`text-xs ${
                        overdue ? 'font-medium text-tone-danger-fg' : 'text-fg-muted'
                      }`}
                    >
                      {overdue ? 'Overdue · ' : ''}
                      {formatDeadline(submissionDeadline(p), deadlineHasTime(p))}
                    </span>
                  </td>

                  <td className="px-4 py-3 align-middle text-right">
                    <span className="text-xs text-fg-muted">{teamCount}</span>
                  </td>

                  <td className="px-4 py-3 align-middle text-right">
                    {fileCount > 0 ? (
                      <span
                        className="inline-flex items-center gap-1 text-xs text-fg-muted"
                        title={`${fileCount} attachment${fileCount === 1 ? '' : 's'}`}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                        </svg>
                        {fileCount}
                      </span>
                    ) : (
                      <span className="text-xs text-fg-faint">—</span>
                    )}
                  </td>

                  <td className="px-4 py-3 align-middle text-right">
                    <a
                      href={href}
                      onClick={(e) => goto(e, 'maybe-new')}
                      className="inline-flex items-center gap-1 rounded-md border border-line bg-fill-2 px-2.5 py-1 text-xs font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg"
                    >
                      Open
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </a>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Cell-scoped workflow lookup. Prefers the pinned snapshot on the project so
// label + flowType color match what the project was created on — workflow
// edits don't propagate.
function ProjectWorkflowCell({ project }: { project: Project }) {
  const workflow = useProjectWorkflow(project)
  return <WorkflowBadge workflow={workflow} compact />
}
