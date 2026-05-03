import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { Timestamp } from 'firebase/firestore'
import Modal from '../ui/Modal'
import UserPicker from '../ui/UserPicker'
import FileBadge, { formatFileSize } from '../ui/FileBadge'
import { useAuth } from '../../contexts/AuthContext'
import { addProject } from '../../lib/firestore'
import { uploadAsset } from '../../lib/uploadAsset'
import type { Attachment } from '../../types/models'

interface Props {
  open: boolean
  onClose: () => void
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB per file

function friendlyError(err: unknown): string {
  if (err instanceof FirebaseError) return err.message
  return err instanceof Error ? err.message : 'Something went wrong.'
}

export default function NewProjectModal({ open, onClose }: Props) {
  const { user, profile } = useAuth()
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submissionDate, setSubmissionDate] = useState('')
  const [presentationDate, setPresentationDate] = useState('')
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setOwnerId((prev) => prev ?? user?.uid ?? null)
    } else {
      setTitle('')
      setDescription('')
      setSubmissionDate('')
      setPresentationDate('')
      setOwnerId(null)
      setFiles([])
      setError(null)
      setSubmitting(false)
      setUploadStatus(null)
    }
  }, [open, user?.uid])  

  function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    const accepted: File[] = []
    for (const f of picked) {
      if (f.size > MAX_FILE_SIZE_BYTES) {
        setError(`${f.name} exceeds 10 MB and was skipped.`)
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

      const projectId = await addProject({
        title: trimmedTitle,
        description: description.trim(),
        ownerId,
        createdBy: user.uid,
        actorName: profile?.displayName ?? user.email ?? 'User',
        submissionDate: submissionDate
          ? Timestamp.fromDate(new Date(submissionDate))
          : undefined,
        presentationDate: presentationDate
          ? Timestamp.fromDate(new Date(presentationDate))
          : undefined,
        attachments,
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
    'w-full rounded-lg border border-white/10 bg-white/4 px-4 py-3 text-white placeholder-white/30 outline-none transition focus:border-purple-400/60 focus:bg-white/6 focus:ring-2 focus:ring-purple-500/20'

  const canSubmit = !!title.trim() && !!ownerId && !submitting

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New tender project"
      description="Lands at stage 1. You'll allocate a Vertical Head once it's created."
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
          <label htmlFor="project-title" className="text-sm font-medium text-white/80">
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

        <div className="space-y-1.5">
          <label htmlFor="project-description" className="text-sm font-medium text-white/80">
            Description <span className="font-normal text-white/40">(optional)</span>
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

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-white/80">
              Attachments <span className="font-normal text-white/40">(optional)</span>
            </label>
            <span className="text-xs text-white/40">10 MB max per file</span>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 bg-white/2 px-4 py-5 text-sm text-white/60 transition hover:border-white/25 hover:bg-white/4 hover:text-white/80"
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
                  className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/2 p-2"
                >
                  <FileBadge mimeType={f.type} fileName={f.name} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">{f.name}</div>
                    <div className="text-xs text-white/40">{formatFileSize(f.size)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    disabled={submitting}
                    className="shrink-0 rounded-md p-1.5 text-white/40 transition hover:bg-white/5 hover:text-white/80 disabled:opacity-40"
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
          <div className="space-y-1.5">
            <label htmlFor="project-submission" className="text-sm font-medium text-white/80">
              Submission date <span className="font-normal text-white/40">(to client)</span>
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
            <label htmlFor="project-presentation" className="text-sm font-medium text-white/80">
              Presentation date <span className="font-normal text-white/40">(optional)</span>
            </label>
            <input
              id="project-presentation"
              type="date"
              value={presentationDate}
              onChange={(e) => setPresentationDate(e.target.value)}
              className={`${inputCls} scheme-dark`}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="project-owner" className="text-sm font-medium text-white/80">
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