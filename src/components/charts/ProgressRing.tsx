import { formatPercent } from '../../lib/progress'
import ChartCard from './ChartCard'

interface Props {
  progress: number // 0..1
  title?: string
  subtitle?: string
  label?: string
}

export default function ProgressRing({
  progress,
  title = 'Overall progress',
  subtitle,
  label,
}: Props) {
  const pct = Math.max(0, Math.min(1, progress))
  const size = 180
  const stroke = 14
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dash = circumference * pct

  return (
    <ChartCard title={title} subtitle={subtitle} height={size + 24}>
      <div className="flex h-full items-center justify-center">
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <defs>
              <linearGradient id="progress-ring-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--color-brand)" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
            </defs>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="var(--color-line)"
              strokeWidth={stroke}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="url(#progress-ring-gradient)"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              style={{ transition: 'stroke-dasharray 600ms ease-out' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <div className="text-3xl font-semibold tracking-tight text-fg">
              {formatPercent(pct)}
            </div>
            {label && <div className="mt-1 text-xs text-fg-subtle">{label}</div>}
          </div>
        </div>
      </div>
    </ChartCard>
  )
}