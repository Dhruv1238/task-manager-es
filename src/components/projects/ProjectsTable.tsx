import { useNavigate } from 'react-router-dom'
import type { Project, User } from '../../types/models'
import ProjectStatusPill from '../workflow/ProjectStatusPill'
import UnreadChatBadge from './UnreadChatBadge'
import Avatar from '../ui/Avatar'
import StagePill from './StagePill'
import WorkflowBadge from './WorkflowBadge'
import { useWorkflow } from '../../contexts/AppConfigContext'
import { formatDeadline, submissionDeadline, isOverdue } from './projectListUtils'

interface Props {
  projects: Project[]
  userById: Map<string, User>
  chatEnabled: boolean
  chatLastReadAt: User['chatLastReadAt']
  // Phase 2b: parent computes whether the workflow column adds signal. When a
  // single workflow is active (e.g. basic-only tenant), the column is
  // redundant and the table omits it.
  showWorkflowColumn: boolean
}

export default function ProjectsTable({
  projects,
  userById,
  chatEnabled,
  chatLastReadAt,
  showWorkflowColumn,
}: Props) {
  const navigate = useNavigate()

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-fill-2 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
            <tr>
              <th scope="col" className="px-5 py-3">
                Project
              </th>
              <th scope="col" className="px-4 py-3">
                Status
              </th>
              {showWorkflowColumn && (
                <th scope="col" className="px-4 py-3">
                  Workflow
                </th>
              )}
              <th scope="col" className="px-4 py-3">
                Stage
              </th>
              <th scope="col" className="px-4 py-3">
                Owner
              </th>
              <th scope="col" className="px-4 py-3 whitespace-nowrap">
                Deadline
              </th>
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
              const owner = userById.get(p.ownerId)
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
                    <ProjectStatusPill status={p.status} size="sm" />
                  </td>

                  {showWorkflowColumn && (
                    <td className="px-4 py-3 align-middle">
                      <ProjectWorkflowCell projectId={p.id} workflowId={p.workflowId} />
                    </td>
                  )}
                  <td className="px-4 py-3 align-middle">
                    <StagePill project={p} />
                  </td>

                  <td className="px-4 py-3 align-middle">
                    {owner ? (
                      <div className="flex items-center gap-2">
                        <Avatar user={owner} size={22} />
                        <span className="max-w-40 truncate text-xs text-fg-muted">
                          {owner.displayName || owner.email}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-fg-faint">No owner</span>
                    )}
                  </td>

                  <td className="px-4 py-3 align-middle whitespace-nowrap">
                    <span
                      className={`text-xs ${
                        overdue ? 'font-medium text-tone-danger-fg' : 'text-fg-muted'
                      }`}
                    >
                      {overdue ? 'Overdue · ' : ''}
                      {formatDeadline(submissionDeadline(p))}
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

// Cell-scoped workflow lookup. Each row asks the context for its project's
// workflow — workflows in the active set return synchronously, ones for old
// projects on deactivated workflows lazy-fetch and resolve on the next
// render.
function ProjectWorkflowCell({
  projectId,
  workflowId,
}: {
  projectId: string
  workflowId: string | undefined
}) {
  void projectId
  const workflow = useWorkflow(workflowId)
  return <WorkflowBadge workflow={workflow} compact />
}
