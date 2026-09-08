type Tone = 'default' | 'danger' | 'warn' | 'brand'

interface Props {
  label: string
  value: number
  sub?: string
  tone?: Tone
  /** Omit (or pass a zero value) for a plain, non-clickable tile. */
  onClick?: () => void
}

// Literal class strings per tone — never interpolate a Tailwind class
// (src/lib/taskStatus.ts:21). Tone tints the NUMBER only; the card itself stays
// neutral so five tiles in a row still read as one instrument panel.
const VALUE_CLS: Record<Tone, string> = {
  default: 'text-fg',
  danger: 'text-tone-danger-fg',
  warn: 'text-tone-warn-fg',
  brand: 'text-brand',
}

const BASE_CLS =
  'flex w-full flex-col justify-between rounded-2xl border border-line bg-card p-5 text-left transition'
const CLICKABLE_CLS =
  'cursor-pointer hover:border-brand-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring'
// Muted rather than hidden: "0 overdue" is information worth reading.
const INERT_CLS = 'cursor-default opacity-60'

/**
 * One clickable number on the My Tasks surface. The WHOLE tile is the button —
 * KpiStatCard looks the same but is a <div> wrapping its own ⓘ button, and a
 * button inside a button is invalid HTML, so it cannot be reused here.
 *
 * A tile with nothing behind it (value 0, or no handler at all) renders inert:
 * clicking through to an empty drill-down panel is a dead end, so the tile
 * says so up front instead.
 */
export default function StatTile({ label, value, sub, tone = 'default', onClick }: Props) {
  const clickable = !!onClick && value > 0

  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      // aria-disabled, not `disabled`: the label and the number are still worth
      // reaching by keyboard and reading out — there is just nothing to open.
      aria-disabled={clickable ? undefined : true}
      className={`${BASE_CLS} ${clickable ? CLICKABLE_CLS : INERT_CLS}`}
    >
      <h3 className="text-xs font-medium uppercase tracking-wider text-fg-muted">{label}</h3>
      <span className={`mt-3 text-3xl font-semibold tracking-tight ${VALUE_CLS[tone]}`}>
        {value}
      </span>
      {sub && <p className="mt-1 text-xs text-fg-subtle">{sub}</p>}
    </button>
  )
}
