import { useEffect, useMemo, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import { Timestamp } from 'firebase/firestore'
import Modal from '../ui/Modal'
import TeamPicker from '../ui/TeamPicker'
import UserPicker from '../ui/UserPicker'
import { useAuth } from '../../contexts/AuthContext'
import { useAllTeams } from '../../hooks/useAllTeams'
import { useAllUsers } from '../../hooks/useAllUsers'
import { useTaskTemplates } from '../../hooks/useTaskTemplates'
import { addTeamTask } from '../../lib/firestore'
import type { TaskPriority, WorkType } from '../../types/models'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  projectTitle: string
  // When provided, the form starts pinned to this team (existing v1 callers).
  // When omitted (e.g., VH adding tasks from the project page), the user picks via template.
  teamId?: string
  teamName?: string
}

function friendlyError(err: unknown): string {
  if (err instanceof FirebaseError) return err.message
  return err instanceof Error ? err.message : 'Something went wrong.'
}

const PRIORITIES: { value: TaskPriority; label: string; cls: string }[] = [
  { value: 'low', label: 'Low', cls: 'text-white/70' },
  { value: 'medium', label: 'Medium', cls: 'text-amber-200' },
  { value: 'high', label: 'High', cls: 'text-red-200' },
]

const CUSTOM = 'custom' as const

export default function NewTaskModal({
  open,
  onClose,
  projectId,
  projectTitle,
  teamId: initialTeamId,
  teamName: initialTeamName,
}: Props) {
  const { user, profile } = useAuth()
  const { teams } = useAllTeams()
  const { users } = useAllUsers()
  const { templates } = useTaskTemplates()

  const [templateCode, setTemplateCode] = useState<WorkType | typeof CUSTOM>(CUSTOM)
  const [teamId, setTeamId] = useState<string | null>(initialTeamId ?? null)
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [dueDate, setDueDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTemplateCode(CUSTOM)
      setTeamId(initialTeamId ?? null)
      setAssigneeId(null)
      setTitle('')
      setDescription('')
      setPriority('medium')
      setDueDate('')
      setError(null)
      setSubmitting(false)
    }
  }, [open, initialTeamId])

  const teamById = useMemo(() => {
    const m = new Map<string, (typeof teams)[number]>()
    for (const t of teams) m.set(t.id, t)
    return m
  }, [teams])

  const userById = useMemo(() => {
    const m = new Map<string, (typeof users)[number]>()
    for (const u of users) m.set(u.uid, u)
    return m
  }, [users])

  const selectedTeam = teamId ? teamById.get(teamId) : undefined
  // Eligible assignees = team lead + members; fed to UserPicker as includeUids.
  const teamMemberUids = selectedTeam
    ? Array.from(new Set([selectedTeam.leadId, ...selectedTeam.memberIds]))
    : []

  // When the user picks a predefined template, auto-fill team + assignee. Title
  // stays user-controlled — templates shouldn't dictate the wording of the task.
  function applyTemplate(code: WorkType | typeof CUSTOM) {
    setTemplateCode(code)
    if (code === CUSTOM) return
    const tpl = templates.find((t) => t.code === code)
    if (!tpl) return
    const team = teamById.get(tpl.teamId)
    if (team) {
      setTeamId(team.id)
      setAssigneeId(team.leadId)
    } else {
      setTeamId(tpl.teamId)
    }
  }

  async function handleSubmit() {
    if (!user) return
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError('Task title is required.')
      return
    }
    if (!teamId) {
      setError('Pick a team for this task.')
      return
    }
    const team = teamById.get(teamId)
    if (!team) {
      setError('Selected team not found.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const assignee = assigneeId ? userById.get(assigneeId) : undefined
      await addTeamTask({
        projectId,
        teamId,
        projectTitle,
        teamName: team.name,
        title: trimmedTitle,
        description: description.trim(),
        priority,
        dueDate: dueDate ? Timestamp.fromDate(new Date(dueDate)) : undefined,
        createdBy: user.uid,
        actorName: profile?.displayName ?? user.email ?? 'User',
        workType: templateCode === CUSTOM ? undefined : templateCode,
        assigneeId: assignee?.uid ?? null,
        assigneeName: assignee?.displayName ?? null,
      })
      onClose()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-white/10 bg-white/4 px-4 py-3 text-white placeholder-white/30 outline-none transition focus:border-purple-400/60 focus:bg-white/6 focus:ring-2 focus:ring-purple-500/20'
  const canSubmit = !!title.trim() && !!teamId && !submitting

  const description2 = initialTeamName
    ? `Adding a task to ${initialTeamName}. Pick a template to switch teams or stamp a work type.`
    : 'Pick a template to auto-fill team and assignee, or stay custom.'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New task"
      description={description2}
      size="lg"
      closeOnBackdrop={!submitting}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void handleSubmit()
        }}
        className="space-y-5"
        noValidate
      >
        <div className="space-y-1.5">
          <label htmlFor="task-template" className="text-sm font-medium text-white/80">
            Template
          </label>
          <select
            id="task-template"
            value={templateCode}
            onChange={(e) => applyTemplate(e.target.value as WorkType | typeof CUSTOM)}
            className={inputCls}
          >
            <option value={CUSTOM} className="bg-[#11111a]">
              Custom task — no pre-fill
            </option>
            {templates.map((t) => (
              <option key={t.code} value={t.code} className="bg-[#11111a]">
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="task-title" className="text-sm font-medium text-white/80">
            Title
          </label>
          <input
            id="task-title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ship the new homepage hero"
            autoComplete="off"
            className={inputCls}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="task-description" className="text-sm font-medium text-white/80">
            Description <span className="font-normal text-white/40">(optional)</span>
          </label>
          <textarea
            id="task-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does 'done' look like?"
            rows={3}
            className={`${inputCls} resize-none`}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="task-team" className="text-sm font-medium text-white/80">
              Team
            </label>
            <TeamPicker
              id="task-team"
              value={teamId}
              onChange={(next) => {
                setTeamId(next)
                // Reset assignee when team changes — old member may not belong to the new team.
                setAssigneeId(null)
              }}
              placeholder="Search teams…"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="task-assignee" className="text-sm font-medium text-white/80">
              Assignee <span className="font-normal text-white/40">(optional)</span>
            </label>
            {teamId ? (
              <UserPicker
                id="task-assignee"
                mode="single"
                value={assigneeId}
                onChange={setAssigneeId}
                placeholder="Search team members…"
                includeUids={teamMemberUids}
              />
            ) : (
              <div className="flex w-full items-center rounded-lg border border-white/10 bg-white/2 px-3 py-2.5 text-sm text-white/30">
                Pick a team first
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-white/80">Priority</label>
            <div className="flex gap-2">
              {PRIORITIES.map((p) => {
                const active = priority === p.value
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPriority(p.value)}
                    className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium capitalize transition ${
                      active
                        ? 'border-purple-400/60 bg-purple-500/15 text-white'
                        : `border-white/10 bg-white/4 ${p.cls} hover:bg-white/8`
                    }`}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="task-due" className="text-sm font-medium text-white/80">
              Due date <span className="font-normal text-white/40">(optional)</span>
            </label>
            <input
              id="task-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={`${inputCls} scheme-dark`}
            />
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          >
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-lg border border-white/10 bg-white/4 px-4 py-3 text-sm font-medium text-white/80 transition hover:bg-white/8 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex-1 rounded-lg bg-linear-to-r from-purple-500 to-fuchsia-500 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover:from-purple-400 hover:to-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Creating…
              </span>
            ) : (
              'Create task'
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}
