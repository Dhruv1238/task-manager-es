import type { ReactNode } from 'react'

// Tiny controlled tab strip. State lives on the caller — keeps the primitive
// trivial and lets the parent persist selection however it wants (URL,
// localStorage, ephemeral). Per-tab labels can be ReactNodes so callers can
// embed badges (e.g. "Tender 10").

export interface TabItem {
  id: string
  label: ReactNode
  // Optional badge rendered after the label (e.g. project count).
  badge?: ReactNode
}

interface Props {
  tabs: TabItem[]
  activeId: string
  onChange: (id: string) => void
  // Optional className override on the outer flex container — lets callers
  // tune spacing inside a denser surface.
  className?: string
}

export default function Tabs({ tabs, activeId, onChange, className }: Props) {
  return (
    <div
      role="tablist"
      className={`flex flex-wrap items-center gap-1 border-b border-line ${className ?? ''}`}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition ${
              active
                ? 'border-fg-strong text-fg-strong'
                : 'border-transparent text-fg-muted hover:text-fg-strong'
            }`}
          >
            {tab.label}
            {tab.badge && (
              <span className="rounded-full bg-fill-2 px-1.5 py-0.5 text-[10px] font-semibold text-fg-subtle">
                {tab.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
