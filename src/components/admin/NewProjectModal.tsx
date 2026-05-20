import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { Timestamp } from 'firebase/firestore'
import Modal from '../ui/Modal'
import UserPicker from '../ui/UserPicker'
import FileBadge, { formatFileSize } from '../ui/FileBadge'
import WorkflowPicker from './WorkflowPicker'
import LeadPickerWithRecommendations from './LeadPickerWithRecommendations'
import { useAuth } from '../../contexts/AuthContext'
import {
  useActiveWorkflows,
  useDefaultWorkflow,
  useOrgStructure,
} from '../../contexts/AppConfigContext'
import { useAllUsers } from '../../hooks/useAllUsers'
import { addProject } from '../../lib/firestore'
import { uploadAsset } from '../../lib/uploadAsset'
import type { Attachment, User } from '../../types/models'
import type { ActionInput, Workflow } from '../../types/workflow'

interface Props {
  open: boolean
  onClose: () => void
}

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB per file

function friendlyError(err: unknown): string {
  if (err instanceof FirebaseError) return err.message
  return err instanceof Error ? err.message : 'Something went wrong.'
}

// The new-project modal walks the user through two conceptual steps:
//   0. Workflow pick (only shown when more than one workflow is active).
//   1. Form fields adapted to the chosen workflow's flowType.
// The form's auto-allocation path: when the workflow's first stage's first
// action is `assign_lead` and the user picks a lead, addProject is called
// with `initialAction` so the project lands at stage 2 in one commit.
export default function NewProjectModal({ open, onClose }: Props) {
  const { user, profile } = useAuth()
  const org = useOrgStructure()
  const { workflows: activeWorkflows } = useActiveWorkflows()
  const defaultWorkflow = useDefaultWorkflow()
  const { users } = useAllUsers()
  const navigate = useNavigate()

  // Workflow selection. Pre-seeded to the default workflow when available;
  // re-seeds when the modal opens.
  const [workflowId, setWorkflowId] = useState<string | null>(null)
  const pickedWorkflow = useMemo<Workflow | null>(
    () => activeWorkflows.find((wf) => wf.id === workflowId) ?? null,
    [activeWorkflows, workflowId],
  )

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submissionDate, setSubmissionDate] = useState('')
  const [presentationDate, setPresentationDate] = useState('')
  const [deadline, setDeadline] = useState('')
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [leadUid, setLeadUid] = useState<string | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setOwnerId((prev) => prev ?? user?.uid ?? null)
      setWorkflowId((prev) => prev ?? defaultWorkflow?.id ?? activeWorkflows[0]?.id ?? null)
    } else {
      setWorkflowId(null)
      setTitle('')
      setDescription('')
      setSubmissionDate('')
      setPresentationDate('')
      setDeadline('')
      setOwnerId(null)
      setLeadUid(null)
      setFiles([])
      setError(null)
      setSubmitting(false)
      setUploadStatus(null)
    }
  }, [open, user?.uid, defaultWorkflow?.id, activeWorkflows])

  // The first action on the first stage — drives the lead-picker UI and the
  // auto-allocation path. When this action's effect is `assign_lead`, the
  // form surfaces a lead picker; submitting with a chosen lead chains the
  // action onto the create batch so the project lands at stage 2.
  const firstAction = useMemo(() => {
    if (!pickedWorkflow) return null
    const firstStage = [...pickedWorkflow.stages].sort((a, b) => a.order - b.order)[0]
    return firstStage?.actions[0] ?? null
  }, [pickedWorkflow])

  const leadInput: ActionInput | null = useMemo(() => {
    if (!firstAction || firstAction.effect.kind !== 'assign_lead') return null
    return firstAction.inputs.find((i) => i.type === 'user_picker') ?? null
  }, [firstAction])

  // Resolve the lead-picker candidate pool from the action's pickerScope.
  // Mirrors ActionModal's resolvePickerScope, scoped to the global-role
  // case which is what the lead pickers in the shipped workflows use.
  const candidateLeadUids = useMemo<string[] | undefined>(() => {
    if (!leadInput?.pickerScope) return undefined
    const [kind, rest] = leadInput.pickerScope.split(':')
    if (kind === 'global_role') {
      return users
        .filter((u) => u.globalRole === (rest as User['globalRole']))
        .map((u) => u.uid)
    }
    return undefined
  }, [leadInput, users])

  function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    const accepted: File[] = []
    for (const f of picked) {
      if (f.size > MAX_FILE_SIZE_BYTES) {
        setError(`${f.name} exceeds 2 GB and was skipped.`)
        continue
      }
      accepted.push(f)
    }
    setFiles((prev) => [...prev, ...accepted])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleSubmit() {
    if (!user) return
    if (!pickedWorkflow) {
      setError('Pick a workflow.')
      return
    }
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError('Project title is required.')
      return
    }
    if (!ownerId) {
      setError('Pick a project owner.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      let attachments: Attachment[] | undefined
      if (files.length > 0) {
        setUploadStatus(`Uploading ${files.length} file${files.length === 1 ? '' : 's'}…`)
        const results = await Promise.all(files.map((f) => uploadAsset(f)))
        attachments = results.map((r) => ({
          id: crypto.randomUUID(),
          name: r.fileName,
          url: r.url,
          key: r.key,
          mimeType: r.contentType,
          sizeBytes: r.sizeBytes,
          uploadedBy: user.uid,
          uploadedAt: Timestamp.now(),
        }))
        setUploadStatus('Saving project…')
      }

      // Auto-allocation: only when the workflow's first action is assign_lead
      // AND the form supplied a lead.
      const initialAction =
        firstAction && firstAction.effect.kind === 'assign_lead' && leadUid
          ? {
              actionId: firstAction.id,
              inputs: { leadUid },
            }
          : undefined

      const projectId = await addProject({
        title: trimmedTitle,
        description: description.trim(),
        ownerId,
        createdBy: user.uid,
        actorName: profile?.displayName ?? user.email ?? 'User',
        // Pass the real role + team ids so addProject's auto-allocation
        // permission check matches the actual creator. Fall back to 'user'
        // only when profile isn't loaded yet (which would also block any
        // global-role-gated first action — the create succeeds, the lead
        // pick lands at stage 1 awaiting manual allocation).
        creatorRole: profile?.globalRole ?? 'user',
        creatorTeamIds: profile?.teamIds ?? [],
        workflowId: pickedWorkflow.id,
        ...(pickedWorkflow.flowType === 'collaborative'
          ? {
              submissionDate: submissionDate
                ? Timestamp.fromDate(new Date(submissionDate))
                : undefined,
              presentationDate: presentationDate
                ? Timestamp.fromDate(new Date(presentationDate))
                : undefined,
            }
          : {}),
        ...(pickedWorkflow.flowType === 'individual' && deadline
          ? { deadline: Timestamp.fromDate(new Date(deadline)) }
          : {}),
        attachments,
        ...(initialAction ? { initialAction } : {}),
      })
      onClose()
      navigate(`/projects/${projectId}`)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setSubmitting(false)
      setUploadStatus(null)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-line bg-fill-2 px-4 py-3 text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

  const canSubmit = !!title.trim() && !!ownerId && !!pickedWorkflow && !submitting

  const showWorkflowPicker = activeWorkflows.length > 1
  const flowType = pickedWorkflow?.flowType
  const showCollabFields = flowType === 'collaborative'
  const showIndividualFields = flowType === 'individual'

  // Title + description copy adapts to the picked workflow's displayName so a
  // Sales tenant sees "New Sales Project" while a Tender tenant sees "New
  // Tender". When no workflow is picked yet (rare; first render before
  // useEffect fires), fall back to a generic title.
  const modalTitle = pickedWorkflow
    ? `New ${pickedWorkflow.displayName.toLowerCase().endsWith('project') ? pickedWorkflow.displayName : `${pickedWorkflow.displayName} project`}`
    : 'New project'

  const modalDescription = useMemo(() => {
    if (!pickedWorkflow) return 'Pick a workflow to get started.'
    const lead = pickedWorkflow.leadRoleName || org.leadRoleName || 'lead'
    switch (pickedWorkflow.flowType) {
      case 'collaborative':
        return `Lands at the first stage. You'll allocate a ${lead} once it's created.`
      case 'individual':
        return `Tracked by a single ${lead}. Pick one now to auto-assign, or leave blank to allocate later.`
      case 'basic':
        return 'Tracked by status. Add tasks after it’s created.'
    }
  }, [pickedWorkflow, org])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={modalTitle}
      description={modalDescription}
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
        {showWorkflowPicker && (
          <WorkflowPicker
            workflows={activeWorkflows}
            pickedId={workflowId}
            onPick={setWorkflowId}
          />
        )}

        <div className="space-y-1.5">
          <label htmlFor="project-title" className="text-sm font-medium text-fg-muted">
            Title
          </label>
          <input
            id="project-title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Q2 Website Refresh"
            autoComplete="off"
            className={inputCls}
          />
        </div>

        {flowType !== 'basic' && (
          <div className="space-y-1.5">
            <label htmlFor="project-description" className="text-sm font-medium text-fg-muted">
              Description <span className="font-normal text-fg-subtle">(optional)</span>
            </label>
            <textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project delivering?"
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-fg-muted">
              Attachments <span className="font-normal text-fg-subtle">(optional)</span>
            </label>
            <span className="text-xs text-fg-subtle">2 GB max per file</span>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-card px-4 py-5 text-sm text-fg-muted transition hover:border-line-strong hover:bg-fill-2 hover:text-fg-muted"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            Add files
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFilesSelected}
          />

          {files.length > 0 && (
            <ul className="mt-2 space-y-2">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-3 rounded-lg border border-line bg-card p-2"
                >
                  <FileBadge mimeType={f.type} fileName={f.name} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-fg">{f.name}</div>
                    <div className="text-xs text-fg-subtle">{formatFileSize(f.size)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    disabled={submitting}
                    className="shrink-0 rounded-md p-1.5 text-fg-subtle transition hover:bg-fill-2 hover:text-fg-muted disabled:opacity-40"
                    aria-label={`Remove ${f.name}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {showCollabFields && (
            <>
              <div className="space-y-1.5">
                <label htmlFor="project-submission" className="text-sm font-medium text-fg-muted">
                  Submission date <span className="font-normal text-fg-subtle">(to client)</span>
                </label>
                <input
                  id="project-submission"
                  type="date"
                  value={submissionDate}
                  onChange={(e) => setSubmissionDate(e.target.value)}
                  className={`${inputCls} scheme-dark`}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="project-presentation" className="text-sm font-medium text-fg-muted">
                  Presentation date <span className="font-normal text-fg-subtle">(optional)</span>
                </label>
                <input
                  id="project-presentation"
                  type="date"
                  value={presentationDate}
                  onChange={(e) => setPresentationDate(e.target.value)}
                  className={`${inputCls} scheme-dark`}
                />
              </div>
            </>
          )}

          {showIndividualFields && (
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="project-deadline" className="text-sm font-medium text-fg-muted">
                Deadline <span className="font-normal text-fg-subtle">(optional)</span>
              </label>
              <input
                id="project-deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className={`${inputCls} scheme-dark`}
              />
            </div>
          )}

          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="project-owner" className="text-sm font-medium text-fg-muted">
              Owner
            </label>
            <UserPicker
              id="project-owner"
              mode="single"
              value={ownerId}
              onChange={setOwnerId}
              placeholder="Pick an owner"
              allowCreate
            />
          </div>

          {leadInput && pickedWorkflow && (
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="project-lead" className="text-sm font-medium text-fg-muted">
                {leadInput.label.replace(
                  /\{leadRoleName\}/g,
                  pickedWorkflow.leadRoleName || org.leadRoleName,
                )}{' '}
                <span className="font-normal text-fg-subtle">(optional — assigns immediately)</span>
              </label>
              <LeadPickerWithRecommendations
                id="project-lead"
                value={leadUid}
                onChange={setLeadUid}
                recommendedUids={pickedWorkflow.recommendedLeads ?? []}
                candidateUids={candidateLeadUids}
                placeholder={`Pick a ${(pickedWorkflow.leadRoleName || org.leadRoleName).toLowerCase()}…`}
              />
            </div>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg"
          >
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-lg border border-line bg-fill-2 px-4 py-3 text-sm font-medium text-fg-muted transition hover:bg-fill-4 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex-1 rounded-lg bg-brand-gradient px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-white" />
                {uploadStatus ?? 'Creating…'}
              </span>
            ) : (
              'Create project'
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}
