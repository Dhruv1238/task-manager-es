import type { ProjectStatus } from '../../types/models'
import { STATUS_DISPLAY } from '../../lib/projectStatus'

interface Props {
  status: ProjectStatus
  // When clickable, the pill renders as a button and calls onClick. Otherwise
  // it's a passive span (e.g., on the Projects list cards).
  onClick?: () => void
  size?: 'sm' | 'md'
}

// Single source of truth for rendering the project status. Clickable variant
// opens the UpdateProjectStatusModal; non-clickable is a read-only badge.
export default function ProjectStatusPill({ status, onClick, size = 'md' }: Props) {
  const meta = STATUS_DISPLAY[status]
  const sizeCls =
    size === 'sm'
      ? 'px-2 py-0.5 text-[11px]'
      : 'px-2.5 py-0.5 text-xs'

  const baseCls = `inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium ${sizeCls} ${meta?.pill}`

  if (!onClick) {
    return (
      <span className={baseCls} title={meta?.description}>
        <span className={`h-1.5 w-1.5 rounded-full ${meta?.dot}`} aria-hidden />
        {meta?.label}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title="Update status"
      className={`${baseCls} transition hover:brightness-110 cursor-pointer`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta?.dot}`} aria-hidden />
      {meta?.label}
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="opacity-70"
        aria-hidden
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  )
}
