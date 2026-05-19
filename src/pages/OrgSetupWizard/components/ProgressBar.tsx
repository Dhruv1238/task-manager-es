interface Props {
  current: number
  total: number
}

export default function ProgressBar({ current, total }: Props) {
  const pct = Math.max(0, Math.min(100, ((current - 1) / Math.max(1, total - 1)) * 100))
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-fg">Setup Assistant</h1>
        <p className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
          Step {current} of {total}
        </p>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-fill-2">
        <div
          className="h-full bg-brand-gradient transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
          aria-valuenow={current}
          aria-valuemin={1}
          aria-valuemax={total}
          role="progressbar"
        />
      </div>
    </div>
  )
}
