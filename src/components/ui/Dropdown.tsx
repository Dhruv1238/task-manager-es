import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface DropdownOption {
  value: string
  label: string
  leading?: ReactNode
}

export interface DropdownGroup {
  label: string
  options: DropdownOption[]
}

interface Props {
  value: string
  onChange: (v: string) => void
  // Either a flat option list, or grouped options (rendered with section
  // headers). When `groups` is set it takes precedence over `options`.
  options?: DropdownOption[]
  groups?: DropdownGroup[]
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

const GAP = 6

// Menu is rendered in a portal with fixed positioning so it escapes any
// ancestor's `overflow`/clipping and flips above the trigger when there isn't
// room below — mirrors the proven UserPicker pattern.
type MenuPos =
  | { mode: 'below'; top: number; left?: number; right?: number; width: number }
  | { mode: 'above'; bottom: number; left?: number; right?: number; width: number }

export default function Dropdown({
  value,
  onChange,
  options,
  groups,
  placeholder,
  disabled,
  disabledTooltip,
  className,
  align = 'left',
  menuClassName,
  displayValue,
}: Props) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<MenuPos | null>(null)

  // Flattened option list — used for the trigger label lookup and height estimate
  // whether the menu is flat or grouped.
  const allOptions = groups ? groups.flatMap((g) => g.options) : options ?? []

  // Estimate menu height for the flip decision (rows are ~36px, capped at the
  // menu's max-height of 288px) so we flip before the browser clips it.
  const estHeight = Math.min(allOptions.length * 36 + (groups ? groups.length * 28 : 0) + 8, 288)

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const measure = () => {
      const t = triggerRef.current
      if (!t) return
      const r = t.getBoundingClientRect()
      const spaceBelow = window.innerHeight - r.bottom
      const spaceAbove = r.top
      const flip = spaceBelow < estHeight + GAP && spaceAbove > spaceBelow
      const horiz =
        align === 'right'
          ? { right: window.innerWidth - r.right }
          : { left: r.left }
      setPos(
        flip
          ? { mode: 'above', bottom: window.innerHeight - r.top, width: r.width, ...horiz }
          : { mode: 'below', top: r.bottom, width: r.width, ...horiz },
      )
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, estHeight, align])

  useEffect(() => {
    if (!open) return
    const onMouse = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
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

  const current = allOptions.find((o) => o.value === value)

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    minWidth: pos?.width,
    zIndex: 60,
    ...(pos && 'left' in pos && pos.left !== undefined ? { left: pos.left } : {}),
    ...(pos && 'right' in pos && pos.right !== undefined ? { right: pos.right } : {}),
    ...(pos?.mode === 'above'
      ? { bottom: pos.bottom + GAP }
      : pos?.mode === 'below'
        ? { top: pos.top + GAP }
        : {}),
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        title={disabled ? disabledTooltip : undefined}
        className={`flex w-full items-center gap-2 rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm transition focus:border-brand-edge focus:bg-fill-3 focus:outline-none focus:ring-2 focus:ring-brand-ring ${
          disabled ? 'cursor-not-allowed text-fg-faint' : 'text-fg-muted hover:bg-fill-3'
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

      {open && !disabled && pos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={menuStyle}
            className={`overflow-hidden rounded-lg border border-line bg-elevated shadow-2xl ${menuClassName ?? ''}`}
          >
            <div className="max-h-72 overflow-y-auto">
              {(() => {
                const renderOption = (opt: DropdownOption) => {
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
                }
                if (groups) {
                  return groups
                    .filter((g) => g.options.length)
                    .map((g) => (
                      <div key={g.label}>
                        <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
                          {g.label}
                        </div>
                        {g.options.map(renderOption)}
                      </div>
                    ))
                }
                return (options ?? []).map(renderOption)
              })()}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
