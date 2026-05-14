interface Props {
  count: number
  onJump: () => void
}

function DownArrowIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export default function NewMessagesPill({ count, onJump }: Props) {
  if (count <= 0) return null
  return (
    <button
      type="button"
      onClick={onJump}
      className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-brand-gradient px-3 py-1 text-[11px] font-semibold text-white shadow-lg shadow-purple-900/40 transition hover-brand-gradient focus:outline-none focus:ring-2 focus:ring-brand-ring"
    >
      <DownArrowIcon />
      {count} new message{count === 1 ? '' : 's'}
    </button>
  )
}
