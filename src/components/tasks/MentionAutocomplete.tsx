import type { User } from '../../types/models'

interface Props {
  users: User[]
  activeIndex: number
  onHover: (i: number) => void
  onSelect: (u: User) => void
}

function initialsFor(u: User): string {
  const src = u.displayName || u.email || '?'
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

// List-only popup, anchored ABOVE the composer (bottom-full) by the parent's
// relative wrapper. Deliberately textarea-anchored rather than caret-pixel
// anchored — true caret anchoring needs a mirror-div measurement hack, and on a
// 2-row composer the difference is invisible. Keyboard nav lives in the parent.
export default function MentionAutocomplete({ users, activeIndex, onHover, onSelect }: Props) {
  if (users.length === 0) return null
  return (
    <div className="absolute bottom-full left-0 z-50 mb-1 w-72 max-w-full overflow-hidden rounded-xl border border-line bg-elevated shadow-2xl">
      <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
        {users.map((u, i) => (
          <li key={u.uid} role="option" aria-selected={i === activeIndex}>
            <button
              type="button"
              // onMouseDown (not onClick) so selection fires before the textarea
              // blur that would otherwise close the popup first.
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect(u)
              }}
              onMouseEnter={() => onHover(i)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition ${
                i === activeIndex ? 'bg-fill-3' : 'hover:bg-fill-2'
              }`}
            >
              <span
                aria-hidden
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-gradient-br text-[10px] font-semibold text-white"
              >
                {initialsFor(u)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{u.displayName}</span>
                <span className="block truncate text-xs text-fg-subtle">{u.email}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
