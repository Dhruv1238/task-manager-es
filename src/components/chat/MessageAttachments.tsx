import FileBadge, { formatFileSize } from '../ui/FileBadge'
import type { ChatAttachment } from '../../types/models'

interface Props {
  attachments: ChatAttachment[]
}

function isImage(contentType: string): boolean {
  return contentType.startsWith('image/')
}

export default function MessageAttachments({ attachments }: Props) {
  if (!attachments.length) return null

  return (
    <div className="mt-2 flex flex-col gap-2">
      {attachments.map((a, i) =>
        isImage(a.contentType) ? (
          <a
            key={`${a.url}-${i}`}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block overflow-hidden rounded-lg border border-line"
          >
            <img
              src={a.url}
              alt={a.name}
              loading="lazy"
              className="max-h-56 w-full object-cover"
            />
          </a>
        ) : (
          <a
            key={`${a.url}-${i}`}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            download={a.name}
            className="flex items-center gap-3 rounded-lg border border-line bg-fill-2 px-3 py-2 transition hover:bg-fill-3"
          >
            <FileBadge mimeType={a.contentType} fileName={a.name} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-fg">{a.name}</span>
              <span className="block text-[11px] text-fg-subtle">
                {formatFileSize(a.sizeBytes)}
              </span>
            </span>
          </a>
        ),
      )}
    </div>
  )
}
