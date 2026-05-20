import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface DropdownOption {
  value: string
  label: string
  leading?: ReactNode
}

interface Props {
  value: string
  onChange: (v: string) => void
  options: DropdownOption[]
  placeholder?: string
  disabled?: boolean
  disabledTooltip?: string
  className?: string
  align?: 'left' | 'right'
  menuClassName?: string
  // Override the trigger label when the selected `value` doesn't map 1:1 to
  // an option's label (e.g. multi-select states rendered as "3 workflows").
  displayValue?: string
}

export default function Dropdown({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  disabledTooltip,
  className,
  align = 'left',
  menuClassName,
  displayValue,
}: Props) {
  const [open, setOpen] = useState(false)
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

  const current = options.find((o) => o.value === value)

  return (
    <div ref={wrapRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        title={disabled ? disabledTooltip : undefined}
        className={`flex w-full items-center gap-2 rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm transition focus:border-brand-edge focus:bg-fill-3 focus:outline-none focus:ring-2 focus:ring-brand-ring ${
          disabled
            ? 'cursor-not-allowed text-fg-faint'
            : 'text-fg-muted hover:bg-fill-3'
        }`}
      >
        {current?.leading}
        <span className={`flex-1 truncate text-left ${current || displayValue ? '' : 'text-fg-faint'}`}>
          {displayValue ?? current?.label ?? placeholder ?? 'Select…'}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-fg-subtle"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && !disabled && (
        <div
          role="listbox"
          className={`absolute top-full z-30 mt-1.5 min-w-full overflow-hidden rounded-lg border border-line bg-elevated shadow-2xl ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${menuClassName ?? ''}`}
        >
          <div className="max-h-72 overflow-y-auto">
            {options.map((opt) => {
              const active = opt.value === value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                    active ? 'bg-brand-soft text-fg' : 'text-fg-muted hover:bg-fill-2'
                  }`}
                >
                  {opt.leading}
                  <span className="flex-1 truncate">{opt.label}</span>
                  {active && (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-brand"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
