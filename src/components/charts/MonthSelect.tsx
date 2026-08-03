import { monthLabel } from '../../lib/kpi/format'

// Compact scope picker for a month-bucketed stat tile, sized to sit in the
// KpiStatCard header next to the ⓘ.
export default function MonthSelect({
  value,
  months,
  onChange,
  label,
}: {
  value: string
  months: string[]
  onChange: (month: string) => void
  label: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="-my-0.5 max-w-32 rounded-md border border-line bg-canvas px-1.5 py-0.5 text-[11px] font-medium text-fg-muted outline-none transition hover:text-fg focus:border-brand-edge focus:ring-2 focus:ring-brand-ring"
    >
      {months.map((m) => (
        <option key={m} value={m} className="bg-overlay">
          {monthLabel(m)}
        </option>
      ))}
    </select>
  )
}
