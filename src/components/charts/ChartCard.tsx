import type { ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: string
  children: ReactNode
  height?: number
  empty?: boolean
  emptyLabel?: string
  className?: string
}

export default function ChartCard({
  title,
  subtitle,
  children,
  height = 240,
  empty = false,
  emptyLabel = 'Not enough data yet.',
  className = '',
}: Props) {
  return (
    <div
      className={`flex flex-col rounded-2xl border border-line bg-card p-5 ${className}`}
      style={{ height: height + 80 }}
    >
      <div className="mb-4">
        <h3 className="text-sm font-medium uppercase tracking-wider text-fg-muted">
          {title}
        </h3>
        {subtitle && <p className="mt-0.5 text-xs text-fg-subtle">{subtitle}</p>}
      </div>
      {empty ? (
        <div
          className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-line bg-card text-xs text-fg-subtle"
        >
          {emptyLabel}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">{children}</div>
      )}
    </div>
  )
}