import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { acquireScrollLock } from '../../lib/scrollLock'

type Size = 'sm' | 'md' | 'lg' | 'xl'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  size?: Size
  children: ReactNode
  closeOnBackdrop?: boolean
}

const sizeClasses: Record<Size, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

// Every open Modal binds its own document-level keydown, so Escape used to
// reach ALL of them at once. Modals nest here (a drill-down panel stays
// mounted while a task opened from it mounts a Modal on top, and that one
// answers Escape with navigate(-1)), so the stack decides: only the top-most
// modal handles the key, and the panel underneath survives until it is
// itself on top. Tokens are opaque objects compared by identity.
const openStack: object[] = []

export default function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
  closeOnBackdrop = true,
}: ModalProps) {
  const tokenRef = useRef<object | null>(null)

  // Stack membership gets its own effect, keyed on `open` alone: an unstable
  // onClose identity must not reshuffle the stack while the modal sits open
  // (same reasoning as the scroll lock below). The token is created inside the
  // effect — allocating it during render, or writing the ref there, is impure.
  useEffect(() => {
    if (!open) return
    const token = {}
    tokenRef.current = token
    openStack.push(token)
    // Splice this exact token out rather than pop(): unmount order is not
    // guaranteed to be the reverse of mount order.
    return () => {
      const i = openStack.indexOf(token)
      if (i !== -1) openStack.splice(i, 1)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (openStack[openStack.length - 1] !== tokenRef.current) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Separate effect, keyed on `open` alone: an unstable onClose identity must
  // not churn the lock while the modal sits open. Ref-counted because modals
  // nest (see lib/scrollLock.ts) — release order doesn't matter.
  useEffect(() => {
    if (!open) return
    return acquireScrollLock()
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden sm:max-h-[calc(100dvh-3rem)] ${sizeClasses[size]} rounded-2xl border border-line bg-card shadow-2xl`}
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <div className="absolute -left-24 -top-24 h-48 w-48 rounded-full bg-orb-a blur-3xl" />
          <div className="absolute -bottom-24 -right-24 h-48 w-48 rounded-full bg-orb-b blur-3xl" />
        </div>

        {(title || description) && (
          <div className="relative shrink-0 border-b border-line bg-surface/90 px-6 py-5 backdrop-blur">
            <div className="flex items-start justify-between gap-4">
              <div>
                {title && (
                  <h2 className="text-lg font-semibold tracking-tight text-fg">{title}</h2>
                )}
                {description && (
                  <p className="mt-1 text-sm text-fg-subtle">{description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="-mr-1 rounded-md p-1 text-fg-subtle transition hover:bg-fill-2 hover:text-fg-strong"
                aria-label="Close"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        )}
        <div className="scrollbar-themed relative min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
