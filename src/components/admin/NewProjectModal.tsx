import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { Timestamp } from 'firebase/firestore'
import Modal from '../ui/Modal'
import UserPicker from '../ui/UserPicker'
import FileBadge, { formatFileSize } from '../ui/FileBadge'
import FieldInput from '../fields/FieldInput'
import { useFieldValidation } from '../fields/useFieldValidation'
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
import { findEntryLeadGate, planCreationAllocation } from '../../lib/creationAllocation'
import { resolveExactRoleHolders } from '../../lib/permissions/effectivePermissions'
import { uploadAsset } from '../../lib/uploadAsset'
import type { Attachment, User } from '../../types/models'
import type { Workflow } from '../../types/workflow'

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
// The form's auto-allocation path: when the workflow's entry stage has an action
// that assigns somebody (legacy `assign_lead` or a canvas-authored
// `outcome.assign`) and the form collected that person, addProject is called
// with the plan from planCreationAllocation() so those gates complete in the
// same commit and the project never lands on the stage that asks for a leader.
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
  const [submissionTime, setSubmissionTime] = useState('')
  const [presentationDate, setPresentationDate] = useState('')
  const [deadline, setDeadline] = useState('')
  // Phase 2d: per-role assignments (owner retired) + custom-field values.
  const [roleAssignments, setRoleAssignments] = useState<
    Record<string, string | string[] | null>
  >({})
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({})
  const [leadUid, setLeadUid] = useState<string | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setWorkflowId((prev) => prev ?? defaultWorkflow?.id ?? activeWorkflows[0]?.id ?? null)
    } else {
      setWorkflowId(null)
      setTitle('')
      setDescription('')
      setSubmissionDate('')
      setSubmissionTime('')
      setPresentationDate('')
      setDeadline('')
      setRoleAssignments({})
      setFieldValues({})
      setLeadUid(null)
      setFiles([])
      setError(null)
      setSubmitting(false)
      setUploadStatus(null)
    }
  }, [open, defaultWorkflow?.id, activeWorkflows])

  // Phase 2d: (re)seed role assignments + clear field values whenever the picked
  // workflow changes. Honours assignedToCreatorOnNew by pre-filling the creator.
  useEffect(() => {
    if (!open || !pickedWorkflow) return
    const init: Record<string, string | string[] | null> = {}
    for (const role of pickedWorkflow.projectRoles ?? []) {
      init[role.id] =
        role.assignedToCreatorOnNew && user?.uid
          ? role.multiple
            ? [user.uid]
            : user.uid
          : role.multiple
            ? []
            : null
    }
    setRoleAssignments(init)
    setFieldValues({})
    // Re-seed only when the modal opens or the workflow changes — NOT on
    // user?.uid resolving, which would wipe values the admin already typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pickedWorkflow?.id])

  // The entry stage's lead-assigning gate, if the workflow has one — drives the
  // lead-picker UI. Resolved by the shared helper so this agrees with addProject
  // on which stage is the entry and which of its actions is the gate (it scans
  // every action, honours workflow.entryStageId, and detects both legacy
  // `assign_lead` effects and canvas-authored `outcome.assign`).
  const leadGate = useMemo(
    () => (pickedWorkflow ? findEntryLeadGate(pickedWorkflow) : null),
    [pickedWorkflow],
  )
  const leadInput = leadGate?.input ?? null

  // Resolve the lead-picker candidate pool from the action's pickerScope.
  // Mirrors ActionModal's resolvePickerScope for the scopes a new-project lead
  // picker can resolve before the project exists: global_role and hierarchy
  // role (exact holders — no downward inheritance, so "a Vertical Head" never
  // includes someone who merely sits above that level). project_role/team_role
  // can't resolve yet (no project/teams), so they fall through to "all users".
  const candidateLeadUids = useMemo<string[] | undefined>(() => {
    if (!leadInput?.pickerScope) return undefined
    const [kind, rest] = leadInput.pickerScope.split(':')
    if (kind === 'global_role') {
      return users
        .filter((u) => u.globalRole === (rest as User['globalRole']))
        .map((u) => u.uid)
    }
    if (kind === 'role') {
      return resolveExactRoleHolders(rest ?? '', users, org.roleHierarchy ?? [])
    }
    return undefined
  }, [leadInput, users, org.roleHierarchy])

  // Phase 2d: roles + create-form custom fields, ordered.
  const roles = useMemo(
    () => [...(pickedWorkflow?.projectRoles ?? [])].sort((a, b) => a.order - b.order),
    [pickedWorkflow],
  )
  const createFormFields = useMemo(
    () =>
      [...(pickedWorkflow?.projectFields?.customFields ?? [])]
        .filter((f) => !f.deprecated && f.surfaces.includes('createForm'))
        .sort((a, b) => a.order - b.order),
    [pickedWorkflow],
  )
  const { errors: fieldErrors, isValid: fieldsValid } = useFieldValidation(
    createFormFields,
    fieldValues,
  )
  const requiredRolesFilled = roles.every((r) => {
    if (!r.required) return true
    const v = roleAssignments[r.id]
    return Array.isArray(v) ? v.length > 0 : Boolean(v)
  })

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
    if (!requiredRolesFilled) {
      const missing = roles.find((r) => {
        if (!r.required) return false
        const v = roleAssignments[r.id]
        return Array.isArray(v) ? v.length === 0 : !v
      })
      setError(`Assign a ${missing?.label ?? 'required role'}.`)
      return
    }
    if (!fieldsValid) {
      const firstErr = createFormFields.map((f) => fieldErrors[f.id]).find(Boolean)
      setError(firstErr ?? 'Please correct the highlighted fields.')
      return
    }
    if (pickedWorkflow.flowType === 'basic' && !description.trim()) {
      setError('Add a short description so others know what this is about.')
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

      // Phase 2d: normalise role assignments (strip empty/null) + field values.
      const normalizedRoles: Record<string, string | string[]> = {}
      for (const [k, v] of Object.entries(roleAssignments)) {
        if (v === null) continue
        if (Array.isArray(v)) {
          if (v.length) normalizedRoles[k] = v
        } else {
          normalizedRoles[k] = v
        }
      }
      const normalizedFields: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(fieldValues)) {
        const empty =
          v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
        if (!empty) normalizedFields[k] = v
      }

      // Auto-allocation: every entry-stage assignment gate this form already
      // satisfied — the lead picked above and/or the project roles collected
      // in normalizedRoles. Empty when the workflow has no such gate or nobody
      // was picked, in which case the project lands on the gate stage as before.
      const initialAllocation = planCreationAllocation(pickedWorkflow, {
        leadUid,
        roleAssignments: normalizedRoles,
      })

      const projectId = await addProject({
        title: trimmedTitle,
        description: description.trim(),
        createdBy: user.uid,
        actorName: profile?.displayName ?? user.email ?? 'User',
        ...(Object.keys(normalizedRoles).length ? { roleAssignments: normalizedRoles } : {}),
        ...(Object.keys(normalizedFields).length ? { fields: normalizedFields } : {}),
        // Pass the real role + team ids so addProject's auto-allocation
        // permission check matches the actual creator. Fall back to 'user'
        // only when profile isn't loaded yet (which would also block any
        // global-role-gated first action — the create succeeds, the lead
        // pick lands at stage 1 awaiting manual allocation).
        creatorRole: profile?.globalRole ?? 'user',
        creatorTeamIds: profile?.teamIds ?? [],
        // Phase 3.6: lets addProject seed accessKeys with holders of any
        // `role`-kind actor on the workflow so they can see/act on the project.
        users,
        workflowId: pickedWorkflow.id,
        ...(pickedWorkflow.flowType === 'collaborative'
          ? {
              // With a time, parse "YYYY-MM-DDTHH:mm" (LOCAL instant); date-only
              // parses "YYYY-MM-DD" (UTC midnight). submissionHasTime tracks which.
              submissionDate: submissionDate
                ? Timestamp.fromDate(
                    new Date(submissionTime ? `${submissionDate}T${submissionTime}` : submissionDate),
                  )
                : undefined,
              submissionHasTime: !!(submissionDate && submissionTime),
              presentationDate: presentationDate
                ? Timestamp.fromDate(new Date(presentationDate))
                : undefined,
            }
          : {}),
        ...(pickedWorkflow.flowType === 'individual' && deadline
          ? { deadline: Timestamp.fromDate(new Date(deadline)) }
          : {}),
        attachments,
        ...(initialAllocation.length ? { initialAllocation } : {}),
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

  const showWorkflowPicker = activeWorkflows.length > 1
  const flowType = pickedWorkflow?.flowType
  const showCollabFields = flowType === 'collaborative'
  const showIndividualFields = flowType === 'individual'
  const isBasicFlow = flowType === 'basic'

  // Description is required for basic-flow projects (the redefined Simple
  // Project surfaces it as the "what is this about" textarea) and optional
  // elsewhere.
  const canSubmit =
    !!title.trim() &&
    !!pickedWorkflow &&
    !submitting &&
    requiredRolesFilled &&
    fieldsValid &&
    (!isBasicFlow || !!description.trim())

  // Title + description copy adapts to the picked workflow's displayName so a
  // Sales tenant sees "New Sales Project" while a Tender tenant sees "New
  // Tender". When no workflow is picked yet (rare; first render before
  // useEffect fires), fall back to a generic title.
  const modalTitle = pickedWorkflow
    ? `New ${pickedWorkflow.displayName.toLowerCase().endsWith('project') ? pickedWorkflow.displayName : `${pickedWorkflow.displayName} project`}`
    : 'New project'

  const modalDescription = useMemo(() => {
    if (!pickedWorkflow) return 'Pick a workflow to get started.'
    // Phase 2c: prefer the workflow-supplied copy when present so tenants who
    // author their own workflows can give the modal a custom subtitle.
    if (pickedWorkflow.creationModalDescription) {
      return pickedWorkflow.creationModalDescription
    }
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

        {/* Description: required for the redefined Simple Project (basic
         * flow) where it carries the "what is this about" weight; optional on
         * other flow types where it's just supplemental context. */}
        <div className="space-y-1.5">
          <label htmlFor="project-description" className="text-sm font-medium text-fg-muted">
            Description{' '}
            <span className="font-normal text-fg-subtle">
              {isBasicFlow ? '' : '(optional)'}
            </span>
          </label>
          <textarea
            id="project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={
              isBasicFlow
                ? "What's this project about? (e.g., 'Q3 launch deck')"
                : 'What is this project delivering?'
            }
            rows={3}
            className={`${inputCls} resize-none`}
            required={isBasicFlow}
          />
        </div>

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
                <div className="flex gap-2">
                  <input
                    id="project-submission"
                    type="date"
                    value={submissionDate}
                    onChange={(e) => setSubmissionDate(e.target.value)}
                    className={`${inputCls} scheme-dark flex-1`}
                  />
                  <input
                    type="time"
                    aria-label="Submission time (optional)"
                    value={submissionTime}
                    onChange={(e) => setSubmissionTime(e.target.value)}
                    disabled={!submissionDate}
                    className={`${inputCls} scheme-dark w-32 disabled:opacity-50`}
                  />
                </div>
                <p className="text-xs text-fg-subtle">Time is optional.</p>
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

          {roles.length > 0 && (
            <div className="space-y-3 sm:col-span-2">
              <div className="text-sm font-medium text-fg-muted">Roles</div>
              {roles.map((role) => (
                <div key={role.id} className="space-y-1.5">
                  <label className="text-sm text-fg-muted">
                    {role.label}
                    {role.required ? (
                      <span className="text-tone-danger-fg"> *</span>
                    ) : (
                      <span className="font-normal text-fg-subtle"> (optional)</span>
                    )}
                  </label>
                  {role.description && (
                    <p className="text-xs text-fg-subtle">{role.description}</p>
                  )}
                  {role.multiple ? (
                    <UserPicker
                      mode="multi"
                      value={(roleAssignments[role.id] as string[] | undefined) ?? []}
                      onChange={(v) => setRoleAssignments((p) => ({ ...p, [role.id]: v }))}
                      placeholder={`Assign ${role.label}`}
                      allowCreate
                    />
                  ) : (
                    <UserPicker
                      mode="single"
                      value={(roleAssignments[role.id] as string | null | undefined) ?? null}
                      onChange={(v) => setRoleAssignments((p) => ({ ...p, [role.id]: v }))}
                      placeholder={`Assign ${role.label}`}
                      allowCreate
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {createFormFields.length > 0 && (
            <div className="space-y-3 sm:col-span-2">
              <div className="text-sm font-medium text-fg-muted">Details</div>
              {createFormFields.map((f) => (
                <div key={f.id} className="space-y-1.5">
                  <label htmlFor={`field-${f.id}`} className="text-sm text-fg-muted">
                    {f.label}
                    {f.required && <span className="text-tone-danger-fg"> *</span>}
                  </label>
                  {f.helpText && <p className="text-xs text-fg-subtle">{f.helpText}</p>}
                  <FieldInput
                    id={`field-${f.id}`}
                    field={f}
                    value={fieldValues[f.id]}
                    onChange={(v) => setFieldValues((p) => ({ ...p, [f.id]: v }))}
                    error={fieldErrors[f.id]}
                  />
                </div>
              ))}
            </div>
          )}

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
