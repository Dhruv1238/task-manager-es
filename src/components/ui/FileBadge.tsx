interface Props {
  mimeType: string
  fileName: string
  size?: number
}

const EXT_MAP: Record<string, { label: string; cls: string }> = {
  pdf: { label: 'PDF', cls: 'bg-tone-danger-bg text-tone-danger-fg border-tone-danger-bd' },
  doc: { label: 'DOC', cls: 'bg-tone-info-bg text-tone-info-fg border-tone-info-bd' },
  docx: { label: 'DOC', cls: 'bg-tone-info-bg text-tone-info-fg border-tone-info-bd' },
  xls: { label: 'XLS', cls: 'bg-tone-success-bg text-tone-success-fg border-tone-success-bd' },
  xlsx: { label: 'XLS', cls: 'bg-tone-success-bg text-tone-success-fg border-tone-success-bd' },
  csv: { label: 'CSV', cls: 'bg-tone-success-bg text-tone-success-fg border-tone-success-bd' },
  ppt: { label: 'PPT', cls: 'pill-orange' },
  pptx: { label: 'PPT', cls: 'pill-orange' },
  zip: { label: 'ZIP', cls: 'pill-yellow' },
  rar: { label: 'ZIP', cls: 'pill-yellow' },
  '7z': { label: 'ZIP', cls: 'pill-yellow' },
  txt: { label: 'TXT', cls: 'bg-fill-4 text-fg-muted border-line-strong' },
  md: { label: 'MD', cls: 'bg-fill-4 text-fg-muted border-line-strong' },
  json: { label: 'JSON', cls: 'bg-tone-warn-bg text-tone-warn-fg border-tone-warn-bd' },
  svg: { label: 'SVG', cls: 'bg-brand-soft text-brand border-brand-edge' },
}

function classify(mimeType: string, fileName: string): { label: string; cls: string } {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const match = EXT_MAP[ext]
  if (match) return match
  if (mimeType.startsWith('image/'))
    return { label: 'IMG', cls: 'bg-brand-soft text-brand border-brand-edge' }
  if (mimeType.startsWith('video/'))
    return { label: 'VID', cls: 'pill-pink' }
  if (mimeType.startsWith('audio/'))
    return { label: 'AUD', cls: 'pill-cool' }
  return {
    label: (ext || 'FILE').toUpperCase().slice(0, 4),
    cls: 'bg-fill-4 text-fg-muted border-line-strong',
  }
}

export default function FileBadge({ mimeType, fileName, size = 40 }: Props) {
  const { label, cls } = classify(mimeType, fileName)
  const fontSize = size <= 28 ? 9 : size <= 36 ? 10 : 11
  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center rounded-lg border font-bold tracking-wider ${cls}`}
      style={{ width: size, height: size, fontSize }}
      aria-hidden
    >
      {label}
    </div>
  )
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}