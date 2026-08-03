import { useRef, useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import { useAuth } from '../../contexts/AuthContext'
import { uploadAsset } from '../../lib/uploadAsset'
import { addTaskAttachment, removeTaskAttachment } from '../../lib/firestore'
import FileBadge, { formatFileSize } from '../ui/FileBadge'
import type { Attachment } from '../../types/models'

interface Props {
  taskId: string
  taskTitle: string
  projectId: string
  attachments: Attachment[]
  canEdit: boolean
}

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB per file

export default function TaskAttachmentsSection({
  taskId,
  taskTitle,
  projectId,
  attachments,
  canEdit,
}: Props) {
  const { user, profile } = useAuth()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    if (!user) return
    const files = Array.from(e.target.files ?? [])
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (files.length === 0) return

    const oversize = files.find((f) => f.size > MAX_FILE_SIZE_BYTES)
    if (oversize) {
      setError(`${oversize.name} exceeds 2 GB.`)
      return
    }

    setError(null)
    setUploading(true)
    try {
      for (const f of files) {
        const result = await uploadAsset(f)
        const attachment: Attachment = {
          id: crypto.randomUUID(),
          name: result.fileName,
          url: result.url,
          key: result.key,
          mimeType: result.contentType,
          sizeBytes: result.sizeBytes,
          uploadedBy: user.uid,
          uploadedAt: Timestamp.now(),
        }
        await addTaskAttachment({
          taskId,
          attachment,
          actorId: user.uid,
          actorName: profile?.displayName ?? user.email ?? 'User',
          taskTitle,
          projectId,
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function removeAttachment(att: Attachment) {
    if (!user) return
    try {
      await removeTaskAttachment({
        taskId,
        attachment: att,
        actorId: user.uid,
        actorName: profile?.displayName ?? user.email ?? 'User',
        taskTitle,
        projectId,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove.')
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium uppercase tracking-wider text-fg-subtle">
          Attachments <span className="text-fg-muted">({attachments.length})</span>
        </h3>
        {canEdit && (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-fill-2 px-3 py-1.5 text-xs font-medium text-fg-strong transition hover:bg-fill-4 hover:text-fg disabled:opacity-60"
            >
              {uploading ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-line-strong border-t-white" />
                  Uploading…
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add files
                </>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFilesSelected}
            />
          </>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg"
        >
          {error}
        </div>
      )}

      {attachments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-card p-6 text-center text-xs text-fg-subtle">
          No attachments yet.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {attachments.map((a) => {
            const canRemove =
              canEdit && (user?.uid === a.uploadedBy || canEdit)
            return (
              <div
                key={a.id}
                className="group relative flex items-center gap-3 rounded-xl border border-line bg-card p-3 transition hover:border-line-strong hover:bg-fill-2"
              >
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center gap-3 min-w-0"
                >
                  <FileBadge mimeType={a.mimeType} fileName={a.name} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-fg">{a.name}</div>
                    <div className="text-xs text-fg-subtle">{formatFileSize(a.sizeBytes)}</div>
                  </div>
                </a>
                {canRemove && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      void removeAttachment(a)
                    }}
                    aria-label={`Remove ${a.name}`}
                    className="shrink-0 rounded-md p-1.5 text-fg-faint transition hover:bg-fill-2 hover:text-tone-danger-fg sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}