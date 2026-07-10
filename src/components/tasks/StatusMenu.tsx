import { useEffect, useRef, useState } from 'react'
import type { TaskStatus } from '../../types/models'

interface Props {
  value: TaskStatus
  onChange: (next: TaskStatus) => void | Promise<void>
  disabled?: boolean
  // Statuses that can't be selected right now (e.g. 'done' while blocked). The
  // menu still opens; these options render greyed with `disabledHint` on hover.
  disabledStatuses?: TaskStatus[]
  disabledHint?: string
}

const ORDER: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'blocked']

const STYLES: Record<TaskStatus, { label: string; cls: string; dot: string }> = {
  todo: {
    label: 'Todo',
    cls: 'border-line bg-fill-2 text-fg-muted',
    dot: 'bg-neutral-dot',
  },
  in_progress: {
    label: 'In Progress',
    cls: 'border-tone-info-bd bg-tone-info-bg text-tone-info-fg',
    dot: 'bg-info-dot',
  },
  in_review: {
    label: 'In Review',
    cls: 'border-brand-edge bg-brand-soft text-brand',
    dot: 'bg-brandtone-dot',
  },
  done: {
    label: 'Done',
    cls: 'border-tone-success-bd bg-tone-success-bg text-tone-success-fg',
    dot: 'bg-success-dot',
  },
  blocked: {
    label: 'Blocked',
    cls: 'border-tone-danger-bd bg-tone-danger-bg text-tone-danger-fg',
    dot: 'bg-danger-dot',
  },
}

export default function StatusMenu({
  value,
  onChange,
  disabled = false,
  disabledStatuses,
  disabledHint,
}: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onMouse = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouse)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouse)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = STYLES[value]

  async function select(next: TaskStatus) {
    if (next === value || disabledStatuses?.includes(next)) {
      setOpen(false)
      return
    }
    setOpen(false)
    setBusy(true)
    try {
      await onChange(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && !busy && setOpen((o) => !o)}
        disabled={disabled || busy}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${current.cls} ${
          disabled ? 'opacity-60 cursor-not-allowed' : 'hover:brightness-110'
        }`}
      >
        {busy ? (
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <span className={`h-1.5 w-1.5 rounded-full ${current.dot}`} aria-hidden />
        )}
        <span>{current.label}</span>
        {!disabled && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      {open && !disabled && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-52 overflow-hidden rounded-lg border border-line bg-elevated shadow-2xl">
          {ORDER.map((s) => {
            const style = STYLES[s]
            const active = s === value
            const isDisabled = disabledStatuses?.includes(s) ?? false
            return (
              <button
                key={s}
                type="button"
                disabled={isDisabled}
                title={isDisabled ? disabledHint : undefined}
                onClick={() => select(s)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
                  isDisabled
                    ? 'cursor-not-allowed opacity-40'
                    : active
                      ? 'bg-fill-2'
                      : 'hover:bg-fill-2'
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} aria-hidden />
                <span className="flex-1 text-fg-strong">{style.label}</span>
                {isDisabled ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-fg-faint" aria-hidden>
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                ) : active ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : null}
              </button>
            )
          })}

          {disabledHint && (disabledStatuses?.length ?? 0) > 0 && (
            <div className="flex items-start gap-1.5 border-t border-line-subtle bg-fill-2/60 px-3 py-2 text-[11px] leading-snug text-fg-subtle">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-px shrink-0" aria-hidden>
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>{disabledHint}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}