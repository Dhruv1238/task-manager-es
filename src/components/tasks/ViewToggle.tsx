import type { ReactNode } from 'react'

export type TaskView = 'list' | 'board'

interface Props {
  value: TaskView
  onChange: (view: TaskView) => void
}

const OPTIONS: { value: TaskView; label: string; icon: ReactNode }[] = [
  {
    value: 'list',
    label: 'List',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    ),
  },
  {
    value: 'board',
    label: 'Board',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="6" height="16" rx="1" />
        <rect x="10" y="4" width="6" height="10" rx="1" />
        <rect x="17" y="4" width="4" height="7" rx="1" />
      </svg>
    ),
  },
]

export default function ViewToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-card p-0.5">
      {OPTIONS.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
              active
                ? 'bg-fill-4 text-fg'
                : 'text-fg-muted hover:bg-fill-2 hover:text-fg-strong'
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}