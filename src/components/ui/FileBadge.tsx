interface Props {
  mimeType: string
  fileName: string
  size?: number
}

const EXT_MAP: Record<string, { label: string; cls: string }> = {
  pdf: { label: 'PDF', cls: 'bg-red-500/20 text-red-200 border-red-400/40' },
  doc: { label: 'DOC', cls: 'bg-blue-500/20 text-blue-200 border-blue-400/40' },
  docx: { label: 'DOC', cls: 'bg-blue-500/20 text-blue-200 border-blue-400/40' },
  xls: { label: 'XLS', cls: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40' },
  xlsx: { label: 'XLS', cls: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40' },
  csv: { label: 'CSV', cls: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40' },
  ppt: { label: 'PPT', cls: 'bg-orange-500/20 text-orange-200 border-orange-400/40' },
  pptx: { label: 'PPT', cls: 'bg-orange-500/20 text-orange-200 border-orange-400/40' },
  zip: { label: 'ZIP', cls: 'bg-yellow-500/20 text-yellow-200 border-yellow-400/40' },
  rar: { label: 'ZIP', cls: 'bg-yellow-500/20 text-yellow-200 border-yellow-400/40' },
  '7z': { label: 'ZIP', cls: 'bg-yellow-500/20 text-yellow-200 border-yellow-400/40' },
  txt: { label: 'TXT', cls: 'bg-white/10 text-white/80 border-white/20' },
  md: { label: 'MD', cls: 'bg-white/10 text-white/80 border-white/20' },
  json: { label: 'JSON', cls: 'bg-amber-500/20 text-amber-200 border-amber-400/40' },
  svg: { label: 'SVG', cls: 'bg-purple-500/20 text-purple-200 border-purple-400/40' },
}

function classify(mimeType: string, fileName: string): { label: string; cls: string } {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const match = EXT_MAP[ext]
  if (match) return match
  if (mimeType.startsWith('image/'))
    return { label: 'IMG', cls: 'bg-purple-500/20 text-purple-200 border-purple-400/40' }
  if (mimeType.startsWith('video/'))
    return { label: 'VID', cls: 'bg-pink-500/20 text-pink-200 border-pink-400/40' }
  if (mimeType.startsWith('audio/'))
    return { label: 'AUD', cls: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40' }
  return {
    label: (ext || 'FILE').toUpperCase().slice(0, 4),
    cls: 'bg-white/10 text-white/80 border-white/20',
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