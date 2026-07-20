import type { Timestamp } from 'firebase/firestore'

interface Props {
  // Latest corrigendum upload on the project (`projects/{id}.corrigendumLastUploadAt`).
  corrigendumLastUploadAt: Timestamp | undefined
  // The user's last "seen" timestamp for this project
  // (`users/{uid}.corrigendumSeenAt[projectId]`).
  seenAt: Timestamp | undefined
  // Configured section label (e.g. "Corrigendum") — shown in the tooltip.
  label: string
  className?: string
}

function DocAlertIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M12 12v3" />
      <path d="M12 18h.01" />
    </svg>
  )
}

// Project-list unread indicator for the corrigendum (extra attachments) section.
// Both inputs are already in memory (project doc + profile) → zero extra reads.
// Renders nothing when the user has seen the latest upload or none exist.
export default function CorrigendumBadge({
  corrigendumLastUploadAt,
  seenAt,
  label,
  className,
}: Props) {
  if (!corrigendumLastUploadAt) return null
  const lastMs = corrigendumLastUploadAt.toMillis?.() ?? 0
  const seenMs = seenAt?.toMillis?.() ?? 0
  if (lastMs <= seenMs) return null

  return (
    <span
      role="status"
      aria-label={`New ${label} upload`}
      title={`New ${label} upload on this project`}
      className={`inline-flex items-center gap-1 rounded-full border border-tone-warn-bd bg-tone-warn-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-tone-warn-fg ${
        className ?? ''
      }`}
    >
      <DocAlertIcon />
      <span>{label}</span>
    </span>
  )
}
