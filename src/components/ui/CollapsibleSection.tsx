import { useState, type ReactNode, type Ref } from 'react'

type Tone = 'default' | 'brand' | 'warn'

interface Props {
  title: string
  description?: ReactNode
  /** Stays in the header, so the number is still readable while collapsed. */
  count?: number
  tone?: Tone
  /** Controlled mode: pass `open` + `onOpenChange`. Omit both to self-manage. */
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Sandbox tour anchor — see lib/tours/sixtySecondTour.ts. */
  tourId?: string
  className?: string
  ref?: Ref<HTMLElement>
  children: ReactNode
}

// Literal class strings per tone — never interpolate a Tailwind class
// (src/lib/taskStatus.ts:21).
const TONE_CLS: Record<Tone, string> = {
  default: 'text-fg-subtle',
  brand: 'text-brand',
  warn: 'text-tone-warn-fg',
}

/**
 * The page-section header used across /me: a rule, an uppercase eyebrow
 * heading, an optional description, and a Hide/Show pill that toggles the body.
 *
 * The body is mounted only while open, which is what lets a section make its
 * fetch on expand (MyTimeSection) instead of on page load — collapsing it
 * unmounts the body, so keep the fetch state in the caller, not in here.
 */
export default function CollapsibleSection({
  title,
  description,
  count,
  tone = 'default',
  open: controlledOpen,
  defaultOpen = true,
  onOpenChange,
  tourId,
  // Matches the spacing the existing call sites hard-coded, so lifting a
  // section into this component leaves the page layout untouched.
  className = 'mt-12',
  ref,
  children,
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const open = controlledOpen ?? uncontrolledOpen

  const toggle = () => {
    const next = !open
    // Only own the state when nobody else does, so a controlled parent stays
    // the single source of truth.
    if (controlledOpen === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  return (
    <section ref={ref} className={className} data-tour-id={tourId}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 border-t border-line-subtle pt-6 text-left transition hover:text-fg"
      >
        <div>
          <div className="flex items-center gap-2">
            <h2 className={`text-xs font-medium uppercase tracking-wider ${TONE_CLS[tone]}`}>
              {title}
            </h2>
            {count !== undefined && (
              <span className="rounded-full border border-line bg-fill-2 px-1.5 py-0.5 text-[10px] tabular-nums text-fg-muted">
                {count}
              </span>
            )}
          </div>
          {description && <p className="mt-1 text-xs text-fg-subtle">{description}</p>}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-fill-2 px-2.5 py-1 text-xs text-fg-muted transition hover:bg-fill-4 hover:text-fg">
          {open ? 'Hide' : 'Show'}
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${open ? '' : '-rotate-90'}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {open && <div className="mt-5">{children}</div>}
    </section>
  )
}
