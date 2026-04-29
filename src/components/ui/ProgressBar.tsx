import { formatPercent } from '../../lib/progress'

interface Props {
  progress: number // 0..1
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  label?: string
  className?: string
}

const HEIGHTS: Record<NonNullable<Props['size']>, string> = {
  sm: 'h-1',
  md: 'h-1.5',
  lg: 'h-2',
}

export default function ProgressBar({
  progress,
  size = 'md',
  showLabel = true,
  label,
  className = '',
}: Props) {
  const pct = Math.max(0, Math.min(1, progress))
  const widthPercent = pct * 100

  return (
    <div className={className}>
      {showLabel && (
        <div className="mb-1 flex items-center justify-between text-xs text-white/60">
          <span>{label ?? 'Progress'}</span>
          <span className="font-medium text-white/85">{formatPercent(pct)}</span>
        </div>
      )}
      <div className={`overflow-hidden rounded-full bg-white/8 ${HEIGHTS[size]}`}>
        <div
          className="h-full rounded-full bg-linear-to-r from-purple-500 to-fuchsia-500 transition-[width] duration-500 ease-out"
          style={{ width: `${widthPercent}%` }}
          aria-valuenow={Math.round(widthPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
          role="progressbar"
        />
      </div>
    </div>
  )
}