import { useEffect, useRef, useState } from 'react'
import type { TaskStatus } from '../../types/models'

interface Props {
  value: TaskStatus
  onChange: (next: TaskStatus) => void | Promise<void>
  disabled?: boolean
}

const ORDER: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'blocked']

const STYLES: Record<TaskStatus, { label: string; cls: string; dot: string }> = {
  todo: {
    label: 'Todo',
    cls: 'border-white/15 bg-white/5 text-white/80',
    dot: 'bg-white/40',
  },
  in_progress: {
    label: 'In Progress',
    cls: 'border-blue-400/40 bg-blue-500/15 text-blue-200',
    dot: 'bg-blue-400',
  },
  in_review: {
    label: 'In Review',
    cls: 'border-purple-400/40 bg-purple-500/15 text-purple-200',
    dot: 'bg-purple-400',
  },
  done: {
    label: 'Done',
    cls: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200',
    dot: 'bg-emerald-400',
  },
  blocked: {
    label: 'Blocked',
    cls: 'border-red-400/40 bg-red-500/15 text-red-200',
    dot: 'bg-red-400',
  },
}

export default function StatusMenu({ value, onChange, disabled = false }: Props) {
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
    if (next === value) {
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
        <div className="absolute left-0 top-full z-30 mt-1.5 w-44 overflow-hidden rounded-lg border border-white/10 bg-[#0e0e16] shadow-2xl">
          {ORDER.map((s) => {
            const style = STYLES[s]
            const active = s === value
            return (
              <button
                key={s}
                type="button"
                onClick={() => select(s)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
                  active ? 'bg-white/5' : 'hover:bg-white/4'
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} aria-hidden />
                <span className="flex-1 text-white/90">{style.label}</span>
                {active && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-purple-300">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}